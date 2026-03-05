import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { badRequest, errorResponseSchema } from '../lib/api-errors.js'
import { notificationQuerySchema, markReadSchema } from '../validation/notifications.js'
import { notifications } from '../db/schema/notifications.js'
import { users } from '../db/schema/users.js'
import { topics } from '../db/schema/topics.js'
import { replies } from '../db/schema/replies.js'
import { getCollectionFromUri } from '../lib/at-uri.js'

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const notificationJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    type: { type: 'string' as const },
    subjectUri: { type: 'string' as const },
    actorDid: { type: 'string' as const },
    actorHandle: { type: ['string', 'null'] as const },
    subjectTitle: { type: ['string', 'null'] as const },
    subjectAuthorDid: { type: ['string', 'null'] as const },
    subjectAuthorHandle: { type: ['string', 'null'] as const },
    message: { type: ['string', 'null'] as const },
    communityDid: { type: 'string' as const },
    read: { type: 'boolean' as const },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a notification row from the DB into a JSON-safe response object.
 * Converts Date fields to ISO strings.
 */
function serializeNotification(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    subjectUri: row.subjectUri,
    actorDid: row.actorDid,
    communityDid: row.communityDid,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Build a human-readable notification message.
 */
function buildNotificationMessage(
  type: string,
  actorHandle: string | null,
  subjectTitle: string | null
): string | null {
  const actor = actorHandle ?? 'Someone'
  const subject = subjectTitle ? `"${subjectTitle}"` : 'your content'

  switch (type) {
    case 'reply':
      return `${actor} replied to ${subject}`
    case 'reaction':
      return `${actor} reacted to ${subject}`
    case 'mention':
      return `${actor} mentioned you in ${subject}`
    case 'mod_action':
      return `A moderator took action on ${subject}`
    case 'cross_post_failed':
      return `Cross-post failed for ${subject}`
    case 'cross_post_revoked':
      return `Cross-post authorization was revoked`
    default:
      return null
  }
}

/**
 * Encode a pagination cursor from createdAt + id.
 */
function encodeCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64')
}

/**
 * Decode a pagination cursor. Returns null if invalid.
 */
function decodeCursor(cursor: string): { createdAt: string; id: number } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as Record<
      string,
      unknown
    >
    if (typeof decoded.createdAt === 'string' && typeof decoded.id === 'number') {
      return { createdAt: decoded.createdAt, id: decoded.id }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Notification routes plugin
// ---------------------------------------------------------------------------

/**
 * Notification routes for the Barazo forum.
 *
 * - GET  /api/notifications       -- List notifications (auth required)
 * - PUT  /api/notifications/read  -- Mark notification(s) as read (auth required)
 * - GET  /api/notifications/count -- Unread notification count (auth required)
 */
export function notificationRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, authMiddleware } = app

    // -------------------------------------------------------------------
    // GET /api/notifications (auth required)
    // -------------------------------------------------------------------

    app.get(
      '/api/notifications',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Notifications'],
          summary: 'List notifications for the authenticated user',
          security: [{ bearerAuth: [] }],
          querystring: {
            type: 'object',
            properties: {
              limit: { type: 'string' },
              cursor: { type: 'string' },
              unreadOnly: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                notifications: {
                  type: 'array',
                  items: notificationJsonSchema,
                },
                cursor: { type: ['string', 'null'] },
                total: { type: 'number' },
              },
            },
            400: errorResponseSchema,
            401: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const parsed = notificationQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { limit, cursor, unreadOnly } = parsed.data

        // Build conditions
        const conditions = [eq(notifications.recipientDid, user.did)]

        if (unreadOnly) {
          conditions.push(eq(notifications.read, false))
        }

        // Cursor-based pagination
        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            conditions.push(
              sql`(${notifications.read}, ${notifications.createdAt}, ${notifications.id}) > (${decoded.createdAt === 'unread' ? false : true}, ${decoded.createdAt === 'unread' ? decoded.createdAt : decoded.createdAt}::timestamptz, ${decoded.id})`
            )
          }
        }

        const whereClause = and(...conditions)

        // Fetch limit + 1 to detect if there are more pages
        const fetchLimit = limit + 1

        // Order: unread first (read=false < read=true), then newest first
        const rows = await db
          .select()
          .from(notifications)
          .where(whereClause)
          .orderBy(sql`${notifications.read} ASC`, desc(notifications.createdAt))
          .limit(fetchLimit)

        const hasMore = rows.length > limit
        const resultRows = hasMore ? rows.slice(0, limit) : rows
        const serialized = resultRows.map(serializeNotification)

        // Batch-resolve actor handles
        const actorDids = [...new Set(serialized.map((n) => n.actorDid))]
        const actorHandleMap = new Map<string, string>()
        if (actorDids.length > 0) {
          const actorRows = await db
            .select({ did: users.did, handle: users.handle })
            .from(users)
            .where(inArray(users.did, actorDids))
          for (const row of actorRows) {
            actorHandleMap.set(row.did, row.handle)
          }
        }

        // Batch-resolve subject titles and authors from topics and replies
        const subjectUris = [...new Set(serialized.map((n) => n.subjectUri))]
        const topicUris = subjectUris.filter(
          (uri) => getCollectionFromUri(uri) === 'forum.barazo.topic.post'
        )
        const replyUris = subjectUris.filter(
          (uri) => getCollectionFromUri(uri) === 'forum.barazo.topic.reply'
        )

        const subjectMap = new Map<
          string,
          { title: string | null; authorDid: string; authorHandle: string | null }
        >()

        if (topicUris.length > 0) {
          const topicRows = await db
            .select({
              uri: topics.uri,
              title: topics.title,
              authorDid: topics.authorDid,
            })
            .from(topics)
            .where(inArray(topics.uri, topicUris))
          for (const row of topicRows) {
            subjectMap.set(row.uri, {
              title: row.title,
              authorDid: row.authorDid,
              authorHandle: null,
            })
          }
        }

        if (replyUris.length > 0) {
          // For replies, look up the root topic title
          const replyRows = await db
            .select({
              uri: replies.uri,
              authorDid: replies.authorDid,
              rootUri: replies.rootUri,
            })
            .from(replies)
            .where(inArray(replies.uri, replyUris))

          // Get root topic titles for replies
          const rootUris = [...new Set(replyRows.map((r) => r.rootUri))]
          const rootTitleMap = new Map<string, string>()
          if (rootUris.length > 0) {
            const rootRows = await db
              .select({ uri: topics.uri, title: topics.title })
              .from(topics)
              .where(inArray(topics.uri, rootUris))
            for (const row of rootRows) {
              rootTitleMap.set(row.uri, row.title)
            }
          }

          for (const row of replyRows) {
            subjectMap.set(row.uri, {
              title: rootTitleMap.get(row.rootUri) ?? null,
              authorDid: row.authorDid,
              authorHandle: null,
            })
          }
        }

        // Resolve author handles for subjects
        const subjectAuthorDids = [
          ...new Set([...subjectMap.values()].map((s) => s.authorDid)),
        ]
        if (subjectAuthorDids.length > 0) {
          const authorRows = await db
            .select({ did: users.did, handle: users.handle })
            .from(users)
            .where(inArray(users.did, subjectAuthorDids))
          const handleMap = new Map(authorRows.map((r) => [r.did, r.handle]))
          for (const [, subject] of subjectMap) {
            subject.authorHandle = handleMap.get(subject.authorDid) ?? null
          }
        }

        // Enrich notifications
        const enriched = serialized.map((n) => {
          const actorHandle = actorHandleMap.get(n.actorDid) ?? null
          const subject = subjectMap.get(n.subjectUri)
          return {
            ...n,
            actorHandle,
            subjectTitle: subject?.title ?? null,
            subjectAuthorDid: subject?.authorDid ?? null,
            subjectAuthorHandle: subject?.authorHandle ?? null,
            message: buildNotificationMessage(n.type, actorHandle, subject?.title ?? null),
          }
        })

        // Get total count for the user
        const countResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(eq(notifications.recipientDid, user.did))

        const total = countResult[0]?.count ?? 0

        let nextCursor: string | null = null
        if (hasMore) {
          const lastRow = resultRows[resultRows.length - 1]
          if (lastRow) {
            nextCursor = encodeCursor(lastRow.createdAt.toISOString(), lastRow.id)
          }
        }

        return reply.status(200).send({
          notifications: enriched,
          cursor: nextCursor,
          total,
        })
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/notifications/read (auth required)
    // -------------------------------------------------------------------

    app.put(
      '/api/notifications/read',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Notifications'],
          summary: 'Mark notification(s) as read',
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            properties: {
              notificationId: { type: 'number' },
              all: { type: 'boolean' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
              },
            },
            400: errorResponseSchema,
            401: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const parsed = markReadSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid request body')
        }

        const { notificationId, all } = parsed.data

        if (!notificationId && !all) {
          throw badRequest('Either notificationId or all must be provided')
        }

        if (all) {
          // Mark all unread notifications as read for this user
          await db
            .update(notifications)
            .set({ read: true })
            .where(and(eq(notifications.recipientDid, user.did), eq(notifications.read, false)))
        } else if (notificationId) {
          // Mark a single notification as read (scoped to user)
          await db
            .update(notifications)
            .set({ read: true })
            .where(
              and(eq(notifications.id, notificationId), eq(notifications.recipientDid, user.did))
            )
        }

        return reply.status(200).send({ success: true })
      }
    )

    // -------------------------------------------------------------------
    // GET /api/notifications/count (auth required)
    // -------------------------------------------------------------------

    app.get(
      '/api/notifications/count',
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ['Notifications'],
          summary: 'Get unread notification count',
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: 'object',
              properties: {
                unread: { type: 'number' },
              },
            },
            401: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const countResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.recipientDid, user.did), eq(notifications.read, false)))

        const unread = countResult[0]?.count ?? 0

        return reply.status(200).send({ unread })
      }
    )

    done()
  }
}

import { eq, and, sql, desc } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { badRequest } from '../lib/api-errors.js'
import { notificationQuerySchema, markReadSchema } from '../validation/notifications.js'
import { notifications } from '../db/schema/notifications.js'

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
    communityDid: { type: 'string' as const },
    read: { type: 'boolean' as const },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

const errorJsonSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
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
            400: errorJsonSchema,
            401: errorJsonSchema,
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
          notifications: serialized,
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
            400: errorJsonSchema,
            401: errorJsonSchema,
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
            401: errorJsonSchema,
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

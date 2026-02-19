import { eq, and, desc, sql } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { notFound, badRequest, conflict } from '../lib/api-errors.js'
import { wordFilterSchema, queueActionSchema, queueQuerySchema } from '../validation/anti-spam.js'
import { moderationQueue } from '../db/schema/moderation-queue.js'
import { accountTrust } from '../db/schema/account-trust.js'
import { topics } from '../db/schema/topics.js'
import { replies } from '../db/schema/replies.js'
import { communitySettings } from '../db/schema/community-settings.js'
import { createRequireModerator } from '../auth/require-moderator.js'

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const errorJsonSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
  },
}

const queueItemJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    contentUri: { type: 'string' as const },
    contentType: { type: 'string' as const },
    authorDid: { type: 'string' as const },
    queueReason: { type: 'string' as const },
    matchedWords: {
      type: ['array', 'null'] as const,
      items: { type: 'string' as const },
    },
    status: { type: 'string' as const },
    reviewedBy: { type: ['string', 'null'] as const },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
    reviewedAt: { type: ['string', 'null'] as const },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeQueueItem(row: typeof moderationQueue.$inferSelect) {
  return {
    id: row.id,
    contentUri: row.contentUri,
    contentType: row.contentType,
    authorDid: row.authorDid,
    queueReason: row.queueReason,
    matchedWords: row.matchedWords ?? null,
    status: row.status,
    reviewedBy: row.reviewedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  }
}

function encodeCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64')
}

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
// Routes
// ---------------------------------------------------------------------------

export function moderationQueueRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware } = app
    const requireModerator = createRequireModerator(db, authMiddleware, app.log)
    const requireAdmin = app.requireAdmin
    const communityDid = env.COMMUNITY_DID ?? 'did:plc:placeholder'

    // -------------------------------------------------------------------
    // GET /api/moderation/queue (moderator+)
    // -------------------------------------------------------------------

    app.get(
      '/api/moderation/queue',
      {
        preHandler: [requireModerator],
        schema: {
          tags: ['Moderation'],
          summary: 'List moderation queue items (paginated)',
          security: [{ bearerAuth: [] }],
          querystring: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['pending', 'approved', 'rejected'],
              },
              queueReason: {
                type: 'string',
                enum: ['word_filter', 'first_post', 'link_hold', 'burst', 'topic_delay'],
              },
              cursor: { type: 'string' },
              limit: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                items: { type: 'array', items: queueItemJsonSchema },
                cursor: { type: ['string', 'null'] },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = queueQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { status, queueReason, cursor, limit } = parsed.data
        const conditions = [eq(moderationQueue.communityDid, communityDid)]

        conditions.push(eq(moderationQueue.status, status))

        if (queueReason) {
          conditions.push(eq(moderationQueue.queueReason, queueReason))
        }

        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            conditions.push(
              sql`(${moderationQueue.createdAt}, ${moderationQueue.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id})`
            )
          }
        }

        const whereClause = and(...conditions)
        const fetchLimit = limit + 1

        const rows = await db
          .select()
          .from(moderationQueue)
          .where(whereClause)
          .orderBy(desc(moderationQueue.createdAt))
          .limit(fetchLimit)

        const hasMore = rows.length > limit
        const resultRows = hasMore ? rows.slice(0, limit) : rows

        let nextCursor: string | null = null
        if (hasMore) {
          const lastRow = resultRows[resultRows.length - 1]
          if (lastRow) {
            nextCursor = encodeCursor(lastRow.createdAt.toISOString(), lastRow.id)
          }
        }

        return reply.status(200).send({
          items: resultRows.map(serializeQueueItem),
          cursor: nextCursor,
        })
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/moderation/queue/:id (moderator+)
    // -------------------------------------------------------------------

    app.put(
      '/api/moderation/queue/:id',
      {
        preHandler: [requireModerator],
        schema: {
          tags: ['Moderation'],
          summary: 'Approve or reject a queued item',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
          body: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['approve', 'reject'] },
            },
          },
          response: {
            200: queueItemJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
            403: errorJsonSchema,
            404: errorJsonSchema,
            409: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const { id } = request.params as { id: string }
        const queueId = Number(id)
        if (Number.isNaN(queueId)) {
          throw badRequest('Invalid queue item ID')
        }

        const parsed = queueActionSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid action')
        }

        const { action } = parsed.data

        // Fetch the queue item
        const existing = await db
          .select()
          .from(moderationQueue)
          .where(
            and(eq(moderationQueue.id, queueId), eq(moderationQueue.communityDid, communityDid))
          )

        const item = existing[0]
        if (!item) {
          throw notFound('Queue item not found')
        }

        if (item.status !== 'pending') {
          throw conflict('Queue item already reviewed')
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected'
        const contentStatus = action === 'approve' ? 'approved' : 'rejected'

        await db.transaction(async (tx) => {
          // Update queue item
          await tx
            .update(moderationQueue)
            .set({
              status: newStatus,
              reviewedBy: user.did,
              reviewedAt: new Date(),
            })
            .where(eq(moderationQueue.id, queueId))

          // Update content moderation status
          if (item.contentType === 'topic') {
            await tx
              .update(topics)
              .set({ moderationStatus: contentStatus })
              .where(eq(topics.uri, item.contentUri))
          } else {
            await tx
              .update(replies)
              .set({ moderationStatus: contentStatus })
              .where(eq(replies.uri, item.contentUri))
          }

          // On approve: increment account trust
          if (action === 'approve') {
            // Check if there are other pending queue items for the same content URI
            // Only increment trust once per content item (not per queue reason)
            const otherPending = await tx
              .select({ id: moderationQueue.id })
              .from(moderationQueue)
              .where(
                and(
                  eq(moderationQueue.contentUri, item.contentUri),
                  eq(moderationQueue.status, 'pending'),
                  sql`${moderationQueue.id} != ${queueId}`
                )
              )

            // Also approve any other pending queue items for the same content
            if (otherPending.length > 0) {
              await tx
                .update(moderationQueue)
                .set({
                  status: 'approved',
                  reviewedBy: user.did,
                  reviewedAt: new Date(),
                })
                .where(
                  and(
                    eq(moderationQueue.contentUri, item.contentUri),
                    eq(moderationQueue.status, 'pending')
                  )
                )
            }

            // Upsert account trust
            const existingTrust = await tx
              .select()
              .from(accountTrust)
              .where(
                and(
                  eq(accountTrust.did, item.authorDid),
                  eq(accountTrust.communityDid, communityDid)
                )
              )

            // Load thresholds for trust check
            const settingsRows = await tx
              .select({
                moderationThresholds: communitySettings.moderationThresholds,
              })
              .from(communitySettings)
              .where(eq(communitySettings.id, 'default'))
            const trustedPostThreshold =
              settingsRows[0]?.moderationThresholds.trustedPostThreshold ?? 10

            if (existingTrust.length > 0) {
              const newCount = (existingTrust[0]?.approvedPostCount ?? 0) + 1
              const nowTrusted = newCount >= trustedPostThreshold

              await tx
                .update(accountTrust)
                .set({
                  approvedPostCount: newCount,
                  isTrusted: nowTrusted,
                  ...(nowTrusted && !existingTrust[0]?.isTrusted ? { trustedAt: new Date() } : {}),
                })
                .where(
                  and(
                    eq(accountTrust.did, item.authorDid),
                    eq(accountTrust.communityDid, communityDid)
                  )
                )
            } else {
              const nowTrusted = 1 >= trustedPostThreshold
              await tx.insert(accountTrust).values({
                did: item.authorDid,
                communityDid,
                approvedPostCount: 1,
                isTrusted: nowTrusted,
                ...(nowTrusted ? { trustedAt: new Date() } : {}),
              })
            }
          }
        })

        app.log.info(
          {
            queueId,
            action,
            contentUri: item.contentUri,
            reviewedBy: user.did,
          },
          `Queue item ${action}d`
        )

        // Fetch updated item
        const updated = await db
          .select()
          .from(moderationQueue)
          .where(eq(moderationQueue.id, queueId))

        const updatedItem = updated[0]
        if (!updatedItem) {
          throw notFound('Queue item not found after update')
        }

        return reply.status(200).send(serializeQueueItem(updatedItem))
      }
    )

    // -------------------------------------------------------------------
    // GET /api/admin/moderation/word-filter (admin only)
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/moderation/word-filter',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Get word filter list',
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: 'object',
              properties: {
                words: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
      async (_request, reply) => {
        const rows = await db
          .select({ wordFilter: communitySettings.wordFilter })
          .from(communitySettings)
          .where(eq(communitySettings.id, 'default'))

        const words = rows[0]?.wordFilter ?? []

        return reply.status(200).send({ words })
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/admin/moderation/word-filter (admin only)
    // -------------------------------------------------------------------

    app.put(
      '/api/admin/moderation/word-filter',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Update word filter list',
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            required: ['words'],
            properties: {
              words: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 100 },
                maxItems: 500,
              },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                words: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = wordFilterSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid word filter data')
        }

        // Deduplicate and normalize to lowercase
        const words = [...new Set(parsed.data.words.map((w) => w.toLowerCase()))]

        await db
          .update(communitySettings)
          .set({ wordFilter: words })
          .where(eq(communitySettings.id, 'default'))

        // Invalidate cached anti-spam settings
        try {
          await app.cache.del(`antispam:settings:${communityDid}`)
        } catch {
          // Non-critical
        }

        app.log.info({ wordCount: words.length }, 'Word filter updated')

        return reply.status(200).send({ words })
      }
    )

    done()
  }
}

import { eq, and, desc, sql, count } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { notFound, badRequest, tooManyRequests } from '../lib/api-errors.js'
import {
  trustSeedCreateSchema,
  trustSeedQuerySchema,
  clusterQuerySchema,
  clusterStatusUpdateSchema,
  pdsTrustUpdateSchema,
  pdsTrustQuerySchema,
  behavioralFlagUpdateSchema,
  behavioralFlagQuerySchema,
} from '../validation/sybil.js'
import { trustSeeds } from '../db/schema/trust-seeds.js'
import { sybilClusters } from '../db/schema/sybil-clusters.js'
import { sybilClusterMembers } from '../db/schema/sybil-cluster-members.js'
import { users } from '../db/schema/users.js'
import { trustScores } from '../db/schema/trust-scores.js'
import { interactionGraph } from '../db/schema/interaction-graph.js'
import { behavioralFlags } from '../db/schema/behavioral-flags.js'
import { pdsTrustFactors } from '../db/schema/pds-trust-factors.js'

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const errorJsonSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
  },
}

const trustSeedJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    did: { type: 'string' as const },
    handle: { type: ['string', 'null'] as const },
    displayName: { type: ['string', 'null'] as const },
    communityId: { type: ['string', 'null'] as const },
    addedBy: { type: 'string' as const },
    reason: { type: ['string', 'null'] as const },
    implicit: { type: 'boolean' as const },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

const sybilClusterJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    clusterHash: { type: 'string' as const },
    internalEdgeCount: { type: 'number' as const },
    externalEdgeCount: { type: 'number' as const },
    memberCount: { type: 'number' as const },
    suspicionRatio: { type: 'number' as const },
    status: { type: 'string' as const },
    reviewedBy: { type: ['string', 'null'] as const },
    reviewedAt: { type: ['string', 'null'] as const },
    detectedAt: { type: 'string' as const, format: 'date-time' as const },
    updatedAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

const pdsTrustJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    pdsHost: { type: 'string' as const },
    trustFactor: { type: 'number' as const },
    isDefault: { type: 'boolean' as const },
    updatedAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

const behavioralFlagJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    flagType: { type: 'string' as const },
    affectedDids: { type: 'array' as const, items: { type: 'string' as const } },
    details: { type: 'string' as const },
    status: { type: 'string' as const },
    detectedAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

const clusterMemberJsonSchema = {
  type: 'object' as const,
  properties: {
    did: { type: 'string' as const },
    handle: { type: ['string', 'null'] as const },
    displayName: { type: ['string', 'null'] as const },
    trustScore: { type: ['number', 'null'] as const },
    reputationScore: { type: 'number' as const },
    accountAge: { type: ['string', 'null'] as const },
    roleInCluster: { type: 'string' as const },
    joinedAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface TrustSeedWithUser {
  seed: typeof trustSeeds.$inferSelect
  handle: string | null
  displayName: string | null
}

function serializeTrustSeed(row: TrustSeedWithUser, implicit: boolean) {
  return {
    id: row.seed.id,
    did: row.seed.did,
    handle: row.handle,
    displayName: row.displayName,
    communityId: row.seed.communityId || null, // Convert "" sentinel back to null for API
    addedBy: row.seed.addedBy,
    reason: row.seed.reason,
    implicit,
    createdAt: row.seed.createdAt.toISOString(),
  }
}

function computeSuspicionRatio(internalEdgeCount: number, externalEdgeCount: number): number {
  const total = internalEdgeCount + externalEdgeCount
  return total > 0 ? internalEdgeCount / total : 0
}

function serializeCluster(row: typeof sybilClusters.$inferSelect) {
  return {
    id: row.id,
    clusterHash: row.clusterHash,
    internalEdgeCount: row.internalEdgeCount,
    externalEdgeCount: row.externalEdgeCount,
    memberCount: row.memberCount,
    suspicionRatio: computeSuspicionRatio(row.internalEdgeCount, row.externalEdgeCount),
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    detectedAt: row.detectedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializePdsTrust(row: typeof pdsTrustFactors.$inferSelect) {
  return {
    id: row.id,
    pdsHost: row.pdsHost,
    trustFactor: row.trustFactor,
    isDefault: row.isDefault,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeBehavioralFlag(row: typeof behavioralFlags.$inferSelect) {
  return {
    id: row.id,
    flagType: row.flagType,
    affectedDids: row.affectedDids,
    details: row.details,
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
  }
}

// Rate limit key for trust graph recompute
const RECOMPUTE_CACHE_KEY = 'trust-graph:last-recompute'
const RECOMPUTE_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/** Fire-and-forget trust graph recomputation. */
function triggerRecompute(app: {
  trustGraphService: { computeTrustScores(communityId: string | null): Promise<unknown> }
  log: { warn(obj: unknown, msg: string): void; info(msg: string): void }
}): void {
  app.log.info('Triggering fire-and-forget trust graph recompute')
  app.trustGraphService.computeTrustScores(null).catch((err: unknown) => {
    app.log.warn({ err }, 'Trust graph recompute failed')
  })
}

// ---------------------------------------------------------------------------
// Admin sybil routes plugin
// ---------------------------------------------------------------------------

export function adminSybilRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, cache } = app
    const requireAdmin = app.requireAdmin

    // =======================================================================
    // TRUST SEED ROUTES
    // =======================================================================

    // -------------------------------------------------------------------
    // GET /api/admin/trust-seeds
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/trust-seeds',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'List trust seeds (including implicit seeds from mods/admins)',
          security: [{ bearerAuth: [] }],
          querystring: {
            type: 'object',
            properties: {
              cursor: { type: 'string' },
              limit: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                seeds: { type: 'array', items: trustSeedJsonSchema },
                cursor: { type: ['string', 'null'] },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = trustSeedQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { cursor, limit } = parsed.data

        // Fetch explicit trust seeds joined with users for handle/displayName
        const conditions = []
        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            conditions.push(
              sql`(${trustSeeds.createdAt}, ${trustSeeds.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id})`
            )
          }
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined
        const fetchLimit = limit + 1

        const explicitRows = await db
          .select({
            seed: trustSeeds,
            handle: users.handle,
            displayName: users.displayName,
          })
          .from(trustSeeds)
          .leftJoin(users, eq(trustSeeds.did, users.did))
          .where(whereClause)
          .orderBy(desc(trustSeeds.createdAt))
          .limit(fetchLimit)

        const hasMore = explicitRows.length > limit
        const resultRows = hasMore ? explicitRows.slice(0, limit) : explicitRows

        // Fetch implicit seeds (admins and moderators)
        const implicitUsers = await db
          .select({
            did: users.did,
            handle: users.handle,
            displayName: users.displayName,
            role: users.role,
            firstSeenAt: users.firstSeenAt,
          })
          .from(users)
          .where(sql`${users.role} IN ('admin', 'moderator')`)

        // Merge explicit seeds with implicit ones
        const explicitDids = new Set(resultRows.map((r) => r.seed.did))
        const implicitSeeds = implicitUsers
          .filter((u) => !explicitDids.has(u.did))
          .map((u) => ({
            id: 0,
            did: u.did,
            handle: u.handle,
            displayName: u.displayName,
            communityId: null,
            addedBy: 'system',
            reason: `Implicit trust seed (${u.role})`,
            implicit: true,
            createdAt: u.firstSeenAt.toISOString(),
          }))

        let nextCursor: string | null = null
        if (hasMore) {
          const lastRow = resultRows[resultRows.length - 1]
          if (lastRow) {
            nextCursor = encodeCursor(lastRow.seed.createdAt.toISOString(), lastRow.seed.id)
          }
        }

        return reply.status(200).send({
          seeds: [...resultRows.map((r) => serializeTrustSeed(r, false)), ...implicitSeeds],
          cursor: nextCursor,
        })
      }
    )

    // -------------------------------------------------------------------
    // POST /api/admin/trust-seeds
    // -------------------------------------------------------------------

    app.post(
      '/api/admin/trust-seeds',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Add a trust seed (triggers trust graph recompute)',
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            required: ['did'],
            properties: {
              did: { type: 'string', minLength: 1 },
              communityId: { type: 'string' },
              reason: { type: 'string', maxLength: 500 },
            },
          },
          response: {
            201: trustSeedJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
            403: errorJsonSchema,
            404: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const admin = request.user
        if (!admin) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const parsed = trustSeedCreateSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid trust seed data')
        }

        const { did, communityId, reason } = parsed.data

        // Validate DID exists in users table and fetch handle/displayName
        const userRows = await db
          .select({ did: users.did, handle: users.handle, displayName: users.displayName })
          .from(users)
          .where(eq(users.did, did))

        if (userRows.length === 0) {
          throw notFound('User not found')
        }

        const inserted = await db
          .insert(trustSeeds)
          .values({
            did,
            communityId: communityId ?? '',
            addedBy: admin.did,
            reason: reason ?? null,
          })
          .returning()

        const seed = inserted[0]
        if (!seed) {
          throw badRequest('Failed to create trust seed')
        }

        app.log.info({ seedId: seed.id, did, addedBy: admin.did }, 'Trust seed added')

        // Fire-and-forget trust graph recomputation
        triggerRecompute(app)

        const user = userRows[0]
        return reply
          .status(201)
          .send(
            serializeTrustSeed(
              { seed, handle: user?.handle ?? null, displayName: user?.displayName ?? null },
              false
            )
          )
      }
    )

    // -------------------------------------------------------------------
    // DELETE /api/admin/trust-seeds/:id
    // -------------------------------------------------------------------

    app.delete(
      '/api/admin/trust-seeds/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Remove a trust seed (triggers recompute)',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
          response: {
            204: { type: 'null' as const },
            400: errorJsonSchema,
            404: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string }
        const seedId = Number(id)
        if (Number.isNaN(seedId)) {
          throw badRequest('Invalid seed ID')
        }

        const existing = await db
          .select({ id: trustSeeds.id })
          .from(trustSeeds)
          .where(eq(trustSeeds.id, seedId))

        if (existing.length === 0) {
          throw notFound('Trust seed not found')
        }

        await db.delete(trustSeeds).where(eq(trustSeeds.id, seedId))

        app.log.info({ seedId }, 'Trust seed removed')

        // Fire-and-forget trust graph recomputation
        triggerRecompute(app)

        return reply.status(204).send()
      }
    )

    // =======================================================================
    // SYBIL CLUSTER ROUTES
    // =======================================================================

    // -------------------------------------------------------------------
    // GET /api/admin/sybil-clusters
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/sybil-clusters',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'List sybil clusters (paginated, filterable)',
          security: [{ bearerAuth: [] }],
          querystring: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['flagged', 'dismissed', 'monitoring', 'banned'] },
              cursor: { type: 'string' },
              limit: { type: 'string' },
              sort: { type: 'string', enum: ['detected_at', 'member_count', 'confidence'] },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                clusters: { type: 'array', items: sybilClusterJsonSchema },
                cursor: { type: ['string', 'null'] },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = clusterQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { status, cursor, limit, sort } = parsed.data
        const conditions = []

        if (status) {
          conditions.push(eq(sybilClusters.status, status))
        }

        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            conditions.push(
              sql`(${sybilClusters.detectedAt}, ${sybilClusters.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id})`
            )
          }
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined
        const fetchLimit = limit + 1

        // Determine sort order
        let orderByCol
        switch (sort) {
          case 'member_count':
            orderByCol = desc(sybilClusters.memberCount)
            break
          case 'confidence':
            // L5: Sort by suspicion ratio (internal / (internal + external))
            orderByCol = desc(
              sql`CASE WHEN (${sybilClusters.internalEdgeCount} + ${sybilClusters.externalEdgeCount}) > 0
                THEN ${sybilClusters.internalEdgeCount}::real / (${sybilClusters.internalEdgeCount} + ${sybilClusters.externalEdgeCount})::real
                ELSE 0 END`
            )
            break
          default:
            orderByCol = desc(sybilClusters.detectedAt)
        }

        const rows = await db
          .select()
          .from(sybilClusters)
          .where(whereClause)
          .orderBy(orderByCol)
          .limit(fetchLimit)

        const hasMore = rows.length > limit
        const resultRows = hasMore ? rows.slice(0, limit) : rows

        let nextCursor: string | null = null
        if (hasMore) {
          const lastRow = resultRows[resultRows.length - 1]
          if (lastRow) {
            nextCursor = encodeCursor(lastRow.detectedAt.toISOString(), lastRow.id)
          }
        }

        return reply.status(200).send({
          clusters: resultRows.map(serializeCluster),
          cursor: nextCursor,
        })
      }
    )

    // -------------------------------------------------------------------
    // GET /api/admin/sybil-clusters/:id
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/sybil-clusters/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Get sybil cluster detail with enriched member list',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                ...sybilClusterJsonSchema.properties,
                members: {
                  type: 'array',
                  items: clusterMemberJsonSchema,
                },
              },
            },
            400: errorJsonSchema,
            404: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string }
        const clusterId = Number(id)
        if (Number.isNaN(clusterId)) {
          throw badRequest('Invalid cluster ID')
        }

        const clusterRows = await db
          .select()
          .from(sybilClusters)
          .where(eq(sybilClusters.id, clusterId))

        const cluster = clusterRows[0]
        if (!cluster) {
          throw notFound('Sybil cluster not found')
        }

        // M5: Enriched member list with user data and trust scores
        const members = await db
          .select({
            did: sybilClusterMembers.did,
            roleInCluster: sybilClusterMembers.roleInCluster,
            joinedAt: sybilClusterMembers.joinedAt,
            handle: users.handle,
            displayName: users.displayName,
            reputationScore: users.reputationScore,
            accountCreatedAt: users.accountCreatedAt,
            trustScore: trustScores.score,
          })
          .from(sybilClusterMembers)
          .leftJoin(users, eq(sybilClusterMembers.did, users.did))
          .leftJoin(trustScores, eq(sybilClusterMembers.did, trustScores.did))
          .where(eq(sybilClusterMembers.clusterId, clusterId))

        return reply.status(200).send({
          ...serializeCluster(cluster),
          members: members.map((m) => ({
            did: m.did,
            handle: m.handle ?? null,
            displayName: m.displayName ?? null,
            trustScore: m.trustScore ?? null,
            reputationScore: m.reputationScore ?? 0,
            accountAge: m.accountCreatedAt?.toISOString() ?? null,
            roleInCluster: m.roleInCluster,
            joinedAt: m.joinedAt.toISOString(),
          })),
        })
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/admin/sybil-clusters/:id
    // -------------------------------------------------------------------

    app.put(
      '/api/admin/sybil-clusters/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Update sybil cluster status (handles ban propagation)',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
          body: {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['dismissed', 'monitoring', 'banned'] },
            },
          },
          response: {
            200: sybilClusterJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
            403: errorJsonSchema,
            404: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const admin = request.user
        if (!admin) {
          return reply.status(401).send({ error: 'Authentication required' })
        }

        const { id } = request.params as { id: string }
        const clusterId = Number(id)
        if (Number.isNaN(clusterId)) {
          throw badRequest('Invalid cluster ID')
        }

        const parsed = clusterStatusUpdateSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid status update')
        }

        const clusterRows = await db
          .select()
          .from(sybilClusters)
          .where(eq(sybilClusters.id, clusterId))

        const cluster = clusterRows[0]
        if (!cluster) {
          throw notFound('Sybil cluster not found')
        }

        const now = new Date()
        const updated = await db
          .update(sybilClusters)
          .set({
            status: parsed.data.status,
            reviewedBy: admin.did,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(sybilClusters.id, clusterId))
          .returning()

        const updatedCluster = updated[0]
        if (!updatedCluster) {
          throw notFound('Cluster not found after update')
        }

        // If status is 'banned', propagate ban to all cluster members
        if (parsed.data.status === 'banned') {
          const members = await db
            .select({ did: sybilClusterMembers.did })
            .from(sybilClusterMembers)
            .where(eq(sybilClusterMembers.clusterId, clusterId))

          for (const member of members) {
            await db.update(users).set({ isBanned: true }).where(eq(users.did, member.did))
          }

          app.log.warn(
            {
              clusterId,
              bannedDids: members.map((m) => m.did),
              adminDid: admin.did,
            },
            'Sybil cluster banned, propagated to all members'
          )
        } else {
          app.log.info(
            { clusterId, status: parsed.data.status, adminDid: admin.did },
            'Sybil cluster status updated'
          )
        }

        return reply.status(200).send(serializeCluster(updatedCluster))
      }
    )

    // =======================================================================
    // PDS TRUST FACTOR ROUTES
    // =======================================================================

    // -------------------------------------------------------------------
    // GET /api/admin/pds-trust
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/pds-trust',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'List PDS trust factors (with defaults)',
          security: [{ bearerAuth: [] }],
          querystring: {
            type: 'object',
            properties: {
              cursor: { type: 'string' },
              limit: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                factors: { type: 'array', items: pdsTrustJsonSchema },
                cursor: { type: ['string', 'null'] },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = pdsTrustQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { cursor, limit } = parsed.data
        const conditions = []

        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            conditions.push(
              sql`(${pdsTrustFactors.updatedAt}, ${pdsTrustFactors.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id})`
            )
          }
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined
        const fetchLimit = limit + 1

        const rows = await db
          .select()
          .from(pdsTrustFactors)
          .where(whereClause)
          .orderBy(desc(pdsTrustFactors.updatedAt))
          .limit(fetchLimit)

        const hasMore = rows.length > limit
        const resultRows = hasMore ? rows.slice(0, limit) : rows

        let nextCursor: string | null = null
        if (hasMore) {
          const lastRow = resultRows[resultRows.length - 1]
          if (lastRow) {
            nextCursor = encodeCursor(lastRow.updatedAt.toISOString(), lastRow.id)
          }
        }

        return reply.status(200).send({
          factors: resultRows.map(serializePdsTrust),
          cursor: nextCursor,
        })
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/admin/pds-trust
    // -------------------------------------------------------------------

    app.put(
      '/api/admin/pds-trust',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Create or update PDS trust factor override',
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            required: ['pdsHost', 'trustFactor'],
            properties: {
              pdsHost: { type: 'string', minLength: 1 },
              trustFactor: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          response: {
            200: pdsTrustJsonSchema,
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = pdsTrustUpdateSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid PDS trust data')
        }

        const { pdsHost, trustFactor } = parsed.data
        const now = new Date()

        const upserted = await db
          .insert(pdsTrustFactors)
          .values({
            pdsHost,
            trustFactor,
            isDefault: false,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [pdsTrustFactors.pdsHost],
            set: {
              trustFactor,
              isDefault: false,
              updatedAt: now,
            },
          })
          .returning()

        const row = upserted[0]
        if (!row) {
          throw badRequest('Failed to upsert PDS trust factor')
        }

        app.log.info({ pdsHost, trustFactor }, 'PDS trust factor updated')

        return reply.status(200).send(serializePdsTrust(row))
      }
    )

    // =======================================================================
    // TRUST GRAPH ADMIN ROUTES
    // =======================================================================

    // -------------------------------------------------------------------
    // POST /api/admin/trust-graph/recompute
    // -------------------------------------------------------------------

    app.post(
      '/api/admin/trust-graph/recompute',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Trigger trust graph recomputation (rate limited: 1/hour)',
          security: [{ bearerAuth: [] }],
          response: {
            202: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                startedAt: { type: 'string', format: 'date-time' },
              },
            },
            429: errorJsonSchema,
          },
        },
      },
      async (_request, reply) => {
        // Rate limit: 1 recompute per hour
        try {
          const lastRecompute = await cache.get(RECOMPUTE_CACHE_KEY)
          if (lastRecompute) {
            const lastTime = Number(lastRecompute)
            if (Date.now() - lastTime < RECOMPUTE_COOLDOWN_MS) {
              throw tooManyRequests('Trust graph recompute is rate limited to once per hour')
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('rate limited')) {
            throw err
          }
          // Cache errors are non-critical, proceed
        }

        const now = new Date()

        // Mark recompute as started in cache
        try {
          await cache.set(RECOMPUTE_CACHE_KEY, String(now.getTime()), 'EX', 3600)
        } catch {
          // Non-critical
        }

        // H5: Trigger actual trust graph recomputation (fire-and-forget)
        triggerRecompute(app)

        return reply.status(202).send({
          message: 'Trust graph recomputation started',
          startedAt: now.toISOString(),
        })
      }
    )

    // -------------------------------------------------------------------
    // GET /api/admin/trust-graph/status
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/trust-graph/status',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Get trust graph computation stats',
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: 'object',
              properties: {
                lastComputedAt: { type: ['string', 'null'] },
                totalNodes: { type: 'number' },
                totalEdges: { type: 'number' },
                computationDurationMs: { type: ['number', 'null'] },
                clustersFlagged: { type: 'number' },
                nextScheduledAt: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
      async (_request, reply) => {
        // Get last recompute time from cache
        let lastComputedAt: string | null = null
        let computationDurationMs: number | null = null
        let nextScheduledAt: string | null = null
        try {
          const cached = await cache.get(RECOMPUTE_CACHE_KEY)
          if (cached) {
            const lastTime = Number(cached)
            lastComputedAt = new Date(lastTime).toISOString()
            // Next scheduled: 1 hour after last computation
            nextScheduledAt = new Date(lastTime + RECOMPUTE_COOLDOWN_MS).toISOString()
          }

          // Check for stored duration
          const durationCached = await cache.get('trust-graph:last-duration-ms')
          if (durationCached) {
            computationDurationMs = Number(durationCached)
          }
        } catch {
          // Non-critical
        }

        // C2: Get counts from database using Drizzle ORM (no raw SQL)
        const [nodeRows, edgeRows, flaggedRows] = await Promise.all([
          db.select({ nodeCount: count() }).from(trustScores),
          db.select({ edgeCount: count() }).from(interactionGraph),
          db
            .select({ flaggedCount: count() })
            .from(sybilClusters)
            .where(eq(sybilClusters.status, 'flagged')),
        ])

        return reply.status(200).send({
          lastComputedAt,
          totalNodes: nodeRows[0]?.nodeCount ?? 0,
          totalEdges: edgeRows[0]?.edgeCount ?? 0,
          computationDurationMs,
          clustersFlagged: flaggedRows[0]?.flaggedCount ?? 0,
          nextScheduledAt,
        })
      }
    )

    // =======================================================================
    // BEHAVIORAL FLAGS ROUTES
    // =======================================================================

    // -------------------------------------------------------------------
    // GET /api/admin/behavioral-flags
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/behavioral-flags',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'List behavioral flags (paginated)',
          security: [{ bearerAuth: [] }],
          querystring: {
            type: 'object',
            properties: {
              flagType: {
                type: 'string',
                enum: ['burst_voting', 'content_similarity', 'low_diversity'],
              },
              status: { type: 'string', enum: ['pending', 'dismissed', 'action_taken'] },
              cursor: { type: 'string' },
              limit: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                flags: { type: 'array', items: behavioralFlagJsonSchema },
                cursor: { type: ['string', 'null'] },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = behavioralFlagQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid query parameters')
        }

        const { flagType, status, cursor, limit } = parsed.data
        const conditions = []

        if (flagType) {
          conditions.push(eq(behavioralFlags.flagType, flagType))
        }
        if (status) {
          conditions.push(eq(behavioralFlags.status, status))
        }
        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            conditions.push(
              sql`(${behavioralFlags.detectedAt}, ${behavioralFlags.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id})`
            )
          }
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined
        const fetchLimit = limit + 1

        const rows = await db
          .select()
          .from(behavioralFlags)
          .where(whereClause)
          .orderBy(desc(behavioralFlags.detectedAt))
          .limit(fetchLimit)

        const hasMore = rows.length > limit
        const resultRows = hasMore ? rows.slice(0, limit) : rows

        let nextCursor: string | null = null
        if (hasMore) {
          const lastRow = resultRows[resultRows.length - 1]
          if (lastRow) {
            nextCursor = encodeCursor(lastRow.detectedAt.toISOString(), lastRow.id)
          }
        }

        return reply.status(200).send({
          flags: resultRows.map(serializeBehavioralFlag),
          cursor: nextCursor,
        })
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/admin/behavioral-flags/:id
    // -------------------------------------------------------------------

    app.put(
      '/api/admin/behavioral-flags/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Admin - Sybil'],
          summary: 'Update behavioral flag status',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
          body: {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['dismissed', 'action_taken'] },
            },
          },
          response: {
            200: behavioralFlagJsonSchema,
            400: errorJsonSchema,
            404: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string }
        const flagId = Number(id)
        if (Number.isNaN(flagId)) {
          throw badRequest('Invalid flag ID')
        }

        const parsed = behavioralFlagUpdateSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid status update')
        }

        const existing = await db
          .select()
          .from(behavioralFlags)
          .where(eq(behavioralFlags.id, flagId))

        if (existing.length === 0) {
          throw notFound('Behavioral flag not found')
        }

        const updated = await db
          .update(behavioralFlags)
          .set({ status: parsed.data.status })
          .where(eq(behavioralFlags.id, flagId))
          .returning()

        const updatedFlag = updated[0]
        if (!updatedFlag) {
          throw notFound('Flag not found after update')
        }

        app.log.info({ flagId, status: parsed.data.status }, 'Behavioral flag status updated')

        return reply.status(200).send(serializeBehavioralFlag(updatedFlag))
      }
    )

    done()
  }
}

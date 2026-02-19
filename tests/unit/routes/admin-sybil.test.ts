import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

import { adminSybilRoutes } from '../../../src/routes/admin-sybil.js'

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------

const mockEnv = {
  COMMUNITY_DID: 'did:plc:community123',
  RATE_LIMIT_WRITE: 10,
  RATE_LIMIT_READ_ANON: 100,
  RATE_LIMIT_READ_AUTH: 300,
} as Env

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = 'did:plc:testuser123'
const TEST_HANDLE = 'alice.bsky.social'
const TEST_SID = 'a'.repeat(64)
const ADMIN_DID = 'did:plc:admin999'
const TEST_NOW = '2026-02-13T12:00:00.000Z'

// ---------------------------------------------------------------------------
// Mock user builders
// ---------------------------------------------------------------------------

function testUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    did: TEST_DID,
    handle: TEST_HANDLE,
    sid: TEST_SID,
    ...overrides,
  }
}

function adminUser(): RequestUser {
  return testUser({ did: ADMIN_DID, handle: 'admin.bsky.social' })
}

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockDb = createMockDb()

let selectChain: DbChain
let updateChain: DbChain
let insertChain: DbChain
let deleteChain: DbChain

function resetAllDbMocks(): void {
  selectChain = createChainableProxy([])
  updateChain = createChainableProxy([])
  insertChain = createChainableProxy([])
  deleteChain = createChainableProxy([])
  mockDb.insert.mockReturnValue(insertChain)
  mockDb.select.mockReturnValue(selectChain)
  mockDb.update.mockReturnValue(updateChain)
  mockDb.delete.mockReturnValue(deleteChain)
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async mock for Drizzle transaction
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => {
    await fn(mockDb)
  })
  mockDb.execute.mockReset()
}

// ---------------------------------------------------------------------------
// Mock cache
// ---------------------------------------------------------------------------

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  }
}

// ---------------------------------------------------------------------------
// Mock requireAdmin
// ---------------------------------------------------------------------------

function createMockRequireAdmin(user?: RequestUser) {
  return async (
    request: { user?: RequestUser },
    reply: { sent: boolean; status: (code: number) => { send: (body: unknown) => Promise<void> } }
  ) => {
    if (!user) {
      await reply.status(401).send({ error: 'Authentication required' })
      return
    }
    request.user = user
    if (user.did !== ADMIN_DID) {
      await reply.status(403).send({ error: 'Admin access required' })
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Mock auth middleware
// ---------------------------------------------------------------------------

function createMockAuthMiddleware(user?: RequestUser) {
  return {
    requireAuth: async (
      request: { user?: RequestUser },
      reply: { sent: boolean; status: (code: number) => { send: (body: unknown) => Promise<void> } }
    ) => {
      if (!user) {
        await reply.status(401).send({ error: 'Authentication required' })
        return
      }
      request.user = user
    },
    optionalAuth: (request: { user?: RequestUser }) => {
      if (user) {
        request.user = user
      }
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// Sample data builders
// ---------------------------------------------------------------------------

function sampleTrustSeed(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    did: 'did:plc:seed001',
    communityId: '',
    addedBy: ADMIN_DID,
    reason: 'Trusted community member',
    createdAt: new Date(TEST_NOW),
    ...overrides,
  }
}

function sampleSybilCluster(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    clusterHash: 'abc123hash',
    internalEdgeCount: 15,
    externalEdgeCount: 2,
    memberCount: 5,
    status: 'flagged' as const,
    reviewedBy: null,
    reviewedAt: null,
    detectedAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

function samplePdsTrust(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    pdsHost: 'bsky.social',
    trustFactor: 1.0,
    isDefault: true,
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

function sampleBehavioralFlag(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    flagType: 'burst_voting' as const,
    affectedDids: ['did:plc:user1', 'did:plc:user2'],
    details: 'Burst voting detected',
    communityDid: null,
    status: 'pending' as const,
    detectedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

const mockTrustGraphService = {
  computeTrustScores: vi.fn().mockResolvedValue({
    totalNodes: 0,
    totalEdges: 0,
    iterations: 0,
    converged: true,
    durationMs: 0,
  }),
  getTrustScore: vi.fn().mockResolvedValue(0.1),
}

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  const authMiddleware = createMockAuthMiddleware(user)
  const requireAdmin = createMockRequireAdmin(user)
  const cache = createMockCache()

  app.decorate('db', mockDb as never)
  app.decorate('env', mockEnv)
  app.decorate('authMiddleware', authMiddleware as never)
  app.decorate('requireAdmin', requireAdmin as never)
  app.decorate('cache', cache as never)
  app.decorate('firehose', {} as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('trustGraphService', mockTrustGraphService as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)

  await app.register(adminSybilRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('admin sybil routes', () => {
  // =========================================================================
  // Trust Seeds
  // =========================================================================

  describe('GET /api/admin/trust-seeds', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns paginated list of trust seeds with implicit seeds', async () => {
      const seed = sampleTrustSeed()

      // First select: db.select({seed, handle, displayName}).from(trustSeeds).leftJoin(users).where().orderBy().limit()
      const explicitChain = createChainableProxy([
        { seed, handle: 'seed-user.bsky.social', displayName: 'Seed User' },
      ])
      // Second select: db.select().from(users).where() for implicit seeds
      const implicitChain = createChainableProxy([
        {
          did: 'did:plc:mod001',
          handle: 'mod.bsky.social',
          displayName: 'Mod',
          role: 'moderator',
          firstSeenAt: new Date(TEST_NOW),
        },
      ])

      mockDb.select.mockReturnValueOnce(explicitChain).mockReturnValueOnce(implicitChain)

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/trust-seeds',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        seeds: Array<{ did: string; implicit: boolean; handle: string | null }>
        cursor: string | null
      }>()
      expect(body.seeds.length).toBeGreaterThanOrEqual(1)
      // Should include both explicit and implicit seeds
      const explicitSeed = body.seeds.find((s) => s.did === 'did:plc:seed001')
      expect(explicitSeed).toBeDefined()
      expect(explicitSeed?.implicit).toBe(false)
      expect(explicitSeed?.handle).toBe('seed-user.bsky.social')
    })

    it('returns 401 when unauthenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/admin/trust-seeds',
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('returns 403 when non-admin user', async () => {
      const regularApp = await buildTestApp(testUser())

      const response = await regularApp.inject({
        method: 'GET',
        url: '/api/admin/trust-seeds',
        headers: { authorization: 'Bearer user-token' },
      })

      expect(response.statusCode).toBe(403)
      await regularApp.close()
    })
  })

  describe('POST /api/admin/trust-seeds', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('creates a trust seed when DID exists', async () => {
      // User lookup: db.select({did, handle, displayName}).from(users).where()
      const userLookupChain = createChainableProxy([
        { did: 'did:plc:newuser', handle: 'newuser.bsky.social', displayName: 'New User' },
      ])
      mockDb.select.mockReturnValueOnce(userLookupChain)
      // Insert returning
      const newSeed = sampleTrustSeed({ did: 'did:plc:newuser', id: 2 })
      insertChain.returning.mockResolvedValueOnce([newSeed])

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/trust-seeds',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          did: 'did:plc:newuser',
          reason: 'Trusted',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json<{ did: string; id: number; handle: string }>()
      expect(body.did).toBe('did:plc:newuser')
      expect(body.handle).toBe('newuser.bsky.social')
    })

    it('returns 404 when DID not found in users table', async () => {
      const emptyChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(emptyChain)

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/trust-seeds',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          did: 'did:plc:nonexistent',
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 400 for empty did', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/trust-seeds',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          did: '',
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('DELETE /api/admin/trust-seeds/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('deletes a trust seed and returns 204', async () => {
      selectChain.where.mockResolvedValueOnce([{ id: 1 }])

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/trust-seeds/1',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(204)
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('returns 404 when seed not found', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/trust-seeds/999',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 400 for invalid ID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/trust-seeds/abc',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // =========================================================================
  // Sybil Clusters
  // =========================================================================

  describe('GET /api/admin/sybil-clusters', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns paginated list of sybil clusters', async () => {
      const cluster = sampleSybilCluster()
      selectChain.limit.mockResolvedValueOnce([cluster])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/sybil-clusters',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        clusters: Array<{ id: number; status: string }>
        cursor: string | null
      }>()
      expect(body.clusters).toHaveLength(1)
      expect(body.clusters[0]?.status).toBe('flagged')
    })

    it('filters by status', async () => {
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/sybil-clusters?status=banned',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ clusters: unknown[] }>()
      expect(body.clusters).toHaveLength(0)
    })
  })

  describe('GET /api/admin/sybil-clusters/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns cluster detail with enriched members', async () => {
      const cluster = sampleSybilCluster()
      // First select: cluster lookup
      const clusterChain = createChainableProxy([cluster])
      // Second select: enriched members with leftJoin
      const membersChain = createChainableProxy([
        {
          did: 'did:plc:member1',
          roleInCluster: 'core',
          joinedAt: new Date(TEST_NOW),
          handle: 'member1.bsky.social',
          displayName: 'Member One',
          reputationScore: 50,
          accountCreatedAt: new Date(TEST_NOW),
          trustScore: 0.8,
        },
        {
          did: 'did:plc:member2',
          roleInCluster: 'peripheral',
          joinedAt: new Date(TEST_NOW),
          handle: null,
          displayName: null,
          reputationScore: 10,
          accountCreatedAt: null,
          trustScore: null,
        },
      ])

      mockDb.select.mockReturnValueOnce(clusterChain).mockReturnValueOnce(membersChain)

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/sybil-clusters/1',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        id: number
        suspicionRatio: number
        members: Array<{
          did: string
          roleInCluster: string
          handle: string | null
          trustScore: number | null
        }>
      }>()
      expect(body.id).toBe(1)
      expect(body.suspicionRatio).toBeCloseTo(15 / 17) // 15 internal / (15 + 2) total
      expect(body.members).toHaveLength(2)
      expect(body.members[0]?.roleInCluster).toBe('core')
      expect(body.members[0]?.handle).toBe('member1.bsky.social')
      expect(body.members[0]?.trustScore).toBe(0.8)
    })

    it('returns 404 when cluster not found', async () => {
      const emptyChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(emptyChain)

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/sybil-clusters/999',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('PUT /api/admin/sybil-clusters/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('updates cluster status', async () => {
      const cluster = sampleSybilCluster()
      const clusterLookup = createChainableProxy([cluster])
      mockDb.select.mockReturnValueOnce(clusterLookup)
      updateChain.returning.mockResolvedValueOnce([
        { ...cluster, status: 'monitoring', updatedAt: new Date() },
      ])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/sybil-clusters/1',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'monitoring' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ status: string; suspicionRatio: number }>()
      expect(body.status).toBe('monitoring')
      expect(body.suspicionRatio).toBeDefined()
    })

    it('propagates ban to cluster members when status is banned', async () => {
      const cluster = sampleSybilCluster()
      const clusterLookup = createChainableProxy([cluster])
      mockDb.select.mockReturnValueOnce(clusterLookup)
      updateChain.returning.mockResolvedValueOnce([
        { ...cluster, status: 'banned', reviewedBy: ADMIN_DID, updatedAt: new Date() },
      ])
      // Members query for ban propagation
      const membersChain = createChainableProxy([
        { did: 'did:plc:member1' },
        { did: 'did:plc:member2' },
      ])
      mockDb.select.mockReturnValueOnce(membersChain)

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/sybil-clusters/1',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'banned' },
      })

      expect(response.statusCode).toBe(200)
      // Verify that update was called for ban propagation
      // mockDb.update is called: once for cluster status + once per member
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns 404 when cluster not found', async () => {
      const emptyChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(emptyChain)

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/sybil-clusters/999',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'dismissed' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 400 for invalid status', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/sybil-clusters/1',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'invalid' },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // =========================================================================
  // PDS Trust
  // =========================================================================

  describe('GET /api/admin/pds-trust', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns list of PDS trust factors with defaults', async () => {
      const factor = samplePdsTrust()
      selectChain.limit.mockResolvedValueOnce([factor])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/pds-trust',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        factors: Array<{ pdsHost: string; trustFactor: number; isDefault: boolean }>
      }>()
      expect(body.factors).toHaveLength(1)
      expect(body.factors[0]?.pdsHost).toBe('bsky.social')
      expect(body.factors[0]?.isDefault).toBe(true)
    })
  })

  describe('PUT /api/admin/pds-trust', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('creates an override for a specific PDS host', async () => {
      const newFactor = samplePdsTrust({
        id: 2,
        pdsHost: 'custom.pds.example.com',
        trustFactor: 0.5,
        isDefault: false,
      })
      insertChain.returning.mockResolvedValueOnce([newFactor])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/pds-trust',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          pdsHost: 'custom.pds.example.com',
          trustFactor: 0.5,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ pdsHost: string; trustFactor: number }>()
      expect(body.pdsHost).toBe('custom.pds.example.com')
      expect(body.trustFactor).toBe(0.5)
    })

    it('returns 400 for trust factor out of range', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/pds-trust',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          pdsHost: 'example.com',
          trustFactor: 1.5,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid hostname', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/pds-trust',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          pdsHost: 'not a hostname',
          trustFactor: 0.5,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for negative trust factor', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/pds-trust',
        headers: { authorization: 'Bearer admin-token' },
        payload: {
          pdsHost: 'example.com',
          trustFactor: -0.1,
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // =========================================================================
  // Trust Graph Admin
  // =========================================================================

  describe('POST /api/admin/trust-graph/recompute', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns 202 when recompute is triggered', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/trust-graph/recompute',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(202)
      const body = response.json<{ message: string; startedAt: string }>()
      expect(body.message).toContain('recomputation started')
      expect(body.startedAt).toBeDefined()
    })

    it('returns 429 when rate limited (recompute within 1 hour)', async () => {
      // Build a fresh app with a cache that returns a recent timestamp
      const rateLimitedApp = Fastify({ logger: false })
      const recentTime = String(Date.now() - 5 * 60 * 1000) // 5 min ago
      const mockCache = createMockCache()
      mockCache.get.mockResolvedValue(recentTime)

      rateLimitedApp.decorate('db', mockDb as never)
      rateLimitedApp.decorate('env', mockEnv)
      rateLimitedApp.decorate('authMiddleware', createMockAuthMiddleware(adminUser()) as never)
      rateLimitedApp.decorate('requireAdmin', createMockRequireAdmin(adminUser()) as never)
      rateLimitedApp.decorate('cache', mockCache as never)
      rateLimitedApp.decorate('firehose', {} as never)
      rateLimitedApp.decorate('oauthClient', {} as never)
      rateLimitedApp.decorate('sessionService', {} as SessionService)
      rateLimitedApp.decorate('setupService', {} as SetupService)
      rateLimitedApp.decorate('trustGraphService', mockTrustGraphService as never)
      rateLimitedApp.decorateRequest('user', undefined as RequestUser | undefined)

      await rateLimitedApp.register(adminSybilRoutes())
      await rateLimitedApp.ready()

      const response = await rateLimitedApp.inject({
        method: 'POST',
        url: '/api/admin/trust-graph/recompute',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(429)
      await rateLimitedApp.close()
    })
  })

  describe('GET /api/admin/trust-graph/status', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns trust graph computation stats', async () => {
      // Three parallel db.select({count}).from() queries
      // First two resolve at .from() (no .where()), third at .where()
      const nodeCountChain = createChainableProxy([{ nodeCount: 42 }])
      // Override from() to be thenable since it's the terminal call for this query
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
      nodeCountChain.from.mockImplementation(() => ({
        ...nodeCountChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([{ nodeCount: 42 }]).then(resolve, reject),
      }))

      const edgeCountChain = createChainableProxy([{ edgeCount: 100 }])
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
      edgeCountChain.from.mockImplementation(() => ({
        ...edgeCountChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([{ edgeCount: 100 }]).then(resolve, reject),
      }))

      const flaggedCountChain = createChainableProxy([{ flaggedCount: 3 }])

      mockDb.select
        .mockReturnValueOnce(nodeCountChain) // trust_scores count
        .mockReturnValueOnce(edgeCountChain) // interaction_graph count
        .mockReturnValueOnce(flaggedCountChain) // sybil_clusters flagged count

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/trust-graph/status',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        lastComputedAt: string | null
        totalNodes: number
        totalEdges: number
        computationDurationMs: number | null
        clustersFlagged: number
        nextScheduledAt: string | null
      }>()
      expect(body.totalNodes).toBe(42)
      expect(body.totalEdges).toBe(100)
      expect(body.clustersFlagged).toBe(3)
    })
  })

  // =========================================================================
  // Behavioral Flags
  // =========================================================================

  describe('GET /api/admin/behavioral-flags', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns paginated list of behavioral flags', async () => {
      const flag = sampleBehavioralFlag()
      selectChain.limit.mockResolvedValueOnce([flag])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/behavioral-flags',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        flags: Array<{ id: number; flagType: string; status: string }>
        cursor: string | null
      }>()
      expect(body.flags).toHaveLength(1)
      expect(body.flags[0]?.flagType).toBe('burst_voting')
      expect(body.flags[0]?.status).toBe('pending')
    })

    it('filters by flag type and status', async () => {
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/behavioral-flags?flagType=low_diversity&status=pending',
        headers: { authorization: 'Bearer admin-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ flags: unknown[] }>()
      expect(body.flags).toHaveLength(0)
    })
  })

  describe('PUT /api/admin/behavioral-flags/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('updates flag status to dismissed', async () => {
      const flag = sampleBehavioralFlag()
      selectChain.where.mockResolvedValueOnce([flag])
      updateChain.returning.mockResolvedValueOnce([{ ...flag, status: 'dismissed' }])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/behavioral-flags/1',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'dismissed' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ status: string }>()
      expect(body.status).toBe('dismissed')
    })

    it('updates flag status to action_taken', async () => {
      const flag = sampleBehavioralFlag()
      selectChain.where.mockResolvedValueOnce([flag])
      updateChain.returning.mockResolvedValueOnce([{ ...flag, status: 'action_taken' }])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/behavioral-flags/1',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'action_taken' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ status: string }>()
      expect(body.status).toBe('action_taken')
    })

    it('returns 404 when flag not found', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/behavioral-flags/999',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'dismissed' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 400 for invalid status', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/behavioral-flags/1',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'invalid' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid flag ID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/behavioral-flags/abc',
        headers: { authorization: 'Bearer admin-token' },
        payload: { status: 'dismissed' },
      })

      expect(response.statusCode).toBe(400)
    })
  })
})

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

// Import routes
import { blockMuteRoutes } from '../../../src/routes/block-mute.js'

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
const TARGET_DID = 'did:plc:targetuser456'
const INVALID_DID = 'not-a-did'

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

// ---------------------------------------------------------------------------
// Chainable mock DB
// ---------------------------------------------------------------------------

const mockDb = createMockDb()

let selectChain: DbChain
let insertChain: DbChain

function resetAllDbMocks(): void {
  selectChain = createChainableProxy([])
  insertChain = createChainableProxy()
  mockDb.insert.mockReturnValue(insertChain)
  mockDb.select.mockReturnValue(selectChain)
  mockDb.update.mockReturnValue(createChainableProxy([]))
  mockDb.delete.mockReturnValue(createChainableProxy())
}

// ---------------------------------------------------------------------------
// Auth middleware mocks
// ---------------------------------------------------------------------------

function createMockAuthMiddleware(user?: RequestUser): AuthMiddleware {
  return {
    requireAuth: async (request, reply) => {
      if (!user) {
        await reply.status(401).send({ error: 'Authentication required' })
        return
      }
      request.user = user
    },
    optionalAuth: (request, _reply) => {
      if (user) {
        request.user = user
      }
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.decorate('db', mockDb as never)
  app.decorate('env', mockEnv)
  app.decorate('authMiddleware', createMockAuthMiddleware(user))
  app.decorate('firehose', {} as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('cache', {} as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)

  await app.register(blockMuteRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('block/mute routes', () => {
  // =========================================================================
  // POST /api/users/me/block/:did
  // =========================================================================

  describe('POST /api/users/me/block/:did', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('adds DID to blocked list', async () => {
      // Current preferences: empty blockedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [],
          mutedDids: [],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('is idempotent when DID is already blocked', async () => {
      // Current preferences: TARGET_DID already in blockedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [TARGET_DID],
          mutedDids: [],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      // Should NOT upsert since already blocked
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('creates preferences row when none exists', async () => {
      // No preferences row found
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('returns 400 for invalid DID format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/block/${encodeURIComponent(INVALID_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'POST',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })

  // =========================================================================
  // DELETE /api/users/me/block/:did
  // =========================================================================

  describe('DELETE /api/users/me/block/:did', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('removes DID from blocked list', async () => {
      // Current preferences: TARGET_DID in blockedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [TARGET_DID, 'did:plc:other'],
          mutedDids: [],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('succeeds even when DID is not in blocked list', async () => {
      // Current preferences: TARGET_DID NOT in blockedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [],
          mutedDids: [],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
    })

    it('returns 400 for invalid DID format', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/users/me/block/${encodeURIComponent(INVALID_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'DELETE',
        url: `/api/users/me/block/${encodeURIComponent(TARGET_DID)}`,
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })

  // =========================================================================
  // POST /api/users/me/mute/:did
  // =========================================================================

  describe('POST /api/users/me/mute/:did', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('adds DID to muted list', async () => {
      // Current preferences: empty mutedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [],
          mutedDids: [],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('is idempotent when DID is already muted', async () => {
      // Current preferences: TARGET_DID already in mutedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [],
          mutedDids: [TARGET_DID],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      // Should NOT upsert since already muted
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('creates preferences row when none exists', async () => {
      // No preferences row found
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('returns 400 for invalid DID format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/users/me/mute/${encodeURIComponent(INVALID_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'POST',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })

  // =========================================================================
  // DELETE /api/users/me/mute/:did
  // =========================================================================

  describe('DELETE /api/users/me/mute/:did', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('removes DID from muted list', async () => {
      // Current preferences: TARGET_DID in mutedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [],
          mutedDids: [TARGET_DID, 'did:plc:other'],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('succeeds even when DID is not in muted list', async () => {
      // Current preferences: TARGET_DID NOT in mutedDids
      selectChain.where.mockResolvedValueOnce([
        {
          did: TEST_DID,
          blockedDids: [],
          mutedDids: [],
          updatedAt: new Date(),
        },
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
    })

    it('returns 400 for invalid DID format', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/users/me/mute/${encodeURIComponent(INVALID_DID)}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'DELETE',
        url: `/api/users/me/mute/${encodeURIComponent(TARGET_DID)}`,
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })
})

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

// Import routes
import { communityProfileRoutes } from '../../../src/routes/community-profiles.js'

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
const COMMUNITY_DID = 'did:plc:community456'
const TEST_NOW = '2026-02-14T12:00:00.000Z'

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
// Sample data builders
// ---------------------------------------------------------------------------

function sampleUserRow(overrides?: Record<string, unknown>) {
  return {
    did: TEST_DID,
    handle: TEST_HANDLE,
    displayName: 'Alice',
    avatarUrl: 'https://example.com/avatar.jpg',
    bannerUrl: 'https://example.com/banner.jpg',
    bio: 'Global bio',
    role: 'user',
    isBanned: false,
    reputationScore: 0,
    firstSeenAt: new Date(TEST_NOW),
    lastActiveAt: new Date(TEST_NOW),
    declaredAge: null,
    maturityPref: 'safe',
    ...overrides,
  }
}

function sampleOverrideRow(overrides?: Record<string, unknown>) {
  return {
    did: TEST_DID,
    communityDid: COMMUNITY_DID,
    displayName: 'Community Alice',
    avatarUrl: null,
    bannerUrl: null,
    bio: 'Community-specific bio',
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Chainable mock DB
// ---------------------------------------------------------------------------

const mockDb = createMockDb()

let selectChain: DbChain
let insertChain: DbChain
let deleteChain: DbChain

function resetAllDbMocks(): void {
  selectChain = createChainableProxy([])
  insertChain = createChainableProxy()
  deleteChain = createChainableProxy()
  mockDb.insert.mockReturnValue(insertChain)
  mockDb.select.mockReturnValue(selectChain)
  mockDb.update.mockReturnValue(createChainableProxy([]))
  mockDb.delete.mockReturnValue(deleteChain)
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

  await app.register(communityProfileRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('community profile routes', () => {
  // =========================================================================
  // GET /api/communities/:communityDid/profile
  // =========================================================================

  describe('GET /api/communities/:communityDid/profile', () => {
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

    it('returns source profile when no override exists', async () => {
      // 1st select: user by DID
      selectChain.where.mockResolvedValueOnce([sampleUserRow()])
      // 2nd select: community_profiles row (none)
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        did: string
        handle: string
        displayName: string
        avatarUrl: string
        bannerUrl: string
        bio: string
        communityDid: string
        hasOverride: boolean
        source: {
          displayName: string
          avatarUrl: string
          bannerUrl: string
          bio: string
        }
      }>()
      expect(body.did).toBe(TEST_DID)
      expect(body.handle).toBe(TEST_HANDLE)
      expect(body.displayName).toBe('Alice')
      expect(body.avatarUrl).toBe('https://example.com/avatar.jpg')
      expect(body.bannerUrl).toBe('https://example.com/banner.jpg')
      expect(body.bio).toBe('Global bio')
      expect(body.communityDid).toBe(COMMUNITY_DID)
      expect(body.hasOverride).toBe(false)
      expect(body.source.displayName).toBe('Alice')
      expect(body.source.avatarUrl).toBe('https://example.com/avatar.jpg')
    })

    it('returns merged profile when override exists (override fields take precedence)', async () => {
      // 1st select: user by DID
      selectChain.where.mockResolvedValueOnce([sampleUserRow()])
      // 2nd select: community_profiles row with overrides
      selectChain.where.mockResolvedValueOnce([sampleOverrideRow()])

      const response = await app.inject({
        method: 'GET',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        did: string
        handle: string
        displayName: string
        avatarUrl: string
        bannerUrl: string
        bio: string
        communityDid: string
        hasOverride: boolean
        source: {
          displayName: string
          avatarUrl: string
          bannerUrl: string
          bio: string
        }
      }>()
      // Override fields take precedence
      expect(body.displayName).toBe('Community Alice')
      expect(body.bio).toBe('Community-specific bio')
      // Null override fields fall back to source
      expect(body.avatarUrl).toBe('https://example.com/avatar.jpg')
      expect(body.bannerUrl).toBe('https://example.com/banner.jpg')
      expect(body.hasOverride).toBe(true)
      // Source always shows original values
      expect(body.source.displayName).toBe('Alice')
      expect(body.source.bio).toBe('Global bio')
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'GET',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('returns 404 when user record not found', async () => {
      // User not found in users table
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  // =========================================================================
  // PUT /api/communities/:communityDid/profile
  // =========================================================================

  describe('PUT /api/communities/:communityDid/profile', () => {
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

    it('creates new override and returns success', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          displayName: 'Community Alice',
          bio: 'Community-specific bio',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('updates existing override', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          displayName: 'Updated Name',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('clears fields when null values are sent', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          displayName: null,
          bio: null,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('accepts empty body (no changes)', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(200)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        payload: { displayName: 'Test' },
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('returns 400 for displayName exceeding 256 characters', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          displayName: 'x'.repeat(257),
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for bio exceeding 2048 characters', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          bio: 'x'.repeat(2049),
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // =========================================================================
  // DELETE /api/communities/:communityDid/profile
  // =========================================================================

  describe('DELETE /api/communities/:communityDid/profile', () => {
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

    it('removes override row and returns 204', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(204)
      expect(mockDb.delete).toHaveBeenCalledOnce()
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'DELETE',
        url: `/api/communities/${COMMUNITY_DID}/profile`,
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })
})

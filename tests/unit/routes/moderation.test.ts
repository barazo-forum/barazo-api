import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

// ---------------------------------------------------------------------------
// Mock requireModerator module (must be before importing routes)
// ---------------------------------------------------------------------------

const mockRequireModerator =
  vi.fn<(request: FastifyRequest, reply: FastifyReply) => Promise<void>>()

vi.mock('../../../src/auth/require-moderator.js', () => ({
  createRequireModerator: () => mockRequireModerator,
}))

// Import routes AFTER mocking
import { moderationRoutes } from '../../../src/routes/moderation.js'

// ---------------------------------------------------------------------------
// Mock env (minimal subset for moderation routes)
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
const OTHER_DID = 'did:plc:otheruser456'
const COMMUNITY_DID = 'did:plc:community123'

const TEST_TOPIC_URI = `at://${OTHER_DID}/forum.barazo.topic.post/topic123`
const TEST_REPLY_URI = `at://${OTHER_DID}/forum.barazo.topic.reply/reply123`
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
// Chainable mock DB (shared helper)
// ---------------------------------------------------------------------------

const mockDb = createMockDb()

let insertChain: DbChain
let selectChain: DbChain
let updateChain: DbChain
let deleteChain: DbChain

function resetAllDbMocks(): void {
  insertChain = createChainableProxy()
  selectChain = createChainableProxy([])
  updateChain = createChainableProxy([])
  deleteChain = createChainableProxy()
  mockDb.insert.mockReturnValue(insertChain)
  mockDb.select.mockReturnValue(selectChain)
  mockDb.update.mockReturnValue(updateChain)
  mockDb.delete.mockReturnValue(deleteChain)
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async mock for Drizzle transaction
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
    return await fn(mockDb)
  })

  // Add groupBy support for reported users endpoint
  // groupBy returns a chainable that ends with orderBy -> limit -> then
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle query chain
  selectChain.where.mockImplementation(() => {
    const chainResult = {
      ...selectChain,
      then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
        Promise.resolve([]).then(resolve, reject),
      orderBy: selectChain.orderBy,
      limit: selectChain.limit,
      returning: selectChain.returning,
      groupBy: vi.fn().mockImplementation(() => chainResult),
    }
    return chainResult
  })
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
// Mock requireAdmin factory
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
// Sample data builders
// ---------------------------------------------------------------------------

function sampleTopicRow(overrides?: Record<string, unknown>) {
  return {
    uri: TEST_TOPIC_URI,
    rkey: 'topic123',
    authorDid: OTHER_DID,
    title: 'Test Topic',
    content: 'Test content',
    contentFormat: null,
    category: 'general',
    tags: null,
    communityDid: COMMUNITY_DID,
    cid: 'bafyreitopic123',
    labels: null,
    replyCount: 0,
    reactionCount: 0,
    lastActivityAt: new Date(TEST_NOW),
    createdAt: new Date(TEST_NOW),
    indexedAt: new Date(TEST_NOW),
    isLocked: false,
    isPinned: false,
    isModDeleted: false,
    embedding: null,
    ...overrides,
  }
}

function sampleReplyRow(overrides?: Record<string, unknown>) {
  return {
    uri: TEST_REPLY_URI,
    rkey: 'reply123',
    authorDid: OTHER_DID,
    content: 'Test reply',
    contentFormat: null,
    rootUri: TEST_TOPIC_URI,
    rootCid: 'bafyreitopic123',
    parentUri: TEST_TOPIC_URI,
    parentCid: 'bafyreitopic123',
    communityDid: COMMUNITY_DID,
    cid: 'bafyreireply123',
    labels: null,
    reactionCount: 0,
    createdAt: new Date(TEST_NOW),
    indexedAt: new Date(TEST_NOW),
    isAuthorDeleted: false,
    isModDeleted: false,
    embedding: null,
    ...overrides,
  }
}

function sampleUserRow(overrides?: Record<string, unknown>) {
  return {
    did: OTHER_DID,
    handle: 'bob.bsky.social',
    displayName: 'Bob',
    avatarUrl: null,
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

function sampleModerationAction(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    action: 'lock',
    targetUri: TEST_TOPIC_URI,
    targetDid: null,
    moderatorDid: TEST_DID,
    communityDid: COMMUNITY_DID,
    reason: null,
    createdAt: new Date(TEST_NOW),
    ...overrides,
  }
}

function sampleReport(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    reporterDid: TEST_DID,
    targetUri: TEST_TOPIC_URI,
    targetDid: OTHER_DID,
    reasonType: 'spam',
    description: null,
    communityDid: COMMUNITY_DID,
    status: 'pending',
    resolutionType: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(TEST_NOW),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(
  user?: RequestUser,
  adminUserObj?: RequestUser
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  const authMiddleware = createMockAuthMiddleware(user)
  const requireAdmin = createMockRequireAdmin(adminUserObj)

  app.decorate('db', mockDb as never)
  app.decorate('env', mockEnv)
  app.decorate('authMiddleware', authMiddleware)
  app.decorate('requireAdmin', requireAdmin as never)
  app.decorate('firehose', {} as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('cache', {} as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)

  await app.register(moderationRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('moderation routes', () => {
  // =========================================================================
  // POST /api/moderation/lock/:id
  // =========================================================================

  describe('POST /api/moderation/lock/:id', () => {
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

      // Default: requireModerator passes and sets user
      mockRequireModerator.mockImplementation((request) => {
        request.user = testUser()
        return Promise.resolve()
      })
    })

    it('locks an unlocked topic and returns isLocked: true', async () => {
      // Topic lookup -> unlocked topic found
      selectChain.where.mockResolvedValueOnce([sampleTopicRow({ isLocked: false })])

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/lock/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Duplicate discussion' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; isLocked: boolean }>()
      expect(body.uri).toBe(TEST_TOPIC_URI)
      expect(body.isLocked).toBe(true)

      // Should have used transaction for update + log
      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('unlocks a locked topic and returns isLocked: false', async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow({ isLocked: true })])

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/lock/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; isLocked: boolean }>()
      expect(body.uri).toBe(TEST_TOPIC_URI)
      expect(body.isLocked).toBe(false)
    })

    it('returns 404 for non-existent topic', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const encodedUri = encodeURIComponent('at://did:plc:nobody/forum.barazo.topic.post/ghost')
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/lock/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 403 for non-moderators', async () => {
      mockRequireModerator.mockImplementation(async (_request, reply) => {
        await reply.status(403).send({ error: 'Moderator access required' })
      })

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/lock/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(403)
    })
  })

  // =========================================================================
  // POST /api/moderation/pin/:id
  // =========================================================================

  describe('POST /api/moderation/pin/:id', () => {
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

      mockRequireModerator.mockImplementation((request) => {
        request.user = testUser()
        return Promise.resolve()
      })
    })

    it('pins an unpinned topic', async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow({ isPinned: false })])

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/pin/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Important announcement' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; isPinned: boolean }>()
      expect(body.uri).toBe(TEST_TOPIC_URI)
      expect(body.isPinned).toBe(true)

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('unpins a pinned topic', async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow({ isPinned: true })])

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/pin/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; isPinned: boolean }>()
      expect(body.uri).toBe(TEST_TOPIC_URI)
      expect(body.isPinned).toBe(false)
    })

    it('returns 404 for non-existent topic', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const encodedUri = encodeURIComponent('at://did:plc:nobody/forum.barazo.topic.post/ghost')
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/pin/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(404)
    })
  })

  // =========================================================================
  // POST /api/moderation/delete/:id
  // =========================================================================

  describe('POST /api/moderation/delete/:id', () => {
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

      mockRequireModerator.mockImplementation((request) => {
        request.user = testUser()
        return Promise.resolve()
      })
    })

    it('mod-deletes a topic and returns isModDeleted: true', async () => {
      // Topic found, not yet mod-deleted
      selectChain.where.mockResolvedValueOnce([sampleTopicRow({ isModDeleted: false })])

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/delete/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Violates community guidelines' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; isModDeleted: boolean }>()
      expect(body.uri).toBe(TEST_TOPIC_URI)
      expect(body.isModDeleted).toBe(true)

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('mod-deletes a reply via soft-delete (sets isModDeleted flag)', async () => {
      // Topic query returns nothing (not a topic)
      selectChain.where.mockResolvedValueOnce([])
      // Reply query returns a reply
      selectChain.where.mockResolvedValueOnce([sampleReplyRow()])

      const encodedUri = encodeURIComponent(TEST_REPLY_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/delete/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Spam content' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; isModDeleted: boolean }>()
      expect(body.uri).toBe(TEST_REPLY_URI)
      expect(body.isModDeleted).toBe(true)

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      // Should soft-delete (update) reply, NOT hard-delete
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.delete).not.toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('returns 409 when reply is already mod-deleted', async () => {
      // Topic query returns nothing (not a topic)
      selectChain.where.mockResolvedValueOnce([])
      // Reply query returns an already mod-deleted reply
      selectChain.where.mockResolvedValueOnce([sampleReplyRow({ isModDeleted: true })])

      const encodedUri = encodeURIComponent(TEST_REPLY_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/delete/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Already deleted' },
      })

      expect(response.statusCode).toBe(409)
    })

    it('returns 400 when reason is missing', async () => {
      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/delete/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 404 when content not found (neither topic nor reply)', async () => {
      // Topic query returns nothing
      selectChain.where.mockResolvedValueOnce([])
      // Reply query returns nothing
      selectChain.where.mockResolvedValueOnce([])

      const encodedUri = encodeURIComponent('at://did:plc:nobody/forum.barazo.topic.post/ghost')
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/delete/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Test reason' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 409 when topic is already mod-deleted', async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow({ isModDeleted: true })])

      const encodedUri = encodeURIComponent(TEST_TOPIC_URI)
      const response = await app.inject({
        method: 'POST',
        url: `/api/moderation/delete/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'Already deleted' },
      })

      expect(response.statusCode).toBe(409)
    })
  })

  // =========================================================================
  // POST /api/moderation/ban
  // =========================================================================

  describe('POST /api/moderation/ban', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser(), adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('bans a regular user and returns isBanned: true', async () => {
      // User lookup -> regular user found, not banned
      selectChain.where.mockResolvedValueOnce([sampleUserRow({ isBanned: false })])

      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/ban',
        headers: { authorization: 'Bearer test-token' },
        payload: { did: OTHER_DID, reason: 'Repeated harassment' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ did: string; isBanned: boolean }>()
      expect(body.did).toBe(OTHER_DID)
      expect(body.isBanned).toBe(true)

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('unbans a banned user', async () => {
      selectChain.where.mockResolvedValueOnce([sampleUserRow({ isBanned: true })])

      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/ban',
        headers: { authorization: 'Bearer test-token' },
        payload: { did: OTHER_DID, reason: 'Appeal accepted' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ did: string; isBanned: boolean }>()
      expect(body.did).toBe(OTHER_DID)
      expect(body.isBanned).toBe(false)
    })

    it('returns 400 when trying to ban self', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/ban',
        headers: { authorization: 'Bearer test-token' },
        payload: { did: ADMIN_DID, reason: 'Self ban' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 403 when trying to ban another admin', async () => {
      const otherAdmin = sampleUserRow({ did: 'did:plc:otheradmin', role: 'admin' })
      selectChain.where.mockResolvedValueOnce([otherAdmin])

      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/ban',
        headers: { authorization: 'Bearer test-token' },
        payload: { did: 'did:plc:otheradmin', reason: 'Ban admin' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 404 when user not found', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/ban',
        headers: { authorization: 'Bearer test-token' },
        payload: { did: 'did:plc:nonexistent', reason: 'Nobody here' },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('POST /api/moderation/ban (non-admin)', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      // Non-admin user: will be blocked by requireAdmin
      app = await buildTestApp(testUser(), testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    it('returns 403 for non-admin user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/ban',
        headers: { authorization: 'Bearer test-token' },
        payload: { did: OTHER_DID, reason: 'Not allowed' },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  // =========================================================================
  // GET /api/moderation/log
  // =========================================================================

  describe('GET /api/moderation/log', () => {
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

      mockRequireModerator.mockImplementation((request) => {
        request.user = testUser()
        return Promise.resolve()
      })
    })

    it('returns paginated moderation actions', async () => {
      const actions = [
        sampleModerationAction({ id: 3, action: 'lock' }),
        sampleModerationAction({ id: 2, action: 'pin' }),
      ]
      selectChain.limit.mockResolvedValueOnce(actions)

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/log',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        actions: Array<{ id: number; action: string; createdAt: string }>
        cursor: string | null
      }>()
      expect(body.actions).toHaveLength(2)
      expect(body.actions[0]?.action).toBe('lock')
      expect(body.actions[0]?.createdAt).toBe(TEST_NOW)
      expect(body.cursor).toBeNull()
    })

    it('filters by action type', async () => {
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/log?action=ban',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ actions: unknown[]; cursor: string | null }>()
      expect(body.actions).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('returns empty list when no actions exist', async () => {
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/log',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ actions: unknown[]; cursor: string | null }>()
      expect(body.actions).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('returns cursor when more results exist', async () => {
      // Default limit is 25; return 26 items to trigger cursor
      const baseDate = new Date('2026-02-13T12:00:00.000Z')
      const actions = Array.from({ length: 26 }, (_, i) => {
        const d = new Date(baseDate.getTime() - i * 3600000) // subtract i hours
        return sampleModerationAction({ id: 26 - i, createdAt: d })
      })
      selectChain.limit.mockResolvedValueOnce(actions)

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/log',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ actions: unknown[]; cursor: string | null }>()
      expect(body.actions).toHaveLength(25)
      expect(body.cursor).toBeTruthy()
    })
  })

  // =========================================================================
  // POST /api/moderation/report
  // =========================================================================

  describe('POST /api/moderation/report', () => {
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

    it('creates a report successfully', async () => {
      // Topic exists
      selectChain.where.mockResolvedValueOnce([{ uri: TEST_TOPIC_URI }])
      // No existing report (duplicate check)
      selectChain.where.mockResolvedValueOnce([])
      // Insert returning
      insertChain.returning.mockResolvedValueOnce([sampleReport()])

      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/report',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          targetUri: TEST_TOPIC_URI,
          reasonType: 'spam',
          description: 'This is spam',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json<{
        id: number
        reporterDid: string
        targetUri: string
        reasonType: string
        status: string
      }>()
      expect(body.id).toBe(1)
      expect(body.reporterDid).toBe(TEST_DID)
      expect(body.targetUri).toBe(TEST_TOPIC_URI)
      expect(body.reasonType).toBe('spam')
      expect(body.status).toBe('pending')
    })

    it('returns 400 for invalid URI format (no DID)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/report',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          targetUri: 'invalid-uri',
          reasonType: 'spam',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 when reporting own content', async () => {
      // URI contains the reporter's own DID
      const ownContentUri = `at://${TEST_DID}/forum.barazo.topic.post/mytopic`
      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/report',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          targetUri: ownContentUri,
          reasonType: 'spam',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 404 when target content not found', async () => {
      // Topic query returns nothing
      selectChain.where.mockResolvedValueOnce([])
      // Reply query returns nothing
      selectChain.where.mockResolvedValueOnce([])

      const nonExistentUri = `at://${OTHER_DID}/forum.barazo.topic.post/ghost`
      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/report',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          targetUri: nonExistentUri,
          reasonType: 'harassment',
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 409 for duplicate report', async () => {
      // Topic exists
      selectChain.where.mockResolvedValueOnce([{ uri: TEST_TOPIC_URI }])
      // Existing report found (duplicate check)
      selectChain.where.mockResolvedValueOnce([{ id: 1 }])

      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/report',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          targetUri: TEST_TOPIC_URI,
          reasonType: 'spam',
        },
      })

      expect(response.statusCode).toBe(409)
    })
  })

  describe('POST /api/moderation/report (unauthenticated)', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(undefined)
    })

    afterAll(async () => {
      await app.close()
    })

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/moderation/report',
        payload: {
          targetUri: TEST_TOPIC_URI,
          reasonType: 'spam',
        },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  // =========================================================================
  // GET /api/moderation/reports
  // =========================================================================

  describe('GET /api/moderation/reports', () => {
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

      mockRequireModerator.mockImplementation((request) => {
        request.user = testUser()
        return Promise.resolve()
      })
    })

    it('returns paginated reports', async () => {
      const reportRows = [sampleReport({ id: 2 }), sampleReport({ id: 1 })]
      selectChain.limit.mockResolvedValueOnce(reportRows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/reports',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        reports: Array<{ id: number; status: string; createdAt: string }>
        cursor: string | null
      }>()
      expect(body.reports).toHaveLength(2)
      expect(body.reports[0]?.id).toBe(2)
      expect(body.reports[0]?.createdAt).toBe(TEST_NOW)
      expect(body.cursor).toBeNull()
    })

    it('filters by status', async () => {
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/reports?status=pending',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ reports: unknown[]; cursor: string | null }>()
      expect(body.reports).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('returns cursor when more results exist', async () => {
      const baseDate = new Date('2026-02-13T12:00:00.000Z')
      const reportRows = Array.from({ length: 26 }, (_, i) => {
        const d = new Date(baseDate.getTime() - i * 3600000) // subtract i hours
        return sampleReport({ id: 26 - i, createdAt: d })
      })
      selectChain.limit.mockResolvedValueOnce(reportRows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/moderation/reports',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ reports: unknown[]; cursor: string | null }>()
      expect(body.reports).toHaveLength(25)
      expect(body.cursor).toBeTruthy()
    })
  })

  // =========================================================================
  // PUT /api/moderation/reports/:id
  // =========================================================================

  describe('PUT /api/moderation/reports/:id', () => {
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

      mockRequireModerator.mockImplementation((request) => {
        request.user = testUser()
        return Promise.resolve()
      })
    })

    it('resolves a pending report', async () => {
      // Report found, status pending
      selectChain.where.mockResolvedValueOnce([sampleReport({ status: 'pending' })])
      // Update returning
      const resolvedReport = sampleReport({
        status: 'resolved',
        resolutionType: 'dismissed',
        resolvedBy: TEST_DID,
        resolvedAt: new Date(TEST_NOW),
      })
      updateChain.returning.mockResolvedValueOnce([resolvedReport])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/moderation/reports/1',
        headers: { authorization: 'Bearer test-token' },
        payload: { resolutionType: 'dismissed' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        id: number
        status: string
        resolutionType: string
        resolvedBy: string
      }>()
      expect(body.id).toBe(1)
      expect(body.status).toBe('resolved')
      expect(body.resolutionType).toBe('dismissed')
      expect(body.resolvedBy).toBe(TEST_DID)
    })

    it('returns 404 for non-existent report', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/moderation/reports/999',
        headers: { authorization: 'Bearer test-token' },
        payload: { resolutionType: 'dismissed' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 409 for already resolved report', async () => {
      selectChain.where.mockResolvedValueOnce([sampleReport({ status: 'resolved' })])

      const response = await app.inject({
        method: 'PUT',
        url: '/api/moderation/reports/1',
        headers: { authorization: 'Bearer test-token' },
        payload: { resolutionType: 'warned' },
      })

      expect(response.statusCode).toBe(409)
    })
  })

  // =========================================================================
  // GET /api/admin/reports/users
  // =========================================================================

  describe('GET /api/admin/reports/users', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser(), adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns most-reported users', async () => {
      const reportedUsers = [
        { did: OTHER_DID, reportCount: 5 },
        { did: 'did:plc:badactor', reportCount: 3 },
      ]
      selectChain.limit.mockResolvedValueOnce(reportedUsers)

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/reports/users',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ users: Array<{ did: string; reportCount: number }> }>()
      expect(body.users).toHaveLength(2)
      expect(body.users[0]?.did).toBe(OTHER_DID)
      expect(body.users[0]?.reportCount).toBe(5)
    })

    it('returns empty list when no reported users', async () => {
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/reports/users',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ users: unknown[] }>()
      expect(body.users).toEqual([])
    })
  })

  // =========================================================================
  // GET /api/admin/moderation/thresholds
  // =========================================================================

  describe('GET /api/admin/moderation/thresholds', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser(), adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns default thresholds when no settings exist', async () => {
      // No community settings row
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/moderation/thresholds',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ autoBlockReportCount: number; warnThreshold: number }>()
      expect(body.autoBlockReportCount).toBe(5)
      expect(body.warnThreshold).toBe(3)
    })

    it('returns stored thresholds from community settings', async () => {
      selectChain.where.mockResolvedValueOnce([
        { moderationThresholds: { autoBlockReportCount: 10, warnThreshold: 7 } },
      ])

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/moderation/thresholds',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ autoBlockReportCount: number; warnThreshold: number }>()
      expect(body.autoBlockReportCount).toBe(10)
      expect(body.warnThreshold).toBe(7)
    })
  })

  // =========================================================================
  // PUT /api/admin/moderation/thresholds
  // =========================================================================

  describe('PUT /api/admin/moderation/thresholds', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser(), adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('updates thresholds successfully', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/moderation/thresholds',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          autoBlockReportCount: 10,
          warnThreshold: 5,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ autoBlockReportCount: number; warnThreshold: number }>()
      expect(body.autoBlockReportCount).toBe(10)
      expect(body.warnThreshold).toBe(5)

      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns 400 for invalid threshold values', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/moderation/thresholds',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          autoBlockReportCount: 0, // min is 1
          warnThreshold: 5,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for threshold exceeding maximum', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/moderation/thresholds',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          autoBlockReportCount: 101, // max is 100
          warnThreshold: 5,
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('PUT /api/admin/moderation/thresholds (non-admin)', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(testUser(), testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    it('returns 403 for non-admin user', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/moderation/thresholds',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          autoBlockReportCount: 10,
          warnThreshold: 5,
        },
      })

      expect(response.statusCode).toBe(403)
    })
  })
})

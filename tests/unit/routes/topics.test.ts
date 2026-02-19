import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

// ---------------------------------------------------------------------------
// Mock PDS client module (must be before importing routes)
// ---------------------------------------------------------------------------

const createRecordFn =
  vi.fn<
    (
      did: string,
      collection: string,
      record: Record<string, unknown>
    ) => Promise<{ uri: string; cid: string }>
  >()
const updateRecordFn =
  vi.fn<
    (
      did: string,
      collection: string,
      rkey: string,
      record: Record<string, unknown>
    ) => Promise<{ uri: string; cid: string }>
  >()
const deleteRecordFn = vi.fn<(did: string, collection: string, rkey: string) => Promise<void>>()

vi.mock('../../../src/lib/pds-client.js', () => ({
  createPdsClient: () => ({
    createRecord: createRecordFn,
    updateRecord: updateRecordFn,
    deleteRecord: deleteRecordFn,
  }),
}))

// Mock anti-spam module (tested separately in anti-spam.test.ts)
vi.mock('../../../src/lib/anti-spam.js', () => ({
  loadAntiSpamSettings: vi.fn().mockResolvedValue({
    wordFilter: [],
    firstPostQueueCount: 3,
    newAccountDays: 7,
    newAccountWriteRatePerMin: 3,
    establishedWriteRatePerMin: 10,
    linkHoldEnabled: true,
    topicCreationDelayEnabled: false,
    burstPostCount: 5,
    burstWindowMinutes: 10,
    trustedPostThreshold: 10,
  }),
  isNewAccount: vi.fn().mockResolvedValue(false),
  isAccountTrusted: vi.fn().mockResolvedValue(true),
  checkWriteRateLimit: vi.fn().mockResolvedValue(false),
  canCreateTopic: vi.fn().mockResolvedValue(true),
  runAntiSpamChecks: vi.fn().mockResolvedValue({ held: false, reasons: [] }),
}))

// Import routes AFTER mocking
import { topicRoutes } from '../../../src/routes/topics.js'

// ---------------------------------------------------------------------------
// Mock env (minimal subset for topic routes)
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
const TEST_URI = `at://${TEST_DID}/forum.barazo.topic.post/abc123`
const TEST_RKEY = 'abc123'
const TEST_CID = 'bafyreiabc123456789'
const TEST_NOW = '2026-02-13T12:00:00.000Z'

const MOD_DID = 'did:plc:moderator999'
const OTHER_DID = 'did:plc:otheruser456'

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
// Mock firehose repo manager
// ---------------------------------------------------------------------------

const isTrackedFn = vi.fn<(did: string) => Promise<boolean>>()
const trackRepoFn = vi.fn<(did: string) => Promise<void>>()

const mockRepoManager = {
  isTracked: isTrackedFn,
  trackRepo: trackRepoFn,
  untrackRepo: vi.fn(),
  restoreTrackedRepos: vi.fn(),
}

const mockFirehose = {
  getRepoManager: () => mockRepoManager,
  start: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn().mockReturnValue({ connected: true, lastEventId: null }),
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
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => {
    await fn(mockDb)
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
// Sample topic row (as returned from DB)
// ---------------------------------------------------------------------------

function sampleTopicRow(overrides?: Record<string, unknown>) {
  return {
    uri: TEST_URI,
    rkey: TEST_RKEY,
    authorDid: TEST_DID,
    title: 'Test Topic Title',
    content: 'Test topic content goes here',
    contentFormat: null,
    category: 'general',
    tags: ['test', 'example'],
    communityDid: 'did:plc:community123',
    cid: TEST_CID,
    labels: null,
    replyCount: 0,
    reactionCount: 0,
    lastActivityAt: new Date(TEST_NOW),
    createdAt: new Date(TEST_NOW),
    indexedAt: new Date(TEST_NOW),
    embedding: null,
    ...overrides,
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
  app.decorate('firehose', mockFirehose as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('cache', {} as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)

  await app.register(topicRoutes())
  await app.ready()

  return app
}

// ---------------------------------------------------------------------------
// Maturity mock helpers
// ---------------------------------------------------------------------------

/**
 * Set up mock DB responses for maturity filtering queries in GET /api/topics.
 * The handler queries: (1) user profile, (2) allowed categories, then (3) topics.
 * Each query goes through selectChain.where, so we queue mockResolvedValueOnce
 * for the first two, letting the third fall through to the chainable default.
 *
 * @param authenticated - Whether the request user is authenticated (adds user profile query)
 * @param allowedSlugs - Category slugs to return as allowed (default: ["general"])
 */
function setupMaturityMocks(authenticated: boolean, allowedSlugs: string[] = ['general']): void {
  if (authenticated) {
    // User profile query: return a user with safe maturity (age not declared)
    selectChain.where.mockResolvedValueOnce([{ declaredAge: null, maturityPref: 'safe' }])
  }
  // Community settings: ageThreshold
  selectChain.where.mockResolvedValueOnce([{ ageThreshold: 16 }])
  // Categories query: return allowed category slugs
  selectChain.where.mockResolvedValueOnce(allowedSlugs.map((slug) => ({ slug })))
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('topic routes', () => {
  // =========================================================================
  // POST /api/topics
  // =========================================================================

  describe('POST /api/topics', () => {
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

      // Default mocks for successful create
      createRecordFn.mockResolvedValue({ uri: TEST_URI, cid: TEST_CID })
      isTrackedFn.mockResolvedValue(true)
    })

    it('creates a topic and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'My First Topic',
          content: 'This is the body of my topic.',
          category: 'general',
          tags: ['hello', 'world'],
        },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json<{ uri: string; cid: string }>()
      expect(body.uri).toBe(TEST_URI)
      expect(body.cid).toBe(TEST_CID)

      // Should have called PDS createRecord
      expect(createRecordFn).toHaveBeenCalledOnce()
      expect(createRecordFn.mock.calls[0]?.[0]).toBe(TEST_DID)
      expect(createRecordFn.mock.calls[0]?.[1]).toBe('forum.barazo.topic.post')

      // Should have inserted into DB
      expect(mockDb.insert).toHaveBeenCalledOnce()
    })

    it('creates a topic without optional tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Tagless Topic',
          content: 'No tags here.',
          category: 'support',
        },
      })

      expect(response.statusCode).toBe(201)
    })

    it("tracks new user's repo on first post", async () => {
      isTrackedFn.mockResolvedValue(false)
      trackRepoFn.mockResolvedValue(undefined)

      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'First Post',
          content: 'This is my first ever post.',
          category: 'introductions',
        },
      })

      expect(response.statusCode).toBe(201)
      expect(isTrackedFn).toHaveBeenCalledWith(TEST_DID)
      expect(trackRepoFn).toHaveBeenCalledWith(TEST_DID)
    })

    it('does not track already-tracked user', async () => {
      isTrackedFn.mockResolvedValue(true)

      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Another Post',
          content: 'Already tracked.',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(201)
      expect(isTrackedFn).toHaveBeenCalledWith(TEST_DID)
      expect(trackRepoFn).not.toHaveBeenCalled()
    })

    it('returns 400 for missing title', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          content: 'No title provided.',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for missing content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'No Content',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for missing category', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'No Category',
          content: 'Missing required field.',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for title exceeding max length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'A'.repeat(201),
          content: 'Valid content.',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for too many tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Too Many Tags',
          content: 'Tags overload.',
          category: 'general',
          tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for empty body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 502 when PDS write fails', async () => {
      createRecordFn.mockRejectedValueOnce(new Error('PDS unreachable'))

      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'PDS Fail Topic',
          content: 'Should fail because PDS is down.',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(502)
    })

    it('creates a topic with self-labels and includes them in PDS record and DB insert', async () => {
      const labels = { values: [{ val: 'nsfw' }, { val: 'spoiler' }] }

      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Labeled Topic',
          content: 'This topic has self-labels.',
          category: 'general',
          labels,
        },
      })

      expect(response.statusCode).toBe(201)

      // Verify PDS record includes labels
      expect(createRecordFn).toHaveBeenCalledOnce()
      const pdsRecord = createRecordFn.mock.calls[0]?.[2] as Record<string, unknown>
      expect(pdsRecord.labels).toEqual(labels)

      // Verify DB insert includes labels
      expect(mockDb.insert).toHaveBeenCalledOnce()
      const insertValues = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>
      expect(insertValues.labels).toEqual(labels)
    })

    it('creates a topic without labels (backwards compatible)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/topics',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'No Labels Topic',
          content: 'This topic has no labels.',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(201)

      // Verify PDS record does NOT include labels key
      const pdsRecord = createRecordFn.mock.calls[0]?.[2] as Record<string, unknown>
      expect(pdsRecord).not.toHaveProperty('labels')

      // Verify DB insert has labels: null
      const insertValues = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>
      expect(insertValues.labels).toBeNull()
    })
  })

  describe('POST /api/topics (unauthenticated)', () => {
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
        url: '/api/topics',
        payload: {
          title: 'Unauth Topic',
          content: 'Should not work.',
          category: 'general',
        },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  // =========================================================================
  // GET /api/topics (list)
  // =========================================================================

  describe('GET /api/topics', () => {
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

    it('returns empty list when no topics exist', async () => {
      setupMaturityMocks(true)
      // The list query ends with .limit() -- make it resolve to empty
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: unknown[]; cursor: string | null }>()
      expect(body.topics).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('returns topics with pagination cursor', async () => {
      setupMaturityMocks(true)
      // Request limit=2 -> route fetches limit+1=3 items
      // Return 3 items to trigger "hasMore"
      const rows = [
        sampleTopicRow(),
        sampleTopicRow({ uri: `at://${TEST_DID}/forum.barazo.topic.post/def456`, rkey: 'def456' }),
        sampleTopicRow({ uri: `at://${TEST_DID}/forum.barazo.topic.post/ghi789`, rkey: 'ghi789' }),
      ]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?limit=2',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: unknown[]; cursor: string | null }>()
      expect(body.topics).toHaveLength(2)
      expect(body.cursor).toBeTruthy()
    })

    it('returns null cursor when fewer items than limit', async () => {
      setupMaturityMocks(true)
      const rows = [sampleTopicRow()]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?limit=25',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: unknown[]; cursor: string | null }>()
      expect(body.topics).toHaveLength(1)
      expect(body.cursor).toBeNull()
    })

    it('filters by category', async () => {
      setupMaturityMocks(true, ['general', 'support'])
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?category=support',
      })

      expect(response.statusCode).toBe(200)
      expect(selectChain.where).toHaveBeenCalled()
    })

    it('filters by tag', async () => {
      setupMaturityMocks(true)
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?tag=help',
      })

      expect(response.statusCode).toBe(200)
      expect(selectChain.where).toHaveBeenCalled()
    })

    it('respects custom limit', async () => {
      setupMaturityMocks(true)
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?limit=5',
      })

      expect(response.statusCode).toBe(200)
      expect(selectChain.limit).toHaveBeenCalled()
    })

    it('returns 400 for invalid limit (over max)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?limit=999',
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid limit (zero)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?limit=0',
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for non-numeric limit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/topics?limit=abc',
      })

      expect(response.statusCode).toBe(400)
    })

    it('accepts cursor parameter', async () => {
      setupMaturityMocks(true)
      const cursor = Buffer.from(
        JSON.stringify({ lastActivityAt: TEST_NOW, uri: TEST_URI })
      ).toString('base64')
      selectChain.limit.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: `/api/topics?cursor=${encodeURIComponent(cursor)}`,
      })

      expect(response.statusCode).toBe(200)
    })

    it('works without authentication (public endpoint)', async () => {
      const noAuthApp = await buildTestApp(undefined)
      setupMaturityMocks(false) // no user profile query when unauthenticated
      selectChain.limit.mockResolvedValueOnce([])

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      await noAuthApp.close()
    })

    it('includes labels in topic list response', async () => {
      setupMaturityMocks(true)
      const labels = { values: [{ val: 'nsfw' }] }
      const rows = [
        sampleTopicRow({ labels }),
        sampleTopicRow({
          uri: `at://${TEST_DID}/forum.barazo.topic.post/nolabel`,
          rkey: 'nolabel',
          labels: null,
        }),
      ]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        topics: Array<{ uri: string; labels: { values: Array<{ val: string }> } | null }>
      }>()
      expect(body.topics).toHaveLength(2)
      expect(body.topics[0]?.labels).toEqual(labels)
      expect(body.topics[1]?.labels).toBeNull()
    })

    it('excludes topics by blocked users from list', async () => {
      const blockedDid = 'did:plc:blockeduser'

      // Query order for authenticated GET /api/topics:
      // 1. User profile (maturity)
      // 2. Allowed categories (maturity)
      // 3. Block/mute preferences
      // 4. Topics query (limit)
      setupMaturityMocks(true)
      // Block/mute preferences query
      selectChain.where.mockResolvedValueOnce([
        {
          blockedDids: [blockedDid],
          mutedDids: [],
        },
      ])

      // Return only non-blocked topics (the route should have applied the filter)
      const rows = [sampleTopicRow({ authorDid: TEST_DID })]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ authorDid: string; isMuted: boolean }> }>()
      // The blocked user's topics should not appear at all
      expect(body.topics.every((t) => t.authorDid !== blockedDid)).toBe(true)
    })

    it('annotates topics by muted users with isMuted: true', async () => {
      const mutedDid = 'did:plc:muteduser'

      setupMaturityMocks(true)
      // Block/mute preferences query
      selectChain.where.mockResolvedValueOnce([
        {
          blockedDids: [],
          mutedDids: [mutedDid],
        },
      ])

      const rows = [
        sampleTopicRow({
          authorDid: mutedDid,
          uri: `at://${mutedDid}/forum.barazo.topic.post/m1`,
          rkey: 'm1',
        }),
        sampleTopicRow({ authorDid: TEST_DID }),
      ]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ authorDid: string; isMuted: boolean }> }>()
      expect(body.topics).toHaveLength(2)

      const mutedTopic = body.topics.find((t) => t.authorDid === mutedDid)
      const normalTopic = body.topics.find((t) => t.authorDid === TEST_DID)
      expect(mutedTopic?.isMuted).toBe(true)
      expect(normalTopic?.isMuted).toBe(false)
    })

    it('returns isMuted: false for all topics when unauthenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)
      setupMaturityMocks(false) // no user profile query
      // No block/mute preferences query for unauthenticated users

      const rows = [
        sampleTopicRow({ authorDid: TEST_DID }),
        sampleTopicRow({
          authorDid: OTHER_DID,
          uri: `at://${OTHER_DID}/forum.barazo.topic.post/o1`,
          rkey: 'o1',
        }),
      ]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ authorDid: string; isMuted: boolean }> }>()
      expect(body.topics).toHaveLength(2)
      expect(body.topics.every((t) => !t.isMuted)).toBe(true)

      await noAuthApp.close()
    })

    it('includes author profile in topic response', async () => {
      resetAllDbMocks()
      setupMaturityMocks(true)

      // Topics query (terminal via .limit)
      selectChain.limit.mockResolvedValueOnce([sampleTopicRow({ authorDid: TEST_DID })])

      // After maturity mocks (3 .where calls consumed), 4 more .where calls follow:
      //   4. loadBlockMuteLists .where (terminal)
      //   5. topics .where (chained to .orderBy().limit())
      //   6. loadMutedWords global .where (terminal)
      //   7. resolveAuthors users .where (terminal)
      // We must explicitly mock calls 4-7 so that:
      //   - Call 5 returns the chain (not a Promise) for .orderBy().limit() to work
      //   - Call 7 returns the author user row

      selectChain.where.mockResolvedValueOnce([]) // 4: loadBlockMuteLists

      selectChain.where.mockImplementationOnce(() => selectChain) // 5: topics .where
      selectChain.where.mockResolvedValueOnce([]) // 6: loadMutedWords global
      selectChain.where.mockResolvedValueOnce([
        // 7: resolveAuthors users
        {
          did: TEST_DID,
          handle: TEST_HANDLE,
          displayName: 'Alice',
          avatarUrl: 'https://cdn.example.com/alice.jpg',
          bannerUrl: null,
          bio: null,
        },
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/api/topics',
        headers: { authorization: 'Bearer test' },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload) as { topics: Array<{ author: unknown }> }
      expect(body.topics[0].author).toEqual({
        did: TEST_DID,
        handle: TEST_HANDLE,
        displayName: 'Alice',
        avatarUrl: 'https://cdn.example.com/alice.jpg',
      })
    })
  })

  // =========================================================================
  // GET /api/topics/:uri (single topic)
  // =========================================================================

  describe('GET /api/topics/:uri', () => {
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

    it('returns a single topic by URI', async () => {
      const row = sampleTopicRow()
      // select().from(topics).where() is the terminal call
      selectChain.where.mockResolvedValueOnce([row])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'GET',
        url: `/api/topics/${encodedUri}`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; title: string }>()
      expect(body.uri).toBe(TEST_URI)
      expect(body.title).toBe('Test Topic Title')
    })

    it('returns 404 for non-existent topic', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const encodedUri = encodeURIComponent('at://did:plc:nonexistent/forum.barazo.topic.post/xyz')
      const response = await app.inject({
        method: 'GET',
        url: `/api/topics/${encodedUri}`,
      })

      expect(response.statusCode).toBe(404)
    })

    it('works without authentication (public endpoint)', async () => {
      const noAuthApp = await buildTestApp(undefined)
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await noAuthApp.inject({
        method: 'GET',
        url: `/api/topics/${encodedUri}`,
      })

      expect(response.statusCode).toBe(200)
      await noAuthApp.close()
    })

    it('includes labels in single topic response', async () => {
      const labels = { values: [{ val: 'spoiler' }, { val: 'nsfw' }] }
      const row = sampleTopicRow({ labels })
      selectChain.where.mockResolvedValueOnce([row])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'GET',
        url: `/api/topics/${encodedUri}`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; labels: { values: Array<{ val: string }> } }>()
      expect(body.labels).toEqual(labels)
    })

    it('returns null labels when topic has no labels', async () => {
      const row = sampleTopicRow({ labels: null })
      selectChain.where.mockResolvedValueOnce([row])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'GET',
        url: `/api/topics/${encodedUri}`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ uri: string; labels: null }>()
      expect(body.labels).toBeNull()
    })
  })

  // =========================================================================
  // PUT /api/topics/:uri
  // =========================================================================

  describe('PUT /api/topics/:uri', () => {
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
      updateRecordFn.mockResolvedValue({ uri: TEST_URI, cid: 'bafyreinewcid' })
    })

    it('updates a topic when user is the author', async () => {
      const existingRow = sampleTopicRow()
      // First: select().from(topics).where() -> find topic
      selectChain.where.mockResolvedValueOnce([existingRow])
      // Then: update().set().where().returning() -> return updated row
      const updatedRow = { ...existingRow, title: 'Updated Title', cid: 'bafyreinewcid' }
      updateChain.returning.mockResolvedValueOnce([updatedRow])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Updated Title',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ title: string }>()
      expect(body.title).toBe('Updated Title')
      expect(updateRecordFn).toHaveBeenCalledOnce()
    })

    it('returns 403 when user is not the author', async () => {
      const existingRow = sampleTopicRow({ authorDid: OTHER_DID })
      selectChain.where.mockResolvedValueOnce([existingRow])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Attempted Edit',
        },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 404 when topic does not exist', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const encodedUri = encodeURIComponent('at://did:plc:nobody/forum.barazo.topic.post/ghost')
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Ghost Topic',
        },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 400 for title exceeding max length', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodeURIComponent(TEST_URI)}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'A'.repeat(201),
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 502 when PDS update fails', async () => {
      const existingRow = sampleTopicRow()
      selectChain.where.mockResolvedValueOnce([existingRow])
      updateRecordFn.mockRejectedValueOnce(new Error('PDS error'))

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: 'Will Fail',
        },
      })

      expect(response.statusCode).toBe(502)
    })

    it('accepts empty update (all fields optional)', async () => {
      const existingRow = sampleTopicRow()
      selectChain.where.mockResolvedValueOnce([existingRow])
      updateChain.returning.mockResolvedValueOnce([existingRow])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(200)
    })

    it('updates a topic with self-labels (PDS record + DB)', async () => {
      const existingRow = sampleTopicRow()
      selectChain.where.mockResolvedValueOnce([existingRow])
      const labels = { values: [{ val: 'nsfw' }, { val: 'spoiler' }] }
      const updatedRow = { ...existingRow, labels, cid: 'bafyreinewcid' }
      updateChain.returning.mockResolvedValueOnce([updatedRow])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { labels },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ labels: { values: Array<{ val: string }> } }>()
      expect(body.labels).toEqual(labels)

      // Verify PDS record includes labels
      expect(updateRecordFn).toHaveBeenCalledOnce()
      const pdsRecord = updateRecordFn.mock.calls[0]?.[3] as Record<string, unknown>
      expect(pdsRecord.labels).toEqual(labels)

      // Verify DB update includes labels
      const dbUpdateSet = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>
      expect(dbUpdateSet.labels).toEqual(labels)
    })

    it('does not change existing labels when labels field is omitted from update', async () => {
      const existingLabels = { values: [{ val: 'nsfw' }] }
      const existingRow = sampleTopicRow({ labels: existingLabels })
      selectChain.where.mockResolvedValueOnce([existingRow])
      const updatedRow = { ...existingRow, title: 'New Title', cid: 'bafyreinewcid' }
      updateChain.returning.mockResolvedValueOnce([updatedRow])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { title: 'New Title' },
      })

      expect(response.statusCode).toBe(200)

      // PDS record should preserve existing labels
      const pdsRecord = updateRecordFn.mock.calls[0]?.[3] as Record<string, unknown>
      expect(pdsRecord.labels).toEqual(existingLabels)

      // DB update should NOT include labels key (partial update)
      const dbUpdateSet = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>
      expect(dbUpdateSet).not.toHaveProperty('labels')
    })
  })

  describe('PUT /api/topics/:uri (unauthenticated)', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(undefined)
    })

    afterAll(async () => {
      await app.close()
    })

    it('returns 401 without auth', async () => {
      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'PUT',
        url: `/api/topics/${encodedUri}`,
        payload: { title: 'Unauth Edit' },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  // =========================================================================
  // DELETE /api/topics/:uri
  // =========================================================================

  describe('DELETE /api/topics/:uri', () => {
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
      deleteRecordFn.mockResolvedValue(undefined)
    })

    it('deletes a topic when user is the author (deletes from PDS + DB)', async () => {
      const existingRow = sampleTopicRow() // authorDid = TEST_DID
      // First select: find topic
      selectChain.where.mockResolvedValueOnce([existingRow])
      // Author === user, so NO second select (no role lookup needed)

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(204)

      // Should have deleted from PDS
      expect(deleteRecordFn).toHaveBeenCalledOnce()
      expect(deleteRecordFn.mock.calls[0]?.[0]).toBe(TEST_DID)

      // Should have deleted from DB (replies + topics)
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('deletes topic as moderator (index-only delete, not from PDS)', async () => {
      const modApp = await buildTestApp(testUser({ did: MOD_DID, handle: 'mod.bsky.social' }))

      const existingRow = sampleTopicRow({ authorDid: OTHER_DID })
      // First select: find topic
      selectChain.where.mockResolvedValueOnce([existingRow])
      // Second select: check user role (moderator is not author)
      selectChain.where.mockResolvedValueOnce([{ did: MOD_DID, role: 'moderator' }])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await modApp.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(204)

      // Moderator should NOT delete from PDS
      expect(deleteRecordFn).not.toHaveBeenCalled()

      // But should delete from DB index
      expect(mockDb.delete).toHaveBeenCalled()

      await modApp.close()
    })

    it('deletes topic as admin (index-only delete, not from PDS)', async () => {
      const adminApp = await buildTestApp(testUser({ did: MOD_DID, handle: 'admin.bsky.social' }))

      const existingRow = sampleTopicRow({ authorDid: OTHER_DID })
      selectChain.where.mockResolvedValueOnce([existingRow])
      selectChain.where.mockResolvedValueOnce([{ did: MOD_DID, role: 'admin' }])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await adminApp.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(204)
      expect(deleteRecordFn).not.toHaveBeenCalled()

      await adminApp.close()
    })

    it('returns 403 when non-author regular user tries to delete', async () => {
      const existingRow = sampleTopicRow({ authorDid: OTHER_DID })
      selectChain.where.mockResolvedValueOnce([existingRow])
      // User role lookup: regular user
      selectChain.where.mockResolvedValueOnce([{ did: TEST_DID, role: 'user' }])

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 404 when topic does not exist', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const encodedUri = encodeURIComponent('at://did:plc:nobody/forum.barazo.topic.post/ghost')
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 502 when PDS delete fails', async () => {
      const existingRow = sampleTopicRow() // author = TEST_DID
      selectChain.where.mockResolvedValueOnce([existingRow])
      deleteRecordFn.mockRejectedValueOnce(new Error('PDS delete failed'))

      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(502)
    })
  })

  describe('DELETE /api/topics/:uri (unauthenticated)', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(undefined)
    })

    afterAll(async () => {
      await app.close()
    })

    it('returns 401 without auth', async () => {
      const encodedUri = encodeURIComponent(TEST_URI)
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/topics/${encodedUri}`,
        headers: {},
      })

      expect(response.statusCode).toBe(401)
    })
  })

  // =========================================================================
  // GET /api/topics (global mode)
  // =========================================================================

  describe('GET /api/topics (global mode)', () => {
    const globalMockEnv = {
      ...mockEnv,
      COMMUNITY_MODE: 'global' as const,
      COMMUNITY_DID: undefined,
    } as Env

    let app: FastifyInstance

    async function buildGlobalTestApp(user?: RequestUser): Promise<FastifyInstance> {
      const globalApp = Fastify({ logger: false })

      globalApp.decorate('db', mockDb as never)
      globalApp.decorate('env', globalMockEnv)
      globalApp.decorate('authMiddleware', createMockAuthMiddleware(user))
      globalApp.decorate('firehose', mockFirehose as never)
      globalApp.decorate('oauthClient', {} as never)
      globalApp.decorate('sessionService', {} as SessionService)
      globalApp.decorate('setupService', {} as SetupService)
      globalApp.decorate('cache', {} as never)
      globalApp.decorateRequest('user', undefined as RequestUser | undefined)

      await globalApp.register(topicRoutes())
      await globalApp.ready()

      return globalApp
    }

    /**
     * Set up mock DB responses for global-mode GET /api/topics.
     *
     * Query order:
     * 1. (if authenticated) User profile query -> selectChain.where
     * 2. Community settings ageThreshold query -> selectChain.where
     * 3. Community settings query -> selectChain.where (with isNotNull filter)
     * 4. Category slugs query -> selectChain.where (categories by community + maturity)
     * 5. (if authenticated) Block/mute preferences -> selectChain.where
     * 6. Topics query -> selectChain.limit
     */
    function setupGlobalMaturityMocks(opts: {
      authenticated: boolean
      userProfile?: { declaredAge: number | null; maturityPref: string }
      communities: Array<{ communityDid: string | null; maturityRating: string }>
      categorySlugs: string[]
    }): void {
      if (opts.authenticated) {
        // User profile query
        const profile = opts.userProfile ?? { declaredAge: null, maturityPref: 'safe' }
        selectChain.where.mockResolvedValueOnce([profile])
      }
      // Community settings: ageThreshold
      selectChain.where.mockResolvedValueOnce([{ ageThreshold: 16 }])
      // Community settings query (all communities)
      selectChain.where.mockResolvedValueOnce(opts.communities)
      // Category slugs query (filtered by allowed communities + maturity)
      selectChain.where.mockResolvedValueOnce(opts.categorySlugs.map((slug) => ({ slug })))
    }

    beforeAll(async () => {
      app = await buildGlobalTestApp(testUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('excludes topics from adult-rated communities in global mode', async () => {
      setupGlobalMaturityMocks({
        authenticated: true,
        userProfile: { declaredAge: 18, maturityPref: 'adult' },
        communities: [
          { communityDid: 'did:plc:sfw-community', maturityRating: 'safe' },
          { communityDid: 'did:plc:adult-community', maturityRating: 'adult' },
        ],
        categorySlugs: ['general'],
      })
      // Topics query: return one topic from the SFW community
      const rows = [sampleTopicRow({ communityDid: 'did:plc:sfw-community' })]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ communityDid: string }> }>()
      // Adult community topics should not be present
      expect(body.topics.every((t) => t.communityDid !== 'did:plc:adult-community')).toBe(true)
      expect(body.topics).toHaveLength(1)
    })

    it('excludes mature-rated communities for SFW-only users', async () => {
      setupGlobalMaturityMocks({
        authenticated: true,
        userProfile: { declaredAge: null, maturityPref: 'safe' },
        communities: [
          { communityDid: 'did:plc:sfw-community', maturityRating: 'safe' },
          { communityDid: 'did:plc:mature-community', maturityRating: 'mature' },
        ],
        categorySlugs: ['general'],
      })
      // Topics from SFW community only
      const rows = [sampleTopicRow({ communityDid: 'did:plc:sfw-community' })]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ communityDid: string }> }>()
      expect(body.topics.every((t) => t.communityDid !== 'did:plc:mature-community')).toBe(true)
      expect(body.topics).toHaveLength(1)
    })

    it('includes mature-rated communities for users with mature preference', async () => {
      setupGlobalMaturityMocks({
        authenticated: true,
        userProfile: { declaredAge: 18, maturityPref: 'mature' },
        communities: [
          { communityDid: 'did:plc:sfw-community', maturityRating: 'safe' },
          { communityDid: 'did:plc:mature-community', maturityRating: 'mature' },
        ],
        categorySlugs: ['general', 'nsfw-general'],
      })
      // Topics from both allowed communities
      const rows = [
        sampleTopicRow({ communityDid: 'did:plc:sfw-community' }),
        sampleTopicRow({
          communityDid: 'did:plc:mature-community',
          uri: `at://${TEST_DID}/forum.barazo.topic.post/mature1`,
          rkey: 'mature1',
        }),
      ]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ communityDid: string }> }>()
      expect(body.topics).toHaveLength(2)
      const communityDids = body.topics.map((t) => t.communityDid)
      expect(communityDids).toContain('did:plc:sfw-community')
      expect(communityDids).toContain('did:plc:mature-community')
    })

    it('always includes SFW communities in global mode', async () => {
      const noAuthApp = await buildGlobalTestApp(undefined)

      setupGlobalMaturityMocks({
        authenticated: false,
        communities: [
          { communityDid: 'did:plc:sfw1', maturityRating: 'safe' },
          { communityDid: 'did:plc:sfw2', maturityRating: 'safe' },
          { communityDid: 'did:plc:mature1', maturityRating: 'mature' },
        ],
        categorySlugs: ['general', 'support'],
      })
      const rows = [
        sampleTopicRow({ communityDid: 'did:plc:sfw1' }),
        sampleTopicRow({
          communityDid: 'did:plc:sfw2',
          uri: `at://${TEST_DID}/forum.barazo.topic.post/sfw2topic`,
          rkey: 'sfw2topic',
        }),
      ]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ communityDid: string }> }>()
      expect(body.topics).toHaveLength(2)
      const communityDids = body.topics.map((t) => t.communityDid)
      expect(communityDids).toContain('did:plc:sfw1')
      expect(communityDids).toContain('did:plc:sfw2')

      await noAuthApp.close()
    })

    it('excludes adult communities even for users with adult maturity level', async () => {
      setupGlobalMaturityMocks({
        authenticated: true,
        userProfile: { declaredAge: 18, maturityPref: 'adult' },
        communities: [
          { communityDid: 'did:plc:sfw-community', maturityRating: 'safe' },
          { communityDid: 'did:plc:adult-community', maturityRating: 'adult' },
        ],
        categorySlugs: ['general'],
      })
      const rows = [sampleTopicRow({ communityDid: 'did:plc:sfw-community' })]
      selectChain.limit.mockResolvedValueOnce(rows)

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: Array<{ communityDid: string }> }>()
      // Even though user has adult maturity, adult communities are NEVER shown in global mode
      expect(body.topics.every((t) => t.communityDid !== 'did:plc:adult-community')).toBe(true)
    })

    it('returns empty result when no communities pass the filter', async () => {
      // In global mode, when all communities are adult-rated, the handler
      // should return early without even querying categories or topics.
      // unauthenticated user: no user profile query
      const noAuthApp = await buildGlobalTestApp(undefined)

      // Community settings query: only adult community
      selectChain.where.mockResolvedValueOnce([
        { communityDid: 'did:plc:adult-only', maturityRating: 'adult' },
      ])
      // No further mocks needed -- handler should return early

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: unknown[]; cursor: string | null }>()
      expect(body.topics).toEqual([])
      expect(body.cursor).toBeNull()

      await noAuthApp.close()
    })

    it('returns empty result when no categories pass the maturity filter in global mode', async () => {
      setupGlobalMaturityMocks({
        authenticated: true,
        userProfile: { declaredAge: null, maturityPref: 'safe' },
        communities: [{ communityDid: 'did:plc:sfw-community', maturityRating: 'safe' }],
        categorySlugs: [], // No categories pass the filter
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/topics',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ topics: unknown[]; cursor: string | null }>()
      expect(body.topics).toEqual([])
      expect(body.cursor).toBeNull()
    })
  })
})

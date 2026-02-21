import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

// Import routes
import { notificationRoutes } from '../../../src/routes/notifications.js'

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
const ACTOR_DID = 'did:plc:actor456'
const COMMUNITY_DID = 'did:plc:community123'
const TEST_SUBJECT_URI = `at://${ACTOR_DID}/forum.barazo.topic.post/topic123`
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
// Chainable mock DB
// ---------------------------------------------------------------------------

const mockDb = createMockDb()

let selectChain: DbChain
let updateChain: DbChain

function resetAllDbMocks(): void {
  selectChain = createChainableProxy([])
  updateChain = createChainableProxy([])
  mockDb.insert.mockReturnValue(createChainableProxy())
  mockDb.select.mockReturnValue(selectChain)
  mockDb.update.mockReturnValue(updateChain)
  mockDb.delete.mockReturnValue(createChainableProxy())
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async mock for Drizzle transaction
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
    return await fn(mockDb)
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
// Sample data builders
// ---------------------------------------------------------------------------

function sampleNotificationRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    recipientDid: TEST_DID,
    type: 'reply',
    subjectUri: TEST_SUBJECT_URI,
    actorDid: ACTOR_DID,
    communityDid: COMMUNITY_DID,
    read: false,
    createdAt: new Date(TEST_NOW),
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
  app.decorate('firehose', {} as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('cache', {} as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)

  await app.register(notificationRoutes())
  await app.ready()

  return app
}

/**
 * Build a test app with a pass-through auth middleware that does NOT set
 * request.user and does NOT send a 401. This simulates the defensive guard
 * inside handler bodies where `if (!user)` is checked.
 */
async function buildTestAppWithPassthroughAuth(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  const passthroughAuth: AuthMiddleware = {
    requireAuth: async (_request, _reply) => {
      // Intentionally do nothing -- neither set user nor abort
    },
    optionalAuth: (_request, _reply) => Promise.resolve(),
  }

  app.decorate('db', mockDb as never)
  app.decorate('env', mockEnv)
  app.decorate('authMiddleware', passthroughAuth)
  app.decorate('firehose', {} as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('cache', {} as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)

  await app.register(notificationRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('notification routes', () => {
  // =========================================================================
  // GET /api/notifications
  // =========================================================================

  describe('GET /api/notifications', () => {
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

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/notifications',
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('returns empty list for user with no notifications', async () => {
      // The route does two select queries:
      // 1. select().from().where().orderBy().limit() -- notification list
      // 2. select({ count }).from().where() -- total count
      // Both use the same selectChain. The first where() must return the
      // chainable thenable so that .orderBy().limit() works. The second
      // where() can resolve directly to the count result.
      //
      // Use mockImplementationOnce for the first where() to preserve
      // chaining, then mockResolvedValueOnce for the second.
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      // Second select().from().where() for count
      selectChain.where.mockResolvedValueOnce([{ count: 0 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toEqual([])
      expect(body.cursor).toBeNull()
      expect(body.total).toBe(0)
    })

    it('returns notifications ordered by unread first', async () => {
      const unreadNotification = sampleNotificationRow({
        id: 2,
        read: false,
        createdAt: new Date('2026-02-14T11:00:00.000Z'),
      })
      const readNotification = sampleNotificationRow({
        id: 1,
        read: true,
        createdAt: new Date('2026-02-14T10:00:00.000Z'),
      })

      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([unreadNotification, readNotification])
      selectChain.where.mockResolvedValueOnce([{ count: 2 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number; read: boolean }>
        total: number
      }>()
      expect(body.notifications).toHaveLength(2)
      expect(body.notifications[0]?.read).toBe(false)
      expect(body.notifications[1]?.read).toBe(true)
      expect(body.total).toBe(2)
    })

    it('supports pagination with cursor', async () => {
      // Return limit + 1 to signal more pages exist
      const rows = Array.from({ length: 26 }, (_, i) =>
        sampleNotificationRow({
          id: i + 1,
          createdAt: new Date(
            `2026-02-14T${String(12 - Math.floor(i / 2)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`
          ),
        })
      )

      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce(rows)
      selectChain.where.mockResolvedValueOnce([{ count: 50 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toHaveLength(25)
      expect(body.cursor).toBeTruthy()
      expect(body.total).toBe(50)
    })

    it('returns null cursor when fewer items than limit', async () => {
      const rows = [sampleNotificationRow()]
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce(rows)
      selectChain.where.mockResolvedValueOnce([{ count: 1 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=25',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
      }>()
      expect(body.notifications).toHaveLength(1)
      expect(body.cursor).toBeNull()
    })

    it('serializes notification dates as ISO strings', async () => {
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([sampleNotificationRow()])
      selectChain.where.mockResolvedValueOnce([{ count: 1 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{
          createdAt: string
          type: string
          actorDid: string
        }>
      }>()
      expect(body.notifications[0]?.createdAt).toBe(TEST_NOW)
      expect(body.notifications[0]?.type).toBe('reply')
      expect(body.notifications[0]?.actorDid).toBe(ACTOR_DID)
    })

    it('returns 400 for invalid limit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=abc',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for limit exceeding max (101)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=101',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for limit below min (0)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=0',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('filters to unread only when unreadOnly=true', async () => {
      const unreadRow = sampleNotificationRow({ id: 1, read: false })
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([unreadRow])
      selectChain.where.mockResolvedValueOnce([{ count: 1 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?unreadOnly=true',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number; read: boolean }>
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toHaveLength(1)
      expect(body.notifications[0]?.read).toBe(false)
    })

    it('returns all notifications when unreadOnly is not set', async () => {
      const unreadRow = sampleNotificationRow({ id: 1, read: false })
      const readRow = sampleNotificationRow({ id: 2, read: true })
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([unreadRow, readRow])
      selectChain.where.mockResolvedValueOnce([{ count: 2 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number; read: boolean }>
        total: number
      }>()
      expect(body.notifications).toHaveLength(2)
      expect(body.total).toBe(2)
    })

    it('returns all notifications when unreadOnly=false', async () => {
      const unreadRow = sampleNotificationRow({ id: 1, read: false })
      const readRow = sampleNotificationRow({ id: 2, read: true })
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([unreadRow, readRow])
      selectChain.where.mockResolvedValueOnce([{ count: 2 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?unreadOnly=false',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number; read: boolean }>
        total: number
      }>()
      // unreadOnly transforms 'false' string -> val === 'true' -> false, so no unreadOnly filter
      expect(body.notifications).toHaveLength(2)
    })

    it('applies cursor-based pagination with a valid cursor', async () => {
      const cursorData = JSON.stringify({
        createdAt: '2026-02-14T11:00:00.000Z',
        id: 5,
      })
      const cursor = Buffer.from(cursorData).toString('base64')

      const row = sampleNotificationRow({
        id: 6,
        createdAt: new Date('2026-02-14T11:30:00.000Z'),
      })
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([row])
      selectChain.where.mockResolvedValueOnce([{ count: 10 }])

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?cursor=${cursor}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number }>
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toHaveLength(1)
      expect(body.notifications[0]?.id).toBe(6)
      expect(body.total).toBe(10)
    })

    it('applies cursor with createdAt equal to "unread"', async () => {
      const cursorData = JSON.stringify({
        createdAt: 'unread',
        id: 3,
      })
      const cursor = Buffer.from(cursorData).toString('base64')

      const row = sampleNotificationRow({ id: 4 })
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([row])
      selectChain.where.mockResolvedValueOnce([{ count: 5 }])

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?cursor=${cursor}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number }>
        total: number
      }>()
      expect(body.notifications).toHaveLength(1)
      expect(body.notifications[0]?.id).toBe(4)
    })

    it('ignores invalid cursor (malformed base64)', async () => {
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      selectChain.where.mockResolvedValueOnce([{ count: 0 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?cursor=not-valid-base64!!!',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('ignores cursor with invalid structure (missing id)', async () => {
      const cursorData = JSON.stringify({ createdAt: '2026-02-14T11:00:00.000Z' })
      const cursor = Buffer.from(cursorData).toString('base64')

      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      selectChain.where.mockResolvedValueOnce([{ count: 0 }])

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?cursor=${cursor}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
      }>()
      expect(body.notifications).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('ignores cursor with invalid structure (missing createdAt)', async () => {
      const cursorData = JSON.stringify({ id: 5 })
      const cursor = Buffer.from(cursorData).toString('base64')

      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      selectChain.where.mockResolvedValueOnce([{ count: 0 }])

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?cursor=${cursor}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
      }>()
      expect(body.notifications).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('ignores cursor with wrong types (id is string instead of number)', async () => {
      const cursorData = JSON.stringify({ createdAt: '2026-02-14T11:00:00.000Z', id: 'abc' })
      const cursor = Buffer.from(cursorData).toString('base64')

      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      selectChain.where.mockResolvedValueOnce([{ count: 0 }])

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?cursor=${cursor}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
      }>()
      expect(body.notifications).toEqual([])
      expect(body.cursor).toBeNull()
    })

    it('defaults total to 0 when count result is empty', async () => {
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      // Return empty array for count query (no rows)
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.total).toBe(0)
    })

    it('defaults total to 0 when count result row has undefined count', async () => {
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([])
      // Return row with undefined count
      selectChain.where.mockResolvedValueOnce([{ count: undefined }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.total).toBe(0)
    })

    it('uses default limit of 25 when limit is not specified', async () => {
      // Return exactly 25 rows (less than 26 = limit + 1), so no cursor
      const rows = Array.from({ length: 25 }, (_, i) =>
        sampleNotificationRow({
          id: i + 1,
          createdAt: new Date(
            `2026-02-14T${String(12).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`
          ),
        })
      )
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce(rows)
      selectChain.where.mockResolvedValueOnce([{ count: 25 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toHaveLength(25)
      expect(body.cursor).toBeNull()
    })

    it('applies custom limit from query parameter', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        sampleNotificationRow({
          id: i + 1,
          createdAt: new Date(`2026-02-14T12:${String(i).padStart(2, '0')}:00.000Z`),
        })
      )
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce(rows)
      selectChain.where.mockResolvedValueOnce([{ count: 5 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=5',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toHaveLength(5)
      expect(body.cursor).toBeNull()
    })

    it('combines unreadOnly and cursor parameters', async () => {
      const cursorData = JSON.stringify({
        createdAt: '2026-02-14T11:00:00.000Z',
        id: 3,
      })
      const cursor = Buffer.from(cursorData).toString('base64')

      const row = sampleNotificationRow({ id: 4, read: false })
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce([row])
      selectChain.where.mockResolvedValueOnce([{ count: 5 }])

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?unreadOnly=true&cursor=${cursor}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: Array<{ id: number; read: boolean }>
        total: number
      }>()
      expect(body.notifications).toHaveLength(1)
      expect(body.notifications[0]?.read).toBe(false)
    })

    it('returns 400 for negative limit (-1)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=-1',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns max limit of 100', async () => {
      const rows = Array.from({ length: 100 }, (_, i) =>
        sampleNotificationRow({
          id: i + 1,
          createdAt: new Date(`2026-02-14T12:00:${String(i % 60).padStart(2, '0')}.000Z`),
        })
      )
      const chainableThenable = {
        ...selectChain,
        then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
          Promise.resolve([]).then(resolve, reject),
        orderBy: selectChain.orderBy,
        limit: selectChain.limit,
        returning: selectChain.returning,
      }
      selectChain.where.mockReturnValueOnce(chainableThenable)
      selectChain.limit.mockResolvedValueOnce(rows)
      selectChain.where.mockResolvedValueOnce([{ count: 100 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=100',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        notifications: unknown[]
        cursor: string | null
        total: number
      }>()
      expect(body.notifications).toHaveLength(100)
      expect(body.cursor).toBeNull()
    })
  })

  // =========================================================================
  // PUT /api/notifications/read
  // =========================================================================

  describe('PUT /api/notifications/read', () => {
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

    it('marks single notification as read', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: 42 },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.update).toHaveBeenCalledOnce()
    })

    it('marks all notifications as read', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { all: true },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.update).toHaveBeenCalledOnce()
    })

    it('returns 400 when neither notificationId nor all provided', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        payload: { all: true },
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('prioritizes all over notificationId when both provided', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: 42, all: true },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      // The all=true branch is taken, so update is called once (for all)
      expect(mockDb.update).toHaveBeenCalledOnce()
    })

    it('returns 400 when all is false and notificationId is not provided', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { all: false },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid body (notificationId is negative)', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: -1 },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid body (notificationId is not an integer)', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: 1.5 },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid body (notificationId is zero)', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: 0 },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for invalid body (notificationId is string)', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: 'abc' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('succeeds when all is false but notificationId is valid', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        headers: { authorization: 'Bearer test-token' },
        payload: { notificationId: 7, all: false },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ success: boolean }>()
      expect(body.success).toBe(true)
      expect(mockDb.update).toHaveBeenCalledOnce()
    })
  })

  // =========================================================================
  // GET /api/notifications/count
  // =========================================================================

  describe('GET /api/notifications/count', () => {
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

    it('returns unread count', async () => {
      selectChain.where.mockResolvedValueOnce([{ count: 5 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/count',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ unread: number }>()
      expect(body.unread).toBe(5)
    })

    it('returns zero when no unread notifications', async () => {
      selectChain.where.mockResolvedValueOnce([{ count: 0 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/count',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ unread: number }>()
      expect(body.unread).toBe(0)
    })

    it('returns 401 when not authenticated', async () => {
      const noAuthApp = await buildTestApp(undefined)

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/notifications/count',
      })

      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('defaults to 0 when count result is empty array', async () => {
      selectChain.where.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/count',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ unread: number }>()
      expect(body.unread).toBe(0)
    })

    it('defaults to 0 when count result row has undefined count', async () => {
      selectChain.where.mockResolvedValueOnce([{ count: undefined }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/count',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ unread: number }>()
      expect(body.unread).toBe(0)
    })

    it('returns large unread count correctly', async () => {
      selectChain.where.mockResolvedValueOnce([{ count: 9999 }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/count',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ unread: number }>()
      expect(body.unread).toBe(9999)
    })
  })

  // =========================================================================
  // Defensive guards: handler-level !user checks (lines 124, 226, 286)
  // =========================================================================
  // These cover the defensive `if (!user)` branches inside each handler body.
  // Normally requireAuth prevents reaching them, but these guards protect
  // against a misconfigured auth middleware.
  // =========================================================================

  describe('handler-level auth guards (passthrough auth)', () => {
    let passthroughApp: FastifyInstance

    beforeAll(async () => {
      passthroughApp = await buildTestAppWithPassthroughAuth()
    })

    afterAll(async () => {
      await passthroughApp.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('GET /api/notifications returns 401 when user is not set on request', async () => {
      const response = await passthroughApp.inject({
        method: 'GET',
        url: '/api/notifications',
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Authentication required')
    })

    it('PUT /api/notifications/read returns 401 when user is not set on request', async () => {
      const response = await passthroughApp.inject({
        method: 'PUT',
        url: '/api/notifications/read',
        payload: { all: true },
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Authentication required')
    })

    it('GET /api/notifications/count returns 401 when user is not set on request', async () => {
      const response = await passthroughApp.inject({
        method: 'GET',
        url: '/api/notifications/count',
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Authentication required')
    })
  })
})

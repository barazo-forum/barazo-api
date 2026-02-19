import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createRequireAdmin } from '../../../src/auth/require-admin.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------

interface MockUserRow {
  did: string
  handle: string
  role: string
}

const mockDbSelect = vi.fn()
const mockDbFrom = vi.fn()
const mockDbWhere = vi.fn()

function createMockDb() {
  // Chain: db.select().from(users).where(eq(users.did, did))
  mockDbWhere.mockReturnValue([])
  mockDbFrom.mockReturnValue({ where: mockDbWhere })
  mockDbSelect.mockReturnValue({ from: mockDbFrom })

  return {
    select: mockDbSelect,
  }
}

// ---------------------------------------------------------------------------
// Mock auth middleware
// ---------------------------------------------------------------------------

function createMockAuthMiddleware(): AuthMiddleware {
  return {
    requireAuth: vi.fn(async (_request, _reply) => {
      // Simulate setting user - tests will set request.user before calling
    }),
    optionalAuth: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER: RequestUser = {
  did: 'did:plc:admin123',
  handle: 'admin.bsky.social',
  sid: 's'.repeat(64),
}

const REGULAR_USER: RequestUser = {
  did: 'did:plc:user456',
  handle: 'user.bsky.social',
  sid: 's'.repeat(64),
}

const ADMIN_DB_ROW: MockUserRow = {
  did: ADMIN_USER.did,
  handle: ADMIN_USER.handle,
  role: 'admin',
}

const REGULAR_DB_ROW: MockUserRow = {
  did: REGULAR_USER.did,
  handle: REGULAR_USER.handle,
  role: 'user',
}

const MODERATOR_DB_ROW: MockUserRow = {
  did: 'did:plc:mod789',
  handle: 'mod.bsky.social',
  role: 'moderator',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireAdmin middleware', () => {
  let app: FastifyInstance
  let mockAuthMiddleware: AuthMiddleware

  beforeEach(async () => {
    vi.clearAllMocks()

    const mockDb = createMockDb()
    mockAuthMiddleware = createMockAuthMiddleware()

    const requireAdmin = createRequireAdmin(mockDb as never, mockAuthMiddleware)

    app = Fastify({ logger: false })
    app.decorateRequest('user', undefined as RequestUser | undefined)

    app.get('/admin-test', { preHandler: [requireAdmin] }, (request) => {
      return { user: request.user }
    })

    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 401 when requireAuth rejects (no token)', async () => {
    // Make requireAuth return 401
    vi.mocked(mockAuthMiddleware.requireAuth).mockImplementation(async (_request, reply) => {
      await reply.status(401).send({ error: 'Authentication required' })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/admin-test',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: string }>()).toStrictEqual({
      error: 'Authentication required',
    })
  })

  it('returns 403 when user is not found in database', async () => {
    // requireAuth passes and sets user
    vi.mocked(mockAuthMiddleware.requireAuth).mockImplementation(async (request, _reply) => {
      request.user = ADMIN_USER
    })

    // User not found in DB
    mockDbWhere.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/admin-test',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ error: string }>()).toStrictEqual({
      error: 'Admin access required',
    })
  })

  it("returns 403 when user has role 'user'", async () => {
    vi.mocked(mockAuthMiddleware.requireAuth).mockImplementation(async (request, _reply) => {
      request.user = REGULAR_USER
    })

    mockDbWhere.mockResolvedValueOnce([REGULAR_DB_ROW])

    const response = await app.inject({
      method: 'GET',
      url: '/admin-test',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ error: string }>()).toStrictEqual({
      error: 'Admin access required',
    })
  })

  it("returns 403 when user has role 'moderator'", async () => {
    vi.mocked(mockAuthMiddleware.requireAuth).mockImplementation(async (request, _reply) => {
      request.user = {
        did: MODERATOR_DB_ROW.did,
        handle: MODERATOR_DB_ROW.handle,
        sid: 's'.repeat(64),
      }
    })

    mockDbWhere.mockResolvedValueOnce([MODERATOR_DB_ROW])

    const response = await app.inject({
      method: 'GET',
      url: '/admin-test',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ error: string }>()).toStrictEqual({
      error: 'Admin access required',
    })
  })

  it('passes through for admin user and returns 200', async () => {
    vi.mocked(mockAuthMiddleware.requireAuth).mockImplementation(async (request, _reply) => {
      request.user = ADMIN_USER
    })

    mockDbWhere.mockResolvedValueOnce([ADMIN_DB_ROW])

    const response = await app.inject({
      method: 'GET',
      url: '/admin-test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ user: RequestUser }>()
    expect(body.user).toStrictEqual(ADMIN_USER)
  })
})

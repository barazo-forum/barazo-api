import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createRequireModerator } from '../../../src/auth/require-moderator.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { Logger } from '../../../src/lib/logger.js'
import { createMockDb, resetDbMocks, createChainableProxy } from '../../helpers/mock-db.js'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = 'did:plc:testuser123'
const ADMIN_DID = 'did:plc:admin456'
const MOD_DID = 'did:plc:mod789'

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockDb = createMockDb()
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'info',
  silent: vi.fn(),
} as unknown as Logger

function createMockAuthMiddleware(user?: RequestUser): AuthMiddleware {
  const requireAuth: AuthMiddleware['requireAuth'] = async (request, reply) => {
    if (user) {
      request.user = user
    } else {
      await reply.status(401).send({ error: 'Authentication required' })
    }
  }
  return {
    requireAuth: vi.fn(requireAuth),
    optionalAuth: vi.fn(),
  }
}

describe('requireModerator middleware', () => {
  let app: FastifyInstance

  beforeEach(() => {
    resetDbMocks(mockDb)
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const authMiddleware = createMockAuthMiddleware(undefined)
    const requireModerator = createRequireModerator(mockDb as never, authMiddleware, mockLogger)

    app = Fastify()
    app.decorateRequest('user', undefined as RequestUser | undefined)
    app.get('/test', { preHandler: [requireModerator] }, () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(401)
  })

  it("returns 403 when user has role 'user'", async () => {
    const user: RequestUser = { did: TEST_DID, handle: 'test.bsky.social', sid: 'a'.repeat(64) }
    const authMiddleware = createMockAuthMiddleware(user)
    const requireModerator = createRequireModerator(mockDb as never, authMiddleware, mockLogger)

    // Mock DB to return user with role "user"
    const selectChain = createChainableProxy([{ did: TEST_DID, role: 'user' }])
    mockDb.select.mockReturnValue(selectChain)

    app = Fastify()
    app.decorateRequest('user', undefined as RequestUser | undefined)
    app.get('/test', { preHandler: [requireModerator] }, () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(403)
  })

  it('allows moderator access', async () => {
    const user: RequestUser = { did: MOD_DID, handle: 'mod.bsky.social', sid: 'b'.repeat(64) }
    const authMiddleware = createMockAuthMiddleware(user)
    const requireModerator = createRequireModerator(mockDb as never, authMiddleware, mockLogger)

    const selectChain = createChainableProxy([{ did: MOD_DID, role: 'moderator' }])
    mockDb.select.mockReturnValue(selectChain)

    app = Fastify()
    app.decorateRequest('user', undefined as RequestUser | undefined)
    app.get('/test', { preHandler: [requireModerator] }, () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('allows admin access', async () => {
    const user: RequestUser = { did: ADMIN_DID, handle: 'admin.bsky.social', sid: 'c'.repeat(64) }
    const authMiddleware = createMockAuthMiddleware(user)
    const requireModerator = createRequireModerator(mockDb as never, authMiddleware, mockLogger)

    const selectChain = createChainableProxy([{ did: ADMIN_DID, role: 'admin' }])
    mockDb.select.mockReturnValue(selectChain)

    app = Fastify()
    app.decorateRequest('user', undefined as RequestUser | undefined)
    app.get('/test', { preHandler: [requireModerator] }, () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('returns 403 when user not found in database', async () => {
    const user: RequestUser = { did: TEST_DID, handle: 'test.bsky.social', sid: 'd'.repeat(64) }
    const authMiddleware = createMockAuthMiddleware(user)
    const requireModerator = createRequireModerator(mockDb as never, authMiddleware, mockLogger)

    const selectChain = createChainableProxy([])
    mockDb.select.mockReturnValue(selectChain)

    app = Fastify()
    app.decorateRequest('user', undefined as RequestUser | undefined)
    app.get('/test', { preHandler: [requireModerator] }, () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(403)
  })

  it('logs moderator access with audit info', async () => {
    const user: RequestUser = { did: MOD_DID, handle: 'mod.bsky.social', sid: 'e'.repeat(64) }
    const authMiddleware = createMockAuthMiddleware(user)
    const requireModerator = createRequireModerator(mockDb as never, authMiddleware, mockLogger)

    const selectChain = createChainableProxy([{ did: MOD_DID, role: 'moderator' }])
    mockDb.select.mockReturnValue(selectChain)

    app = Fastify()
    app.decorateRequest('user', undefined as RequestUser | undefined)
    app.get('/test', { preHandler: [requireModerator] }, () => ({ ok: true }))
    await app.ready()

    await app.inject({ method: 'GET', url: '/test' })
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ did: MOD_DID }),
      expect.stringContaining('access granted')
    )
  })
})

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import type { FastifyInstance } from 'fastify'
import type { SessionService, SessionWithToken, Session } from '../../../src/auth/session.js'
import type { Env } from '../../../src/config/env.js'
import { authRoutes } from '../../../src/routes/auth.js'
import type { HandleResolver } from '../../../src/lib/handle-resolver.js'
import {
  BARAZO_BASE_SCOPES,
  BARAZO_CROSSPOST_SCOPES,
  FALLBACK_SCOPE,
} from '../../../src/auth/scopes.js'

// ---------------------------------------------------------------------------
// Mock env (minimal subset needed by auth routes)
// ---------------------------------------------------------------------------

const mockEnv = {
  OAUTH_CLIENT_ID: 'http://localhost',
  OAUTH_SESSION_TTL: 604800,
  OAUTH_ACCESS_TOKEN_TTL: 900,
  CORS_ORIGINS: 'http://localhost:3000',
} as Env

// ---------------------------------------------------------------------------
// Standalone mock functions (avoids @typescript-eslint/unbound-method)
// ---------------------------------------------------------------------------

// Database mock functions
const dbSelectFn = vi.fn()
const dbInsertFn = vi.fn()
const dbFromFn = vi.fn()
const dbWhereFn = vi.fn()
const dbValuesFn = vi.fn()
const dbOnConflictDoUpdateFn = vi.fn()

function createMockDb() {
  // Default: no preferences found (crossPostScopesGranted = false)
  dbWhereFn.mockResolvedValue([])
  dbFromFn.mockReturnValue({ where: dbWhereFn })
  dbSelectFn.mockReturnValue({ from: dbFromFn })
  dbOnConflictDoUpdateFn.mockResolvedValue(undefined)
  dbValuesFn.mockReturnValue({ onConflictDoUpdate: dbOnConflictDoUpdateFn })
  dbInsertFn.mockReturnValue({ values: dbValuesFn })

  return {
    select: dbSelectFn,
    insert: dbInsertFn,
  }
}

// OAuth client mock functions
const authorizeFn = vi.fn<(...args: unknown[]) => Promise<URL>>()
const callbackFn =
  vi.fn<
    (
      ...args: unknown[]
    ) => Promise<{ session: { did: string; tokenSet?: { scope?: string } }; state: string | null }>
  >()

// Session service mock functions
const createSessionFn = vi.fn<(...args: unknown[]) => Promise<SessionWithToken>>()
const validateAccessTokenFn = vi.fn<(...args: unknown[]) => Promise<Session | undefined>>()
const refreshSessionFn = vi.fn<(...args: unknown[]) => Promise<SessionWithToken | undefined>>()
const deleteSessionFn = vi.fn<(...args: unknown[]) => Promise<void>>()
const deleteAllSessionsForDidFn = vi.fn<(...args: unknown[]) => Promise<number>>()

// Handle resolver mock function
const resolveFn = vi.fn<(...args: unknown[]) => Promise<string>>()

// ---------------------------------------------------------------------------
// Mock objects using standalone fns
// ---------------------------------------------------------------------------

const mockOAuthClient = {
  authorize: authorizeFn,
  callback: callbackFn,
  clientMetadata: {},
  jwks: { keys: [] },
}

const mockSessionService: SessionService = {
  createSession: createSessionFn,
  validateAccessToken: validateAccessTokenFn,
  refreshSession: refreshSessionFn,
  deleteSession: deleteSessionFn,
  deleteAllSessionsForDid: deleteAllSessionsForDidFn,
}

const mockHandleResolver: HandleResolver = {
  resolve: resolveFn,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DID = 'did:plc:test123456789'
const TEST_HANDLE = 'alice.bsky.social'
const TEST_SID = 'a'.repeat(64)
const TEST_ACCESS_TOKEN = 'b'.repeat(64)
const TEST_ACCESS_TOKEN_HASH = 'c'.repeat(64)
const TEST_EXPIRES_AT = Date.now() + 900_000

function makeMockSessionWithToken(): SessionWithToken {
  return {
    sid: TEST_SID,
    did: TEST_DID,
    handle: TEST_HANDLE,
    accessTokenHash: TEST_ACCESS_TOKEN_HASH,
    accessTokenExpiresAt: TEST_EXPIRES_AT,
    createdAt: Date.now(),
    accessToken: TEST_ACCESS_TOKEN,
  }
}

function makeMockSession(): Session {
  return {
    sid: TEST_SID,
    did: TEST_DID,
    handle: TEST_HANDLE,
    accessTokenHash: TEST_ACCESS_TOKEN_HASH,
    accessTokenExpiresAt: TEST_EXPIRES_AT,
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('auth routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify({ logger: false })

    // Register cookie plugin
    await app.register(cookie, { secret: 'a'.repeat(32) })

    // Decorate with mocks
    app.decorate('env', mockEnv)
    app.decorate('sessionService', mockSessionService)
    app.decorate('handleResolver', mockHandleResolver)
    app.decorate('profileSync', {
      syncProfile: vi
        .fn()
        .mockResolvedValue({ displayName: null, avatarUrl: null, bannerUrl: null, bio: null }),
    })
    app.decorate('db', createMockDb())

    // Register auth routes (cast needed because mock is not full NodeOAuthClient)
    await app.register(authRoutes(mockOAuthClient as Parameters<typeof authRoutes>[0]))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset db mocks to default behavior
    dbWhereFn.mockResolvedValue([])
    dbFromFn.mockReturnValue({ where: dbWhereFn })
    dbSelectFn.mockReturnValue({ from: dbFromFn })
    dbOnConflictDoUpdateFn.mockResolvedValue(undefined)
    dbValuesFn.mockReturnValue({ onConflictDoUpdate: dbOnConflictDoUpdateFn })
    dbInsertFn.mockReturnValue({ values: dbValuesFn })
  })

  // =========================================================================
  // GET /api/auth/login
  // =========================================================================

  describe('GET /api/auth/login', () => {
    it('returns redirect URL for valid handle', async () => {
      const redirectUrl = new URL('https://pds.example.com/oauth/authorize?code=abc')
      authorizeFn.mockResolvedValueOnce(redirectUrl)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login?handle=alice.bsky.social',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ url: string }>()
      expect(body.url).toBe(redirectUrl.toString())
      expect(authorizeFn).toHaveBeenCalledWith('alice.bsky.social', { scope: BARAZO_BASE_SCOPES })
    })

    it('returns 400 for missing handle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid handle')
    })

    it('returns 400 for empty handle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login?handle=',
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid handle')
    })

    it('returns 400 for whitespace-only handle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login?handle=%20%20',
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid handle')
    })

    it('returns 502 when OAuth client throws', async () => {
      authorizeFn.mockRejectedValueOnce(new Error('PDS unreachable'))

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login?handle=alice.bsky.social',
      })

      expect(response.statusCode).toBe(502)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Failed to initiate login')
    })
  })

  // =========================================================================
  // GET /api/auth/callback
  // =========================================================================

  describe('GET /api/auth/callback', () => {
    it('redirects to frontend and sets cookie for valid callback', async () => {
      const mockSession = makeMockSessionWithToken()
      const mockOAuthSession = { did: TEST_DID }

      callbackFn.mockResolvedValueOnce({
        session: mockOAuthSession,
        state: 'some-state',
      })
      resolveFn.mockResolvedValueOnce(TEST_HANDLE)
      createSessionFn.mockResolvedValueOnce(mockSession)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/callback?iss=https://pds.example.com&code=test-code&state=test-state',
      })

      expect(response.statusCode).toBe(302)

      // Verify redirect URL points to frontend callback with success flag
      const location = response.headers.location as string
      expect(location).toContain('/auth/callback')
      expect(location).toContain('success=true')

      // Verify handle was resolved from DID and session created with resolved handle
      expect(resolveFn).toHaveBeenCalledWith(TEST_DID)
      expect(createSessionFn).toHaveBeenCalledWith(TEST_DID, TEST_HANDLE)

      // Verify cookie was set
      const cookies = response.cookies
      const refreshCookie = cookies.find((c: { name: string }) => c.name === 'barazo_refresh')
      expect(refreshCookie).toBeDefined()
      expect(refreshCookie?.value).toBe(TEST_SID)
      expect(refreshCookie?.httpOnly).toBe(true)
      expect(refreshCookie?.sameSite).toBe('Lax')
      expect(refreshCookie?.path).toBe('/api/auth')
    })

    it('returns 400 for missing iss param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/callback?code=test-code&state=test-state',
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid callback parameters')
    })

    it('returns 400 for missing code param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/callback?iss=https://pds.example.com&state=test-state',
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid callback parameters')
    })

    it('returns 400 for missing state param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/callback?iss=https://pds.example.com&code=test-code',
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid callback parameters')
    })

    it('redirects to frontend with error when OAuth client throws', async () => {
      callbackFn.mockRejectedValueOnce(new Error('Token exchange failed'))

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/callback?iss=https://pds.example.com&code=test-code&state=test-state',
      })

      expect(response.statusCode).toBe(302)
      const location = response.headers.location as string
      expect(location).toContain('/auth/callback')
      expect(location).toContain('error=')
    })
  })

  // =========================================================================
  // POST /api/auth/refresh
  // =========================================================================

  describe('POST /api/auth/refresh', () => {
    it('returns new access token when valid refresh cookie', async () => {
      const mockSession = makeMockSessionWithToken()
      refreshSessionFn.mockResolvedValueOnce(mockSession)

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { barazo_refresh: TEST_SID },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{
        accessToken: string
        expiresAt: number
      }>()
      expect(body.accessToken).toBe(TEST_ACCESS_TOKEN)
      expect(body.expiresAt).toBe(TEST_EXPIRES_AT)

      // Verify refresh cookie was re-set
      const cookies = response.cookies
      const refreshCookie = cookies.find((c: { name: string }) => c.name === 'barazo_refresh')
      expect(refreshCookie).toBeDefined()
      expect(refreshCookie?.value).toBe(TEST_SID)
    })

    it('returns 401 when no cookie', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('No refresh token')
    })

    it('returns 401 when session expired and clears cookie', async () => {
      refreshSessionFn.mockResolvedValueOnce(undefined)

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { barazo_refresh: TEST_SID },
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Session expired')

      // Verify cookie was cleared
      const cookies = response.cookies
      const refreshCookie = cookies.find((c: { name: string }) => c.name === 'barazo_refresh')
      expect(refreshCookie).toBeDefined()
      expect(refreshCookie?.value).toBe('')
    })
  })

  // =========================================================================
  // DELETE /api/auth/session
  // =========================================================================

  describe('DELETE /api/auth/session', () => {
    it('returns 204 and clears cookie', async () => {
      deleteSessionFn.mockResolvedValueOnce(undefined)

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/auth/session',
        cookies: { barazo_refresh: TEST_SID },
      })

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')

      expect(deleteSessionFn).toHaveBeenCalledWith(TEST_SID)

      // Verify cookie was cleared
      const cookies = response.cookies
      const refreshCookie = cookies.find((c: { name: string }) => c.name === 'barazo_refresh')
      expect(refreshCookie).toBeDefined()
      expect(refreshCookie?.value).toBe('')
    })

    it('returns 204 when no cookie (idempotent)', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/auth/session',
      })

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')
      expect(deleteSessionFn).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // GET /api/auth/me
  // =========================================================================

  describe('GET /api/auth/me', () => {
    it('returns user info for valid Bearer token', async () => {
      const mockSession = makeMockSession()
      validateAccessTokenFn.mockResolvedValueOnce(mockSession)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ did: string; handle: string }>()
      expect(body.did).toBe(TEST_DID)
      expect(body.handle).toBe(TEST_HANDLE)

      expect(validateAccessTokenFn).toHaveBeenCalledWith(TEST_ACCESS_TOKEN)
    })

    it('returns 401 for missing Authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Authentication required')
    })

    it('returns 401 for non-Bearer authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Authentication required')
    })

    it('returns 401 for invalid/expired token', async () => {
      validateAccessTokenFn.mockResolvedValueOnce(undefined)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
        },
      })

      expect(response.statusCode).toBe(401)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Invalid or expired token')
    })

    it('returns 502 when session service throws', async () => {
      validateAccessTokenFn.mockRejectedValueOnce(new Error('Valkey down'))

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
        },
      })

      expect(response.statusCode).toBe(502)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Service temporarily unavailable')
    })
  })

  // =========================================================================
  // Service error handling
  // =========================================================================

  describe('service error handling', () => {
    it('returns 502 when refresh service throws', async () => {
      refreshSessionFn.mockRejectedValueOnce(new Error('Valkey down'))

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { barazo_refresh: TEST_SID },
      })

      expect(response.statusCode).toBe(502)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Service temporarily unavailable')
    })

    it('returns 502 when delete service throws', async () => {
      deleteSessionFn.mockRejectedValueOnce(new Error('Valkey down'))

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/auth/session',
        cookies: { barazo_refresh: TEST_SID },
      })

      expect(response.statusCode).toBe(502)
      const body = response.json<{ error: string }>()
      expect(body.error).toBe('Service temporarily unavailable')
    })
  })

  // =========================================================================
  // OAuth scope refinement
  // =========================================================================

  describe('granular scope fallback', () => {
    it('falls back to transition:generic when granular scopes are rejected', async () => {
      const fallbackUrl = new URL('https://pds.example.com/oauth/authorize?code=fallback')
      // First call (granular) fails, second call (fallback) succeeds
      authorizeFn
        .mockRejectedValueOnce(new Error('Unsupported scope'))
        .mockResolvedValueOnce(fallbackUrl)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login?handle=alice.bsky.social',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ url: string }>()
      expect(body.url).toBe(fallbackUrl.toString())

      // First call with granular scopes
      expect(authorizeFn).toHaveBeenNthCalledWith(1, 'alice.bsky.social', {
        scope: BARAZO_BASE_SCOPES,
      })
      // Second call with fallback
      expect(authorizeFn).toHaveBeenNthCalledWith(2, 'alice.bsky.social', { scope: FALLBACK_SCOPE })
    })

    it('requests cross-post scopes when crosspost=true', async () => {
      const redirectUrl = new URL('https://pds.example.com/oauth/authorize?code=abc')
      authorizeFn.mockResolvedValueOnce(redirectUrl)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/login?handle=alice.bsky.social&crosspost=true',
      })

      expect(response.statusCode).toBe(200)
      expect(authorizeFn).toHaveBeenCalledWith('alice.bsky.social', {
        scope: BARAZO_CROSSPOST_SCOPES,
      })
    })
  })

  describe('GET /api/auth/crosspost-authorize', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/crosspost-authorize',
      })

      expect(response.statusCode).toBe(401)
    })

    it('returns redirect URL with cross-post scopes', async () => {
      const mockSession = makeMockSession()
      validateAccessTokenFn.mockResolvedValueOnce(mockSession)

      const redirectUrl = new URL('https://pds.example.com/oauth/authorize?scope=crosspost')
      authorizeFn.mockResolvedValueOnce(redirectUrl)

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/crosspost-authorize',
        headers: { authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ url: string }>()
      expect(body.url).toBe(redirectUrl.toString())
      expect(authorizeFn).toHaveBeenCalledWith(TEST_HANDLE, { scope: BARAZO_CROSSPOST_SCOPES })
    })
  })

  describe('crossPostScopesGranted in responses', () => {
    it('/me returns crossPostScopesGranted from user preferences', async () => {
      const mockSession = makeMockSession()
      validateAccessTokenFn.mockResolvedValueOnce(mockSession)
      dbWhereFn.mockResolvedValueOnce([{ crossPostScopesGranted: true }])

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ crossPostScopesGranted: boolean }>()
      expect(body.crossPostScopesGranted).toBe(true)
    })

    it('/me defaults crossPostScopesGranted to false when no preferences', async () => {
      const mockSession = makeMockSession()
      validateAccessTokenFn.mockResolvedValueOnce(mockSession)
      dbWhereFn.mockResolvedValueOnce([])

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ crossPostScopesGranted: boolean }>()
      expect(body.crossPostScopesGranted).toBe(false)
    })

    it('/refresh returns crossPostScopesGranted', async () => {
      const mockSession = makeMockSessionWithToken()
      refreshSessionFn.mockResolvedValueOnce(mockSession)
      dbWhereFn.mockResolvedValueOnce([{ crossPostScopesGranted: true }])

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { barazo_refresh: TEST_SID },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ crossPostScopesGranted: boolean }>()
      expect(body.crossPostScopesGranted).toBe(true)
    })
  })
})

// ===========================================================================
// Production-mode cookie security
// ===========================================================================

describe('auth routes (production mode)', () => {
  let prodApp: FastifyInstance

  const prodEnv = {
    OAUTH_CLIENT_ID: 'https://forum.barazo.forum/oauth-client-metadata.json',
    OAUTH_SESSION_TTL: 604800,
    OAUTH_ACCESS_TOKEN_TTL: 900,
    RATE_LIMIT_AUTH: 10,
    CORS_ORIGINS: 'https://forum.barazo.forum',
  } as Env

  beforeAll(async () => {
    prodApp = Fastify({ logger: false })
    await prodApp.register(cookie, { secret: 'a'.repeat(32) })
    prodApp.decorate('env', prodEnv)
    prodApp.decorate('sessionService', mockSessionService)
    prodApp.decorate('handleResolver', mockHandleResolver)
    prodApp.decorate('profileSync', {
      syncProfile: vi
        .fn()
        .mockResolvedValue({ displayName: null, avatarUrl: null, bannerUrl: null, bio: null }),
    })
    prodApp.decorate('db', createMockDb())
    await prodApp.register(authRoutes(mockOAuthClient as Parameters<typeof authRoutes>[0]))
    await prodApp.ready()
  })

  afterAll(async () => {
    await prodApp.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    dbWhereFn.mockResolvedValue([])
    dbFromFn.mockReturnValue({ where: dbWhereFn })
    dbSelectFn.mockReturnValue({ from: dbFromFn })
  })

  it('sets secure cookie in production mode', async () => {
    const mockSession = makeMockSessionWithToken()
    const mockOAuthSession = { did: TEST_DID }

    callbackFn.mockResolvedValueOnce({
      session: mockOAuthSession,
      state: 'some-state',
    })
    resolveFn.mockResolvedValueOnce(TEST_HANDLE)
    createSessionFn.mockResolvedValueOnce(mockSession)

    const response = await prodApp.inject({
      method: 'GET',
      url: '/api/auth/callback?iss=https://pds.example.com&code=test-code&state=test-state',
    })

    expect(response.statusCode).toBe(302)

    const cookies = response.cookies
    const refreshCookie = cookies.find((c: { name: string }) => c.name === 'barazo_refresh')
    expect(refreshCookie).toBeDefined()
    expect(refreshCookie?.secure).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { createSessionService } from '../../../src/auth/session.js'
import type { SessionService, SessionConfig } from '../../../src/auth/session.js'
import type { Cache } from '../../../src/cache/index.js'
import type { Logger } from '../../../src/lib/logger.js'

// ---------------------------------------------------------------------------
// Helpers -- mirrors the mock pattern from oauth-stores.test.ts
// ---------------------------------------------------------------------------

function createMockCache() {
  const setFn = vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('OK')
  const getFn = vi.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null)
  const delFn = vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1)
  const saddFn = vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1)
  const smembersFn = vi.fn<(...args: unknown[]) => Promise<string[]>>().mockResolvedValue([])
  const sremFn = vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1)
  const expireFn = vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1)
  return {
    cache: {
      set: setFn,
      get: getFn,
      del: delFn,
      sadd: saddFn,
      smembers: smembersFn,
      srem: sremFn,
      expire: expireFn,
    } as unknown as Cache,
    setFn,
    getFn,
    delFn,
    saddFn,
    smembersFn,
    sremFn,
    expireFn,
  }
}

function createMockLogger() {
  const debugFn = vi.fn()
  const infoFn = vi.fn()
  const warnFn = vi.fn()
  const errorFn = vi.fn()
  return {
    logger: {
      debug: debugFn,
      info: infoFn,
      warn: warnFn,
      error: errorFn,
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger,
    debugFn,
    infoFn,
    warnFn,
    errorFn,
  }
}

/** SHA-256 hash helper for test assertions */
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

const defaultConfig: SessionConfig = {
  sessionTtl: 604800, // 7 days
  accessTokenTtl: 900, // 15 min
}

const testDid = 'did:plc:test-user-123'
const testHandle = 'alice.bsky.social'

/**
 * Build a mock persisted session (as stored in Valkey).
 * Uses accessTokenHash (never raw accessToken).
 */
function buildPersistedSession(
  overrides: {
    sid?: string
    did?: string
    handle?: string
    accessTokenHash?: string
    accessTokenExpiresAt?: number
    createdAt?: number
  } = {}
) {
  return {
    sid: overrides.sid ?? 'a'.repeat(64),
    did: overrides.did ?? testDid,
    handle: overrides.handle ?? testHandle,
    accessTokenHash: overrides.accessTokenHash ?? sha256('b'.repeat(64)),
    accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? Date.now() + 900_000,
    createdAt: overrides.createdAt ?? Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionService', () => {
  let _cache: Cache
  let setFn: ReturnType<typeof createMockCache>['setFn']
  let getFn: ReturnType<typeof createMockCache>['getFn']
  let delFn: ReturnType<typeof createMockCache>['delFn']
  let saddFn: ReturnType<typeof createMockCache>['saddFn']
  let smembersFn: ReturnType<typeof createMockCache>['smembersFn']
  let sremFn: ReturnType<typeof createMockCache>['sremFn']
  let expireFn: ReturnType<typeof createMockCache>['expireFn']
  let debugFn: ReturnType<typeof createMockLogger>['debugFn']
  let errorFn: ReturnType<typeof createMockLogger>['errorFn']
  let service: SessionService

  beforeEach(() => {
    const mocks = createMockCache()
    const logMocks = createMockLogger()
    _cache = mocks.cache
    setFn = mocks.setFn
    getFn = mocks.getFn
    delFn = mocks.delFn
    saddFn = mocks.saddFn
    smembersFn = mocks.smembersFn
    sremFn = mocks.sremFn
    expireFn = mocks.expireFn
    debugFn = logMocks.debugFn
    errorFn = logMocks.errorFn
    service = createSessionService(mocks.cache, logMocks.logger, defaultConfig)
  })

  // -------------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------------
  describe('createSession', () => {
    it('creates session with valid did and handle', async () => {
      const session = await service.createSession(testDid, testHandle)

      expect(session.did).toBe(testDid)
      expect(session.handle).toBe(testHandle)
    })

    it('generates a unique session ID (64 hex chars)', async () => {
      const session = await service.createSession(testDid, testHandle)

      expect(session.sid).toMatch(/^[a-f0-9]{64}$/)
    })

    it('generates a unique access token (64 hex chars)', async () => {
      const session = await service.createSession(testDid, testHandle)

      expect(session.accessToken).toMatch(/^[a-f0-9]{64}$/)
    })

    it('generates different IDs on each call', async () => {
      const session1 = await service.createSession(testDid, testHandle)
      const session2 = await service.createSession(testDid, testHandle)

      expect(session1.sid).not.toBe(session2.sid)
      expect(session1.accessToken).not.toBe(session2.accessToken)
    })

    it('stores session data with accessTokenHash (not raw token) in Valkey', async () => {
      const session = await service.createSession(testDid, testHandle)
      const tokenHash = sha256(session.accessToken)

      // The persisted data should have accessTokenHash, NOT accessToken
      const persisted = {
        sid: session.sid,
        did: session.did,
        handle: session.handle,
        accessTokenHash: tokenHash,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        createdAt: session.createdAt,
      }

      expect(setFn).toHaveBeenCalledWith(
        `barazo:session:data:${session.sid}`,
        JSON.stringify(persisted),
        'EX',
        604800
      )
    })

    it('stores access token hash mapping with correct TTL', async () => {
      const session = await service.createSession(testDid, testHandle)
      const tokenHash = sha256(session.accessToken)

      expect(setFn).toHaveBeenCalledWith(
        `barazo:session:access:${tokenHash}`,
        session.sid,
        'EX',
        900
      )
    })

    it('adds session ID to DID index set', async () => {
      const session = await service.createSession(testDid, testHandle)

      expect(saddFn).toHaveBeenCalledWith(`barazo:session:did:${testDid}`, session.sid)
    })

    it('refreshes TTL on DID index set', async () => {
      await service.createSession(testDid, testHandle)

      expect(expireFn).toHaveBeenCalledWith(`barazo:session:did:${testDid}`, 604800)
    })

    it('sets accessTokenExpiresAt in the future', async () => {
      const before = Date.now()
      const session = await service.createSession(testDid, testHandle)
      const after = Date.now()

      // accessTokenExpiresAt should be ~900 seconds (15 min) from now
      expect(session.accessTokenExpiresAt).toBeGreaterThanOrEqual(before + 900 * 1000)
      expect(session.accessTokenExpiresAt).toBeLessThanOrEqual(after + 900 * 1000)
    })

    it('sets createdAt to approximately now', async () => {
      const before = Date.now()
      const session = await service.createSession(testDid, testHandle)
      const after = Date.now()

      expect(session.createdAt).toBeGreaterThanOrEqual(before)
      expect(session.createdAt).toBeLessThanOrEqual(after)
    })

    it('returns SessionWithToken including both accessToken and accessTokenHash', async () => {
      const session = await service.createSession(testDid, testHandle)

      expect(session).toEqual(
        expect.objectContaining({
          sid: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
          did: testDid,
          handle: testHandle,
          accessToken: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
          accessTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
          accessTokenExpiresAt: expect.any(Number) as number,
          createdAt: expect.any(Number) as number,
        })
      )

      // accessTokenHash should be the SHA-256 of accessToken
      expect(session.accessTokenHash).toBe(sha256(session.accessToken))
    })

    it('logs debug on success without raw tokens', async () => {
      const session = await service.createSession(testDid, testHandle)

      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({
          did: testDid,
          sid: session.sid.slice(0, 8),
        }),
        'Session created'
      )

      // Verify no debug call contains the full access token
      for (const call of debugFn.mock.calls) {
        const logObj = JSON.stringify(call)
        expect(logObj).not.toContain(session.accessToken)
      }
    })

    it('logs error and rethrows on cache failure', async () => {
      const error = new Error('Valkey connection refused')
      setFn.mockRejectedValueOnce(error)

      await expect(service.createSession(testDid, testHandle)).rejects.toThrow(
        'Valkey connection refused'
      )
      expect(errorFn).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // validateAccessToken
  // -------------------------------------------------------------------------
  describe('validateAccessToken', () => {
    it('returns session when access token is valid', async () => {
      const rawToken = 'b'.repeat(64)
      const tokenHash = sha256(rawToken)
      const persisted = buildPersistedSession({ accessTokenHash: tokenHash })

      // First get: access token hash → sid
      getFn.mockResolvedValueOnce(persisted.sid)
      // Second get: session data
      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      const result = await service.validateAccessToken(rawToken)

      expect(result).toEqual(persisted)
      expect(getFn).toHaveBeenCalledWith(`barazo:session:access:${tokenHash}`)
      expect(getFn).toHaveBeenCalledWith(`barazo:session:data:${persisted.sid}`)
    })

    it('returns undefined when access token not found', async () => {
      getFn.mockResolvedValueOnce(null)

      const result = await service.validateAccessToken('nonexistent-token')

      expect(result).toBeUndefined()
    })

    it('returns undefined when session data not found (orphaned token)', async () => {
      // Access token hash lookup returns a sid
      getFn.mockResolvedValueOnce('a'.repeat(64))
      // But session data is gone
      getFn.mockResolvedValueOnce(null)

      const result = await service.validateAccessToken('some-token')

      expect(result).toBeUndefined()
    })

    it('never logs raw access tokens', async () => {
      const rawToken = 'c'.repeat(64)
      getFn.mockResolvedValueOnce(null)

      await service.validateAccessToken(rawToken)

      for (const call of debugFn.mock.calls) {
        const logObj = JSON.stringify(call)
        expect(logObj).not.toContain(rawToken)
      }
    })

    it('logs error and rethrows on cache failure', async () => {
      const error = new Error('Valkey timeout')
      getFn.mockRejectedValueOnce(error)

      await expect(service.validateAccessToken('some-token')).rejects.toThrow('Valkey timeout')
      expect(errorFn).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // refreshSession
  // -------------------------------------------------------------------------
  describe('refreshSession', () => {
    it('returns updated session with new access token', async () => {
      const oldTokenHash = sha256('old-token-' + 'x'.repeat(54))
      const persisted = buildPersistedSession({
        accessTokenHash: oldTokenHash,
        accessTokenExpiresAt: Date.now() - 1000,
        createdAt: Date.now() - 600_000,
      })

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      const result = await service.refreshSession(persisted.sid)

      if (result === undefined) {
        expect.fail('Expected session to be defined')
      }
      expect(result.sid).toBe(persisted.sid)
      expect(result.did).toBe(testDid)
      expect(result.handle).toBe(testHandle)
      // New access token should be a fresh 64-char hex string
      expect(result.accessToken).toMatch(/^[a-f0-9]{64}$/)
      // New accessTokenHash should match the new access token
      expect(result.accessTokenHash).toBe(sha256(result.accessToken))
      expect(result.accessTokenHash).not.toBe(oldTokenHash)
      // New expiry should be in the future
      expect(result.accessTokenExpiresAt).toBeGreaterThan(Date.now())
      // createdAt should remain the same
      expect(result.createdAt).toBe(persisted.createdAt)
    })

    it('deletes old access token lookup', async () => {
      const oldTokenHash = sha256('old-token-' + 'x'.repeat(54))
      const persisted = buildPersistedSession({ accessTokenHash: oldTokenHash })

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      await service.refreshSession(persisted.sid)

      expect(delFn).toHaveBeenCalledWith(`barazo:session:access:${oldTokenHash}`)
    })

    it('creates new access token lookup', async () => {
      const persisted = buildPersistedSession()

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      const result = await service.refreshSession(persisted.sid)

      if (result === undefined) {
        expect.fail('Expected session to be defined')
      }
      const newTokenHash = sha256(result.accessToken)
      expect(setFn).toHaveBeenCalledWith(
        `barazo:session:access:${newTokenHash}`,
        persisted.sid,
        'EX',
        900
      )
    })

    it('updates session data with new accessTokenHash (not raw token)', async () => {
      const persisted = buildPersistedSession()

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      const result = await service.refreshSession(persisted.sid)

      if (result === undefined) {
        expect.fail('Expected session to be defined')
      }

      // The persisted form should have accessTokenHash but NOT accessToken
      const expectedPersisted = {
        sid: result.sid,
        did: result.did,
        handle: result.handle,
        accessTokenHash: result.accessTokenHash,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        createdAt: result.createdAt,
      }

      expect(setFn).toHaveBeenCalledWith(
        `barazo:session:data:${persisted.sid}`,
        JSON.stringify(expectedPersisted),
        'EX',
        604800
      )
    })

    it('returns undefined when session ID not found', async () => {
      getFn.mockResolvedValueOnce(null)

      const result = await service.refreshSession('nonexistent-sid')

      expect(result).toBeUndefined()
    })

    it('logs debug on success', async () => {
      const persisted = buildPersistedSession()

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      await service.refreshSession(persisted.sid)

      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({
          sid: persisted.sid.slice(0, 8),
        }),
        'Session refreshed'
      )
    })

    it('logs error and rethrows on cache failure', async () => {
      const error = new Error('Valkey error')
      getFn.mockRejectedValueOnce(error)

      await expect(service.refreshSession('some-sid')).rejects.toThrow('Valkey error')
      expect(errorFn).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // deleteSession
  // -------------------------------------------------------------------------
  describe('deleteSession', () => {
    it('deletes session data', async () => {
      const persisted = buildPersistedSession()

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      await service.deleteSession(persisted.sid)

      expect(delFn).toHaveBeenCalledWith(`barazo:session:data:${persisted.sid}`)
    })

    it('deletes access token lookup using stored hash', async () => {
      const tokenHash = sha256('b'.repeat(64))
      const persisted = buildPersistedSession({ accessTokenHash: tokenHash })

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      await service.deleteSession(persisted.sid)

      expect(delFn).toHaveBeenCalledWith(`barazo:session:access:${tokenHash}`)
    })

    it('removes session ID from DID index set', async () => {
      const persisted = buildPersistedSession()

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      await service.deleteSession(persisted.sid)

      expect(sremFn).toHaveBeenCalledWith(`barazo:session:did:${testDid}`, persisted.sid)
    })

    it('does not throw when session does not exist', async () => {
      getFn.mockResolvedValueOnce(null)

      await expect(service.deleteSession('nonexistent-sid')).resolves.toBeUndefined()
    })

    it('logs debug on success', async () => {
      const persisted = buildPersistedSession()

      getFn.mockResolvedValueOnce(JSON.stringify(persisted))

      await service.deleteSession(persisted.sid)

      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({ sid: persisted.sid.slice(0, 8) }),
        'Session deleted'
      )
    })

    it('logs error and rethrows on cache failure', async () => {
      const error = new Error('Valkey error')
      getFn.mockRejectedValueOnce(error)

      await expect(service.deleteSession('some-sid')).rejects.toThrow('Valkey error')
      expect(errorFn).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // deleteAllSessionsForDid
  // -------------------------------------------------------------------------
  describe('deleteAllSessionsForDid', () => {
    it('deletes all sessions for a DID', async () => {
      const sid1 = 'a'.repeat(64)
      const sid2 = 'b'.repeat(64)

      const session1 = buildPersistedSession({
        sid: sid1,
        accessTokenHash: sha256('c'.repeat(64)),
      })
      const session2 = buildPersistedSession({
        sid: sid2,
        accessTokenHash: sha256('d'.repeat(64)),
      })

      // smembers returns the set of session IDs
      smembersFn.mockResolvedValueOnce([sid1, sid2])
      // For each session, get returns the session data (for deleteSession)
      getFn.mockResolvedValueOnce(JSON.stringify(session1))
      getFn.mockResolvedValueOnce(JSON.stringify(session2))

      const count = await service.deleteAllSessionsForDid(testDid)

      expect(count).toBe(2)
      expect(smembersFn).toHaveBeenCalledWith(`barazo:session:did:${testDid}`)
    })

    it('returns count of deleted sessions', async () => {
      const sid1 = 'a'.repeat(64)
      const sid2 = 'b'.repeat(64)
      const sid3 = 'c'.repeat(64)

      smembersFn.mockResolvedValueOnce([sid1, sid2, sid3])
      getFn.mockResolvedValueOnce(
        JSON.stringify(
          buildPersistedSession({
            sid: sid1,
            accessTokenHash: sha256('x'.repeat(64)),
          })
        )
      )
      getFn.mockResolvedValueOnce(
        JSON.stringify(
          buildPersistedSession({
            sid: sid2,
            accessTokenHash: sha256('y'.repeat(64)),
          })
        )
      )
      getFn.mockResolvedValueOnce(
        JSON.stringify(
          buildPersistedSession({
            sid: sid3,
            accessTokenHash: sha256('z'.repeat(64)),
          })
        )
      )

      const count = await service.deleteAllSessionsForDid(testDid)

      expect(count).toBe(3)
    })

    it('removes the DID index set', async () => {
      smembersFn.mockResolvedValueOnce(['a'.repeat(64)])
      getFn.mockResolvedValueOnce(JSON.stringify(buildPersistedSession()))

      await service.deleteAllSessionsForDid(testDid)

      expect(delFn).toHaveBeenCalledWith(`barazo:session:did:${testDid}`)
    })

    it('returns 0 when DID has no sessions', async () => {
      smembersFn.mockResolvedValueOnce([])

      const count = await service.deleteAllSessionsForDid(testDid)

      expect(count).toBe(0)
    })

    it('logs debug with count on success', async () => {
      smembersFn.mockResolvedValueOnce(['a'.repeat(64)])
      getFn.mockResolvedValueOnce(JSON.stringify(buildPersistedSession()))

      await service.deleteAllSessionsForDid(testDid)

      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({ did: testDid, count: 1 }),
        'All sessions deleted for DID'
      )
    })

    it('logs error and rethrows on cache failure', async () => {
      const error = new Error('Valkey error')
      smembersFn.mockRejectedValueOnce(error)

      await expect(service.deleteAllSessionsForDid(testDid)).rejects.toThrow('Valkey error')
      expect(errorFn).toHaveBeenCalled()
    })
  })
})

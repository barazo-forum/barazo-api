import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHandleResolver } from '../../../src/lib/handle-resolver.js'
import type { Cache } from '../../../src/cache/index.js'
import type { Database } from '../../../src/db/index.js'
import type { Logger } from '../../../src/lib/logger.js'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const cacheGetFn = vi.fn<(...args: unknown[]) => Promise<string | null>>()
const cacheSetFn = vi.fn<(...args: unknown[]) => Promise<string>>()

const mockCache = {
  get: cacheGetFn,
  set: cacheSetFn,
} as unknown as Cache

const dbSelectFn = vi.fn()
const mockDb = {
  select: dbSelectFn,
} as unknown as Database

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DID = 'did:plc:test123456789'
const TEST_HANDLE = 'alice.bsky.social'

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('handle-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('returns handle from Valkey cache when available', async () => {
    cacheGetFn.mockResolvedValueOnce(TEST_HANDLE)

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_HANDLE)
    expect(cacheGetFn).toHaveBeenCalledWith(`barazo:handle:${TEST_DID}`)
    expect(dbSelectFn).not.toHaveBeenCalled()
  })

  it('falls back to DB when cache misses', async () => {
    cacheGetFn.mockResolvedValueOnce(null)

    // Mock the Drizzle chain: db.select().from().where().limit()
    const limitFn = vi.fn().mockResolvedValueOnce([{ handle: TEST_HANDLE }])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_HANDLE)
    // Should cache the result
    expect(cacheSetFn).toHaveBeenCalledWith(`barazo:handle:${TEST_DID}`, TEST_HANDLE, 'EX', 3600)
  })

  it('skips DB result when handle equals DID (not yet resolved)', async () => {
    cacheGetFn.mockResolvedValueOnce(null)

    // DB has DID as handle (placeholder from before handle resolution)
    const limitFn = vi.fn().mockResolvedValueOnce([{ handle: TEST_DID }])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    // Mock PLC directory fetch
    const plcDoc = {
      id: TEST_DID,
      alsoKnownAs: [`at://${TEST_HANDLE}`],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(plcDoc), { status: 200 })
    )

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_HANDLE)
  })

  it('falls back to PLC directory when cache and DB miss', async () => {
    cacheGetFn.mockResolvedValueOnce(null)

    // DB returns no results
    const limitFn = vi.fn().mockResolvedValueOnce([])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    // Mock PLC directory fetch
    const plcDoc = {
      id: TEST_DID,
      alsoKnownAs: [`at://${TEST_HANDLE}`],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(plcDoc), { status: 200 })
    )

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_HANDLE)
    // Should cache the result
    expect(cacheSetFn).toHaveBeenCalledWith(`barazo:handle:${TEST_DID}`, TEST_HANDLE, 'EX', 3600)
  })

  it('returns DID as fallback when all resolution methods fail', async () => {
    cacheGetFn.mockResolvedValueOnce(null)

    // DB returns no results
    const limitFn = vi.fn().mockResolvedValueOnce([])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    // PLC directory returns 404
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Not found', { status: 404 }))

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_DID)
  })

  it('handles PLC directory network errors gracefully', async () => {
    cacheGetFn.mockResolvedValueOnce(null)

    // DB returns no results
    const limitFn = vi.fn().mockResolvedValueOnce([])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    // PLC directory fetch throws
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    // Falls back to DID
    expect(handle).toBe(TEST_DID)
  })

  it('skips PLC lookup for did:web DIDs', async () => {
    const webDid = 'did:web:example.com'
    cacheGetFn.mockResolvedValueOnce(null)

    // DB returns no results
    const limitFn = vi.fn().mockResolvedValueOnce([])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(webDid)

    // Should not call PLC directory for did:web
    expect(fetchSpy).not.toHaveBeenCalled()
    // Falls back to DID
    expect(handle).toBe(webDid)
  })

  it('handles cache errors gracefully and continues resolution', async () => {
    cacheGetFn.mockRejectedValueOnce(new Error('Valkey down'))

    // DB has the handle
    const limitFn = vi.fn().mockResolvedValueOnce([{ handle: TEST_HANDLE }])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_HANDLE)
  })

  it('handles missing alsoKnownAs in PLC document', async () => {
    cacheGetFn.mockResolvedValueOnce(null)

    const limitFn = vi.fn().mockResolvedValueOnce([])
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn })
    const fromFn = vi.fn().mockReturnValue({ where: whereFn })
    dbSelectFn.mockReturnValue({ from: fromFn })

    // PLC document without alsoKnownAs
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: TEST_DID }), { status: 200 })
    )

    const resolver = createHandleResolver(mockCache, mockDb, mockLogger)
    const handle = await resolver.resolve(TEST_DID)

    expect(handle).toBe(TEST_DID)
  })
})

import type { Cache } from '../cache/index.js'
import type { Database } from '../db/index.js'
import type { Logger } from './logger.js'
import { users } from '../db/schema/users.js'
import { eq } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HANDLE_CACHE_PREFIX = 'barazo:handle:'
const HANDLE_CACHE_TTL = 3600 // 1 hour
const PLC_DIRECTORY_URL = 'https://plc.directory'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DID document from PLC directory. */
interface PlcDidDocument {
  id: string
  alsoKnownAs?: string[]
}

export interface HandleResolver {
  /**
   * Resolve a DID to its AT Protocol handle.
   *
   * Resolution order:
   * 1. Valkey cache (1-hour TTL)
   * 2. Users table in PostgreSQL (populated by firehose)
   * 3. PLC directory (for did:plc:*) -- fetches the DID document
   *
   * Returns the DID itself as fallback if resolution fails (never blocks auth).
   */
  resolve(did: string): Promise<string>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract handle from a DID document's alsoKnownAs field.
 * AT Protocol handles appear as "at://{handle}" entries.
 */
function extractHandleFromDidDocument(doc: PlcDidDocument): string | undefined {
  if (!doc.alsoKnownAs || !Array.isArray(doc.alsoKnownAs)) {
    return undefined
  }

  for (const aka of doc.alsoKnownAs) {
    if (typeof aka === 'string' && aka.startsWith('at://')) {
      return aka.slice('at://'.length)
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHandleResolver(cache: Cache, db: Database, logger: Logger): HandleResolver {
  async function resolveFromCache(did: string): Promise<string | undefined> {
    const cached = await cache.get(`${HANDLE_CACHE_PREFIX}${did}`)
    if (cached !== null) {
      return cached
    }
    return undefined
  }

  async function resolveFromDb(did: string): Promise<string | undefined> {
    const rows = await db
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.did, did))
      .limit(1)

    const row = rows[0]
    if (row !== undefined && row.handle !== did) {
      return row.handle
    }
    return undefined
  }

  async function resolveFromPlcDirectory(did: string): Promise<string | undefined> {
    if (!did.startsWith('did:plc:')) {
      // did:web resolution is not yet needed for MVP
      logger.debug({ did }, 'Non-PLC DID, skipping PLC directory lookup')
      return undefined
    }

    const url = `${PLC_DIRECTORY_URL}/${encodeURIComponent(did)}`

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      logger.warn({ did, status: response.status }, 'PLC directory lookup failed')
      return undefined
    }

    const doc = (await response.json()) as PlcDidDocument
    return extractHandleFromDidDocument(doc)
  }

  async function cacheHandle(did: string, handle: string): Promise<void> {
    await cache.set(`${HANDLE_CACHE_PREFIX}${did}`, handle, 'EX', HANDLE_CACHE_TTL)
  }

  async function resolve(did: string): Promise<string> {
    // 1. Check Valkey cache
    try {
      const cached = await resolveFromCache(did)
      if (cached) {
        return cached
      }
    } catch (err: unknown) {
      logger.warn({ err, did }, 'Handle cache lookup failed, continuing')
    }

    // 2. Check users table (firehose may have indexed the handle)
    try {
      const dbHandle = await resolveFromDb(did)
      if (dbHandle) {
        // Populate cache for next time
        await cacheHandle(did, dbHandle).catch((err: unknown) => {
          logger.warn({ err, did }, 'Failed to cache handle from DB')
        })
        return dbHandle
      }
    } catch (err: unknown) {
      logger.warn({ err, did }, 'Handle DB lookup failed, continuing')
    }

    // 3. Resolve from PLC directory
    try {
      const plcHandle = await resolveFromPlcDirectory(did)
      if (plcHandle) {
        // Populate cache for next time
        await cacheHandle(did, plcHandle).catch((err: unknown) => {
          logger.warn({ err, did }, 'Failed to cache handle from PLC')
        })
        return plcHandle
      }
    } catch (err: unknown) {
      logger.warn({ err, did }, 'PLC directory lookup failed, continuing')
    }

    // 4. Fallback: return DID itself (auth should never fail due to handle resolution)
    logger.info({ did }, 'Handle resolution failed, using DID as fallback')
    return did
  }

  return { resolve }
}

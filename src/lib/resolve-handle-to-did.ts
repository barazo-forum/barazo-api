import { eq } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import type { Logger } from './logger.js'
import { users } from '../db/schema/users.js'

/**
 * Resolve an AT Protocol handle to a DID.
 *
 * 1. Check the local users table first (fast path).
 * 2. Fall back to the public Bluesky AppView XRPC endpoint.
 * 3. Return `null` if resolution fails.
 */
export async function resolveHandleToDid(
  handle: string,
  db: Database,
  logger: Logger
): Promise<string | null> {
  const localRows = await db
    .select({ did: users.did })
    .from(users)
    .where(eq(users.handle, handle))

  if (localRows[0]) {
    return localRows[0].did
  }

  try {
    const url = `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = (await res.json()) as { did?: string }
      if (data.did) {
        return data.did
      }
    }
  } catch {
    logger.warn({ handle }, 'Failed to resolve handle via Bluesky AppView')
  }

  return null
}

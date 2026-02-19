import { eq } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { userPreferences } from '../db/schema/user-preferences.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockMuteLists {
  blockedDids: string[]
  mutedDids: string[]
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the authenticated user's block and mute lists from their preferences.
 *
 * Returns empty lists when:
 * - The user is not authenticated (userDid is undefined)
 * - No preferences row exists for the user
 *
 * @param userDid - The DID of the authenticated user, or undefined if unauthenticated
 * @param db - The Drizzle database instance
 */
export async function loadBlockMuteLists(
  userDid: string | undefined,
  db: Database
): Promise<BlockMuteLists> {
  if (!userDid) {
    return { blockedDids: [], mutedDids: [] }
  }

  const rows = await db
    .select({
      blockedDids: userPreferences.blockedDids,
      mutedDids: userPreferences.mutedDids,
    })
    .from(userPreferences)
    .where(eq(userPreferences.did, userDid))

  const prefs = rows[0]
  return {
    blockedDids: prefs?.blockedDids ?? [],
    mutedDids: prefs?.mutedDids ?? [],
  }
}

import { eq, and } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { userPreferences, userCommunityPreferences } from '../db/schema/user-preferences.js'

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the authenticated user's muted words list (global + per-community merged).
 *
 * When a communityDid is provided, per-community muted words are merged with
 * global ones (union, deduplicated). A null per-community list means "use
 * global only" (no override).
 *
 * Returns empty array when the user is not authenticated or has no preferences.
 */
export async function loadMutedWords(
  userDid: string | undefined,
  communityDid: string | undefined,
  db: Database
): Promise<string[]> {
  if (!userDid) {
    return []
  }

  // Fetch global muted words
  const globalRows = await db
    .select({ mutedWords: userPreferences.mutedWords })
    .from(userPreferences)
    .where(eq(userPreferences.did, userDid))

  const globalWords: string[] = globalRows[0]?.mutedWords ?? []

  // If no community context, return global only
  if (!communityDid) {
    return globalWords
  }

  // Fetch per-community override
  const communityRows = await db
    .select({ mutedWords: userCommunityPreferences.mutedWords })
    .from(userCommunityPreferences)
    .where(
      and(
        eq(userCommunityPreferences.did, userDid),
        eq(userCommunityPreferences.communityDid, communityDid)
      )
    )

  const communityWords: string[] | null = communityRows[0]?.mutedWords ?? null

  // null = no override, use global only
  if (communityWords === null) {
    return globalWords
  }

  // Merge and deduplicate (union of global + community)
  return [...new Set([...globalWords, ...communityWords])]
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

/**
 * Escape regex special characters in a string so it can be used as a literal
 * match inside a RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Check whether content (and optionally a title) matches any muted word.
 *
 * Matching rules:
 * - Case-insensitive
 * - Word-boundary matching (whole words only, not partial)
 * - Multi-word phrases supported
 * - Regex special characters in muted words are escaped
 *
 * @param content - The content body text
 * @param mutedWords - The user's merged muted words list
 * @param title - Optional title to also check (for topics)
 */
export function contentMatchesMutedWords(
  content: string,
  mutedWords: string[],
  title?: string
): boolean {
  if (mutedWords.length === 0) return false

  const text = title ? `${title} ${content}` : content
  if (text.length === 0) return false

  for (const word of mutedWords) {
    const escaped = escapeRegex(word)
    const pattern = new RegExp(`(?:^|\\b|(?<=\\W))${escaped}(?:$|\\b|(?=\\W))`, 'i')
    if (pattern.test(text)) {
      return true
    }
  }

  return false
}

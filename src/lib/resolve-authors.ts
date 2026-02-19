import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { users } from '../db/schema/users.js'
import { communityProfiles } from '../db/schema/community-profiles.js'
import { resolveProfile, type SourceProfile, type CommunityOverride } from './resolve-profile.js'

/**
 * Compact author profile for embedding in topic/reply responses.
 * Intentionally excludes bannerUrl and bio to keep payloads small.
 */
export interface AuthorProfile {
  did: string
  handle: string
  displayName: string | null
  avatarUrl: string | null
}

/**
 * Batch-resolve author profiles for a list of DIDs.
 *
 * When `communityDid` is provided, per-community profile overrides are
 * applied (display name, avatar) via `resolveProfile()`.
 *
 * Returns a Map keyed by DID for O(1) lookup during serialization.
 */
export async function resolveAuthors(
  dids: string[],
  communityDid: string | null,
  db: Database
): Promise<Map<string, AuthorProfile>> {
  const uniqueDids = [...new Set(dids)]
  if (uniqueDids.length === 0) {
    return new Map()
  }

  // Batch query 1: source profiles from users table
  const userRows: SourceProfile[] = await db
    .select({
      did: users.did,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bannerUrl: users.bannerUrl,
      bio: users.bio,
    })
    .from(users)
    .where(inArray(users.did, uniqueDids))

  const sourceMap = new Map<string, SourceProfile>()
  for (const row of userRows) {
    sourceMap.set(row.did, row)
  }

  // Batch query 2: community profile overrides (only when community context exists)
  const overrideMap = new Map<string, CommunityOverride>()
  if (communityDid) {
    const overrideRows = await db
      .select({
        did: communityProfiles.did,
        displayName: communityProfiles.displayName,
        avatarUrl: communityProfiles.avatarUrl,
        bannerUrl: communityProfiles.bannerUrl,
        bio: communityProfiles.bio,
      })
      .from(communityProfiles)
      .where(
        and(
          inArray(communityProfiles.did, uniqueDids),
          eq(communityProfiles.communityDid, communityDid)
        )
      )

    for (const row of overrideRows) {
      overrideMap.set(row.did, {
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        bannerUrl: row.bannerUrl,
        bio: row.bio,
      })
    }
  }

  // Merge: resolve each DID using resolveProfile, then project to AuthorProfile
  const result = new Map<string, AuthorProfile>()
  for (const did of uniqueDids) {
    const source = sourceMap.get(did) ?? {
      did,
      handle: did,
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    }

    const resolved = resolveProfile(source, overrideMap.get(did) ?? null)

    result.set(did, {
      did: resolved.did,
      handle: resolved.handle,
      displayName: resolved.displayName,
      avatarUrl: resolved.avatarUrl,
    })
  }

  return result
}

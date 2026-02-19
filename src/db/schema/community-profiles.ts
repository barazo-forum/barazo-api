import { pgTable, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core'

/**
 * Per-community profile overrides.
 * All fields nullable -- null means "use source account value from users table."
 * Keyed by (did, community_did). Deleted when user leaves or is purged.
 */
export const communityProfiles = pgTable(
  'community_profiles',
  {
    did: text('did').notNull(),
    communityDid: text('community_did').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    bio: text('bio'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.did, table.communityDid] }),
    index('community_profiles_did_idx').on(table.did),
    index('community_profiles_community_idx').on(table.communityDid),
  ]
)

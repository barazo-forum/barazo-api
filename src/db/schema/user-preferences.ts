import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Global user preferences (stored in PostgreSQL for MVP, will sync to PDS later)
// ---------------------------------------------------------------------------

export const userPreferences = pgTable('user_preferences', {
  did: text('did').primaryKey(),
  maturityLevel: text('maturity_level', {
    enum: ['sfw', 'mature'],
  })
    .notNull()
    .default('sfw'),
  declaredAge: integer('declared_age'),
  mutedWords: jsonb('muted_words').$type<string[]>().notNull().default([]),
  blockedDids: jsonb('blocked_dids').$type<string[]>().notNull().default([]),
  mutedDids: jsonb('muted_dids').$type<string[]>().notNull().default([]),
  crossPostBluesky: boolean('cross_post_bluesky').notNull().default(false),
  crossPostFrontpage: boolean('cross_post_frontpage').notNull().default(false),
  crossPostScopesGranted: boolean('cross_post_scopes_granted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Per-community preference overrides
// ---------------------------------------------------------------------------

export const userCommunityPreferences = pgTable(
  'user_community_preferences',
  {
    did: text('did').notNull(),
    communityDid: text('community_did').notNull(),
    maturityOverride: text('maturity_override', {
      enum: ['sfw', 'mature'],
    }),
    mutedWords: jsonb('muted_words').$type<string[]>(),
    blockedDids: jsonb('blocked_dids').$type<string[]>(),
    mutedDids: jsonb('muted_dids').$type<string[]>(),
    notificationPrefs: jsonb('notification_prefs').$type<{
      replies: boolean
      reactions: boolean
      mentions: boolean
      modActions: boolean
    }>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.did, table.communityDid] }),
    index('user_community_prefs_did_idx').on(table.did),
    index('user_community_prefs_community_idx').on(table.communityDid),
  ]
)

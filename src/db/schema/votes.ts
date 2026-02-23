import { pgTable, text, timestamp, index, unique } from 'drizzle-orm/pg-core'

export const votes = pgTable(
  'votes',
  {
    uri: text('uri').primaryKey(),
    rkey: text('rkey').notNull(),
    authorDid: text('author_did').notNull(),
    subjectUri: text('subject_uri').notNull(),
    subjectCid: text('subject_cid').notNull(),
    direction: text('direction').notNull(),
    communityDid: text('community_did').notNull(),
    cid: text('cid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('votes_author_did_idx').on(table.authorDid),
    index('votes_subject_uri_idx').on(table.subjectUri),
    index('votes_community_did_idx').on(table.communityDid),
    // One vote per user per subject (regardless of direction)
    unique('votes_author_subject_uniq').on(table.authorDid, table.subjectUri),
  ]
)

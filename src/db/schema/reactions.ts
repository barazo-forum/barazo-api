import { pgTable, text, timestamp, index, unique } from 'drizzle-orm/pg-core'

export const reactions = pgTable(
  'reactions',
  {
    uri: text('uri').primaryKey(),
    rkey: text('rkey').notNull(),
    authorDid: text('author_did').notNull(),
    subjectUri: text('subject_uri').notNull(),
    subjectCid: text('subject_cid').notNull(),
    type: text('type').notNull(),
    communityDid: text('community_did').notNull(),
    cid: text('cid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reactions_author_did_idx').on(table.authorDid),
    index('reactions_subject_uri_idx').on(table.subjectUri),
    index('reactions_community_did_idx').on(table.communityDid),
    // communityDid intentionally excluded: AT URIs are globally unique, so a
    // reaction to a given subject is inherently community-scoped via the subject URI.
    unique('reactions_author_subject_type_uniq').on(table.authorDid, table.subjectUri, table.type),
  ]
)

import { pgTable, serial, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const moderationQueue = pgTable(
  'moderation_queue',
  {
    id: serial('id').primaryKey(),
    contentUri: text('content_uri').notNull(),
    contentType: text('content_type', {
      enum: ['topic', 'reply'],
    }).notNull(),
    authorDid: text('author_did').notNull(),
    communityDid: text('community_did').notNull(),
    queueReason: text('queue_reason', {
      enum: ['word_filter', 'first_post', 'link_hold', 'burst', 'topic_delay'],
    }).notNull(),
    matchedWords: jsonb('matched_words').$type<string[]>(),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected'],
    })
      .notNull()
      .default('pending'),
    reviewedBy: text('reviewed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    index('mod_queue_author_did_idx').on(table.authorDid),
    index('mod_queue_community_did_idx').on(table.communityDid),
    index('mod_queue_status_idx').on(table.status),
    index('mod_queue_created_at_idx').on(table.createdAt),
    index('mod_queue_content_uri_idx').on(table.contentUri),
  ]
)

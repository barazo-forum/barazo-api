import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

export const crossPosts = pgTable(
  'cross_posts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    topicUri: text('topic_uri').notNull(),
    service: text('service', { enum: ['bluesky', 'frontpage'] }).notNull(),
    crossPostUri: text('cross_post_uri').notNull(),
    crossPostCid: text('cross_post_cid').notNull(),
    authorDid: text('author_did').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cross_posts_topic_uri_idx').on(table.topicUri),
    index('cross_posts_author_did_idx').on(table.authorDid),
  ]
)

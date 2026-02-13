import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const topics = pgTable(
  "topics",
  {
    uri: text("uri").primaryKey(),
    rkey: text("rkey").notNull(),
    authorDid: text("author_did").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentFormat: text("content_format"),
    category: text("category").notNull(),
    tags: jsonb("tags").$type<string[]>(),
    communityDid: text("community_did").notNull(),
    cid: text("cid").notNull(),
    labels: jsonb("labels").$type<{ values: { val: string }[] }>(),
    replyCount: integer("reply_count").notNull().default(0),
    reactionCount: integer("reaction_count").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    embedding: text("embedding"),
  },
  (table) => [
    index("topics_author_did_idx").on(table.authorDid),
    index("topics_category_idx").on(table.category),
    index("topics_created_at_idx").on(table.createdAt),
    index("topics_last_activity_at_idx").on(table.lastActivityAt),
    index("topics_community_did_idx").on(table.communityDid),
  ],
);

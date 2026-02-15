import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
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
    isLocked: boolean("is_locked").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    isModDeleted: boolean("is_mod_deleted").notNull().default(false),
    moderationStatus: text("moderation_status", {
      enum: ["approved", "held", "rejected"],
    })
      .notNull()
      .default("approved"),
    /** Trust status based on account age at indexing time. 'new' for accounts < 24h old. */
    trustStatus: text("trust_status", {
      enum: ["trusted", "new"],
    })
      .notNull()
      .default("trusted"),
    // Note: search_vector (tsvector) and embedding (vector) columns exist in the
    // database but are managed outside Drizzle schema (see migration 0010).
    // search_vector is maintained by a database trigger.
    // embedding is nullable vector(768) for optional semantic search.
  },
  (table) => [
    index("topics_author_did_idx").on(table.authorDid),
    index("topics_category_idx").on(table.category),
    index("topics_created_at_idx").on(table.createdAt),
    index("topics_last_activity_at_idx").on(table.lastActivityAt),
    index("topics_community_did_idx").on(table.communityDid),
    index("topics_moderation_status_idx").on(table.moderationStatus),
    index("topics_trust_status_idx").on(table.trustStatus),
  ],
);

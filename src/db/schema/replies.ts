import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const replies = pgTable(
  "replies",
  {
    uri: text("uri").primaryKey(),
    rkey: text("rkey").notNull(),
    authorDid: text("author_did").notNull(),
    content: text("content").notNull(),
    contentFormat: text("content_format"),
    rootUri: text("root_uri").notNull(),
    rootCid: text("root_cid").notNull(),
    parentUri: text("parent_uri").notNull(),
    parentCid: text("parent_cid").notNull(),
    communityDid: text("community_did").notNull(),
    cid: text("cid").notNull(),
    labels: jsonb("labels").$type<{ values: { val: string }[] }>(),
    reactionCount: integer("reaction_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    index("replies_author_did_idx").on(table.authorDid),
    index("replies_root_uri_idx").on(table.rootUri),
    index("replies_parent_uri_idx").on(table.parentUri),
    index("replies_created_at_idx").on(table.createdAt),
    index("replies_community_did_idx").on(table.communityDid),
    index("replies_moderation_status_idx").on(table.moderationStatus),
    index("replies_trust_status_idx").on(table.trustStatus),
  ],
);

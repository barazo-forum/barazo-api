import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  serial,
} from "drizzle-orm/pg-core";

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientDid: text("recipient_did").notNull(),
    type: text("type", {
      enum: ["reply", "reaction", "mention", "mod_action", "global_report", "cross_post_failed", "cross_post_revoked"],
    }).notNull(),
    subjectUri: text("subject_uri").notNull(),
    actorDid: text("actor_did").notNull(),
    communityDid: text("community_did").notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_recipient_did_idx").on(table.recipientDid),
    index("notifications_recipient_read_idx").on(
      table.recipientDid,
      table.read,
    ),
    index("notifications_created_at_idx").on(table.createdAt),
  ],
);

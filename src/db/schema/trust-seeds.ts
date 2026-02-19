import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Trust seeds table. `communityId` uses empty string "" as sentinel for
 * "global" scope instead of NULL, so the unique index works correctly.
 */
export const trustSeeds = pgTable(
  "trust_seeds",
  {
    id: serial("id").primaryKey(),
    did: text("did").notNull(),
    communityId: text("community_id").notNull().default(""),
    addedBy: text("added_by").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("trust_seeds_did_community_idx").on(
      table.did,
      table.communityId,
    ),
  ],
);

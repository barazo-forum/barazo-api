import {
  pgTable,
  text,
  real,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/**
 * Trust scores table. `communityId` uses empty string "" as sentinel for
 * "global" scope instead of NULL, so the composite PK works correctly.
 */
export const trustScores = pgTable(
  "trust_scores",
  {
    did: text("did").notNull(),
    communityId: text("community_id").notNull().default(""),
    score: real("score").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.did, table.communityId] }),
    index("trust_scores_did_community_idx").on(table.did, table.communityId),
  ],
);

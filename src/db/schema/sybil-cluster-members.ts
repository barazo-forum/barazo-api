import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sybilClusters } from "./sybil-clusters.js";

export const sybilClusterMembers = pgTable(
  "sybil_cluster_members",
  {
    clusterId: integer("cluster_id")
      .notNull()
      .references(() => sybilClusters.id),
    did: text("did").notNull(),
    roleInCluster: text("role_in_cluster", {
      enum: ["core", "peripheral"],
    }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.clusterId, table.did] }),
  ],
);

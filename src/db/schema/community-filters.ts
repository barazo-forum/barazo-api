import {
  pgTable,
  text,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";

export const communityFilters = pgTable(
  "community_filters",
  {
    communityDid: text("community_did").primaryKey(),
    status: text("status", {
      enum: ["active", "warned", "filtered"],
    })
      .notNull()
      .default("active"),
    adminDid: text("admin_did"),
    reason: text("reason"),
    reportCount: integer("report_count").notNull().default(0),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    filteredBy: text("filtered_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("community_filters_status_idx").on(table.status),
    index("community_filters_admin_did_idx").on(table.adminDid),
    index("community_filters_updated_at_idx").on(table.updatedAt),
  ],
);

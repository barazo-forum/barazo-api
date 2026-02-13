import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const communitySettings = pgTable("community_settings", {
  id: text("id").primaryKey().default("default"),
  initialized: boolean("initialized").notNull().default(false),
  communityDid: text("community_did"),
  communityName: text("community_name").notNull().default("ATgora Community"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";


export const users = pgTable("users", {
  did: text("did").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  role: text("role", { enum: ["user", "moderator", "admin"] })
    .notNull()
    .default("user"),
  isBanned: boolean("is_banned").notNull().default(false),
  reputationScore: integer("reputation_score").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  declaredAge: integer("declared_age"),
  maturityPref: text("maturity_pref", {
    enum: ["safe", "mature", "adult"],
  })
    .notNull()
    .default("safe"),
});

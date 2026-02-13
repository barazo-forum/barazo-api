import { pgTable, text, bigint, timestamp } from "drizzle-orm/pg-core";

export const firehoseCursor = pgTable("firehose_cursor", {
  id: text("id").primaryKey().default("default"),
  cursor: bigint("cursor", { mode: "bigint" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

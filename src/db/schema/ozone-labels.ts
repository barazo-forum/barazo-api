import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  serial,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const ozoneLabels = pgTable(
  "ozone_labels",
  {
    id: serial("id").primaryKey(),
    src: text("src").notNull(),
    uri: text("uri").notNull(),
    val: text("val").notNull(),
    neg: boolean("neg").notNull().default(false),
    cts: timestamp("cts", { withTimezone: true }).notNull(),
    exp: timestamp("exp", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ozone_labels_src_uri_val_idx").on(
      table.src,
      table.uri,
      table.val,
    ),
    index("ozone_labels_uri_idx").on(table.uri),
    index("ozone_labels_val_idx").on(table.val),
    index("ozone_labels_indexed_at_idx").on(table.indexedAt),
  ],
);

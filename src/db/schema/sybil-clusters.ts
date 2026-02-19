import { pgTable, serial, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const sybilClusters = pgTable(
  'sybil_clusters',
  {
    id: serial('id').primaryKey(),
    clusterHash: text('cluster_hash').notNull(),
    internalEdgeCount: integer('internal_edge_count').notNull(),
    externalEdgeCount: integer('external_edge_count').notNull(),
    memberCount: integer('member_count').notNull(),
    status: text('status', {
      enum: ['flagged', 'dismissed', 'monitoring', 'banned'],
    })
      .notNull()
      .default('flagged'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('sybil_clusters_hash_idx').on(table.clusterHash)]
)

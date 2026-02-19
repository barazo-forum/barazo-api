import { pgTable, text, timestamp, index, serial, uniqueIndex } from 'drizzle-orm/pg-core'

export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    reporterDid: text('reporter_did').notNull(),
    targetUri: text('target_uri').notNull(),
    targetDid: text('target_did').notNull(),
    reasonType: text('reason_type', {
      enum: ['spam', 'sexual', 'harassment', 'violation', 'misleading', 'other'],
    }).notNull(),
    description: text('description'),
    communityDid: text('community_did').notNull(),
    status: text('status', {
      enum: ['pending', 'resolved'],
    })
      .notNull()
      .default('pending'),
    resolutionType: text('resolution_type', {
      enum: ['dismissed', 'warned', 'labeled', 'removed', 'banned'],
    }),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    appealReason: text('appeal_reason'),
    appealedAt: timestamp('appealed_at', { withTimezone: true }),
    appealStatus: text('appeal_status', {
      enum: ['none', 'pending', 'rejected'],
    })
      .notNull()
      .default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reports_reporter_did_idx').on(table.reporterDid),
    index('reports_target_uri_idx').on(table.targetUri),
    index('reports_target_did_idx').on(table.targetDid),
    index('reports_community_did_idx').on(table.communityDid),
    index('reports_status_idx').on(table.status),
    index('reports_created_at_idx').on(table.createdAt),
    uniqueIndex('reports_unique_reporter_target_idx').on(
      table.reporterDid,
      table.targetUri,
      table.communityDid
    ),
  ]
)

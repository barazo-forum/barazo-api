import { pgTable, pgPolicy, text, timestamp, index, serial, integer, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { appRole } from './roles.js'

export const accountFilters = pgTable(
  'account_filters',
  {
    id: serial('id').primaryKey(),
    did: text('did').notNull(),
    communityDid: text('community_did').notNull(),
    status: text('status', {
      enum: ['active', 'warned', 'filtered'],
    })
      .notNull()
      .default('active'),
    reason: text('reason'),
    reportCount: integer('report_count').notNull().default(0),
    banCount: integer('ban_count').notNull().default(0),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    filteredBy: text('filtered_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('account_filters_did_community_idx').on(table.did, table.communityDid),
    index('account_filters_did_idx').on(table.did),
    index('account_filters_community_did_idx').on(table.communityDid),
    index('account_filters_status_idx').on(table.status),
    index('account_filters_updated_at_idx').on(table.updatedAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: appRole,
      for: 'all',
      using: sql`community_did = current_setting('app.current_community_did', true)`,
      withCheck: sql`community_did = current_setting('app.current_community_did', true)`,
    }),
  ]
).enableRLS()

import {
  pgTable,
  pgPolicy,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { appRole } from './roles.js'

export const accountTrust = pgTable(
  'account_trust',
  {
    id: serial('id').primaryKey(),
    did: text('did').notNull(),
    communityDid: text('community_did').notNull(),
    approvedPostCount: integer('approved_post_count').notNull().default(0),
    isTrusted: boolean('is_trusted').notNull().default(false),
    trustedAt: timestamp('trusted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('account_trust_did_community_idx').on(table.did, table.communityDid),
    index('account_trust_did_idx').on(table.did),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: appRole,
      for: 'all',
      using: sql`community_did = current_setting('app.current_community_did', true)`,
      withCheck: sql`community_did = current_setting('app.current_community_did', true)`,
    }),
  ]
).enableRLS()

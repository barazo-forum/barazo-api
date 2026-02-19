import { pgTable, serial, text, real, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const pdsTrustFactors = pgTable(
  'pds_trust_factors',
  {
    id: serial('id').primaryKey(),
    pdsHost: text('pds_host').notNull(),
    trustFactor: real('trust_factor').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('pds_trust_factors_pds_host_idx').on(table.pdsHost)]
)

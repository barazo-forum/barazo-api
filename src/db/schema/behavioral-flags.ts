import { pgTable, serial, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'

export const behavioralFlags = pgTable(
  'behavioral_flags',
  {
    id: serial('id').primaryKey(),
    flagType: text('flag_type', {
      enum: ['burst_voting', 'content_similarity', 'low_diversity'],
    }).notNull(),
    affectedDids: jsonb('affected_dids').$type<string[]>().notNull(),
    details: text('details').notNull(),
    communityDid: text('community_did'),
    status: text('status', {
      enum: ['pending', 'dismissed', 'action_taken'],
    })
      .notNull()
      .default('pending'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('behavioral_flags_flag_type_idx').on(table.flagType),
    index('behavioral_flags_status_idx').on(table.status),
    index('behavioral_flags_detected_at_idx').on(table.detectedAt),
  ]
)

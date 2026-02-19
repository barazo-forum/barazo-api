import { pgTable, text, integer, timestamp, index, primaryKey } from 'drizzle-orm/pg-core'

export const interactionGraph = pgTable(
  'interaction_graph',
  {
    sourceDid: text('source_did').notNull(),
    targetDid: text('target_did').notNull(),
    communityId: text('community_id').notNull(),
    interactionType: text('interaction_type', {
      enum: ['reply', 'reaction', 'topic_coparticipation'],
    }).notNull(),
    weight: integer('weight').notNull().default(1),
    firstInteractionAt: timestamp('first_interaction_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastInteractionAt: timestamp('last_interaction_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceDid, table.targetDid, table.communityId, table.interactionType],
    }),
    index('interaction_graph_source_target_community_idx').on(
      table.sourceDid,
      table.targetDid,
      table.communityId
    ),
  ]
)

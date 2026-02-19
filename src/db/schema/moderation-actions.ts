import { pgTable, text, timestamp, index, serial } from 'drizzle-orm/pg-core'

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: serial('id').primaryKey(),
    action: text('action', {
      enum: ['lock', 'unlock', 'pin', 'unpin', 'delete', 'ban', 'unban'],
    }).notNull(),
    targetUri: text('target_uri'),
    targetDid: text('target_did'),
    moderatorDid: text('moderator_did').notNull(),
    communityDid: text('community_did').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mod_actions_moderator_did_idx').on(table.moderatorDid),
    index('mod_actions_community_did_idx').on(table.communityDid),
    index('mod_actions_created_at_idx').on(table.createdAt),
    index('mod_actions_target_uri_idx').on(table.targetUri),
    index('mod_actions_target_did_idx').on(table.targetDid),
  ]
)

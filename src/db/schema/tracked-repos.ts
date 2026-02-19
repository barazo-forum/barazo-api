import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const trackedRepos = pgTable('tracked_repos', {
  did: text('did').primaryKey(),
  trackedAt: timestamp('tracked_at', { withTimezone: true }).notNull().defaultNow(),
})

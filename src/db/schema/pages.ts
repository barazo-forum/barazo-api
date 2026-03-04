import {
  pgTable,
  pgPolicy,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { appRole } from './roles.js'

export const pages = pgTable(
  'pages',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    status: text('status', {
      enum: ['draft', 'published'],
    })
      .notNull()
      .default('draft'),
    metaDescription: text('meta_description'),
    parentId: text('parent_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    communityDid: text('community_did').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pages_slug_community_did_idx').on(table.slug, table.communityDid),
    index('pages_community_did_idx').on(table.communityDid),
    index('pages_parent_id_idx').on(table.parentId),
    index('pages_status_community_did_idx').on(table.status, table.communityDid),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'pages_parent_id_fk',
    }).onDelete('set null'),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: appRole,
      for: 'all',
      using: sql`community_did = current_setting('app.current_community_did', true)`,
      withCheck: sql`community_did = current_setting('app.current_community_did', true)`,
    }),
  ]
).enableRLS()

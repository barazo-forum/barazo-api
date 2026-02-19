import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'

export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    parentId: text('parent_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    communityDid: text('community_did').notNull(),
    maturityRating: text('maturity_rating', {
      enum: ['safe', 'mature', 'adult'],
    })
      .notNull()
      .default('safe'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('categories_slug_community_did_idx').on(table.slug, table.communityDid),
    index('categories_parent_id_idx').on(table.parentId),
    index('categories_community_did_idx').on(table.communityDid),
    index('categories_maturity_rating_idx').on(table.maturityRating),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'categories_parent_id_fk',
    }).onDelete('set null'),
  ]
)

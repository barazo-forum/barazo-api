import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { pages } from '../../../../src/db/schema/pages.js'

describe('pages schema', () => {
  const columns = getTableColumns(pages)

  it('has the correct table name', () => {
    expect(getTableName(pages)).toBe('pages')
  })

  it('uses id as primary key', () => {
    expect(columns.id.primary).toBe(true)
  })

  it('has all required columns', () => {
    const columnNames = Object.keys(columns)

    const expected = [
      'id',
      'slug',
      'title',
      'content',
      'status',
      'metaDescription',
      'parentId',
      'sortOrder',
      'communityDid',
      'createdAt',
      'updatedAt',
    ]

    for (const col of expected) {
      expect(columnNames).toContain(col)
    }
  })

  it('has non-nullable required columns', () => {
    expect(columns.id.notNull).toBe(true)
    expect(columns.slug.notNull).toBe(true)
    expect(columns.title.notNull).toBe(true)
    expect(columns.content.notNull).toBe(true)
    expect(columns.status.notNull).toBe(true)
    expect(columns.sortOrder.notNull).toBe(true)
    expect(columns.communityDid.notNull).toBe(true)
    expect(columns.createdAt.notNull).toBe(true)
    expect(columns.updatedAt.notNull).toBe(true)
  })

  it('has nullable optional columns', () => {
    expect(columns.metaDescription.notNull).toBe(false)
    expect(columns.parentId.notNull).toBe(false)
  })

  it('has default value for sortOrder', () => {
    expect(columns.sortOrder.hasDefault).toBe(true)
  })

  it('has default value for status', () => {
    expect(columns.status.hasDefault).toBe(true)
  })

  it('has default values for timestamps', () => {
    expect(columns.createdAt.hasDefault).toBe(true)
    expect(columns.updatedAt.hasDefault).toBe(true)
  })
})

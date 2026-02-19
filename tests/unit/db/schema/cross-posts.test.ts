import { describe, it, expect } from 'vitest'
import { crossPosts } from '../../../../src/db/schema/cross-posts.js'
import { getTableName, getTableColumns } from 'drizzle-orm'

describe('cross-posts schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(crossPosts)).toBe('cross_posts')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(crossPosts)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('id')
    expect(columnNames).toContain('topicUri')
    expect(columnNames).toContain('service')
    expect(columnNames).toContain('crossPostUri')
    expect(columnNames).toContain('crossPostCid')
    expect(columnNames).toContain('authorDid')
    expect(columnNames).toContain('createdAt')
  })

  it('should have id as primary key', () => {
    const columns = getTableColumns(crossPosts)
    expect(columns.id.primary).toBe(true)
  })

  it('should mark required columns as not null', () => {
    const columns = getTableColumns(crossPosts)
    expect(columns.topicUri.notNull).toBe(true)
    expect(columns.service.notNull).toBe(true)
    expect(columns.crossPostUri.notNull).toBe(true)
    expect(columns.crossPostCid.notNull).toBe(true)
    expect(columns.authorDid.notNull).toBe(true)
    expect(columns.createdAt.notNull).toBe(true)
  })

  it('should have exactly 7 columns', () => {
    const columns = getTableColumns(crossPosts)
    expect(Object.keys(columns)).toHaveLength(7)
  })

  it('should have a default value for id', () => {
    const columns = getTableColumns(crossPosts)
    expect(columns.id.hasDefault).toBe(true)
  })

  it('should have a default value for createdAt', () => {
    const columns = getTableColumns(crossPosts)
    expect(columns.createdAt.hasDefault).toBe(true)
  })
})

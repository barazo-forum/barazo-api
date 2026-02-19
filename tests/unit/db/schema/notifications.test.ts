import { describe, it, expect } from 'vitest'
import { notifications } from '../../../../src/db/schema/notifications.js'
import { getTableName, getTableColumns } from 'drizzle-orm'

describe('notifications schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(notifications)).toBe('notifications')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(notifications)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('id')
    expect(columnNames).toContain('recipientDid')
    expect(columnNames).toContain('type')
    expect(columnNames).toContain('subjectUri')
    expect(columnNames).toContain('actorDid')
    expect(columnNames).toContain('communityDid')
    expect(columnNames).toContain('read')
    expect(columnNames).toContain('createdAt')
  })

  it('should have id as primary key', () => {
    const columns = getTableColumns(notifications)
    expect(columns.id.primary).toBe(true)
  })

  it('should mark required columns as not null', () => {
    const columns = getTableColumns(notifications)
    expect(columns.recipientDid.notNull).toBe(true)
    expect(columns.type.notNull).toBe(true)
    expect(columns.subjectUri.notNull).toBe(true)
    expect(columns.actorDid.notNull).toBe(true)
    expect(columns.communityDid.notNull).toBe(true)
    expect(columns.read.notNull).toBe(true)
    expect(columns.createdAt.notNull).toBe(true)
  })

  it('should have exactly 8 columns', () => {
    const columns = getTableColumns(notifications)
    expect(Object.keys(columns)).toHaveLength(8)
  })

  it('should have a default value for read (false)', () => {
    const columns = getTableColumns(notifications)
    expect(columns.read.hasDefault).toBe(true)
  })

  it('should have a default value for createdAt', () => {
    const columns = getTableColumns(notifications)
    expect(columns.createdAt.hasDefault).toBe(true)
  })
})

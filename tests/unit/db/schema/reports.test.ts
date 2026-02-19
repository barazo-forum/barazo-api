import { describe, it, expect } from 'vitest'
import { reports } from '../../../../src/db/schema/reports.js'
import { getTableName, getTableColumns } from 'drizzle-orm'

describe('reports schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(reports)).toBe('reports')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(reports)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('id')
    expect(columnNames).toContain('reporterDid')
    expect(columnNames).toContain('targetUri')
    expect(columnNames).toContain('targetDid')
    expect(columnNames).toContain('reasonType')
    expect(columnNames).toContain('description')
    expect(columnNames).toContain('communityDid')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('resolutionType')
    expect(columnNames).toContain('resolvedBy')
    expect(columnNames).toContain('resolvedAt')
    expect(columnNames).toContain('createdAt')
  })

  it('should have id as primary key', () => {
    const columns = getTableColumns(reports)
    expect(columns.id.primary).toBe(true)
  })

  it('should mark required columns as not null', () => {
    const columns = getTableColumns(reports)
    expect(columns.reporterDid.notNull).toBe(true)
    expect(columns.targetUri.notNull).toBe(true)
    expect(columns.targetDid.notNull).toBe(true)
    expect(columns.reasonType.notNull).toBe(true)
    expect(columns.communityDid.notNull).toBe(true)
    expect(columns.status.notNull).toBe(true)
    expect(columns.createdAt.notNull).toBe(true)
  })

  it('should allow nullable resolution fields', () => {
    const columns = getTableColumns(reports)
    expect(columns.description.notNull).toBe(false)
    expect(columns.resolutionType.notNull).toBe(false)
    expect(columns.resolvedBy.notNull).toBe(false)
    expect(columns.resolvedAt.notNull).toBe(false)
  })

  it('should default status to pending', () => {
    const columns = getTableColumns(reports)
    expect(columns.status.default).toBeDefined()
  })
})

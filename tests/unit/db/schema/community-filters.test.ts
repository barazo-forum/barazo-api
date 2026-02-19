import { describe, it, expect } from 'vitest'
import { communityFilters } from '../../../../src/db/schema/community-filters.js'
import { getTableName, getTableColumns } from 'drizzle-orm'

describe('community-filters schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(communityFilters)).toBe('community_filters')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(communityFilters)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('communityDid')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('adminDid')
    expect(columnNames).toContain('reason')
    expect(columnNames).toContain('reportCount')
    expect(columnNames).toContain('lastReviewedAt')
    expect(columnNames).toContain('filteredBy')
    expect(columnNames).toContain('createdAt')
    expect(columnNames).toContain('updatedAt')
  })

  it('should have communityDid as primary key', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.communityDid.primary).toBe(true)
  })

  it('should mark required columns as not null', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.communityDid.notNull).toBe(true)
    expect(columns.status.notNull).toBe(true)
    expect(columns.reportCount.notNull).toBe(true)
    expect(columns.createdAt.notNull).toBe(true)
    expect(columns.updatedAt.notNull).toBe(true)
  })

  it('should allow nullable optional fields', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.adminDid.notNull).toBe(false)
    expect(columns.reason.notNull).toBe(false)
    expect(columns.lastReviewedAt.notNull).toBe(false)
    expect(columns.filteredBy.notNull).toBe(false)
  })

  it('should have status enum values of active, warned, filtered', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.status.enumValues).toEqual(['active', 'warned', 'filtered'])
  })

  it('should default status to active', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.status.default).toBeDefined()
  })

  it('should default reportCount to 0', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.reportCount.default).toBeDefined()
  })

  it('should have default timestamps for createdAt and updatedAt', () => {
    const columns = getTableColumns(communityFilters)
    expect(columns.createdAt.default).toBeDefined()
    expect(columns.updatedAt.default).toBeDefined()
  })
})

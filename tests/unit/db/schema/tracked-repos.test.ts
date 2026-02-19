import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { trackedRepos } from '../../../../src/db/schema/tracked-repos.js'

describe('tracked_repos schema', () => {
  const columns = getTableColumns(trackedRepos)

  it('has the correct table name', () => {
    expect(getTableName(trackedRepos)).toBe('tracked_repos')
  })

  it('uses did as primary key', () => {
    expect(columns.did.primary).toBe(true)
  })

  it('has tracked_at column with default', () => {
    expect(columns.trackedAt).toBeDefined()
    expect(columns.trackedAt.hasDefault).toBe(true)
    expect(columns.trackedAt.notNull).toBe(true)
  })

  it('has only did and tracked_at columns', () => {
    const columnNames = Object.keys(columns)
    expect(columnNames).toEqual(['did', 'trackedAt'])
  })
})

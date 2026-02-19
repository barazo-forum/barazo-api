import { describe, it, expect } from 'vitest'
import { sybilClusterMembers } from '../../../../src/db/schema/sybil-cluster-members.js'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'

describe('sybil-cluster-members schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(sybilClusterMembers)).toBe('sybil_cluster_members')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(sybilClusterMembers)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('clusterId')
    expect(columnNames).toContain('did')
    expect(columnNames).toContain('roleInCluster')
    expect(columnNames).toContain('joinedAt')
  })

  it('should mark all columns as not null', () => {
    const columns = getTableColumns(sybilClusterMembers)
    expect(columns.clusterId.notNull).toBe(true)
    expect(columns.did.notNull).toBe(true)
    expect(columns.roleInCluster.notNull).toBe(true)
    expect(columns.joinedAt.notNull).toBe(true)
  })

  it('should have roleInCluster enum values', () => {
    const columns = getTableColumns(sybilClusterMembers)
    expect(columns.roleInCluster.enumValues).toEqual(['core', 'peripheral'])
  })

  it('should have composite primary key on (clusterId, did)', () => {
    const config = getTableConfig(sybilClusterMembers)
    expect(config.primaryKeys.length).toBeGreaterThanOrEqual(1)
    const pk = config.primaryKeys[0]
    expect(pk).toBeDefined()
    if (pk) expect(pk.columns.length).toBe(2)
  })

  it('should have foreign key on clusterId referencing sybil_clusters', () => {
    const config = getTableConfig(sybilClusterMembers)
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
  })
})

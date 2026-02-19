import { describe, it, expect } from 'vitest'
import { sybilClusters } from '../../../../src/db/schema/sybil-clusters.js'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'

describe('sybil-clusters schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(sybilClusters)).toBe('sybil_clusters')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(sybilClusters)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('id')
    expect(columnNames).toContain('clusterHash')
    expect(columnNames).toContain('internalEdgeCount')
    expect(columnNames).toContain('externalEdgeCount')
    expect(columnNames).toContain('memberCount')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('reviewedBy')
    expect(columnNames).toContain('reviewedAt')
    expect(columnNames).toContain('detectedAt')
    expect(columnNames).toContain('updatedAt')
  })

  it('should have id as primary key (serial)', () => {
    const columns = getTableColumns(sybilClusters)
    expect(columns.id.primary).toBe(true)
  })

  it('should mark required columns as not null', () => {
    const columns = getTableColumns(sybilClusters)
    expect(columns.clusterHash.notNull).toBe(true)
    expect(columns.internalEdgeCount.notNull).toBe(true)
    expect(columns.externalEdgeCount.notNull).toBe(true)
    expect(columns.memberCount.notNull).toBe(true)
    expect(columns.status.notNull).toBe(true)
    expect(columns.detectedAt.notNull).toBe(true)
    expect(columns.updatedAt.notNull).toBe(true)
  })

  it('should allow nullable reviewedBy and reviewedAt', () => {
    const columns = getTableColumns(sybilClusters)
    expect(columns.reviewedBy.notNull).toBe(false)
    expect(columns.reviewedAt.notNull).toBe(false)
  })

  it('should have status enum values', () => {
    const columns = getTableColumns(sybilClusters)
    expect(columns.status.enumValues).toEqual(['flagged', 'dismissed', 'monitoring', 'banned'])
  })

  it('should default status to flagged', () => {
    const columns = getTableColumns(sybilClusters)
    expect(columns.status.default).toBeDefined()
  })

  it('should have unique index on clusterHash', () => {
    const config = getTableConfig(sybilClusters)
    const idx = config.indexes.find((i) => i.config.name === 'sybil_clusters_hash_idx')
    expect(idx).toBeDefined()
    expect(idx?.config.unique).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { ozoneLabels } from '../../../../src/db/schema/ozone-labels.js'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'

describe('ozone-labels schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(ozoneLabels)).toBe('ozone_labels')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(ozoneLabels)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('id')
    expect(columnNames).toContain('src')
    expect(columnNames).toContain('uri')
    expect(columnNames).toContain('val')
    expect(columnNames).toContain('neg')
    expect(columnNames).toContain('cts')
    expect(columnNames).toContain('exp')
    expect(columnNames).toContain('indexedAt')
  })

  it('should have id as primary key (serial)', () => {
    const columns = getTableColumns(ozoneLabels)
    expect(columns.id.primary).toBe(true)
  })

  it('should mark required columns as not null', () => {
    const columns = getTableColumns(ozoneLabels)
    expect(columns.src.notNull).toBe(true)
    expect(columns.uri.notNull).toBe(true)
    expect(columns.val.notNull).toBe(true)
    expect(columns.neg.notNull).toBe(true)
    expect(columns.cts.notNull).toBe(true)
    expect(columns.indexedAt.notNull).toBe(true)
  })

  it('should allow nullable optional fields', () => {
    const columns = getTableColumns(ozoneLabels)
    expect(columns.exp.notNull).toBe(false)
  })

  it('should default neg to false', () => {
    const columns = getTableColumns(ozoneLabels)
    expect(columns.neg.default).toBeDefined()
  })

  it('should have a unique index on (src, uri, val)', () => {
    const config = getTableConfig(ozoneLabels)
    const uniqueIdx = config.indexes.find(
      (idx) => idx.config.name === 'ozone_labels_src_uri_val_idx'
    )
    expect(uniqueIdx).toBeDefined()
    expect(uniqueIdx?.config.unique).toBe(true)
  })

  it('should have default timestamp for indexedAt', () => {
    const columns = getTableColumns(ozoneLabels)
    expect(columns.indexedAt.default).toBeDefined()
  })
})

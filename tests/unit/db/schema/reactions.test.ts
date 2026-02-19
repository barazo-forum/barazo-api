import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { reactions } from '../../../../src/db/schema/reactions.js'

describe('reactions schema', () => {
  const columns = getTableColumns(reactions)

  it('has the correct table name', () => {
    expect(getTableName(reactions)).toBe('reactions')
  })

  it('uses uri as primary key', () => {
    expect(columns.uri.primary).toBe(true)
  })

  it('has all required columns', () => {
    const columnNames = Object.keys(columns)

    const expected = [
      'uri',
      'rkey',
      'authorDid',
      'subjectUri',
      'subjectCid',
      'type',
      'communityDid',
      'cid',
      'createdAt',
      'indexedAt',
    ]

    for (const col of expected) {
      expect(columnNames).toContain(col)
    }
  })

  it('has non-nullable required columns', () => {
    expect(columns.uri.notNull).toBe(true)
    expect(columns.rkey.notNull).toBe(true)
    expect(columns.authorDid.notNull).toBe(true)
    expect(columns.subjectUri.notNull).toBe(true)
    expect(columns.subjectCid.notNull).toBe(true)
    expect(columns.type.notNull).toBe(true)
    expect(columns.communityDid.notNull).toBe(true)
    expect(columns.cid.notNull).toBe(true)
  })

  it('has default value for indexed_at', () => {
    expect(columns.indexedAt.hasDefault).toBe(true)
  })
})

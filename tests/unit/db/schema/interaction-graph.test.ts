import { describe, it, expect } from 'vitest'
import { interactionGraph } from '../../../../src/db/schema/interaction-graph.js'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'

describe('interaction-graph schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(interactionGraph)).toBe('interaction_graph')
  })

  it('should have all required columns', () => {
    const columns = getTableColumns(interactionGraph)
    const columnNames = Object.keys(columns)

    expect(columnNames).toContain('sourceDid')
    expect(columnNames).toContain('targetDid')
    expect(columnNames).toContain('communityId')
    expect(columnNames).toContain('interactionType')
    expect(columnNames).toContain('weight')
    expect(columnNames).toContain('firstInteractionAt')
    expect(columnNames).toContain('lastInteractionAt')
  })

  it('should mark all columns as not null', () => {
    const columns = getTableColumns(interactionGraph)
    expect(columns.sourceDid.notNull).toBe(true)
    expect(columns.targetDid.notNull).toBe(true)
    expect(columns.communityId.notNull).toBe(true)
    expect(columns.interactionType.notNull).toBe(true)
    expect(columns.weight.notNull).toBe(true)
    expect(columns.firstInteractionAt.notNull).toBe(true)
    expect(columns.lastInteractionAt.notNull).toBe(true)
  })

  it('should have interactionType enum values', () => {
    const columns = getTableColumns(interactionGraph)
    expect(columns.interactionType.enumValues).toEqual([
      'reply',
      'reaction',
      'topic_coparticipation',
    ])
  })

  it('should default weight to 1', () => {
    const columns = getTableColumns(interactionGraph)
    expect(columns.weight.default).toBeDefined()
  })

  it('should have composite primary key on (sourceDid, targetDid, communityId, interactionType)', () => {
    const config = getTableConfig(interactionGraph)
    // Composite PK exists
    expect(config.primaryKeys.length).toBeGreaterThanOrEqual(1)
    const pk = config.primaryKeys[0]
    expect(pk).toBeDefined()
    if (pk) expect(pk.columns.length).toBe(4)
  })

  it('should have composite index on (sourceDid, targetDid, communityId)', () => {
    const config = getTableConfig(interactionGraph)
    const idx = config.indexes.find(
      (i) => i.config.name === 'interaction_graph_source_target_community_idx'
    )
    expect(idx).toBeDefined()
  })
})

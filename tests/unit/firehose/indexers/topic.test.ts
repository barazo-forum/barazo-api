import { describe, it, expect, vi } from 'vitest'
import { TopicIndexer } from '../../../../src/firehose/indexers/topic.js'

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}

describe('TopicIndexer', () => {
  const baseParams = {
    uri: 'at://did:plc:test/forum.barazo.topic.post/abc123',
    rkey: 'abc123',
    did: 'did:plc:test',
    cid: 'bafyabc',
    live: true,
  }

  describe('handleCreate', () => {
    it('upserts a topic record', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new TopicIndexer(db as never, logger as never)

      await indexer.handleCreate({
        ...baseParams,
        record: {
          title: 'Test Topic',
          content: 'Content here',
          contentFormat: 'markdown',
          community: 'did:plc:community',
          category: 'general',
          tags: ['test'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.insert).toHaveBeenCalledTimes(1)
    })

    it('includes labels when present', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new TopicIndexer(db as never, logger as never)

      await indexer.handleCreate({
        ...baseParams,
        record: {
          title: 'Test',
          content: 'Content',
          community: 'did:plc:community',
          category: 'general',
          labels: { values: [{ val: 'nsfw' }] },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.insert).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleUpdate', () => {
    it('updates topic content', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new TopicIndexer(db as never, logger as never)

      await indexer.handleUpdate({
        ...baseParams,
        record: {
          title: 'Updated Title',
          content: 'Updated content',
          community: 'did:plc:community',
          category: 'updated',
          tags: ['updated'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleDelete', () => {
    it('deletes a topic by URI', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new TopicIndexer(db as never, logger as never)

      await indexer.handleDelete({
        uri: baseParams.uri,
        rkey: baseParams.rkey,
        did: baseParams.did,
      })

      expect(db.delete).toHaveBeenCalledTimes(1)
    })
  })
})

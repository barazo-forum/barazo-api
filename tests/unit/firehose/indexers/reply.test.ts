import { describe, it, expect, vi } from 'vitest'
import { ReplyIndexer } from '../../../../src/firehose/indexers/reply.js'

function createMockDb() {
  const mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ uri: 'deleted' }]),
    }),
  }

  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ uri: 'deleted' }]),
    }),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
    _tx: mockTx,
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

describe('ReplyIndexer', () => {
  const baseParams = {
    uri: 'at://did:plc:test/forum.barazo.topic.reply/reply1',
    rkey: 'reply1',
    did: 'did:plc:test',
    cid: 'bafyreply',
    live: true,
  }

  describe('handleCreate', () => {
    it('inserts a reply and increments topic reply count in a transaction', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new ReplyIndexer(db as never, logger as never)

      await indexer.handleCreate({
        ...baseParams,
        record: {
          content: 'A reply',
          root: { uri: 'at://did:plc:test/forum.barazo.topic.post/topic1', cid: 'bafytopic' },
          parent: { uri: 'at://did:plc:test/forum.barazo.topic.post/topic1', cid: 'bafytopic' },
          community: 'did:plc:community',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleUpdate', () => {
    it('updates reply content', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new ReplyIndexer(db as never, logger as never)

      await indexer.handleUpdate({
        ...baseParams,
        record: {
          content: 'Updated reply',
          root: { uri: 'at://did:plc:test/forum.barazo.topic.post/topic1', cid: 'bafytopic' },
          parent: { uri: 'at://did:plc:test/forum.barazo.topic.post/topic1', cid: 'bafytopic' },
          community: 'did:plc:community',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleDelete', () => {
    it('deletes a reply and decrements count in a transaction', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new ReplyIndexer(db as never, logger as never)

      await indexer.handleDelete({
        uri: baseParams.uri,
        rkey: baseParams.rkey,
        did: baseParams.did,
        rootUri: 'at://did:plc:test/forum.barazo.topic.post/topic1',
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
    })
  })
})

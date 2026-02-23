import { describe, it, expect, vi } from 'vitest'
import { VoteIndexer } from '../../../../src/firehose/indexers/vote.js'

function createMockDb() {
  const mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
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
        onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
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

describe('VoteIndexer', () => {
  const baseParams = {
    uri: 'at://did:plc:test/forum.barazo.interaction.vote/vote1',
    rkey: 'vote1',
    did: 'did:plc:test',
    cid: 'bafyvote',
    live: true,
  }

  describe('handleCreate', () => {
    it('upserts a vote and increments count in a transaction', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new VoteIndexer(db as never, logger as never)

      await indexer.handleCreate({
        ...baseParams,
        record: {
          subject: {
            uri: 'at://did:plc:test/forum.barazo.topic.post/topic1',
            cid: 'bafytopic',
          },
          direction: 'up',
          community: 'did:plc:community',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
    })

    it('handles vote on a reply subject', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new VoteIndexer(db as never, logger as never)

      await indexer.handleCreate({
        ...baseParams,
        record: {
          subject: {
            uri: 'at://did:plc:test/forum.barazo.topic.reply/reply1',
            cid: 'bafyreply',
          },
          direction: 'up',
          community: 'did:plc:community',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleDelete', () => {
    it('deletes a vote and decrements count in a transaction', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new VoteIndexer(db as never, logger as never)

      await indexer.handleDelete({
        uri: baseParams.uri,
        rkey: baseParams.rkey,
        did: baseParams.did,
        subjectUri: 'at://did:plc:test/forum.barazo.topic.post/topic1',
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
    })

    it('handles delete for a reply subject', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const indexer = new VoteIndexer(db as never, logger as never)

      await indexer.handleDelete({
        uri: baseParams.uri,
        rkey: baseParams.rkey,
        did: baseParams.did,
        subjectUri: 'at://did:plc:test/forum.barazo.topic.reply/reply1',
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
    })
  })
})

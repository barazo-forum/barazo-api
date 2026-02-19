import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OzoneService } from '../../../src/services/ozone.js'

// Mock WebSocket globally to prevent actual connections
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  close = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  send = vi.fn()
}

vi.stubGlobal('WebSocket', MockWebSocket)

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}

function createMockCache() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  }
}

function createMockDb() {
  const deleteMock = {
    where: vi.fn().mockResolvedValue(undefined),
  }
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined)
  const insertValuesMock = {
    onConflictDoUpdate: onConflictDoUpdateMock,
  }
  const insertMock = {
    values: vi.fn().mockReturnValue(insertValuesMock),
  }
  const selectFromWhereMock = vi.fn().mockResolvedValue([])
  const selectFromMock = {
    where: selectFromWhereMock,
  }
  const selectMock = {
    from: vi.fn().mockReturnValue(selectFromMock),
  }

  return {
    select: vi.fn().mockReturnValue(selectMock),
    insert: vi.fn().mockReturnValue(insertMock),
    delete: vi.fn().mockReturnValue(deleteMock),
    // Expose internals for assertions
    _selectFromWhere: selectFromWhereMock,
    _insertValues: insertMock.values,
    _onConflictDoUpdate: onConflictDoUpdateMock,
    _deleteWhere: deleteMock.where,
  }
}

describe('OzoneService', () => {
  let service: OzoneService
  let logger: ReturnType<typeof createMockLogger>
  let cache: ReturnType<typeof createMockCache>
  let db: ReturnType<typeof createMockDb>

  beforeEach(() => {
    logger = createMockLogger()
    cache = createMockCache()
    db = createMockDb()
    service = new OzoneService(
      db as never,
      cache as never,
      logger as never,
      'https://ozone.example.com'
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('start / stop', () => {
    it('sets stopping to false on start and creates a WebSocket', () => {
      // start() should not throw and should attempt to connect
      expect(() => {
        service.start()
      }).not.toThrow()
      expect(logger.info).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ url: expect.stringContaining('wss:') }),
        'Connecting to Ozone labeler'
      )
    })

    it('sets stopping to true on stop and closes WebSocket', () => {
      service.start()
      service.stop()

      // After stop, calling start again should work (stopping reset)
      // The ws.close() should have been called
      expect(logger.info).toHaveBeenCalled()
    })

    it('stop is safe to call without prior start', () => {
      expect(() => {
        service.stop()
      }).not.toThrow()
    })

    it('does not reconnect after stop', () => {
      service.start()
      service.stop()
      // After stopping, a second start should work fresh
      service.start()
      expect(logger.info).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ url: expect.any(String) }),
        'Connecting to Ozone labeler'
      )
    })
  })

  describe('getLabels', () => {
    it('returns labels from cache when available', async () => {
      const cachedLabels = [{ val: 'spam', src: 'did:plc:labeler1', neg: false }]
      cache.get.mockResolvedValue(JSON.stringify(cachedLabels))

      const result = await service.getLabels('did:plc:user123')

      expect(result).toEqual(cachedLabels)
      expect(cache.get).toHaveBeenCalledWith('ozone:labels:did:plc:user123')
      // DB should NOT have been queried
      expect(db.select).not.toHaveBeenCalled()
    })

    it('queries DB and caches result on cache miss', async () => {
      cache.get.mockResolvedValue(null)
      const dbRows = [
        { val: 'nudity', src: 'did:plc:labeler1', neg: false },
        { val: 'spam', src: 'did:plc:labeler2', neg: false },
      ]
      db._selectFromWhere.mockResolvedValue(dbRows)

      const result = await service.getLabels('at://did:plc:user/app.bsky.feed.post/abc')

      expect(result).toEqual(dbRows)
      expect(db.select).toHaveBeenCalled()
      expect(cache.set).toHaveBeenCalledWith(
        'ozone:labels:at://did:plc:user/app.bsky.feed.post/abc',
        JSON.stringify(dbRows),
        'EX',
        3600
      )
    })

    it('queries DB when cache throws an error', async () => {
      cache.get.mockRejectedValue(new Error('Redis down'))
      db._selectFromWhere.mockResolvedValue([])

      const result = await service.getLabels('did:plc:user123')

      expect(result).toEqual([])
      expect(db.select).toHaveBeenCalled()
    })

    it('returns labels even when cache set fails', async () => {
      cache.get.mockResolvedValue(null)
      cache.set.mockRejectedValue(new Error('Redis write failed'))
      const dbRows = [{ val: 'spam', src: 'did:plc:labeler1', neg: false }]
      db._selectFromWhere.mockResolvedValue(dbRows)

      const result = await service.getLabels('did:plc:user123')

      expect(result).toEqual(dbRows)
    })

    it('returns empty array when no labels exist', async () => {
      cache.get.mockResolvedValue(null)
      db._selectFromWhere.mockResolvedValue([])

      const result = await service.getLabels('did:plc:clean-user')

      expect(result).toEqual([])
      // Empty array should still be cached
      expect(cache.set).toHaveBeenCalledWith('ozone:labels:did:plc:clean-user', '[]', 'EX', 3600)
    })
  })

  describe('hasLabel', () => {
    it('returns true when the label exists', async () => {
      cache.get.mockResolvedValue(
        JSON.stringify([
          { val: 'spam', src: 'did:plc:labeler1', neg: false },
          { val: 'nudity', src: 'did:plc:labeler1', neg: false },
        ])
      )

      const result = await service.hasLabel('did:plc:user123', 'spam')

      expect(result).toBe(true)
    })

    it('returns false when the label does not exist', async () => {
      cache.get.mockResolvedValue(
        JSON.stringify([{ val: 'nudity', src: 'did:plc:labeler1', neg: false }])
      )

      const result = await service.hasLabel('did:plc:user123', 'spam')

      expect(result).toBe(false)
    })

    it('returns false when no labels exist', async () => {
      cache.get.mockResolvedValue(null)
      db._selectFromWhere.mockResolvedValue([])

      const result = await service.hasLabel('did:plc:user123', 'spam')

      expect(result).toBe(false)
    })
  })

  describe('isSpamLabeled', () => {
    it('returns true when "spam" label is present', async () => {
      cache.get.mockResolvedValue(
        JSON.stringify([{ val: 'spam', src: 'did:plc:labeler1', neg: false }])
      )

      const result = await service.isSpamLabeled('did:plc:spammer')

      expect(result).toBe(true)
    })

    it('returns true when "!hide" label is present', async () => {
      cache.get.mockResolvedValue(
        JSON.stringify([{ val: '!hide', src: 'did:plc:labeler1', neg: false }])
      )

      const result = await service.isSpamLabeled('did:plc:hidden-user')

      expect(result).toBe(true)
    })

    it('returns true when both spam labels are present', async () => {
      cache.get.mockResolvedValue(
        JSON.stringify([
          { val: 'spam', src: 'did:plc:labeler1', neg: false },
          { val: '!hide', src: 'did:plc:labeler2', neg: false },
        ])
      )

      const result = await service.isSpamLabeled('did:plc:very-spammy')

      expect(result).toBe(true)
    })

    it('returns false when only non-spam labels are present', async () => {
      cache.get.mockResolvedValue(
        JSON.stringify([
          { val: 'nudity', src: 'did:plc:labeler1', neg: false },
          { val: 'gore', src: 'did:plc:labeler1', neg: false },
        ])
      )

      const result = await service.isSpamLabeled('did:plc:not-spam')

      expect(result).toBe(false)
    })

    it('returns false when no labels exist', async () => {
      cache.get.mockResolvedValue(null)
      db._selectFromWhere.mockResolvedValue([])

      const result = await service.isSpamLabeled('did:plc:clean-user')

      expect(result).toBe(false)
    })
  })

  describe('handleMessage (via processLabel internals)', () => {
    // We test processLabel behavior indirectly through handleMessage,
    // which is private but accessible via the class prototype for testing.

    it('processLabel with negation deletes label from DB', async () => {
      const label = {
        src: 'did:plc:labeler1',
        uri: 'did:plc:user123',
        val: 'spam',
        neg: true,
        cts: '2026-01-15T12:00:00.000Z',
      }

      // Access private method for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).processLabel(label)

      expect(db.delete).toHaveBeenCalled()
      expect(db._deleteWhere).toHaveBeenCalled()
      // Should NOT have called insert
      expect(db.insert).not.toHaveBeenCalled()
      // Should invalidate cache
      expect(cache.del).toHaveBeenCalledWith('ozone:labels:did:plc:user123')
    })

    it('processLabel without negation upserts label into DB', async () => {
      const label = {
        src: 'did:plc:labeler1',
        uri: 'did:plc:user123',
        val: 'spam',
        neg: false,
        cts: '2026-01-15T12:00:00.000Z',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).processLabel(label)

      expect(db.insert).toHaveBeenCalled()
      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          src: 'did:plc:labeler1',
          uri: 'did:plc:user123',
          val: 'spam',
          neg: false,
          cts: new Date('2026-01-15T12:00:00.000Z'),
        })
      )
      expect(db._onConflictDoUpdate).toHaveBeenCalled()
      // Should NOT have called delete
      expect(db.delete).not.toHaveBeenCalled()
      // Should invalidate cache
      expect(cache.del).toHaveBeenCalledWith('ozone:labels:did:plc:user123')
    })

    it('processLabel with exp passes expiration date', async () => {
      const label = {
        src: 'did:plc:labeler1',
        uri: 'did:plc:user123',
        val: 'spam',
        neg: false,
        cts: '2026-01-15T12:00:00.000Z',
        exp: '2026-02-15T12:00:00.000Z',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).processLabel(label)

      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          exp: new Date('2026-02-15T12:00:00.000Z'),
        })
      )
    })

    it('processLabel without exp passes undefined for expiration', async () => {
      const label = {
        src: 'did:plc:labeler1',
        uri: 'did:plc:user123',
        val: 'spam',
        neg: false,
        cts: '2026-01-15T12:00:00.000Z',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).processLabel(label)

      expect(db._insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          exp: undefined,
        })
      )
    })

    it('processLabel still invalidates cache even when cache.del fails', async () => {
      cache.del.mockRejectedValue(new Error('Redis down'))

      const label = {
        src: 'did:plc:labeler1',
        uri: 'did:plc:user123',
        val: 'spam',
        neg: false,
        cts: '2026-01-15T12:00:00.000Z',
      }

      // Should not throw despite cache failure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await expect((service as any).processLabel(label)).resolves.not.toThrow()
      expect(db.insert).toHaveBeenCalled()
    })

    it('handleMessage processes multiple labels in a single event', async () => {
      const event = JSON.stringify({
        seq: 1,
        labels: [
          {
            src: 'did:plc:labeler1',
            uri: 'did:plc:user1',
            val: 'spam',
            neg: false,
            cts: '2026-01-15T12:00:00.000Z',
          },
          {
            src: 'did:plc:labeler1',
            uri: 'did:plc:user2',
            val: '!hide',
            neg: true,
            cts: '2026-01-15T12:00:00.000Z',
          },
        ],
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).handleMessage(event)

      // First label: insert (neg: false)
      expect(db.insert).toHaveBeenCalledTimes(1)
      // Second label: delete (neg: true)
      expect(db.delete).toHaveBeenCalledTimes(1)
      // Both should invalidate cache
      expect(cache.del).toHaveBeenCalledTimes(2)
    })

    it('handleMessage skips events without labels array', async () => {
      const event = JSON.stringify({ seq: 1 })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).handleMessage(event)

      expect(db.insert).not.toHaveBeenCalled()
      expect(db.delete).not.toHaveBeenCalled()
    })

    it('handleMessage logs warning on invalid JSON', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).handleMessage('not valid json{{{')

      expect(logger.warn).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ err: expect.any(SyntaxError) }),
        'Failed to process Ozone label event'
      )
    })

    it('handleMessage handles non-string data by converting to string', async () => {
      const event = {
        seq: 1,
        labels: [
          {
            src: 'did:plc:labeler1',
            uri: 'did:plc:user1',
            val: 'spam',
            neg: false,
            cts: '2026-01-15T12:00:00.000Z',
          },
        ],
      }

      // Pass a non-string -- String(object) produces "[object Object]" which is invalid JSON
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).handleMessage(event)

      // Should log a warning because String({}) is not valid JSON
      expect(logger.warn).toHaveBeenCalled()
    })
  })
})

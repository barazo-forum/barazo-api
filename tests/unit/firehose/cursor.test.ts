import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CursorStore } from '../../../src/firehose/cursor.js'

function createMockDb() {
  return {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  }
}

describe('CursorStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getCursor', () => {
    it('returns null when no cursor exists', async () => {
      const mockDb = createMockDb()
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })
      const store = new CursorStore(mockDb as never)
      const cursor = await store.getCursor()
      expect(cursor).toBeNull()
    })

    it('returns cursor value when it exists', async () => {
      const mockDb = createMockDb()
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ cursor: 42n }]),
        }),
      })
      const store = new CursorStore(mockDb as never)
      const cursor = await store.getCursor()
      expect(cursor).toBe(42n)
    })
  })

  describe('saveCursor', () => {
    it('debounces writes', async () => {
      const mockDb = createMockDb()
      const setFn = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setFn })
      const store = new CursorStore(mockDb as never, 5000)

      // Multiple rapid saves should not trigger immediate writes
      store.saveCursor(1n)
      store.saveCursor(2n)
      store.saveCursor(3n)

      // No write yet (debounced)
      expect(mockDb.update).not.toHaveBeenCalled()

      // After debounce period, only the latest value should be written
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockDb.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('flush', () => {
    it('force-writes the current cursor value', async () => {
      const mockDb = createMockDb()
      const setFn = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setFn })
      const store = new CursorStore(mockDb as never, 5000)

      store.saveCursor(10n)
      expect(mockDb.update).not.toHaveBeenCalled()

      await store.flush()
      expect(mockDb.update).toHaveBeenCalledTimes(1)
    })

    it('is a no-op if no cursor was saved', async () => {
      const mockDb = createMockDb()
      const store = new CursorStore(mockDb as never, 5000)
      await store.flush()
      expect(mockDb.update).not.toHaveBeenCalled()
    })
  })
})

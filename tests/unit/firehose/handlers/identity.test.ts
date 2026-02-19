import { describe, it, expect, vi } from 'vitest'
import { IdentityHandler } from '../../../../src/firehose/handlers/identity.js'
import type { IdentityEvent } from '../../../../src/firehose/types.js'

function createMockDb() {
  return {
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
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
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const mockTx = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }
      return fn(mockTx)
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

describe('IdentityHandler', () => {
  describe('deleted status', () => {
    it('purges all data for the DID in a transaction', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const handler = new IdentityHandler(db as never, logger as never)

      const event: IdentityEvent = {
        id: 1,
        did: 'did:plc:deleted',
        handle: 'deleted.bsky.social',
        isActive: false,
        status: 'deleted',
      }

      await handler.handle(event)

      expect(db.transaction).toHaveBeenCalledTimes(1)
      expect(logger.info).toHaveBeenCalled()
    })
  })

  describe('active status', () => {
    it('upserts user with handle', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const handler = new IdentityHandler(db as never, logger as never)

      const event: IdentityEvent = {
        id: 2,
        did: 'did:plc:active',
        handle: 'active.bsky.social',
        isActive: true,
        status: 'active',
      }

      await handler.handle(event)

      expect(db.insert).toHaveBeenCalledTimes(1)
    })
  })

  describe('deactivated status', () => {
    it('logs the status change', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const handler = new IdentityHandler(db as never, logger as never)

      const event: IdentityEvent = {
        id: 3,
        did: 'did:plc:deactivated',
        handle: 'deactivated.bsky.social',
        isActive: false,
        status: 'deactivated',
      }

      await handler.handle(event)

      expect(logger.info).toHaveBeenCalled()
    })
  })

  describe('takendown status', () => {
    it('logs the status change', async () => {
      const db = createMockDb()
      const logger = createMockLogger()
      const handler = new IdentityHandler(db as never, logger as never)

      const event: IdentityEvent = {
        id: 4,
        did: 'did:plc:takendown',
        handle: 'takendown.bsky.social',
        isActive: false,
        status: 'takendown',
      }

      await handler.handle(event)

      expect(logger.info).toHaveBeenCalled()
    })
  })
})

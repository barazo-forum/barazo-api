import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FirehoseService } from '../../../src/firehose/service.js'
import type { Env } from '../../../src/config/env.js'

// Mock the Tap and SimpleIndexer from @atproto/tap
vi.mock('@atproto/tap', () => {
  const mockChannel = {
    start: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  }

  class MockTap {
    addRepos = vi.fn().mockResolvedValue(undefined)
    removeRepos = vi.fn().mockResolvedValue(undefined)
    channel = vi.fn().mockReturnValue(mockChannel)
  }

  class MockSimpleIndexer {
    identity = vi.fn().mockReturnThis()
    record = vi.fn().mockReturnThis()
    error = vi.fn().mockReturnThis()
  }

  return {
    Tap: MockTap,
    SimpleIndexer: MockSimpleIndexer,
    _mockChannel: mockChannel,
  }
})

function createMockDb() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
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
    transaction: vi.fn(),
  }
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
}

function createMinimalEnv(): Env {
  return {
    DATABASE_URL: 'postgresql://barazo:barazo_dev@localhost:5432/barazo',
    VALKEY_URL: 'redis://localhost:6379',
    TAP_URL: 'http://localhost:2480',
    TAP_ADMIN_PASSWORD: 'test_secret',
    HOST: '0.0.0.0',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: 'http://localhost:3001',
    COMMUNITY_MODE: 'single' as const,
    COMMUNITY_NAME: 'Test Community',
    RATE_LIMIT_AUTH: 10,
    RATE_LIMIT_WRITE: 10,
    RATE_LIMIT_READ_ANON: 100,
    RATE_LIMIT_READ_AUTH: 300,
  }
}

describe('FirehoseService', () => {
  let db: ReturnType<typeof createMockDb>
  let logger: ReturnType<typeof createMockLogger>
  let env: Env

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMockDb()
    logger = createMockLogger()
    env = createMinimalEnv()
  })

  describe('lifecycle', () => {
    it('creates a service instance', () => {
      const service = new FirehoseService(db as never, logger as never, env)
      expect(service).toBeDefined()
    })

    it('starts without throwing', async () => {
      // Mock restoreTrackedRepos to find no repos
      db.select.mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      })

      const service = new FirehoseService(db as never, logger as never, env)
      await expect(service.start()).resolves.toBeUndefined()
    })

    it('stops without throwing', async () => {
      db.select.mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      })

      const service = new FirehoseService(db as never, logger as never, env)
      await service.start()
      await expect(service.stop()).resolves.toBeUndefined()
    })
  })

  describe('getStatus', () => {
    it('returns status before start', () => {
      const service = new FirehoseService(db as never, logger as never, env)
      const status = service.getStatus()
      expect(status.connected).toBe(false)
      expect(status.lastEventId).toBeNull()
    })

    it('returns connected status after start', async () => {
      db.select.mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      })

      const service = new FirehoseService(db as never, logger as never, env)
      await service.start()
      const status = service.getStatus()
      expect(status.connected).toBe(true)
    })
  })

  describe('error handling', () => {
    it('does not throw when start fails', async () => {
      // Make restoreTrackedRepos fail
      db.select.mockReturnValue({
        from: vi.fn().mockRejectedValue(new Error('DB down')),
      })

      const service = new FirehoseService(db as never, logger as never, env)
      // start() should catch errors internally
      await expect(service.start()).resolves.toBeUndefined()
      expect(logger.error).toHaveBeenCalled()
    })
  })
})

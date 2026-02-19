import { describe, it, expect, vi } from 'vitest'
import { RepoManager } from '../../../src/firehose/repo-manager.js'

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    }),
  }
}

function createMockTap() {
  return {
    addRepos: vi.fn<(dids: string[]) => Promise<void>>().mockResolvedValue(undefined),
    removeRepos: vi.fn<(dids: string[]) => Promise<void>>().mockResolvedValue(undefined),
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

describe('RepoManager', () => {
  describe('trackRepo', () => {
    it('inserts into tracked_repos and calls tap.addRepos', async () => {
      const db = createMockDb()
      const tap = createMockTap()
      const logger = createMockLogger()
      const manager = new RepoManager(db as never, tap, logger as never)

      await manager.trackRepo('did:plc:test')

      expect(db.insert).toHaveBeenCalledTimes(1)
      expect(tap.addRepos).toHaveBeenCalledWith(['did:plc:test'])
    })
  })

  describe('untrackRepo', () => {
    it('deletes from tracked_repos and calls tap.removeRepos', async () => {
      const db = createMockDb()
      const tap = createMockTap()
      const logger = createMockLogger()
      const manager = new RepoManager(db as never, tap, logger as never)

      await manager.untrackRepo('did:plc:test')

      expect(db.delete).toHaveBeenCalledTimes(1)
      expect(tap.removeRepos).toHaveBeenCalledWith(['did:plc:test'])
    })
  })

  describe('restoreTrackedRepos', () => {
    it('loads all DIDs and calls addRepos in batches', async () => {
      const db = createMockDb()
      const dids = Array.from({ length: 150 }, (_, i) => ({
        did: `did:plc:user${String(i)}`,
      }))
      db.select.mockReturnValue({
        from: vi.fn().mockResolvedValue(dids),
      })

      const tap = createMockTap()
      const logger = createMockLogger()
      const manager = new RepoManager(db as never, tap, logger as never)

      await manager.restoreTrackedRepos()

      expect(tap.addRepos).toHaveBeenCalledTimes(2)
      const firstCall = tap.addRepos.mock.calls[0] as [string[]]
      expect(firstCall[0]).toHaveLength(100)
      const secondCall = tap.addRepos.mock.calls[1] as [string[]]
      expect(secondCall[0]).toHaveLength(50)
    })

    it('does nothing when no repos are tracked', async () => {
      const db = createMockDb()
      const tap = createMockTap()
      const logger = createMockLogger()
      const manager = new RepoManager(db as never, tap, logger as never)

      await manager.restoreTrackedRepos()

      expect(tap.addRepos).not.toHaveBeenCalled()
    })
  })

  describe('isTracked', () => {
    it('returns true when DID is tracked', async () => {
      const db = createMockDb()
      db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ did: 'did:plc:test' }]),
        }),
      })
      const tap = createMockTap()
      const logger = createMockLogger()
      const manager = new RepoManager(db as never, tap, logger as never)

      const result = await manager.isTracked('did:plc:test')
      expect(result).toBe(true)
    })

    it('returns false when DID is not tracked', async () => {
      const db = createMockDb()
      db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })
      const tap = createMockTap()
      const logger = createMockLogger()
      const manager = new RepoManager(db as never, tap, logger as never)

      const result = await manager.isTracked('did:plc:unknown')
      expect(result).toBe(false)
    })
  })
})

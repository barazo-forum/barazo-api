import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTrustGraphService } from '../../../src/services/trust-graph.js'
import type { TrustGraphService } from '../../../src/services/trust-graph.js'

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
}

// ---------------------------------------------------------------------------
// Mock DB helpers
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  }
}

function makeChain(result: unknown = []) {
  const thenFn = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)

  // Terminal: an object that acts as a thenable but is not a Promise
  const terminal = vi.fn().mockImplementation(() => ({ then: thenFn }))

  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = terminal
  chain.values = vi.fn().mockReturnValue(chain)
  chain.onConflictDoUpdate = terminal
  chain.onConflictDoNothing = terminal
  chain.set = vi.fn().mockReturnValue(chain)
  chain.orderBy = terminal
  chain.limit = terminal
  chain.returning = terminal

  return chain
}

describe('TrustGraphService', () => {
  let service: TrustGraphService
  let mockDb: ReturnType<typeof createMockDb>
  let logger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    mockDb = createMockDb()
    logger = createMockLogger()
    service = createTrustGraphService(mockDb as never, logger as never)
  })

  describe('computeTrustScores', () => {
    it('should converge on a simple known graph', async () => {
      // Graph: A->B (weight 2), B->C (weight 1), A->C (weight 1)
      // Seeds: A
      // Expected: A has high trust (seed), B has moderate trust, C has some trust
      const interactionRows = [
        { source_did: 'did:a', target_did: 'did:b', weight: 2 },
        { source_did: 'did:b', target_did: 'did:c', weight: 1 },
        { source_did: 'did:a', target_did: 'did:c', weight: 1 },
      ]

      const seedRows = [{ did: 'did:a' }]
      const adminRows: never[] = []

      // Mock: select interaction_graph
      const interactionChain = makeChain(interactionRows)
      const seedChain = makeChain(seedRows)
      const adminChain = makeChain(adminRows)
      const upsertChain = makeChain()

      let selectCallCount = 0
      mockDb.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return interactionChain
        if (selectCallCount === 2) return seedChain
        return adminChain
      })

      mockDb.insert.mockReturnValue(upsertChain)

      const result = await service.computeTrustScores('community1')

      expect(result.totalNodes).toBe(3)
      expect(result.totalEdges).toBe(3)
      expect(result.converged).toBe(true)
      expect(result.iterations).toBeLessThanOrEqual(20)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should handle empty graph', async () => {
      const emptyChain = makeChain([])
      mockDb.select.mockReturnValue(emptyChain)

      const result = await service.computeTrustScores('community1')

      expect(result.totalNodes).toBe(0)
      expect(result.totalEdges).toBe(0)
      expect(result.converged).toBe(true)
    })

    it('should handle graph with no seeds', async () => {
      const interactionRows = [{ source_did: 'did:a', target_did: 'did:b', weight: 1 }]

      const interactionChain = makeChain(interactionRows)
      const emptyChain = makeChain([])
      const upsertChain = makeChain()

      let selectCallCount = 0
      mockDb.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return interactionChain
        return emptyChain
      })
      mockDb.insert.mockReturnValue(upsertChain)

      const result = await service.computeTrustScores('community1')

      // With no seeds, all trust should remain at 0
      expect(result.totalNodes).toBe(2)
      expect(result.converged).toBe(true)
    })

    it('should respect max 20 iterations', async () => {
      // Create a cyclic graph that might not converge easily
      const interactionRows = [
        { source_did: 'did:a', target_did: 'did:b', weight: 1 },
        { source_did: 'did:b', target_did: 'did:a', weight: 1 },
      ]
      const seedRows = [{ did: 'did:a' }]

      const interactionChain = makeChain(interactionRows)
      const seedChain = makeChain(seedRows)
      const adminChain = makeChain([])
      const upsertChain = makeChain()

      let selectCallCount = 0
      mockDb.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return interactionChain
        if (selectCallCount === 2) return seedChain
        return adminChain
      })
      mockDb.insert.mockReturnValue(upsertChain)

      const result = await service.computeTrustScores('community1')

      expect(result.iterations).toBeLessThanOrEqual(20)
    })
  })

  describe('getTrustScore', () => {
    it('should return score from trust_scores table', async () => {
      const chain = makeChain([{ score: 0.75 }])
      mockDb.select.mockReturnValue(chain)

      const score = await service.getTrustScore('did:plc:abc', 'community1')

      expect(score).toBe(0.75)
    })

    it('should return default 0.1 when no score found', async () => {
      const chain = makeChain([])
      mockDb.select.mockReturnValue(chain)

      const score = await service.getTrustScore('did:plc:unknown', 'community1')

      expect(score).toBe(0.1)
    })
  })
})

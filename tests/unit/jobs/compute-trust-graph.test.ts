import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTrustGraphJob } from '../../../src/jobs/compute-trust-graph.js'
import type { TrustGraphJob } from '../../../src/jobs/compute-trust-graph.js'

// ---------------------------------------------------------------------------
// Helpers
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

function createMockTrustGraphService() {
  return {
    computeTrustScores: vi.fn().mockResolvedValue({
      totalNodes: 10,
      totalEdges: 20,
      iterations: 5,
      converged: true,
      durationMs: 42,
    }),
    getTrustScore: vi.fn().mockResolvedValue(0.5),
  }
}

function createMockSybilDetectorService() {
  return {
    detectClusters: vi.fn().mockResolvedValue({
      clustersDetected: 1,
      totalLowTrustDids: 5,
      durationMs: 15,
    }),
  }
}

function createMockBehavioralHeuristicsService() {
  return {
    detectBurstVoting: vi.fn().mockResolvedValue([]),
    detectContentSimilarity: vi.fn().mockResolvedValue([]),
    detectLowDiversity: vi.fn().mockResolvedValue([]),
    runAll: vi.fn().mockResolvedValue([]),
  }
}

describe('TrustGraphJob', () => {
  let job: TrustGraphJob
  let trustGraphService: ReturnType<typeof createMockTrustGraphService>
  let sybilDetectorService: ReturnType<typeof createMockSybilDetectorService>
  let behavioralHeuristicsService: ReturnType<typeof createMockBehavioralHeuristicsService>
  let logger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    logger = createMockLogger()
    trustGraphService = createMockTrustGraphService()
    sybilDetectorService = createMockSybilDetectorService()
    behavioralHeuristicsService = createMockBehavioralHeuristicsService()
    job = createTrustGraphJob(
      trustGraphService as never,
      sybilDetectorService as never,
      behavioralHeuristicsService as never,
      logger as never
    )
  })

  describe('run', () => {
    it('should orchestrate trust computation, behavioral heuristics, and sybil detection', async () => {
      const result = await job.run('community1')

      expect(trustGraphService.computeTrustScores).toHaveBeenCalledWith('community1')
      expect(behavioralHeuristicsService.runAll).toHaveBeenCalledWith('community1')
      expect(sybilDetectorService.detectClusters).toHaveBeenCalledWith('community1')
      expect(result.trustComputation.totalNodes).toBe(10)
      expect(result.behavioralFlags).toEqual([])
      expect(result.sybilDetection.clustersDetected).toBe(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should orchestrate with null communityId for global computation', async () => {
      const result = await job.run(null)

      expect(trustGraphService.computeTrustScores).toHaveBeenCalledWith(null)
      expect(behavioralHeuristicsService.runAll).toHaveBeenCalledWith(null)
      expect(sybilDetectorService.detectClusters).toHaveBeenCalledWith(null)
      expect(result.trustComputation.converged).toBe(true)
    })

    it('should log errors on failure', async () => {
      const error = new Error('DB connection failed')
      trustGraphService.computeTrustScores.mockRejectedValueOnce(error)

      await expect(job.run('community1')).rejects.toThrow('DB connection failed')
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('getStatus', () => {
    it('should return idle status before any run', () => {
      const status = job.getStatus()

      expect(status.state).toBe('idle')
      expect(status.lastComputedAt).toBeNull()
    })

    it('should return completed status after successful run', async () => {
      await job.run('community1')

      const status = job.getStatus()

      expect(status.state).toBe('completed')
      expect(status.lastComputedAt).toBeInstanceOf(Date)
      expect(status.lastDurationMs).toBeGreaterThanOrEqual(0)
    })
  })
})

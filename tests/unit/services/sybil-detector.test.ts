import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSybilDetectorService } from "../../../src/services/sybil-detector.js";
import type { SybilDetectorService } from "../../../src/services/sybil-detector.js";

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
  };
}

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
}

function makeChain(result: unknown = []) {
  const thenFn = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);

  const terminal = vi.fn().mockImplementation(() => ({ then: thenFn }));
  const returningFn = vi.fn().mockImplementation(() => ({ then: thenFn }));

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = terminal;
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = vi.fn().mockImplementation(() => ({ then: thenFn, returning: returningFn }));
  chain.onConflictDoNothing = terminal;
  chain.set = vi.fn().mockReturnValue(chain);
  chain.orderBy = terminal;
  chain.limit = terminal;
  chain.returning = returningFn;

  return chain;
}

describe("SybilDetectorService", () => {
  let service: SybilDetectorService;
  let mockDb: ReturnType<typeof createMockDb>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    logger = createMockLogger();
    service = createSybilDetectorService(mockDb as never, logger as never);
  });

  describe("detectClusters", () => {
    it("should detect a planted sybil cluster", async () => {
      // Low-trust DIDs (score < 0.05)
      const lowTrustRows = [
        { did: "did:sybil1" },
        { did: "did:sybil2" },
        { did: "did:sybil3" },
        { did: "did:sybil4" },
      ];

      // Dense internal edges among sybils
      const subgraphRows = [
        { source_did: "did:sybil1", target_did: "did:sybil2", weight: 5 },
        { source_did: "did:sybil1", target_did: "did:sybil3", weight: 3 },
        { source_did: "did:sybil2", target_did: "did:sybil3", weight: 4 },
        { source_did: "did:sybil2", target_did: "did:sybil4", weight: 2 },
        { source_did: "did:sybil3", target_did: "did:sybil4", weight: 3 },
        { source_did: "did:sybil4", target_did: "did:sybil1", weight: 2 },
      ];

      // All edges involving these DIDs (high internal ratio)
      const allEdgesRows = [
        ...subgraphRows,
        { source_did: "did:sybil1", target_did: "did:legit1", weight: 1 },
      ];

      // No existing dismissed clusters
      const existingClusters: never[] = [];

      const lowTrustChain = makeChain(lowTrustRows);
      const subgraphChain = makeChain(subgraphRows);
      const allEdgesChain = makeChain(allEdgesRows);
      const existingClusterChain = makeChain(existingClusters);
      const insertChain = makeChain([{ id: 1 }]);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return lowTrustChain;
        if (selectCallCount === 2) return subgraphChain;
        if (selectCallCount === 3) return allEdgesChain;
        return existingClusterChain;
      });

      mockDb.insert.mockReturnValue(insertChain);
      mockDb.delete.mockReturnValue(makeChain());

      const result = await service.detectClusters("community1");

      expect(result.clustersDetected).toBeGreaterThanOrEqual(1);
      expect(result.totalLowTrustDids).toBe(4);
    });

    it("should not flag when no low-trust DIDs exist", async () => {
      const emptyChain = makeChain([]);
      mockDb.select.mockReturnValue(emptyChain);

      const result = await service.detectClusters("community1");

      expect(result.clustersDetected).toBe(0);
      expect(result.totalLowTrustDids).toBe(0);
    });

    it("should skip components with fewer than 3 members", async () => {
      const lowTrustRows = [
        { did: "did:sybil1" },
        { did: "did:sybil2" },
      ];

      const subgraphRows = [
        { source_did: "did:sybil1", target_did: "did:sybil2", weight: 5 },
      ];

      const lowTrustChain = makeChain(lowTrustRows);
      const subgraphChain = makeChain(subgraphRows);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return lowTrustChain;
        return subgraphChain;
      });

      const result = await service.detectClusters("community1");

      expect(result.clustersDetected).toBe(0);
    });
  });
});

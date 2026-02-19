import type { Logger } from "../lib/logger.js";
import type { TrustGraphService, TrustComputationResult } from "../services/trust-graph.js";
import type { SybilDetectorService, DetectionResult } from "../services/sybil-detector.js";
import type { BehavioralHeuristicsService, BehavioralFlag } from "../services/behavioral-heuristics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobResult {
  trustComputation: TrustComputationResult;
  behavioralFlags: BehavioralFlag[];
  sybilDetection: DetectionResult;
  durationMs: number;
}

export type JobState = "idle" | "running" | "completed" | "failed";

export interface JobStatus {
  state: JobState;
  lastComputedAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export interface TrustGraphJob {
  run(communityId: string | null): Promise<JobResult>;
  getStatus(): JobStatus;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTrustGraphJob(
  trustGraphService: TrustGraphService,
  sybilDetectorService: SybilDetectorService,
  behavioralHeuristicsService: BehavioralHeuristicsService,
  logger: Logger,
): TrustGraphJob {
  let state: JobState = "idle";
  let lastComputedAt: Date | null = null;
  let lastDurationMs: number | null = null;
  let lastError: string | null = null;

  async function run(communityId: string | null): Promise<JobResult> {
    const start = Date.now();
    state = "running";

    logger.info({ communityId }, "Starting trust graph computation job");

    try {
      // Step 1: Compute trust scores (EigenTrust)
      const trustComputation =
        await trustGraphService.computeTrustScores(communityId);

      logger.info(
        {
          communityId,
          nodes: trustComputation.totalNodes,
          edges: trustComputation.totalEdges,
          converged: trustComputation.converged,
          iterations: trustComputation.iterations,
        },
        "Trust computation phase completed",
      );

      // Step 2: Run behavioral heuristics
      const behavioralFlags =
        await behavioralHeuristicsService.runAll(communityId);

      logger.info(
        {
          communityId,
          flagsDetected: behavioralFlags.length,
        },
        "Behavioral heuristics phase completed",
      );

      // Step 3: Detect sybil clusters
      const sybilDetection =
        await sybilDetectorService.detectClusters(communityId);

      logger.info(
        {
          communityId,
          clustersDetected: sybilDetection.clustersDetected,
          lowTrustDids: sybilDetection.totalLowTrustDids,
        },
        "Sybil detection phase completed",
      );

      const durationMs = Date.now() - start;
      state = "completed";
      lastComputedAt = new Date();
      lastDurationMs = durationMs;
      lastError = null;

      logger.info(
        { communityId, durationMs },
        "Trust graph computation job completed",
      );

      return { trustComputation, behavioralFlags, sybilDetection, durationMs };
    } catch (err) {
      state = "failed";
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      lastError = errorMessage;

      logger.error(
        { communityId, err },
        "Trust graph computation job failed",
      );

      throw err;
    }
  }

  function getStatus(): JobStatus {
    return {
      state,
      lastComputedAt,
      lastDurationMs,
      lastError,
    };
  }

  return { run, getStatus };
}

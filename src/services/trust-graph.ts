import { eq, and, sql, or, inArray } from "drizzle-orm";
import type { Database } from "../db/index.js";
import type { Logger } from "../lib/logger.js";
import { interactionGraph } from "../db/schema/interaction-graph.js";
import { trustSeeds } from "../db/schema/trust-seeds.js";
import { trustScores } from "../db/schema/trust-scores.js";
import { users } from "../db/schema/users.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrustComputationResult {
  totalNodes: number;
  totalEdges: number;
  iterations: number;
  converged: boolean;
  durationMs: number;
}

export interface TrustGraphService {
  computeTrustScores(
    communityId: string | null,
  ): Promise<TrustComputationResult>;
  getTrustScore(did: string, communityId: string | null): Promise<number>;
}

// ---------------------------------------------------------------------------
// Pure EigenTrust implementation (exported for simulation tests)
// ---------------------------------------------------------------------------

type Edge = { target: string; weight: number };

interface EigenTrustResult {
  scores: Map<string, number>;
  iterations: number;
  converged: boolean;
}

/**
 * Run the EigenTrust algorithm on an in-memory graph.
 *
 * @param edges - Adjacency list: source DID -> list of {target, weight}
 * @param seedDids - Set of seed DIDs (initial trust = 1.0)
 * @param maxIterations - Maximum number of iterations
 * @param convergenceThreshold - Stop when max change < this value
 * @returns Trust scores map and convergence metadata
 */
export function runEigenTrust(
  edges: Map<string, Edge[]>,
  seedDids: Set<string>,
  maxIterations: number,
  convergenceThreshold: number,
): Map<string, number>;
export function runEigenTrust(
  edges: Map<string, Edge[]>,
  seedDids: Set<string>,
  maxIterations: number,
  convergenceThreshold: number,
  returnMetadata: true,
): EigenTrustResult;
export function runEigenTrust(
  edges: Map<string, Edge[]>,
  seedDids: Set<string>,
  maxIterations: number,
  convergenceThreshold: number,
  returnMetadata?: boolean,
): Map<string, number> | EigenTrustResult {
  // Collect all nodes
  const allNodes = new Set<string>();
  for (const [source, targets] of edges) {
    allNodes.add(source);
    for (const { target } of targets) {
      allNodes.add(target);
    }
  }

  if (allNodes.size === 0) {
    const empty = new Map<string, number>();
    if (returnMetadata) {
      return { scores: empty, iterations: 0, converged: true };
    }
    return empty;
  }

  // Initialize trust: seeds = 1.0, others = 0.0
  const trust = new Map<string, number>();
  const seedTrust = new Map<string, number>();
  for (const node of allNodes) {
    const isSeed = seedDids.has(node);
    trust.set(node, isSeed ? 1.0 : 0.0);
    seedTrust.set(node, isSeed ? 1.0 : 0.0);
  }

  // If no seeds, all trust remains at 0
  if (seedDids.size === 0) {
    if (returnMetadata) {
      return { scores: trust, iterations: 0, converged: true };
    }
    return trust;
  }

  // Compute total outgoing weight per node
  const totalOutgoing = new Map<string, number>();
  for (const [source, targets] of edges) {
    let total = 0;
    for (const { weight } of targets) {
      total += weight;
    }
    totalOutgoing.set(source, total);
  }

  // Build incoming edges: target -> [{source, weight}]
  const incoming = new Map<string, { source: string; weight: number }[]>();
  for (const [source, targets] of edges) {
    for (const { target, weight } of targets) {
      const existing = incoming.get(target);
      if (existing) {
        existing.push({ source, weight });
      } else {
        incoming.set(target, [{ source, weight }]);
      }
    }
  }

  // Iterate with double-buffering: read from previous iteration, write to new map
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    let maxChange = 0;
    const nextTrust = new Map<string, number>();

    for (const node of allNodes) {
      const seed = seedTrust.get(node) ?? 0;
      let incomingTrust = 0;

      const inEdges = incoming.get(node);
      if (inEdges) {
        for (const { source, weight } of inEdges) {
          const sourceTrust = trust.get(source) ?? 0;
          const sourceOutgoing = totalOutgoing.get(source) ?? 1;
          incomingTrust += sourceTrust * (weight / sourceOutgoing);
        }
      }

      const newTrust = 0.5 * seed + 0.5 * incomingTrust;
      const oldTrust = trust.get(node) ?? 0;
      const change = Math.abs(newTrust - oldTrust);
      if (change > maxChange) maxChange = change;

      nextTrust.set(node, newTrust);
    }

    // Swap: copy nextTrust into trust for next iteration
    for (const [node, score] of nextTrust) {
      trust.set(node, score);
    }

    if (maxChange < convergenceThreshold) {
      converged = true;
      break;
    }
  }

  if (returnMetadata) {
    return { scores: trust, iterations, converged };
  }
  return trust;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_TRUST_SCORE = 0.1;
const MAX_ITERATIONS = 20;
const CONVERGENCE_THRESHOLD = 0.001;

export function createTrustGraphService(
  db: Database,
  logger: Logger,
): TrustGraphService {
  async function computeTrustScores(
    communityId: string | null,
  ): Promise<TrustComputationResult> {
    const start = Date.now();

    // 1. Load interaction graph edges
    const communityFilter = communityId
      ? eq(interactionGraph.communityId, communityId)
      : sql`true`;

    const edgeRows = await db
      .select({
        source_did: interactionGraph.sourceDid,
        target_did: interactionGraph.targetDid,
        weight: interactionGraph.weight,
      })
      .from(interactionGraph)
      .where(communityFilter);

    if (edgeRows.length === 0) {
      logger.info(
        { communityId },
        "No edges found, skipping trust computation",
      );
      return {
        totalNodes: 0,
        totalEdges: 0,
        iterations: 0,
        converged: true,
        durationMs: Date.now() - start,
      };
    }

    // Build adjacency list
    const edges = new Map<string, Edge[]>();
    const allNodes = new Set<string>();

    for (const row of edgeRows) {
      allNodes.add(row.source_did);
      allNodes.add(row.target_did);
      const existing = edges.get(row.source_did);
      if (existing) {
        existing.push({ target: row.target_did, weight: row.weight });
      } else {
        edges.set(row.source_did, [{ target: row.target_did, weight: row.weight }]);
      }
    }

    // 2. Get trust seeds (empty string = global scope)
    const seedFilter = communityId
      ? or(
          eq(trustSeeds.communityId, communityId),
          eq(trustSeeds.communityId, ""),
        )
      : eq(trustSeeds.communityId, "");

    const seedRows = await db
      .select({ did: trustSeeds.did })
      .from(trustSeeds)
      .where(seedFilter);

    // Also include admins/moderators as seeds
    const adminRows = await db
      .select({ did: users.did })
      .from(users)
      .where(inArray(users.role, ["admin", "moderator"]));

    const seedDids = new Set<string>();
    for (const row of seedRows) {
      seedDids.add(row.did);
    }
    for (const row of adminRows) {
      seedDids.add(row.did);
    }

    // 3. Run EigenTrust
    const result = runEigenTrust(
      edges,
      seedDids,
      MAX_ITERATIONS,
      CONVERGENCE_THRESHOLD,
      true,
    );

    // 4. Upsert results to trust_scores (empty string = global scope)
    const effectiveCommunityId = communityId ?? "";
    for (const [did, score] of result.scores) {
      await db
        .insert(trustScores)
        .values({
          did,
          communityId: effectiveCommunityId,
          score,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [trustScores.did, trustScores.communityId],
          set: {
            score,
            computedAt: new Date(),
          },
        });
    }

    const durationMs = Date.now() - start;

    logger.info(
      {
        communityId,
        totalNodes: allNodes.size,
        totalEdges: edgeRows.length,
        iterations: result.iterations,
        converged: result.converged,
        durationMs,
      },
      "Trust computation completed",
    );

    return {
      totalNodes: allNodes.size,
      totalEdges: edgeRows.length,
      iterations: result.iterations,
      converged: result.converged,
      durationMs,
    };
  }

  async function getTrustScore(
    did: string,
    communityId: string | null,
  ): Promise<number> {
    const effectiveCommunityId = communityId ?? "";
    const filter = and(
      eq(trustScores.did, did),
      eq(trustScores.communityId, effectiveCommunityId),
    );

    const rows = await db
      .select({ score: trustScores.score })
      .from(trustScores)
      .where(filter);

    const row = rows[0];
    if (!row) {
      return DEFAULT_TRUST_SCORE;
    }

    return row.score;
  }

  return { computeTrustScores, getTrustScore };
}

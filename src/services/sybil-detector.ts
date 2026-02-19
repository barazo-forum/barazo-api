import { eq, and, sql, lt, or, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../db/index.js";
import type { Logger } from "../lib/logger.js";
import { interactionGraph } from "../db/schema/interaction-graph.js";
import { trustScores } from "../db/schema/trust-scores.js";
import { sybilClusters } from "../db/schema/sybil-clusters.js";
import { sybilClusterMembers } from "../db/schema/sybil-cluster-members.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectionResult {
  clustersDetected: number;
  totalLowTrustDids: number;
  durationMs: number;
}

export interface SybilDetectorService {
  detectClusters(communityId: string | null): Promise<DetectionResult>;
}

export interface ClusterInfo {
  members: string[];
  internalEdges: number;
  externalEdges: number;
  ratio: number;
}

// ---------------------------------------------------------------------------
// Pure cluster detection (exported for simulation tests)
// ---------------------------------------------------------------------------

type Edge = { target: string; weight: number };

/**
 * Find connected components of low-trust DIDs and identify sybil clusters.
 *
 * @param lowTrustDids - Set of DIDs with trust below threshold
 * @param subgraphEdges - Adjacency list of edges between low-trust DIDs (undirected)
 * @param allEdges - Full adjacency list (directed) for counting external edges
 * @param minSize - Minimum component size to consider (default 3)
 * @param ratioThreshold - Internal/(internal+external) ratio to flag (default 0.8)
 */
export function findSybilClusters(
  lowTrustDids: Set<string>,
  subgraphEdges: Map<string, Set<string>>,
  allEdges: Map<string, Edge[]>,
  minSize: number = 3,
  ratioThreshold: number = 0.8,
): ClusterInfo[] {
  // Find connected components using BFS
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const did of lowTrustDids) {
    if (visited.has(did)) continue;
    // Only start BFS from nodes that appear in the subgraph
    if (!subgraphEdges.has(did)) {
      visited.add(did);
      continue;
    }

    const component: string[] = [];
    const queue = [did];
    visited.add(did);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);

      const neighbors = subgraphEdges.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    if (component.length >= minSize) {
      components.push(component);
    }
  }

  // For each component, count internal vs external edges
  const clusters: ClusterInfo[] = [];

  for (const component of components) {
    const memberSet = new Set(component);
    let internalEdges = 0;
    let externalEdges = 0;

    for (const member of component) {
      const targets = allEdges.get(member);
      if (!targets) continue;
      for (const { target } of targets) {
        if (memberSet.has(target)) {
          internalEdges++;
        } else {
          externalEdges++;
        }
      }
    }

    const total = internalEdges + externalEdges;
    const ratio = total > 0 ? internalEdges / total : 0;

    if (ratio > ratioThreshold) {
      clusters.push({
        members: component,
        internalEdges,
        externalEdges,
        ratio,
      });
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const LOW_TRUST_THRESHOLD = 0.05;
const MIN_CLUSTER_SIZE = 3;
const INTERNAL_RATIO_THRESHOLD = 0.8;

export function createSybilDetectorService(
  db: Database,
  logger: Logger,
): SybilDetectorService {
  async function detectClusters(
    communityId: string | null,
  ): Promise<DetectionResult> {
    const start = Date.now();

    // 1. Find low-trust DIDs (empty string = global scope)
    const trustFilter = communityId
      ? and(
          lt(trustScores.score, LOW_TRUST_THRESHOLD),
          or(
            eq(trustScores.communityId, communityId),
            eq(trustScores.communityId, ""),
          ),
        )
      : and(
          lt(trustScores.score, LOW_TRUST_THRESHOLD),
          eq(trustScores.communityId, ""),
        );

    const lowTrustRows = await db
      .select({ did: trustScores.did })
      .from(trustScores)
      .where(trustFilter);

    const lowTrustDids = new Set(lowTrustRows.map((r) => r.did));

    if (lowTrustDids.size === 0) {
      logger.info(
        { communityId },
        "No low-trust DIDs found, skipping sybil detection",
      );
      return {
        clustersDetected: 0,
        totalLowTrustDids: 0,
        durationMs: Date.now() - start,
      };
    }

    // 2. Build subgraph of edges between low-trust DIDs
    const lowTrustArray = Array.from(lowTrustDids);
    const communityFilter = communityId
      ? eq(interactionGraph.communityId, communityId)
      : sql`true`;

    const subgraphRows = await db
      .select({
        source_did: interactionGraph.sourceDid,
        target_did: interactionGraph.targetDid,
        weight: interactionGraph.weight,
      })
      .from(interactionGraph)
      .where(
        and(
          communityFilter,
          inArray(interactionGraph.sourceDid, lowTrustArray),
          inArray(interactionGraph.targetDid, lowTrustArray),
        ),
      );

    // Build undirected subgraph adjacency
    const subgraphEdges = new Map<string, Set<string>>();
    for (const row of subgraphRows) {
      const sourceSet = subgraphEdges.get(row.source_did) ?? new Set<string>();
      sourceSet.add(row.target_did);
      subgraphEdges.set(row.source_did, sourceSet);

      const targetSet = subgraphEdges.get(row.target_did) ?? new Set<string>();
      targetSet.add(row.source_did);
      subgraphEdges.set(row.target_did, targetSet);
    }

    // 3. Load ALL edges involving low-trust DIDs (for internal/external ratio)
    const allEdgesRows = await db
      .select({
        source_did: interactionGraph.sourceDid,
        target_did: interactionGraph.targetDid,
        weight: interactionGraph.weight,
      })
      .from(interactionGraph)
      .where(
        and(
          communityFilter,
          or(
            inArray(interactionGraph.sourceDid, lowTrustArray),
            inArray(interactionGraph.targetDid, lowTrustArray),
          ),
        ),
      );

    // Build directed adjacency from low-trust sources
    const allEdges = new Map<string, Edge[]>();
    for (const row of allEdgesRows) {
      if (lowTrustDids.has(row.source_did)) {
        const existing = allEdges.get(row.source_did);
        if (existing) {
          existing.push({ target: row.target_did, weight: row.weight });
        } else {
          allEdges.set(row.source_did, [{ target: row.target_did, weight: row.weight }]);
        }
      }
    }

    // 4. Run cluster detection
    const clusterInfos = findSybilClusters(
      lowTrustDids,
      subgraphEdges,
      allEdges,
      MIN_CLUSTER_SIZE,
      INTERNAL_RATIO_THRESHOLD,
    );

    // 5. Upsert clusters to database
    let clustersDetected = 0;

    for (const cluster of clusterInfos) {
      const sortedMembers = [...cluster.members].sort();
      const clusterHash = createHash("sha256")
        .update(sortedMembers.join(","))
        .digest("hex");

      // Check if dismissed cluster exists with same hash
      const existingRows = await db
        .select({
          id: sybilClusters.id,
          status: sybilClusters.status,
        })
        .from(sybilClusters)
        .where(eq(sybilClusters.clusterHash, clusterHash));

      const existing = existingRows[0];
      if (existing?.status === "dismissed") {
        // Skip dismissed clusters unless members changed (hash handles this)
        continue;
      }

      // Upsert cluster
      const clusterRows = await db
        .insert(sybilClusters)
        .values({
          clusterHash,
          internalEdgeCount: cluster.internalEdges,
          externalEdgeCount: cluster.externalEdges,
          memberCount: cluster.members.length,
          status: "flagged",
          detectedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [sybilClusters.clusterHash],
          set: {
            internalEdgeCount: cluster.internalEdges,
            externalEdgeCount: cluster.externalEdges,
            memberCount: cluster.members.length,
            updatedAt: new Date(),
          },
        })
        .returning({ id: sybilClusters.id });

      const clusterId = clusterRows[0]?.id;
      if (clusterId == null) continue;

      // Compute median internal connections for core/peripheral classification
      const connectionCounts: number[] = [];
      for (const member of sortedMembers) {
        const neighbors = subgraphEdges.get(member);
        connectionCounts.push(neighbors?.size ?? 0);
      }
      connectionCounts.sort((a, b) => a - b);
      const median =
        connectionCounts[Math.floor(connectionCounts.length / 2)] ?? 0;

      // Delete existing members and re-insert
      await db
        .delete(sybilClusterMembers)
        .where(eq(sybilClusterMembers.clusterId, clusterId));

      for (const member of sortedMembers) {
        const neighbors = subgraphEdges.get(member);
        const count = neighbors?.size ?? 0;
        const role = count > median ? "core" : "peripheral";

        await db.insert(sybilClusterMembers).values({
          clusterId,
          did: member,
          roleInCluster: role,
          joinedAt: new Date(),
        });
      }

      clustersDetected++;
    }

    const durationMs = Date.now() - start;

    logger.info(
      {
        communityId,
        totalLowTrustDids: lowTrustDids.size,
        clustersDetected,
        durationMs,
      },
      "Sybil detection completed",
    );

    return {
      clustersDetected,
      totalLowTrustDids: lowTrustDids.size,
      durationMs,
    };
  }

  return { detectClusters };
}

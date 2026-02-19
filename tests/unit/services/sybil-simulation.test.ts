import { describe, it, expect } from "vitest";
import { runEigenTrust } from "../../../src/services/trust-graph.js";
import { findSybilClusters } from "../../../src/services/sybil-detector.js";
import type { ClusterInfo } from "../../../src/services/sybil-detector.js";

/**
 * Sybil attack simulation test.
 *
 * Scenario:
 * - 20 "real" accounts with diverse cross-interactions
 * - 10 "sybil" accounts interacting only with each other
 * - 3 trust seeds from real accounts
 *
 * Expected:
 * - Real accounts: trust > 0.3
 * - Sybil accounts: trust < 0.05
 * - Sybil cluster detected
 */
describe("Sybil attack simulation", () => {
  // Build the test graph in-memory
  const realDids = Array.from({ length: 20 }, (_, i) => `did:real${String(i)}`);
  const sybilDids = Array.from({ length: 10 }, (_, i) => `did:sybil${String(i)}`);
  const seed0 = realDids[0] ?? "did:real0";
  const seed1 = realDids[1] ?? "did:real1";
  const seed2 = realDids[2] ?? "did:real2";
  const seedDids = new Set([seed0, seed1, seed2]);

  // Build adjacency list: source -> [{target, weight}]
  type Edge = { target: string; weight: number };
  const edges: Map<string, Edge[]> = new Map();

  function addEdge(source: string, target: string, weight: number) {
    const existing = edges.get(source);
    if (existing) {
      existing.push({ target, weight });
    } else {
      edges.set(source, [{ target, weight }]);
    }
  }

  // Real accounts: diverse cross-interactions (each interacts with 5-8 others)
  for (let i = 0; i < realDids.length; i++) {
    const source = realDids[i] ?? "";
    for (let j = 1; j <= 5; j++) {
      const target = realDids[(i + j) % realDids.length] ?? "";
      addEdge(source, target, 2 + (j % 3));
    }
  }

  // Sybil accounts: dense internal interactions only
  for (let i = 0; i < sybilDids.length; i++) {
    const source = sybilDids[i] ?? "";
    for (let j = 0; j < sybilDids.length; j++) {
      if (i !== j) {
        const target = sybilDids[j] ?? "";
        addEdge(source, target, 3);
      }
    }
  }

  // One sybil tries to interact with one real account (minimal external link)
  addEdge(sybilDids[0] ?? "", realDids[19] ?? "", 1);

  it("should assign higher trust to real accounts than sybil accounts", () => {
    const scores = runEigenTrust(edges, seedDids, 20, 0.001);

    // Compute average trust per group
    const realScores = realDids.map((did) => scores.get(did) ?? 0);
    const sybilScores = sybilDids.map((did) => scores.get(did) ?? 0);
    const realAvg = realScores.reduce((a, b) => a + b, 0) / realScores.length;
    const sybilAvg = sybilScores.reduce((a, b) => a + b, 0) / sybilScores.length;
    const minReal = Math.min(...realScores);
    const maxSybil = Math.max(...sybilScores);

    // Every real account should have higher trust than every sybil account
    expect(minReal).toBeGreaterThan(maxSybil);

    // Average real trust should be at least 5x sybil trust
    expect(realAvg).toBeGreaterThan(sybilAvg * 5);

    // All sybil accounts should have trust < 0.05
    for (const score of sybilScores) {
      expect(score).toBeLessThan(0.05);
    }
  });

  it("should detect the sybil cluster", () => {
    const scores = runEigenTrust(edges, seedDids, 20, 0.001);
    const lowTrustDids = new Set<string>();
    for (const [did, score] of scores) {
      if (score < 0.05) lowTrustDids.add(did);
    }

    // All sybil DIDs should be in the low-trust set
    for (const did of sybilDids) {
      expect(lowTrustDids.has(did)).toBe(true);
    }

    // Build subgraph of low-trust DIDs
    const subgraphEdges: Map<string, Set<string>> = new Map();
    for (const [source, targets] of edges) {
      if (!lowTrustDids.has(source)) continue;
      for (const { target } of targets) {
        if (!lowTrustDids.has(target)) continue;

        const sourceSet = subgraphEdges.get(source) ?? new Set<string>();
        sourceSet.add(target);
        subgraphEdges.set(source, sourceSet);

        const targetSet = subgraphEdges.get(target) ?? new Set<string>();
        targetSet.add(source);
        subgraphEdges.set(target, targetSet);
      }
    }

    const allEdgesForDetection = edges;
    const clusters = findSybilClusters(
      lowTrustDids,
      subgraphEdges,
      allEdgesForDetection,
      3,
      0.8,
    );

    expect(clusters.length).toBeGreaterThanOrEqual(1);

    // Find the cluster that contains the most sybil DIDs
    const sybilSet = new Set(sybilDids);
    let bestCluster: ClusterInfo | null = null;
    let bestSybilCount = 0;

    for (const cluster of clusters) {
      const sybilCount = cluster.members.filter((m) => sybilSet.has(m)).length;
      if (sybilCount > bestSybilCount) {
        bestSybilCount = sybilCount;
        bestCluster = cluster;
      }
    }

    // The sybil-dominated cluster should contain most sybil DIDs
    expect(bestCluster).not.toBeNull();
    expect(bestSybilCount).toBeGreaterThanOrEqual(9);

    // The internal ratio should be very high
    if (bestCluster) {
      expect(bestCluster.ratio).toBeGreaterThan(0.8);
    }
  });
});

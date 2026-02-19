// ---------------------------------------------------------------------------
// Cluster diversity factor for reputation weighting
// ---------------------------------------------------------------------------

/**
 * Compute the cluster diversity factor for a voter.
 *
 * - If the voter is NOT in any flagged sybil cluster, returns 1.0.
 * - If the voter IS in a flagged cluster, returns log2(1 + externalInteractionCount).
 *   This means voters in clusters with zero external interactions contribute
 *   a factor of 0, effectively zeroing their reputation impact.
 *
 * @param inFlaggedCluster - Whether the voter belongs to a flagged sybil cluster
 * @param externalInteractionCount - Number of distinct external DIDs the voter
 *   interacts with outside any flagged cluster they belong to
 */
export function computeClusterDiversityFactor(
  inFlaggedCluster: boolean,
  externalInteractionCount: number,
): number {
  if (!inFlaggedCluster) {
    return 1.0;
  }

  return Math.log2(1 + externalInteractionCount);
}

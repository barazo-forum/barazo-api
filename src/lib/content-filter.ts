// ---------------------------------------------------------------------------
// Content maturity filtering helpers
// ---------------------------------------------------------------------------
// Determines the maximum maturity level a user is allowed to see based on
// authentication status, age declaration, and maturity preference.
// ---------------------------------------------------------------------------

import { isMaturityAtMost, ratingsAtMost } from "./maturity.js";
import type { MaturityRating } from "./maturity.js";

/** Minimal user shape needed for maturity resolution. */
export interface MaturityUser {
  ageDeclaredAt: Date | null | undefined;
  maturityPref: string;
}

/**
 * Resolve the maximum maturity rating a user is allowed to view.
 *
 * Rules:
 * - Unauthenticated (user is undefined): "safe" only
 * - Authenticated but age not declared: "safe" only
 * - Authenticated with age declared: use their maturityPref
 */
export function resolveMaxMaturity(
  user: MaturityUser | undefined,
): MaturityRating {
  if (!user) return "safe";
  if (!user.ageDeclaredAt) return "safe";
  // Safe: maturityPref validated by DB enum constraint
  const pref = user.maturityPref as MaturityRating;
  return pref;
}

/**
 * Check whether content with the given maturity rating is visible
 * at the specified maximum allowed maturity level.
 *
 * A content rating is allowed if it is <= maxAllowed in the hierarchy:
 * safe (0) <= mature (1) <= adult (2)
 */
export function maturityAllows(
  maxAllowed: MaturityRating,
  contentRating: MaturityRating,
): boolean {
  return isMaturityAtMost(contentRating, maxAllowed);
}

/**
 * Return the list of maturity ratings that are visible at the given max level.
 * Useful for building SQL IN clauses.
 */
export function allowedRatings(maxAllowed: MaturityRating): MaturityRating[] {
  return ratingsAtMost(maxAllowed);
}

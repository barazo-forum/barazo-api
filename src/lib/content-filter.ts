// ---------------------------------------------------------------------------
// Content maturity filtering helpers
// ---------------------------------------------------------------------------
// Determines the maximum maturity level a user is allowed to see based on
// authentication status, declared age, age threshold, and maturity preference.
// ---------------------------------------------------------------------------

import { isMaturityAtMost, ratingsAtMost } from "./maturity.js";
import type { MaturityRating } from "./maturity.js";

/** Minimal user shape needed for maturity resolution. */
export interface MaturityUser {
  declaredAge: number | null | undefined;
  maturityPref: string;
}

/** Default age threshold (GDPR Art. 8 strictest: 16). */
const DEFAULT_AGE_THRESHOLD = 16;

/**
 * Resolve the maximum maturity rating a user is allowed to view.
 *
 * Rules:
 * - Unauthenticated (user is undefined): "safe" only
 * - No age declared (null): "safe" only
 * - "Rather not say" (0): "safe" only
 * - Declared age below community threshold: "safe" only
 * - Declared age meets threshold: use their maturityPref
 */
export function resolveMaxMaturity(
  user: MaturityUser | undefined,
  ageThreshold: number = DEFAULT_AGE_THRESHOLD,
): MaturityRating {
  if (!user) return "safe";
  if (user.declaredAge === null || user.declaredAge === undefined) return "safe";
  if (user.declaredAge === 0) return "safe";
  if (user.declaredAge < ageThreshold) return "safe";
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

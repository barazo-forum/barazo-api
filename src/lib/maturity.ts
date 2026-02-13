// ---------------------------------------------------------------------------
// Maturity rating helpers (shared between categories and admin-settings)
// ---------------------------------------------------------------------------

import type { MaturityRating as ZodMaturityRating } from "../validation/categories.js";

/** Valid maturity rating values. Derived from Zod schema as single source of truth. */
export type MaturityRating = ZodMaturityRating;

/** Numeric order of maturity ratings for comparison. */
export const MATURITY_ORDER: Record<MaturityRating, number> = {
  safe: 0,
  mature: 1,
  adult: 2,
} as const;

/**
 * Check if maturity rating `a` is lower than `b` in the hierarchy.
 * Hierarchy: safe < mature < adult
 */
export function isMaturityLowerThan(a: MaturityRating, b: MaturityRating): boolean {
  return MATURITY_ORDER[a] < MATURITY_ORDER[b];
}

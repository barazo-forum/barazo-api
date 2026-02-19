// ---------------------------------------------------------------------------
// Maturity rating helpers (shared between categories and admin-settings)
// ---------------------------------------------------------------------------

import type { MaturityRating as ZodMaturityRating } from '../validation/categories.js'

/** Valid maturity rating values. Derived from Zod schema as single source of truth. */
export type MaturityRating = ZodMaturityRating

/** Numeric order of maturity ratings for comparison. */
export const MATURITY_ORDER: Record<MaturityRating, number> = {
  safe: 0,
  mature: 1,
  adult: 2,
} as const

/**
 * Check if maturity rating `a` is lower than `b` in the hierarchy.
 * Hierarchy: safe < mature < adult
 */
export function isMaturityLowerThan(a: MaturityRating, b: MaturityRating): boolean {
  return MATURITY_ORDER[a] < MATURITY_ORDER[b]
}

/**
 * Check if maturity rating `a` is at most `b` in the hierarchy (a <= b).
 * Used for content visibility: content rating must be at most user's max allowed.
 */
export function isMaturityAtMost(a: MaturityRating, b: MaturityRating): boolean {
  return MATURITY_ORDER[a] <= MATURITY_ORDER[b]
}

/**
 * Return all maturity ratings that are at most `maxLevel` in the hierarchy.
 * Useful for building SQL IN clauses.
 */
export function ratingsAtMost(maxLevel: MaturityRating): MaturityRating[] {
  const max = MATURITY_ORDER[maxLevel]
  return (Object.entries(MATURITY_ORDER) as Array<[MaturityRating, number]>)
    .filter(([, order]) => order <= max)
    .map(([rating]) => rating)
}

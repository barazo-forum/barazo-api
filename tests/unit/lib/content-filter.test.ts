import { describe, it, expect } from 'vitest'
import {
  resolveMaxMaturity,
  maturityAllows,
  allowedRatings,
} from '../../../src/lib/content-filter.js'
import type { MaturityUser } from '../../../src/lib/content-filter.js'
import type { MaturityRating } from '../../../src/lib/maturity.js'

// ---------------------------------------------------------------------------
// resolveMaxMaturity
// ---------------------------------------------------------------------------

describe('resolveMaxMaturity', () => {
  it("returns 'safe' for unauthenticated user", () => {
    expect(resolveMaxMaturity(undefined)).toBe('safe')
  })

  it("returns 'safe' when declaredAge is null", () => {
    const user: MaturityUser = { declaredAge: null, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user)).toBe('safe')
  })

  it("returns 'safe' when declaredAge is 0 (rather not say)", () => {
    const user: MaturityUser = { declaredAge: 0, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user)).toBe('safe')
  })

  it('returns maturityPref when declaredAge meets default threshold (16)', () => {
    const user: MaturityUser = { declaredAge: 16, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user, 16)).toBe('mature')
  })

  it("returns 'safe' when declaredAge below community threshold", () => {
    const user: MaturityUser = { declaredAge: 14, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user, 16)).toBe('safe')
  })

  it('returns maturityPref when declaredAge meets lower threshold (13)', () => {
    const user: MaturityUser = { declaredAge: 13, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user, 13)).toBe('mature')
  })

  it("returns 'safe' when declaredAge is 13 and threshold is 14", () => {
    const user: MaturityUser = { declaredAge: 13, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user, 14)).toBe('safe')
  })

  it('defaults threshold to 16 when not provided', () => {
    const user: MaturityUser = { declaredAge: 16, maturityPref: 'mature' }
    expect(resolveMaxMaturity(user)).toBe('mature')
  })

  it("returns 'safe' when declaredAge is undefined", () => {
    const user: MaturityUser = { declaredAge: undefined, maturityPref: 'adult' }
    expect(resolveMaxMaturity(user)).toBe('safe')
  })

  it("returns 'adult' when declaredAge meets threshold and pref is adult", () => {
    const user: MaturityUser = { declaredAge: 18, maturityPref: 'adult' }
    expect(resolveMaxMaturity(user, 16)).toBe('adult')
  })

  it("returns 'safe' when declaredAge meets threshold but pref is safe", () => {
    const user: MaturityUser = { declaredAge: 18, maturityPref: 'safe' }
    expect(resolveMaxMaturity(user, 16)).toBe('safe')
  })
})

// ---------------------------------------------------------------------------
// maturityAllows
// ---------------------------------------------------------------------------

describe('maturityAllows', () => {
  const cases: Array<[MaturityRating, MaturityRating, boolean]> = [
    // [maxAllowed, contentRating, expected]
    ['safe', 'safe', true],
    ['safe', 'mature', false],
    ['safe', 'adult', false],
    ['mature', 'safe', true],
    ['mature', 'mature', true],
    ['mature', 'adult', false],
    ['adult', 'safe', true],
    ['adult', 'mature', true],
    ['adult', 'adult', true],
  ]

  for (const [maxAllowed, contentRating, expected] of cases) {
    it(`maxAllowed=${maxAllowed}, content=${contentRating} -> ${String(expected)}`, () => {
      expect(maturityAllows(maxAllowed, contentRating)).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// allowedRatings
// ---------------------------------------------------------------------------

describe('allowedRatings', () => {
  it("returns only 'safe' for safe max level", () => {
    expect(allowedRatings('safe')).toEqual(['safe'])
  })

  it("returns 'safe' and 'mature' for mature max level", () => {
    const result = allowedRatings('mature')
    expect(result).toHaveLength(2)
    expect(result).toContain('safe')
    expect(result).toContain('mature')
  })

  it('returns all ratings for adult max level', () => {
    const result = allowedRatings('adult')
    expect(result).toHaveLength(3)
    expect(result).toContain('safe')
    expect(result).toContain('mature')
    expect(result).toContain('adult')
  })
})

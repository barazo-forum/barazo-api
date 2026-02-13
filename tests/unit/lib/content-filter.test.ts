import { describe, it, expect } from "vitest";
import {
  resolveMaxMaturity,
  maturityAllows,
  allowedRatings,
} from "../../../src/lib/content-filter.js";
import type { MaturityRating } from "../../../src/lib/maturity.js";

// ---------------------------------------------------------------------------
// resolveMaxMaturity
// ---------------------------------------------------------------------------

describe("resolveMaxMaturity", () => {
  it("returns 'safe' when user is undefined (unauthenticated)", () => {
    expect(resolveMaxMaturity(undefined)).toBe("safe");
  });

  it("returns 'safe' when user has no ageDeclaredAt", () => {
    expect(
      resolveMaxMaturity({ ageDeclaredAt: null, maturityPref: "mature" }),
    ).toBe("safe");
  });

  it("returns 'safe' when user has ageDeclaredAt but maturityPref is 'safe'", () => {
    expect(
      resolveMaxMaturity({
        ageDeclaredAt: new Date(),
        maturityPref: "safe",
      }),
    ).toBe("safe");
  });

  it("returns 'mature' when user has ageDeclaredAt and maturityPref is 'mature'", () => {
    expect(
      resolveMaxMaturity({
        ageDeclaredAt: new Date(),
        maturityPref: "mature",
      }),
    ).toBe("mature");
  });

  it("returns 'adult' when user has ageDeclaredAt and maturityPref is 'adult'", () => {
    expect(
      resolveMaxMaturity({
        ageDeclaredAt: new Date(),
        maturityPref: "adult",
      }),
    ).toBe("adult");
  });

  it("returns 'safe' when ageDeclaredAt is undefined", () => {
    expect(
      resolveMaxMaturity({ ageDeclaredAt: undefined, maturityPref: "adult" }),
    ).toBe("safe");
  });
});

// ---------------------------------------------------------------------------
// maturityAllows
// ---------------------------------------------------------------------------

describe("maturityAllows", () => {
  const cases: Array<[MaturityRating, MaturityRating, boolean]> = [
    // [maxAllowed, contentRating, expected]
    ["safe", "safe", true],
    ["safe", "mature", false],
    ["safe", "adult", false],
    ["mature", "safe", true],
    ["mature", "mature", true],
    ["mature", "adult", false],
    ["adult", "safe", true],
    ["adult", "mature", true],
    ["adult", "adult", true],
  ];

  for (const [maxAllowed, contentRating, expected] of cases) {
    it(`maxAllowed=${maxAllowed}, content=${contentRating} -> ${String(expected)}`, () => {
      expect(maturityAllows(maxAllowed, contentRating)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// allowedRatings
// ---------------------------------------------------------------------------

describe("allowedRatings", () => {
  it("returns only 'safe' for safe max level", () => {
    expect(allowedRatings("safe")).toEqual(["safe"]);
  });

  it("returns 'safe' and 'mature' for mature max level", () => {
    const result = allowedRatings("mature");
    expect(result).toHaveLength(2);
    expect(result).toContain("safe");
    expect(result).toContain("mature");
  });

  it("returns all ratings for adult max level", () => {
    const result = allowedRatings("adult");
    expect(result).toHaveLength(3);
    expect(result).toContain("safe");
    expect(result).toContain("mature");
    expect(result).toContain("adult");
  });
});

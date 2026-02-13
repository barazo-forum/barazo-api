import { describe, it, expect } from "vitest";
import {
  isMaturityLowerThan,
  isMaturityAtMost,
  ratingsAtMost,
} from "../../../src/lib/maturity.js";
import type { MaturityRating } from "../../../src/lib/maturity.js";

// ---------------------------------------------------------------------------
// isMaturityLowerThan
// ---------------------------------------------------------------------------

describe("isMaturityLowerThan", () => {
  const cases: Array<[MaturityRating, MaturityRating, boolean]> = [
    ["safe", "safe", false],
    ["safe", "mature", true],
    ["safe", "adult", true],
    ["mature", "safe", false],
    ["mature", "mature", false],
    ["mature", "adult", true],
    ["adult", "safe", false],
    ["adult", "mature", false],
    ["adult", "adult", false],
  ];

  for (const [a, b, expected] of cases) {
    it(`${a} < ${b} -> ${String(expected)}`, () => {
      expect(isMaturityLowerThan(a, b)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// isMaturityAtMost
// ---------------------------------------------------------------------------

describe("isMaturityAtMost", () => {
  const cases: Array<[MaturityRating, MaturityRating, boolean]> = [
    ["safe", "safe", true],
    ["safe", "mature", true],
    ["safe", "adult", true],
    ["mature", "safe", false],
    ["mature", "mature", true],
    ["mature", "adult", true],
    ["adult", "safe", false],
    ["adult", "mature", false],
    ["adult", "adult", true],
  ];

  for (const [a, b, expected] of cases) {
    it(`${a} <= ${b} -> ${String(expected)}`, () => {
      expect(isMaturityAtMost(a, b)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// ratingsAtMost
// ---------------------------------------------------------------------------

describe("ratingsAtMost", () => {
  it("returns only 'safe' for safe max level", () => {
    expect(ratingsAtMost("safe")).toEqual(["safe"]);
  });

  it("returns 'safe' and 'mature' for mature max level", () => {
    const result = ratingsAtMost("mature");
    expect(result).toHaveLength(2);
    expect(result).toContain("safe");
    expect(result).toContain("mature");
  });

  it("returns all ratings for adult max level", () => {
    const result = ratingsAtMost("adult");
    expect(result).toHaveLength(3);
    expect(result).toContain("safe");
    expect(result).toContain("mature");
    expect(result).toContain("adult");
  });
});

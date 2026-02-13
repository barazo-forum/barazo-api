import { describe, it, expect } from "vitest";
import {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
  maturityRatingSchema,
  updateMaturitySchema,
  categoryResponseSchema,
  categoryTreeResponseSchema,
} from "../../../src/validation/categories.js";

// ---------------------------------------------------------------------------
// maturityRatingSchema
// ---------------------------------------------------------------------------

describe("maturityRatingSchema", () => {
  it("accepts 'safe'", () => {
    expect(maturityRatingSchema.safeParse("safe").success).toBe(true);
  });

  it("accepts 'mature'", () => {
    expect(maturityRatingSchema.safeParse("mature").success).toBe(true);
  });

  it("accepts 'adult'", () => {
    expect(maturityRatingSchema.safeParse("adult").success).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(maturityRatingSchema.safeParse("nsfw").success).toBe(false);
    expect(maturityRatingSchema.safeParse("").success).toBe(false);
    expect(maturityRatingSchema.safeParse(123).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCategorySchema
// ---------------------------------------------------------------------------

describe("createCategorySchema", () => {
  const validInput = {
    name: "General Discussion",
    slug: "general-discussion",
  };

  it("accepts valid minimal input (name + slug)", () => {
    const result = createCategorySchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts valid input with all optional fields", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      description: "A place for general discussion",
      parentId: "cat-parent-123",
      sortOrder: 5,
      maturityRating: "mature",
    });
    expect(result.success).toBe(true);
  });

  // --- name ---

  it("rejects empty name", () => {
    const result = createCategorySchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 100 characters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      name: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 100 characters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      name: "a".repeat(100),
    });
    expect(result.success).toBe(true);
  });

  // --- slug ---

  it("rejects empty slug", () => {
    const result = createCategorySchema.safeParse({ ...validInput, slug: "" });
    expect(result.success).toBe(false);
  });

  it("rejects slug longer than 50 characters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "a".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it("accepts slug exactly 50 characters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "a".repeat(50),
    });
    expect(result.success).toBe(true);
  });

  it("rejects slug with uppercase letters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "General",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug with spaces", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "general discussion",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug starting with a hyphen", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "-general",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug ending with a hyphen", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "general-",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug with consecutive hyphens", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "general--discussion",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid hyphenated slug", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "general-discussion",
    });
    expect(result.success).toBe(true);
  });

  it("accepts numeric slug", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      slug: "123",
    });
    expect(result.success).toBe(true);
  });

  // --- description ---

  it("accepts missing description", () => {
    const result = createCategorySchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects description longer than 500 characters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts description exactly 500 characters", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      description: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });

  // --- sortOrder ---

  it("rejects negative sortOrder", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      sortOrder: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer sortOrder", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      sortOrder: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts sortOrder of 0", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  // --- maturityRating ---

  it("accepts valid maturityRating", () => {
    for (const rating of ["safe", "mature", "adult"]) {
      const result = createCategorySchema.safeParse({
        ...validInput,
        maturityRating: rating,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid maturityRating", () => {
    const result = createCategorySchema.safeParse({
      ...validInput,
      maturityRating: "nsfw",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateCategorySchema
// ---------------------------------------------------------------------------

describe("updateCategorySchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = updateCategorySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update with name only", () => {
    const result = updateCategorySchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with slug only", () => {
    const result = updateCategorySchema.safeParse({ slug: "new-slug" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with all fields", () => {
    const result = updateCategorySchema.safeParse({
      name: "Updated",
      slug: "updated",
      description: "Updated description",
      parentId: "cat-123",
      sortOrder: 10,
      maturityRating: "adult",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug in update", () => {
    const result = updateCategorySchema.safeParse({ slug: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name in update", () => {
    const result = updateCategorySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// categoryQuerySchema
// ---------------------------------------------------------------------------

describe("categoryQuerySchema", () => {
  it("accepts empty object", () => {
    const result = categoryQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts parentId filter", () => {
    const result = categoryQuerySchema.safeParse({ parentId: "cat-123" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateMaturitySchema
// ---------------------------------------------------------------------------

describe("updateMaturitySchema", () => {
  it("accepts valid maturity rating", () => {
    const result = updateMaturitySchema.safeParse({ maturityRating: "safe" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid maturity rating", () => {
    const result = updateMaturitySchema.safeParse({
      maturityRating: "extreme",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing maturityRating", () => {
    const result = updateMaturitySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// categoryResponseSchema
// ---------------------------------------------------------------------------

describe("categoryResponseSchema", () => {
  const validResponse = {
    id: "cat-123",
    slug: "general",
    name: "General",
    description: null,
    parentId: null,
    sortOrder: 0,
    communityDid: "did:plc:community123",
    maturityRating: "safe",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts valid category response", () => {
    const result = categoryResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("accepts response with non-null description and parentId", () => {
    const result = categoryResponseSchema.safeParse({
      ...validResponse,
      description: "A description",
      parentId: "cat-parent",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// categoryTreeResponseSchema
// ---------------------------------------------------------------------------

describe("categoryTreeResponseSchema", () => {
  it("accepts valid tree response with children", () => {
    const result = categoryTreeResponseSchema.safeParse({
      id: "cat-1",
      slug: "parent",
      name: "Parent",
      description: null,
      parentId: null,
      sortOrder: 0,
      communityDid: "did:plc:community123",
      maturityRating: "safe",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      children: [
        {
          id: "cat-2",
          slug: "child",
          name: "Child",
          description: null,
          parentId: "cat-1",
          sortOrder: 0,
          communityDid: "did:plc:community123",
          maturityRating: "safe",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          children: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts tree with empty children array", () => {
    const result = categoryTreeResponseSchema.safeParse({
      id: "cat-1",
      slug: "leaf",
      name: "Leaf",
      description: null,
      parentId: null,
      sortOrder: 0,
      communityDid: "did:plc:community123",
      maturityRating: "safe",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      children: [],
    });
    expect(result.success).toBe(true);
  });
});

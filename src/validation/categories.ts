import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Valid maturity rating values for categories and communities. */
export const maturityRatingSchema = z.enum(["safe", "mature", "adult"]);

export type MaturityRating = z.infer<typeof maturityRatingSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Slug pattern: lowercase alphanumeric segments separated by single hyphens. */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Schema for creating a new category. */
export const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(50, "Slug must be at most 50 characters")
    .regex(
      slugPattern,
      "Slug must be lowercase alphanumeric with single hyphens (e.g. 'general-discussion')",
    ),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .optional(),
  parentId: z.string().optional(),
  sortOrder: z
    .number()
    .int("Sort order must be an integer")
    .min(0, "Sort order must be non-negative")
    .optional(),
  maturityRating: maturityRatingSchema.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Schema for updating an existing category (all fields optional). */
export const updateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name must not be empty")
    .max(100, "Name must be at most 100 characters")
    .optional(),
  slug: z
    .string()
    .min(1, "Slug must not be empty")
    .max(50, "Slug must be at most 50 characters")
    .regex(
      slugPattern,
      "Slug must be lowercase alphanumeric with single hyphens (e.g. 'general-discussion')",
    )
    .optional(),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .optional(),
  parentId: z.string().optional(),
  sortOrder: z
    .number()
    .int("Sort order must be an integer")
    .min(0, "Sort order must be non-negative")
    .optional(),
  maturityRating: maturityRatingSchema.optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/** Schema for updating community/category maturity rating. */
export const updateMaturitySchema = z.object({
  maturityRating: maturityRatingSchema,
});

export type UpdateMaturityInput = z.infer<typeof updateMaturitySchema>;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

/** Schema for listing categories with optional filtering. */
export const categoryQuerySchema = z.object({
  parentId: z.string().optional(),
});

export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>;

// ---------------------------------------------------------------------------
// Response schemas (for OpenAPI documentation)
// ---------------------------------------------------------------------------

/** Schema describing a single category in API responses. */
export const categoryResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  sortOrder: z.number(),
  communityDid: z.string(),
  maturityRating: maturityRatingSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CategoryResponse = z.infer<typeof categoryResponseSchema>;

/** Schema describing a category with its children (tree structure). */
export const categoryTreeResponseSchema: z.ZodType<CategoryTreeResponse> =
  z.lazy(() =>
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      parentId: z.string().nullable(),
      sortOrder: z.number(),
      communityDid: z.string(),
      maturityRating: maturityRatingSchema,
      createdAt: z.string(),
      updatedAt: z.string(),
      children: z.array(categoryTreeResponseSchema),
    }),
  );

export interface CategoryTreeResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  communityDid: string;
  maturityRating: "safe" | "mature" | "adult";
  createdAt: string;
  updatedAt: string;
  children: CategoryTreeResponse[];
}

import { z } from "zod/v4";
import { maturityRatingSchema } from "./categories.js";
import { reactionSetSchema } from "./reactions.js";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Schema for updating community settings (all fields optional). */
export const updateSettingsSchema = z.object({
  communityName: z
    .string()
    .trim()
    .min(1, "Community name is required")
    .max(100, "Community name must be at most 100 characters")
    .optional(),
  maturityRating: maturityRatingSchema.optional(),
  reactionSet: reactionSetSchema.optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// ---------------------------------------------------------------------------
// Response schemas (for OpenAPI documentation)
// ---------------------------------------------------------------------------

/** Schema describing community settings in API responses. */
export const settingsResponseSchema = z.object({
  id: z.string(),
  initialized: z.boolean(),
  communityDid: z.string().nullable(),
  adminDid: z.string().nullable(),
  communityName: z.string(),
  maturityRating: maturityRatingSchema,
  reactionSet: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

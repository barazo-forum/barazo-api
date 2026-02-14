import { z } from "zod/v4";
import { maturityRatingSchema } from "./categories.js";
import { reactionSetSchema } from "./reactions.js";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Hex color code pattern: # followed by 3, 4, 6, or 8 hex digits. */
const hexColorPattern = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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
  communityDescription: z
    .string()
    .trim()
    .max(500, "Community description must be at most 500 characters")
    .optional(),
  communityLogoUrl: z
    .url("Community logo must be a valid URL")
    .optional(),
  primaryColor: z
    .string()
    .regex(hexColorPattern, "Primary color must be a valid hex color (e.g., #ff0000)")
    .optional(),
  accentColor: z
    .string()
    .regex(hexColorPattern, "Accent color must be a valid hex color (e.g., #00ff00)")
    .optional(),
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
  communityDescription: z.string().nullable(),
  communityLogoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  accentColor: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

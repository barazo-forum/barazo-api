import { z } from "zod";

// ---------------------------------------------------------------------------
// Community filter schemas
// ---------------------------------------------------------------------------

export const communityFilterQuerySchema = z.object({
  status: z.enum(["active", "warned", "filtered"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CommunityFilterQueryInput = z.infer<typeof communityFilterQuerySchema>;

export const updateCommunityFilterSchema = z.object({
  status: z.enum(["active", "warned", "filtered"]),
  reason: z.string().max(1000).optional(),
  adminDid: z.string().min(1).optional(),
});

export type UpdateCommunityFilterInput = z.infer<typeof updateCommunityFilterSchema>;

// ---------------------------------------------------------------------------
// Account filter schemas
// ---------------------------------------------------------------------------

export const accountFilterQuerySchema = z.object({
  status: z.enum(["active", "warned", "filtered"]).optional(),
  communityDid: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type AccountFilterQueryInput = z.infer<typeof accountFilterQuerySchema>;

export const updateAccountFilterSchema = z.object({
  status: z.enum(["active", "warned", "filtered"]),
  reason: z.string().max(1000).optional(),
});

export type UpdateAccountFilterInput = z.infer<typeof updateAccountFilterSchema>;

// ---------------------------------------------------------------------------
// Global report schemas
// ---------------------------------------------------------------------------

export const globalReportQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type GlobalReportQueryInput = z.infer<typeof globalReportQuerySchema>;

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of grapheme clusters in a string using Intl.Segmenter.
 * AT Protocol lexicons specify `maxGraphemes` which counts user-perceived
 * characters (grapheme clusters), not UTF-16 code units.
 */
function graphemeLength(str: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return [...segmenter.segment(str)].length
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Schema for creating a reaction on a topic or reply. */
export const createReactionSchema = z.object({
  subjectUri: z.string().min(1, 'Subject URI is required'),
  subjectCid: z.string().min(1, 'Subject CID is required'),
  type: z
    .string()
    .trim()
    .min(1, 'Reaction type is required')
    .max(300, 'Reaction type exceeds maximum byte length')
    .refine((val) => graphemeLength(val) <= 30, 'Reaction type must be at most 30 graphemes'),
})

export type CreateReactionInput = z.infer<typeof createReactionSchema>

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

/** Schema for listing reactions with pagination and optional type filter. */
export const reactionQuerySchema = z.object({
  subjectUri: z.string().min(1, 'Subject URI is required'),
  type: z.string().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .transform((val) => Number(val))
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default(25),
})

export type ReactionQueryInput = z.infer<typeof reactionQuerySchema>

// ---------------------------------------------------------------------------
// Admin settings extension
// ---------------------------------------------------------------------------

/** Schema for validating reactionSet in admin settings updates. */
export const reactionSetSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Reaction type must not be empty')
      .max(300, 'Reaction type exceeds maximum byte length')
      .refine((val) => graphemeLength(val) <= 30, 'Reaction type must be at most 30 graphemes')
  )
  .min(1, 'Reaction set must contain at least one reaction type')
  .refine((arr) => new Set(arr).size === arr.length, 'Reaction set must contain unique values')

export type ReactionSet = z.infer<typeof reactionSetSchema>

// ---------------------------------------------------------------------------
// Response schemas (for OpenAPI documentation)
// ---------------------------------------------------------------------------

/** Schema describing a single reaction in API responses. */
export const reactionResponseSchema = z.object({
  uri: z.string(),
  rkey: z.string(),
  authorDid: z.string(),
  subjectUri: z.string(),
  type: z.string(),
  cid: z.string(),
  createdAt: z.string(),
})

export type ReactionResponse = z.infer<typeof reactionResponseSchema>

/** Schema for a paginated reaction list response. */
export const reactionListResponseSchema = z.object({
  reactions: z.array(reactionResponseSchema),
  cursor: z.string().nullable(),
})

export type ReactionListResponse = z.infer<typeof reactionListResponseSchema>

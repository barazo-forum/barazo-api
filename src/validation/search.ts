import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

/** Schema for validating search query parameters. */
export const searchQuerySchema = z.object({
  q: z
    .string()
    .min(1, 'Search query is required')
    .max(500, 'Search query must be at most 500 characters'),
  category: z.string().optional(),
  author: z.string().optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  type: z.enum(['topics', 'replies', 'all']).default('all'),
  limit: z
    .string()
    .transform((val) => Number(val))
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default(25),
  cursor: z.string().optional(),
})

export type SearchQueryInput = z.infer<typeof searchQuerySchema>

// ---------------------------------------------------------------------------
// Response schemas (for OpenAPI documentation)
// ---------------------------------------------------------------------------

/** Schema describing a single search result in API responses. */
export const searchResultSchema = z.object({
  type: z.enum(['topic', 'reply']),
  uri: z.string(),
  rkey: z.string(),
  authorDid: z.string(),
  title: z.string().nullable(),
  content: z.string(),
  category: z.string().nullable(),
  communityDid: z.string(),
  replyCount: z.number().nullable(),
  reactionCount: z.number(),
  createdAt: z.string(),
  rank: z.number(),
  // Reply-specific context
  rootUri: z.string().nullable(),
  rootTitle: z.string().nullable(),
})

export type SearchResult = z.infer<typeof searchResultSchema>

/** Schema for the search response. */
export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  cursor: z.string().nullable(),
  total: z.number(),
  searchMode: z.enum(['fulltext', 'hybrid']),
})

export type SearchResponse = z.infer<typeof searchResponseSchema>

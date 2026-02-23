import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Schema for casting a vote on a topic or reply. */
export const createVoteSchema = z.object({
  subjectUri: z.string().min(1, 'Subject URI is required'),
  subjectCid: z.string().min(1, 'Subject CID is required'),
  direction: z.string().min(1, 'Direction is required'),
})

export type CreateVoteInput = z.infer<typeof createVoteSchema>

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

/** Schema for checking vote status. */
export const voteStatusQuerySchema = z.object({
  subjectUri: z.string().min(1, 'Subject URI is required'),
  did: z.string().min(1, 'DID is required'),
})

export type VoteStatusQueryInput = z.infer<typeof voteStatusQuerySchema>

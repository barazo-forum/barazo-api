import { z } from 'zod'

// ---------------------------------------------------------------------------
// Trust seed schemas
// ---------------------------------------------------------------------------

export const trustSeedCreateSchema = z.object({
  did: z.string().min(1),
  communityId: z.string().optional(),
  reason: z.string().max(500).optional(),
})

export const trustSeedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

// ---------------------------------------------------------------------------
// Sybil cluster schemas
// ---------------------------------------------------------------------------

export const clusterQuerySchema = z.object({
  status: z.enum(['flagged', 'dismissed', 'monitoring', 'banned']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['detected_at', 'member_count', 'confidence']).optional(),
})

export const clusterStatusUpdateSchema = z.object({
  status: z.enum(['dismissed', 'monitoring', 'banned']),
})

// ---------------------------------------------------------------------------
// PDS trust factor schemas
// ---------------------------------------------------------------------------

export const pdsTrustUpdateSchema = z.object({
  pdsHost: z
    .string()
    .min(1)
    .max(253)
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      'Must be a valid hostname'
    ),
  trustFactor: z.number().min(0.0).max(1.0),
})

export const pdsTrustQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

// ---------------------------------------------------------------------------
// Behavioral flag schemas
// ---------------------------------------------------------------------------

export const behavioralFlagUpdateSchema = z.object({
  status: z.enum(['dismissed', 'action_taken']),
})

export const behavioralFlagQuerySchema = z.object({
  flagType: z.enum(['burst_voting', 'content_similarity', 'low_diversity']).optional(),
  status: z.enum(['pending', 'dismissed', 'action_taken']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

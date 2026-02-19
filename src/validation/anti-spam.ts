import { z } from 'zod'

export const wordFilterSchema = z.object({
  words: z.array(z.string().min(1).max(100)).max(500),
})

export const queueActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
})

export const queueQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  queueReason: z
    .enum(['word_filter', 'first_post', 'link_hold', 'burst', 'topic_delay'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

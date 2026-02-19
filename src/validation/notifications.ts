import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

/** Schema for listing notifications with pagination. */
export const notificationQuerySchema = z.object({
  limit: z
    .string()
    .transform((val) => Number(val))
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default(25),
  cursor: z.string().optional(),
  unreadOnly: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
})

export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

/** Schema for marking notifications as read. */
export const markReadSchema = z.object({
  notificationId: z.number().int().positive().optional(),
  all: z.boolean().optional(),
})

export type MarkReadInput = z.infer<typeof markReadSchema>

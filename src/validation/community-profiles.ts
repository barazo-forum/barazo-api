import { z } from 'zod/v4'

/** Schema for PUT /api/communities/:communityDid/profile body. */
export const updateCommunityProfileSchema = z.object({
  displayName: z.string().max(256).nullable().optional(),
  bio: z.string().max(2048).nullable().optional(),
})

export type UpdateCommunityProfileInput = z.infer<typeof updateCommunityProfileSchema>

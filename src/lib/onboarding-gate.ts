import { eq, and } from 'drizzle-orm'
import {
  communityOnboardingFields,
  userOnboardingResponses,
} from '../db/schema/onboarding-fields.js'
import type { Database } from '../db/index.js'

export interface OnboardingCheckResult {
  complete: boolean
  missingFields: { id: string; label: string; fieldType: string }[]
}

/**
 * Check whether a user has completed all mandatory onboarding fields
 * for a community. Returns complete=true if no fields are configured
 * or all mandatory ones have responses.
 */
export async function checkOnboardingComplete(
  db: Database,
  did: string,
  communityDid: string
): Promise<OnboardingCheckResult> {
  // Get mandatory fields for this community
  const fields = await db
    .select()
    .from(communityOnboardingFields)
    .where(
      and(
        eq(communityOnboardingFields.communityDid, communityDid),
        eq(communityOnboardingFields.isMandatory, true)
      )
    )

  if (fields.length === 0) {
    return { complete: true, missingFields: [] }
  }

  // Get user's responses for this community
  const responses = await db
    .select()
    .from(userOnboardingResponses)
    .where(
      and(
        eq(userOnboardingResponses.did, did),
        eq(userOnboardingResponses.communityDid, communityDid)
      )
    )

  const answeredFieldIds = new Set(responses.map((r) => r.fieldId))

  const missingFields = fields
    .filter((f) => !answeredFieldIds.has(f.id))
    .map((f) => ({ id: f.id, label: f.label, fieldType: f.fieldType }))

  return {
    complete: missingFields.length === 0,
    missingFields,
  }
}

import { describe, it, expect } from 'vitest'
import {
  userPreferencesSchema,
  communityPreferencesSchema,
  ageDeclarationSchema,
} from '../../../src/validation/profiles.js'

// ===========================================================================
// Tests
// ===========================================================================

describe('profile validation schemas', () => {
  // =========================================================================
  // userPreferencesSchema
  // =========================================================================

  describe('userPreferencesSchema', () => {
    it('parses a fully populated valid body', () => {
      const result = userPreferencesSchema.safeParse({
        maturityLevel: 'mature',
        mutedWords: ['spoiler', 'nsfw'],
        blockedDids: ['did:plc:blocked1'],
        mutedDids: ['did:plc:muted1'],
        crossPostBluesky: true,
        crossPostFrontpage: false,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.maturityLevel).toBe('mature')
        expect(result.data.mutedWords).toEqual(['spoiler', 'nsfw'])
        expect(result.data.crossPostBluesky).toBe(true)
      }
    })

    it('parses an empty body (all fields optional)', () => {
      const result = userPreferencesSchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.maturityLevel).toBeUndefined()
        expect(result.data.mutedWords).toBeUndefined()
        expect(result.data.blockedDids).toBeUndefined()
        expect(result.data.mutedDids).toBeUndefined()
        expect(result.data.crossPostBluesky).toBeUndefined()
        expect(result.data.crossPostFrontpage).toBeUndefined()
      }
    })

    it('parses partial updates (only maturityLevel)', () => {
      const result = userPreferencesSchema.safeParse({
        maturityLevel: 'sfw',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.maturityLevel).toBe('sfw')
      }
    })

    it('fails for invalid maturityLevel', () => {
      const result = userPreferencesSchema.safeParse({
        maturityLevel: 'adult',
      })
      expect(result.success).toBe(false)
    })

    it('fails for empty strings in mutedWords', () => {
      const result = userPreferencesSchema.safeParse({
        mutedWords: [''],
      })
      expect(result.success).toBe(false)
    })

    it('fails for non-boolean crossPostBluesky', () => {
      const result = userPreferencesSchema.safeParse({
        crossPostBluesky: 'yes',
      })
      expect(result.success).toBe(false)
    })

    it("accepts maturityLevel 'sfw'", () => {
      const result = userPreferencesSchema.safeParse({
        maturityLevel: 'sfw',
      })
      expect(result.success).toBe(true)
    })

    it("accepts maturityLevel 'mature'", () => {
      const result = userPreferencesSchema.safeParse({
        maturityLevel: 'mature',
      })
      expect(result.success).toBe(true)
    })
  })

  // =========================================================================
  // communityPreferencesSchema
  // =========================================================================

  describe('communityPreferencesSchema', () => {
    it('parses a fully populated valid body', () => {
      const result = communityPreferencesSchema.safeParse({
        maturityOverride: 'mature',
        mutedWords: ['spoiler'],
        blockedDids: ['did:plc:blocked1'],
        mutedDids: ['did:plc:muted1'],
        notificationPrefs: {
          replies: true,
          reactions: false,
          mentions: true,
          modActions: true,
        },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.maturityOverride).toBe('mature')
        expect(result.data.notificationPrefs?.replies).toBe(true)
        expect(result.data.notificationPrefs?.reactions).toBe(false)
      }
    })

    it('parses an empty body (all fields optional)', () => {
      const result = communityPreferencesSchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.maturityOverride).toBeUndefined()
        expect(result.data.mutedWords).toBeUndefined()
        expect(result.data.notificationPrefs).toBeUndefined()
      }
    })

    it('accepts null values for nullable fields', () => {
      const result = communityPreferencesSchema.safeParse({
        maturityOverride: null,
        mutedWords: null,
        blockedDids: null,
        mutedDids: null,
        notificationPrefs: null,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.maturityOverride).toBeNull()
        expect(result.data.mutedWords).toBeNull()
        expect(result.data.notificationPrefs).toBeNull()
      }
    })

    it('fails for invalid maturityOverride', () => {
      const result = communityPreferencesSchema.safeParse({
        maturityOverride: 'adult',
      })
      expect(result.success).toBe(false)
    })

    it('fails for incomplete notificationPrefs', () => {
      const result = communityPreferencesSchema.safeParse({
        notificationPrefs: {
          replies: true,
          // missing other required fields
        },
      })
      expect(result.success).toBe(false)
    })

    it('fails for non-boolean values in notificationPrefs', () => {
      const result = communityPreferencesSchema.safeParse({
        notificationPrefs: {
          replies: 'yes',
          reactions: true,
          mentions: true,
          modActions: true,
        },
      })
      expect(result.success).toBe(false)
    })
  })

  // =========================================================================
  // ageDeclarationSchema
  // =========================================================================

  describe('ageDeclarationSchema', () => {
    it('parses valid declaredAge: 0 (rather not say)', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 0 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.declaredAge).toBe(0)
      }
    })

    it('parses valid declaredAge: 13', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 13 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.declaredAge).toBe(13)
      }
    })

    it('parses valid declaredAge: 14', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 14 })
      expect(result.success).toBe(true)
    })

    it('parses valid declaredAge: 15', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 15 })
      expect(result.success).toBe(true)
    })

    it('parses valid declaredAge: 16', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 16 })
      expect(result.success).toBe(true)
    })

    it('parses valid declaredAge: 18', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 18 })
      expect(result.success).toBe(true)
    })

    it('fails for declaredAge: 1 (invalid value)', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 1 })
      expect(result.success).toBe(false)
    })

    it('fails for declaredAge: 12 (below minimum)', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 12 })
      expect(result.success).toBe(false)
    })

    it('fails for declaredAge: 17 (not a valid bracket)', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 17 })
      expect(result.success).toBe(false)
    })

    it('fails for declaredAge: 19 (above valid range)', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 19 })
      expect(result.success).toBe(false)
    })

    it('fails for declaredAge: -1 (negative)', () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: -1 })
      expect(result.success).toBe(false)
    })

    it("fails for declaredAge: 'sixteen' (string)", () => {
      const result = ageDeclarationSchema.safeParse({ declaredAge: 'sixteen' })
      expect(result.success).toBe(false)
    })

    it('fails when declaredAge is missing', () => {
      const result = ageDeclarationSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})

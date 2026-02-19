import { describe, it, expect } from 'vitest'
import {
  communityFilterQuerySchema,
  updateCommunityFilterSchema,
  accountFilterQuerySchema,
  updateAccountFilterSchema,
  globalReportQuerySchema,
} from '../../../src/validation/global-filters.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('global filter validation schemas', () => {
  // =========================================================================
  // communityFilterQuerySchema
  // =========================================================================

  describe('communityFilterQuerySchema', () => {
    it('parses a valid query with all fields', () => {
      const result = communityFilterQuerySchema.safeParse({
        status: 'active',
        cursor: 'abc123',
        limit: '10',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('active')
        expect(result.data.cursor).toBe('abc123')
        expect(result.data.limit).toBe(10)
      }
    })

    it('parses a minimal valid query (no fields)', () => {
      const result = communityFilterQuerySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBeUndefined()
        expect(result.data.cursor).toBeUndefined()
        expect(result.data.limit).toBe(25)
      }
    })

    it('defaults limit to 25 when not provided', () => {
      const result = communityFilterQuerySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(25)
      }
    })

    it('transforms string limit to number', () => {
      const result = communityFilterQuerySchema.safeParse({ limit: '42' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(42)
        expect(typeof result.data.limit).toBe('number')
      }
    })

    it('accepts limit at boundary 1', () => {
      const result = communityFilterQuerySchema.safeParse({ limit: '1' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(1)
      }
    })

    it('accepts limit at boundary 100', () => {
      const result = communityFilterQuerySchema.safeParse({ limit: '100' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(100)
      }
    })

    it('fails when limit is below minimum (0)', () => {
      const result = communityFilterQuerySchema.safeParse({ limit: '0' })
      expect(result.success).toBe(false)
    })

    it('fails when limit exceeds maximum (101)', () => {
      const result = communityFilterQuerySchema.safeParse({ limit: '101' })
      expect(result.success).toBe(false)
    })

    it('fails for non-numeric limit', () => {
      const result = communityFilterQuerySchema.safeParse({ limit: 'abc' })
      expect(result.success).toBe(false)
    })

    it("accepts valid status 'active'", () => {
      const result = communityFilterQuerySchema.safeParse({ status: 'active' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('active')
      }
    })

    it("accepts valid status 'warned'", () => {
      const result = communityFilterQuerySchema.safeParse({ status: 'warned' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('warned')
      }
    })

    it("accepts valid status 'filtered'", () => {
      const result = communityFilterQuerySchema.safeParse({
        status: 'filtered',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('filtered')
      }
    })

    it('fails for invalid status', () => {
      const result = communityFilterQuerySchema.safeParse({
        status: 'banned',
      })
      expect(result.success).toBe(false)
    })

    it('parses optional cursor', () => {
      const cursor = 'someCursorValue'
      const result = communityFilterQuerySchema.safeParse({ cursor })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.cursor).toBe(cursor)
      }
    })
  })

  // =========================================================================
  // updateCommunityFilterSchema
  // =========================================================================

  describe('updateCommunityFilterSchema', () => {
    it('parses a valid update with all fields', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'warned',
        reason: 'Spam content',
        adminDid: 'did:plc:abc123',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('warned')
        expect(result.data.reason).toBe('Spam content')
        expect(result.data.adminDid).toBe('did:plc:abc123')
      }
    })

    it('parses with only required status field', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'filtered',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('filtered')
        expect(result.data.reason).toBeUndefined()
        expect(result.data.adminDid).toBeUndefined()
      }
    })

    it("accepts valid status 'active'", () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'active',
      })
      expect(result.success).toBe(true)
    })

    it("accepts valid status 'warned'", () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'warned',
      })
      expect(result.success).toBe(true)
    })

    it("accepts valid status 'filtered'", () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'filtered',
      })
      expect(result.success).toBe(true)
    })

    it('fails for invalid status', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'suspended',
      })
      expect(result.success).toBe(false)
    })

    it('fails when status is missing', () => {
      const result = updateCommunityFilterSchema.safeParse({
        reason: 'Some reason',
      })
      expect(result.success).toBe(false)
    })

    it('allows reason to be optional', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'active',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.reason).toBeUndefined()
      }
    })

    it('fails when reason exceeds 1000 characters', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'warned',
        reason: 'x'.repeat(1001),
      })
      expect(result.success).toBe(false)
    })

    it('accepts reason at boundary 1000 characters', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'warned',
        reason: 'x'.repeat(1000),
      })
      expect(result.success).toBe(true)
    })

    it('allows adminDid to be optional', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'active',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.adminDid).toBeUndefined()
      }
    })

    it('fails when adminDid is empty string', () => {
      const result = updateCommunityFilterSchema.safeParse({
        status: 'active',
        adminDid: '',
      })
      expect(result.success).toBe(false)
    })
  })

  // =========================================================================
  // accountFilterQuerySchema
  // =========================================================================

  describe('accountFilterQuerySchema', () => {
    it('parses a valid query with all fields', () => {
      const result = accountFilterQuerySchema.safeParse({
        status: 'filtered',
        communityDid: 'did:plc:community1',
        cursor: 'cursor123',
        limit: '50',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('filtered')
        expect(result.data.communityDid).toBe('did:plc:community1')
        expect(result.data.cursor).toBe('cursor123')
        expect(result.data.limit).toBe(50)
      }
    })

    it('parses a minimal valid query (no fields)', () => {
      const result = accountFilterQuerySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBeUndefined()
        expect(result.data.communityDid).toBeUndefined()
        expect(result.data.cursor).toBeUndefined()
        expect(result.data.limit).toBe(25)
      }
    })

    it('defaults limit to 25 when not provided', () => {
      const result = accountFilterQuerySchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(25)
      }
    })

    it('accepts valid statuses', () => {
      for (const status of ['active', 'warned', 'filtered']) {
        const result = accountFilterQuerySchema.safeParse({ status })
        expect(result.success).toBe(true)
      }
    })

    it('fails for invalid status', () => {
      const result = accountFilterQuerySchema.safeParse({
        status: 'blocked',
      })
      expect(result.success).toBe(false)
    })

    it('allows communityDid to be optional', () => {
      const result = accountFilterQuerySchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.communityDid).toBeUndefined()
      }
    })

    it('fails when limit is below minimum (0)', () => {
      const result = accountFilterQuerySchema.safeParse({ limit: '0' })
      expect(result.success).toBe(false)
    })

    it('fails when limit exceeds maximum (101)', () => {
      const result = accountFilterQuerySchema.safeParse({ limit: '101' })
      expect(result.success).toBe(false)
    })

    it('transforms string limit to number', () => {
      const result = accountFilterQuerySchema.safeParse({ limit: '15' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(15)
        expect(typeof result.data.limit).toBe('number')
      }
    })
  })

  // =========================================================================
  // updateAccountFilterSchema
  // =========================================================================

  describe('updateAccountFilterSchema', () => {
    it('parses a valid update with all fields', () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'warned',
        reason: 'Inappropriate behavior',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('warned')
        expect(result.data.reason).toBe('Inappropriate behavior')
      }
    })

    it('parses with only required status field', () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'active',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe('active')
        expect(result.data.reason).toBeUndefined()
      }
    })

    it("accepts valid status 'active'", () => {
      const result = updateAccountFilterSchema.safeParse({ status: 'active' })
      expect(result.success).toBe(true)
    })

    it("accepts valid status 'warned'", () => {
      const result = updateAccountFilterSchema.safeParse({ status: 'warned' })
      expect(result.success).toBe(true)
    })

    it("accepts valid status 'filtered'", () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'filtered',
      })
      expect(result.success).toBe(true)
    })

    it('fails for invalid status', () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'deleted',
      })
      expect(result.success).toBe(false)
    })

    it('fails when status is missing', () => {
      const result = updateAccountFilterSchema.safeParse({
        reason: 'Some reason',
      })
      expect(result.success).toBe(false)
    })

    it('allows reason to be optional', () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'active',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.reason).toBeUndefined()
      }
    })

    it('fails when reason exceeds 1000 characters', () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'warned',
        reason: 'x'.repeat(1001),
      })
      expect(result.success).toBe(false)
    })

    it('accepts reason at boundary 1000 characters', () => {
      const result = updateAccountFilterSchema.safeParse({
        status: 'warned',
        reason: 'x'.repeat(1000),
      })
      expect(result.success).toBe(true)
    })
  })

  // =========================================================================
  // globalReportQuerySchema
  // =========================================================================

  describe('globalReportQuerySchema', () => {
    it('parses a valid query with limit', () => {
      const result = globalReportQuerySchema.safeParse({ limit: '10' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(10)
      }
    })

    it('defaults limit to 25 when not provided', () => {
      const result = globalReportQuerySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(25)
      }
    })

    it('transforms string limit to number', () => {
      const result = globalReportQuerySchema.safeParse({ limit: '42' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(42)
        expect(typeof result.data.limit).toBe('number')
      }
    })

    it('accepts limit at boundary 1', () => {
      const result = globalReportQuerySchema.safeParse({ limit: '1' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(1)
      }
    })

    it('accepts limit at boundary 100', () => {
      const result = globalReportQuerySchema.safeParse({ limit: '100' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(100)
      }
    })

    it('fails when limit is below minimum (0)', () => {
      const result = globalReportQuerySchema.safeParse({ limit: '0' })
      expect(result.success).toBe(false)
    })

    it('fails when limit exceeds maximum (101)', () => {
      const result = globalReportQuerySchema.safeParse({ limit: '101' })
      expect(result.success).toBe(false)
    })

    it('fails for non-numeric limit', () => {
      const result = globalReportQuerySchema.safeParse({ limit: 'abc' })
      expect(result.success).toBe(false)
    })
  })
})

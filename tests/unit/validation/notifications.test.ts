import { describe, it, expect } from 'vitest'
import { notificationQuerySchema, markReadSchema } from '../../../src/validation/notifications.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notification validation schemas', () => {
  // =========================================================================
  // notificationQuerySchema
  // =========================================================================

  describe('notificationQuerySchema', () => {
    it('parses a valid query with all fields', () => {
      const result = notificationQuerySchema.safeParse({
        limit: '10',
        cursor: 'abc123base64',
        unreadOnly: 'true',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(10)
        expect(result.data.cursor).toBe('abc123base64')
        expect(result.data.unreadOnly).toBe(true)
      }
    })

    it('parses a minimal valid query (no fields)', () => {
      const result = notificationQuerySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(25)
        expect(result.data.cursor).toBeUndefined()
        expect(result.data.unreadOnly).toBeUndefined()
      }
    })

    it('defaults limit to 25 when not provided', () => {
      const result = notificationQuerySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(25)
      }
    })

    it('transforms string limit to number', () => {
      const result = notificationQuerySchema.safeParse({ limit: '42' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(42)
        expect(typeof result.data.limit).toBe('number')
      }
    })

    it('accepts limit at boundary 1', () => {
      const result = notificationQuerySchema.safeParse({ limit: '1' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(1)
      }
    })

    it('accepts limit at boundary 100', () => {
      const result = notificationQuerySchema.safeParse({ limit: '100' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(100)
      }
    })

    it('fails when limit is below minimum (0)', () => {
      const result = notificationQuerySchema.safeParse({ limit: '0' })
      expect(result.success).toBe(false)
    })

    it('fails when limit exceeds maximum (101)', () => {
      const result = notificationQuerySchema.safeParse({ limit: '101' })
      expect(result.success).toBe(false)
    })

    it('fails for non-numeric limit', () => {
      const result = notificationQuerySchema.safeParse({ limit: 'abc' })
      expect(result.success).toBe(false)
    })

    it("transforms unreadOnly 'true' to boolean true", () => {
      const result = notificationQuerySchema.safeParse({
        unreadOnly: 'true',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.unreadOnly).toBe(true)
      }
    })

    it("transforms unreadOnly 'false' to boolean false", () => {
      const result = notificationQuerySchema.safeParse({
        unreadOnly: 'false',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.unreadOnly).toBe(false)
      }
    })

    it('parses optional cursor', () => {
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: '2026-02-14T12:00:00Z', id: 42 })
      ).toString('base64')
      const result = notificationQuerySchema.safeParse({ cursor })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.cursor).toBe(cursor)
      }
    })
  })

  // =========================================================================
  // markReadSchema
  // =========================================================================

  describe('markReadSchema', () => {
    it('parses with notificationId', () => {
      const result = markReadSchema.safeParse({ notificationId: 42 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.notificationId).toBe(42)
        expect(result.data.all).toBeUndefined()
      }
    })

    it('parses with all: true', () => {
      const result = markReadSchema.safeParse({ all: true })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.all).toBe(true)
        expect(result.data.notificationId).toBeUndefined()
      }
    })

    it('parses with both notificationId and all', () => {
      const result = markReadSchema.safeParse({
        notificationId: 1,
        all: true,
      })
      expect(result.success).toBe(true)
    })

    it('parses empty object (both optional)', () => {
      const result = markReadSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.notificationId).toBeUndefined()
        expect(result.data.all).toBeUndefined()
      }
    })

    it('fails for negative notificationId', () => {
      const result = markReadSchema.safeParse({ notificationId: -1 })
      expect(result.success).toBe(false)
    })

    it('fails for zero notificationId', () => {
      const result = markReadSchema.safeParse({ notificationId: 0 })
      expect(result.success).toBe(false)
    })

    it('fails for non-integer notificationId', () => {
      const result = markReadSchema.safeParse({ notificationId: 1.5 })
      expect(result.success).toBe(false)
    })

    it('fails for non-boolean all', () => {
      const result = markReadSchema.safeParse({ all: 'yes' })
      expect(result.success).toBe(false)
    })
  })
})

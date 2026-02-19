import { describe, it, expect } from 'vitest'
import { searchQuerySchema } from '../../../src/validation/search.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search validation schemas', () => {
  // =========================================================================
  // searchQuerySchema
  // =========================================================================

  describe('searchQuerySchema', () => {
    it('parses a valid query with all fields', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test query',
        category: 'general',
        author: 'did:plc:user123',
        dateFrom: '2026-01-01T00:00:00Z',
        dateTo: '2026-02-01T00:00:00Z',
        type: 'topics',
        limit: '10',
        cursor: 'abc123base64',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.q).toBe('test query')
        expect(result.data.category).toBe('general')
        expect(result.data.author).toBe('did:plc:user123')
        expect(result.data.dateFrom).toBe('2026-01-01T00:00:00Z')
        expect(result.data.dateTo).toBe('2026-02-01T00:00:00Z')
        expect(result.data.type).toBe('topics')
        expect(result.data.limit).toBe(10)
        expect(result.data.cursor).toBe('abc123base64')
      }
    })

    it('parses a minimal valid query (only q)', () => {
      const result = searchQuerySchema.safeParse({ q: 'hello' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.q).toBe('hello')
      }
    })

    it('fails when q is missing', () => {
      const result = searchQuerySchema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('fails when q is empty string', () => {
      const result = searchQuerySchema.safeParse({ q: '' })
      expect(result.success).toBe(false)
    })

    it('fails when q exceeds 500 characters', () => {
      const result = searchQuerySchema.safeParse({ q: 'a'.repeat(501) })
      expect(result.success).toBe(false)
    })

    it('accepts q at exactly 500 characters', () => {
      const result = searchQuerySchema.safeParse({ q: 'a'.repeat(500) })
      expect(result.success).toBe(true)
    })

    it("defaults type to 'all' when not provided", () => {
      const result = searchQuerySchema.safeParse({ q: 'test' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('all')
      }
    })

    it('defaults limit to 25 when not provided', () => {
      const result = searchQuerySchema.safeParse({ q: 'test' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(25)
      }
    })

    it("accepts type 'topics'", () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        type: 'topics',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('topics')
      }
    })

    it("accepts type 'replies'", () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        type: 'replies',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('replies')
      }
    })

    it("accepts type 'all'", () => {
      const result = searchQuerySchema.safeParse({ q: 'test', type: 'all' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('all')
      }
    })

    it('fails for invalid type value', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        type: 'invalid',
      })
      expect(result.success).toBe(false)
    })

    it('fails when limit is below minimum (0)', () => {
      const result = searchQuerySchema.safeParse({ q: 'test', limit: '0' })
      expect(result.success).toBe(false)
    })

    it('fails when limit exceeds maximum (101)', () => {
      const result = searchQuerySchema.safeParse({ q: 'test', limit: '101' })
      expect(result.success).toBe(false)
    })

    it('accepts limit at boundary 1', () => {
      const result = searchQuerySchema.safeParse({ q: 'test', limit: '1' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(1)
      }
    })

    it('accepts limit at boundary 100', () => {
      const result = searchQuerySchema.safeParse({ q: 'test', limit: '100' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(100)
      }
    })

    it('transforms string limit to number', () => {
      const result = searchQuerySchema.safeParse({ q: 'test', limit: '42' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.limit).toBe(42)
        expect(typeof result.data.limit).toBe('number')
      }
    })

    it('fails for non-numeric limit', () => {
      const result = searchQuerySchema.safeParse({ q: 'test', limit: 'abc' })
      expect(result.success).toBe(false)
    })

    it('parses optional category filter', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        category: 'support',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe('support')
      }
    })

    it('parses optional author filter', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        author: 'did:plc:abc123',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.author).toBe('did:plc:abc123')
      }
    })

    it('validates dateFrom as ISO datetime', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        dateFrom: '2026-01-15T10:30:00Z',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dateFrom).toBe('2026-01-15T10:30:00Z')
      }
    })

    it('validates dateTo as ISO datetime', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        dateTo: '2026-02-15T23:59:59Z',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dateTo).toBe('2026-02-15T23:59:59Z')
      }
    })

    it('fails for invalid dateFrom format', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        dateFrom: 'not-a-date',
      })
      expect(result.success).toBe(false)
    })

    it('fails for invalid dateTo format', () => {
      const result = searchQuerySchema.safeParse({
        q: 'test',
        dateTo: '2026/01/15',
      })
      expect(result.success).toBe(false)
    })

    it('parses optional cursor', () => {
      const cursor = Buffer.from(
        JSON.stringify({ rank: 0.5, uri: 'at://did:plc:test/forum.barazo.topic.post/abc' })
      ).toString('base64')
      const result = searchQuerySchema.safeParse({ q: 'test', cursor })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.cursor).toBe(cursor)
      }
    })
  })
})

import { describe, it, expect } from 'vitest'
import { validateRecord } from '../../../src/firehose/validation.js'

describe('validateRecord', () => {
  describe('topic post validation', () => {
    const validTopic = {
      title: 'Test Topic',
      content: 'Some content here',
      contentFormat: 'markdown',
      community: 'did:plc:abc123',
      category: 'general',
      tags: ['test'],
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    it('accepts a valid topic post', () => {
      const result = validateRecord('forum.barazo.topic.post', validTopic)
      expect(result.success).toBe(true)
    })

    it('rejects a topic post with missing title', () => {
      const { title: _, ...invalid } = validTopic
      const result = validateRecord('forum.barazo.topic.post', invalid)
      expect(result.success).toBe(false)
    })

    it('rejects a topic post with empty content', () => {
      const result = validateRecord('forum.barazo.topic.post', {
        ...validTopic,
        content: '',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('topic reply validation', () => {
    const validReply = {
      content: 'A reply',
      root: { uri: 'at://did:plc:abc/forum.barazo.topic.post/123', cid: 'bafyabc' },
      parent: { uri: 'at://did:plc:abc/forum.barazo.topic.post/123', cid: 'bafyabc' },
      community: 'did:plc:abc123',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    it('accepts a valid topic reply', () => {
      const result = validateRecord('forum.barazo.topic.reply', validReply)
      expect(result.success).toBe(true)
    })

    it('rejects a reply with missing root ref', () => {
      const { root: _, ...invalid } = validReply
      const result = validateRecord('forum.barazo.topic.reply', invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('reaction validation', () => {
    const validReaction = {
      subject: { uri: 'at://did:plc:abc/forum.barazo.topic.post/123', cid: 'bafyabc' },
      type: 'like',
      community: 'did:plc:abc123',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    it('accepts a valid reaction', () => {
      const result = validateRecord('forum.barazo.interaction.reaction', validReaction)
      expect(result.success).toBe(true)
    })

    it('rejects a reaction with missing type', () => {
      const { type: _, ...invalid } = validReaction
      const result = validateRecord('forum.barazo.interaction.reaction', invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('unknown collection', () => {
    it('rejects an unknown collection', () => {
      const result = validateRecord('com.example.unknown', { foo: 'bar' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Unsupported collection')
      }
    })
  })

  describe('size limit', () => {
    it('rejects records exceeding 64KB', () => {
      const oversized = {
        title: 'Test',
        content: 'x'.repeat(65_537),
        community: 'did:plc:abc123',
        category: 'general',
        createdAt: '2026-01-01T00:00:00.000Z',
      }
      const result = validateRecord('forum.barazo.topic.post', oversized)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('exceeds maximum size')
      }
    })
  })
})

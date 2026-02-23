import { describe, it, expect } from 'vitest'
import { SUPPORTED_COLLECTIONS, COLLECTION_MAP } from '../../../src/firehose/types.js'

describe('firehose types', () => {
  describe('SUPPORTED_COLLECTIONS', () => {
    it('contains topic post collection', () => {
      expect(SUPPORTED_COLLECTIONS).toContain('forum.barazo.topic.post')
    })

    it('contains topic reply collection', () => {
      expect(SUPPORTED_COLLECTIONS).toContain('forum.barazo.topic.reply')
    })

    it('contains reaction collection', () => {
      expect(SUPPORTED_COLLECTIONS).toContain('forum.barazo.interaction.reaction')
    })

    it('contains vote collection', () => {
      expect(SUPPORTED_COLLECTIONS).toContain('forum.barazo.interaction.vote')
    })

    it('has exactly 4 supported collections', () => {
      expect(SUPPORTED_COLLECTIONS).toHaveLength(4)
    })
  })

  describe('COLLECTION_MAP', () => {
    it("maps topic post to 'topic'", () => {
      expect(COLLECTION_MAP['forum.barazo.topic.post']).toBe('topic')
    })

    it("maps topic reply to 'reply'", () => {
      expect(COLLECTION_MAP['forum.barazo.topic.reply']).toBe('reply')
    })

    it("maps reaction to 'reaction'", () => {
      expect(COLLECTION_MAP['forum.barazo.interaction.reaction']).toBe('reaction')
    })

    it("maps vote to 'vote'", () => {
      expect(COLLECTION_MAP['forum.barazo.interaction.vote']).toBe('vote')
    })

    it('returns undefined for unsupported collection', () => {
      expect(COLLECTION_MAP['com.example.unknown' as keyof typeof COLLECTION_MAP]).toBeUndefined()
    })
  })
})

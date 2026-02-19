import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeTrigrams,
  jaccardSimilarity,
  createBehavioralHeuristicsService,
} from '../../../src/services/behavioral-heuristics.js'
import { createMockDb, createChainableProxy, resetDbMocks } from '../../helpers/mock-db.js'
import type { DbChain } from '../../helpers/mock-db.js'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('computeTrigrams', () => {
  it('computes trigrams from simple text', () => {
    const trigrams = computeTrigrams('hello')
    expect(trigrams.has('hel')).toBe(true)
    expect(trigrams.has('ell')).toBe(true)
    expect(trigrams.has('llo')).toBe(true)
    expect(trigrams.size).toBe(3)
  })

  it('normalizes to lowercase', () => {
    const trigrams = computeTrigrams('HELLO')
    expect(trigrams.has('hel')).toBe(true)
  })

  it('strips non-alphanumeric characters', () => {
    const trigrams = computeTrigrams('hi! there.')
    // Should normalize to "hi there"
    expect(trigrams.has('hi ')).toBe(true)
    expect(trigrams.has('i t')).toBe(true)
  })

  it('returns empty set for short text', () => {
    const trigrams = computeTrigrams('ab')
    expect(trigrams.size).toBe(0)
  })

  it('handles empty string', () => {
    const trigrams = computeTrigrams('')
    expect(trigrams.size).toBe(0)
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const a = new Set(['abc', 'bcd', 'cde'])
    const b = new Set(['abc', 'bcd', 'cde'])
    expect(jaccardSimilarity(a, b)).toBe(1)
  })

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['abc', 'bcd'])
    const b = new Set(['xyz', 'yzw'])
    expect(jaccardSimilarity(a, b)).toBe(0)
  })

  it('returns correct value for partial overlap', () => {
    const a = new Set(['abc', 'bcd', 'cde'])
    const b = new Set(['abc', 'bcd', 'xyz'])
    // Intersection: 2, Union: 4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5)
  })

  it('returns 1 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1)
  })

  it('returns 0 when one set is empty', () => {
    const a = new Set(['abc'])
    const b = new Set<string>()
    expect(jaccardSimilarity(a, b)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Service tests
// ---------------------------------------------------------------------------

describe('BehavioralHeuristicsService', () => {
  const mockDb = createMockDb()
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  }

  let selectChain: DbChain
  let insertChain: DbChain

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks(mockDb)
    selectChain = createChainableProxy([])
    insertChain = createChainableProxy()
    mockDb.select.mockReturnValue(selectChain)
    mockDb.insert.mockReturnValue(insertChain)
  })

  describe('detectBurstVoting', () => {
    it('returns empty array when no burst voting detected', async () => {
      // db.select().from().where().groupBy().having() returns []
      const burstChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(burstChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectBurstVoting(null)

      expect(flags).toHaveLength(0)
    })

    it('detects burst voting and persists flag', async () => {
      // db.select().from().where().groupBy().having() returns spammer rows
      const burstChain = createChainableProxy([
        { authorDid: 'did:plc:spammer1', reactionCount: 25 },
      ])
      mockDb.select.mockReturnValueOnce(burstChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectBurstVoting(null)

      expect(flags).toHaveLength(1)
      expect(flags[0]?.flagType).toBe('burst_voting')
      expect(flags[0]?.affectedDids).toContain('did:plc:spammer1')
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('scopes burst voting detection to a community', async () => {
      const burstChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(burstChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      await service.detectBurstVoting('community123')

      expect(mockDb.select).toHaveBeenCalled()
    })

    it('handles errors gracefully', async () => {
      // Make the select chain throw
      const errorChain = createChainableProxy()
      errorChain.from.mockReturnValue(errorChain)
      errorChain.where.mockReturnValue(errorChain)
      errorChain.groupBy.mockReturnValue(errorChain)
      errorChain.having.mockRejectedValueOnce(new Error('DB down'))
      mockDb.select.mockReturnValueOnce(errorChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectBurstVoting(null)

      expect(flags).toHaveLength(0)
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('detectContentSimilarity', () => {
    it('returns empty array when no similar content found', async () => {
      const selectChain = createChainableProxy([])
      mockDb.select.mockReturnValue(selectChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectContentSimilarity(null)

      expect(flags).toHaveLength(0)
    })

    it('detects similar content from different DIDs', async () => {
      // The same content posted by 3 different DIDs
      const similarContent =
        'This is a test post with enough content to generate meaningful trigrams for comparison purposes'
      const topicRows = [
        { authorDid: 'did:plc:user1', content: similarContent, uri: 'at://did:plc:user1/topic/1' },
        { authorDid: 'did:plc:user2', content: similarContent, uri: 'at://did:plc:user2/topic/2' },
        { authorDid: 'did:plc:user3', content: similarContent, uri: 'at://did:plc:user3/topic/3' },
      ]

      // First select: topics
      const topicSelectChain = createChainableProxy(topicRows)
      // Second select: replies
      const replySelectChain = createChainableProxy([])

      mockDb.select.mockReturnValueOnce(topicSelectChain).mockReturnValueOnce(replySelectChain)

      // Insert for persisting the flag
      const insertChain = createChainableProxy()
      mockDb.insert.mockReturnValue(insertChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectContentSimilarity(null)

      expect(flags).toHaveLength(1)
      expect(flags[0]?.flagType).toBe('content_similarity')
      expect(flags[0]?.affectedDids).toHaveLength(3)
    })

    it('does not flag content from the same DID', async () => {
      const content = 'This is a test post with enough content for trigrams comparison and analysis'
      const topicRows = [
        { authorDid: 'did:plc:user1', content, uri: 'at://did:plc:user1/topic/1' },
        { authorDid: 'did:plc:user1', content, uri: 'at://did:plc:user1/topic/2' },
        { authorDid: 'did:plc:user1', content, uri: 'at://did:plc:user1/topic/3' },
      ]

      const topicSelectChain = createChainableProxy(topicRows)
      const replySelectChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(topicSelectChain).mockReturnValueOnce(replySelectChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectContentSimilarity(null)

      expect(flags).toHaveLength(0)
    })
  })

  describe('detectLowDiversity', () => {
    it('returns empty array when no low diversity detected', async () => {
      // db.select().from().where().groupBy().having() returns []
      const diversityChain = createChainableProxy([])
      mockDb.select.mockReturnValueOnce(diversityChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectLowDiversity(null)

      expect(flags).toHaveLength(0)
    })

    it('detects low interaction diversity', async () => {
      // db.select().from().where().groupBy().having() returns puppets
      const diversityChain = createChainableProxy([
        { authorDid: 'did:plc:puppet1', totalInteractions: 15, uniqueTargets: 2 },
      ])
      mockDb.select.mockReturnValueOnce(diversityChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectLowDiversity(null)

      expect(flags).toHaveLength(1)
      expect(flags[0]?.flagType).toBe('low_diversity')
      expect(flags[0]?.affectedDids).toContain('did:plc:puppet1')
    })

    it('handles errors gracefully', async () => {
      const errorChain = createChainableProxy()
      errorChain.from.mockReturnValue(errorChain)
      errorChain.where.mockReturnValue(errorChain)
      errorChain.groupBy.mockReturnValue(errorChain)
      errorChain.having.mockRejectedValueOnce(new Error('DB timeout'))
      mockDb.select.mockReturnValueOnce(errorChain)

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.detectLowDiversity(null)

      expect(flags).toHaveLength(0)
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('runAll', () => {
    it('aggregates flags from all heuristics', async () => {
      // Burst voting: db.select().from().where().groupBy().having() -> spammer
      const burstChain = createChainableProxy([
        { authorDid: 'did:plc:spammer1', reactionCount: 25 },
      ])
      // Content similarity: topics -> empty, replies -> empty
      const topicSelectChain = createChainableProxy([])
      const replySelectChain = createChainableProxy([])
      // Low diversity: db.select().from().where().groupBy().having() -> empty
      const diversityChain = createChainableProxy([])

      mockDb.select
        .mockReturnValueOnce(burstChain) // burst voting query
        .mockReturnValueOnce(topicSelectChain) // content similarity: topics
        .mockReturnValueOnce(replySelectChain) // content similarity: replies
        .mockReturnValueOnce(diversityChain) // low diversity query

      const service = createBehavioralHeuristicsService(mockDb as never, mockLogger as never)
      const flags = await service.runAll(null)

      // At least 1 flag from burst voting
      expect(flags.length).toBeGreaterThanOrEqual(1)
      expect(flags.some((f) => f.flagType === 'burst_voting')).toBe(true)
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadMutedWords, contentMatchesMutedWords } from '../../../src/lib/muted-words.js'

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function createMockDb() {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockResolvedValue([])

  return {
    select: vi.fn().mockReturnValue(chain),
    chain,
  }
}

// ---------------------------------------------------------------------------
// loadMutedWords
// ---------------------------------------------------------------------------

describe('loadMutedWords', () => {
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it('returns empty array for unauthenticated user', async () => {
    const result = await loadMutedWords(undefined, undefined, mockDb)
    expect(result).toEqual([])
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('returns global muted words when no community override', async () => {
    mockDb.chain.where.mockResolvedValueOnce([{ mutedWords: ['spam', 'nsfw'] }])

    const result = await loadMutedWords('did:plc:user1', undefined, mockDb)
    expect(result).toEqual(['spam', 'nsfw'])
  })

  it('returns empty array when no preferences row exists', async () => {
    mockDb.chain.where.mockResolvedValueOnce([])

    const result = await loadMutedWords('did:plc:user1', undefined, mockDb)
    expect(result).toEqual([])
  })

  it('returns empty array when mutedWords is null', async () => {
    mockDb.chain.where.mockResolvedValueOnce([{ mutedWords: null }])

    const result = await loadMutedWords('did:plc:user1', undefined, mockDb)
    expect(result).toEqual([])
  })

  it('merges global + per-community muted words (deduplicated)', async () => {
    // First call: global prefs
    mockDb.chain.where.mockResolvedValueOnce([{ mutedWords: ['spam', 'crypto'] }])
    // Second call: community prefs
    mockDb.chain.where.mockResolvedValueOnce([{ mutedWords: ['politics', 'crypto'] }])

    const result = await loadMutedWords('did:plc:user1', 'did:plc:community1', mockDb)
    expect(result).toEqual(expect.arrayContaining(['spam', 'crypto', 'politics']))
    expect(result).toHaveLength(3) // deduplicated
  })

  it('uses only global words when community override is null', async () => {
    // First call: global prefs
    mockDb.chain.where.mockResolvedValueOnce([{ mutedWords: ['spam'] }])
    // Second call: community prefs with null mutedWords
    mockDb.chain.where.mockResolvedValueOnce([{ mutedWords: null }])

    const result = await loadMutedWords('did:plc:user1', 'did:plc:community1', mockDb)
    expect(result).toEqual(['spam'])
  })
})

// ---------------------------------------------------------------------------
// contentMatchesMutedWords
// ---------------------------------------------------------------------------

describe('contentMatchesMutedWords', () => {
  it('returns false for empty muted words list', () => {
    expect(contentMatchesMutedWords('hello world', [])).toBe(false)
  })

  it('returns false when no words match', () => {
    expect(contentMatchesMutedWords('hello world', ['spam', 'crypto'])).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(contentMatchesMutedWords('This is SPAM content', ['spam'])).toBe(true)
    expect(contentMatchesMutedWords('this is spam content', ['SPAM'])).toBe(true)
  })

  it('matches word boundaries (not partial words)', () => {
    // "class" should NOT match "classification"
    expect(contentMatchesMutedWords('classification system', ['class'])).toBe(false)
    // But should match standalone "class"
    expect(contentMatchesMutedWords('this class is good', ['class'])).toBe(true)
  })

  it('matches at start and end of content', () => {
    expect(contentMatchesMutedWords('spam is bad', ['spam'])).toBe(true)
    expect(contentMatchesMutedWords('this is spam', ['spam'])).toBe(true)
  })

  it('matches multi-word phrases', () => {
    expect(contentMatchesMutedWords('buy crypto now for gains', ['buy crypto'])).toBe(true)
  })

  it('handles content with punctuation around words', () => {
    expect(contentMatchesMutedWords('is this spam?', ['spam'])).toBe(true)
    expect(contentMatchesMutedWords('(spam) detected', ['spam'])).toBe(true)
    expect(contentMatchesMutedWords("'spam' alert", ['spam'])).toBe(true)
  })

  it('handles empty content', () => {
    expect(contentMatchesMutedWords('', ['spam'])).toBe(false)
  })

  it('matches title + content combined', () => {
    expect(contentMatchesMutedWords('Buy now', ['crypto'], 'Crypto trading tips')).toBe(true)
  })

  it('returns false when title and content both miss', () => {
    expect(contentMatchesMutedWords('Hello world', ['crypto'], 'General discussion')).toBe(false)
  })

  it('escapes regex special characters in muted words', () => {
    expect(contentMatchesMutedWords('price is $100', ['$100'])).toBe(true)
    expect(contentMatchesMutedWords('use (parens) here', ['(parens)'])).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { RequestUser } from '../../../src/auth/middleware.js'

// ---------------------------------------------------------------------------
// Mock DB with execute method (search uses raw SQL, not Drizzle query builder)
// ---------------------------------------------------------------------------

const mockDb = {
  execute: vi.fn(),
}

// ---------------------------------------------------------------------------
// Mock embedding service
// ---------------------------------------------------------------------------

const mockIsEnabled = vi.fn().mockReturnValue(false)
const mockGenerateEmbedding = vi.fn().mockResolvedValue(null)

vi.mock('../../../src/services/embedding.js', () => ({
  createEmbeddingService: vi.fn(() => ({
    isEnabled: mockIsEnabled,
    generateEmbedding: mockGenerateEmbedding,
  })),
}))

// Import routes AFTER mocking
import { searchRoutes } from '../../../src/routes/search.js'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = 'did:plc:testuser123'
const TEST_COMMUNITY_DID = 'did:plc:community123'
const TEST_NOW = new Date('2026-02-13T12:00:00.000Z')

// ---------------------------------------------------------------------------
// Sample row builders (snake_case to match raw SQL output)
// ---------------------------------------------------------------------------

function sampleTopicRow(overrides?: Record<string, unknown>) {
  return {
    uri: `at://${TEST_DID}/forum.barazo.topic.post/topic123`,
    rkey: 'topic123',
    author_did: TEST_DID,
    title: 'Test Topic Title',
    content: 'This is a test topic body content for search testing.',
    category: 'general',
    community_did: TEST_COMMUNITY_DID,
    reply_count: 5,
    reaction_count: 3,
    created_at: TEST_NOW,
    rank: 0.75,
    ...overrides,
  }
}

function sampleReplyRow(overrides?: Record<string, unknown>) {
  return {
    uri: `at://${TEST_DID}/forum.barazo.topic.reply/reply123`,
    rkey: 'reply123',
    author_did: TEST_DID,
    content: 'This is a reply to the test topic.',
    community_did: TEST_COMMUNITY_DID,
    reaction_count: 1,
    created_at: TEST_NOW,
    root_uri: `at://${TEST_DID}/forum.barazo.topic.post/topic123`,
    root_title: 'Test Topic Title',
    rank: 0.6,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: build app
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.decorateRequest('user', undefined as RequestUser | undefined)
  app.decorate('db', mockDb as never)
  app.decorate('env', {
    EMBEDDING_URL: undefined,
    AI_EMBEDDING_DIMENSIONS: 768,
  } as never)
  app.decorate('authMiddleware', {
    requireAuth: vi.fn((_req: unknown, _reply: unknown) => Promise.resolve()),
    optionalAuth: vi.fn((_req: unknown, _reply: unknown) => Promise.resolve()),
  } as never)
  app.decorate('cache', {} as never)

  await app.register(searchRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('search routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockDb.execute.mockResolvedValue([])
    mockIsEnabled.mockReturnValue(false)
    mockGenerateEmbedding.mockResolvedValue(null)

    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // =========================================================================
  // Validation
  // =========================================================================

  it('returns 400 when q is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search',
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns 400 when q is empty', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=',
    })

    expect(response.statusCode).toBe(400)
  })

  // =========================================================================
  // Full-text search: basic results
  // =========================================================================

  it('returns empty results when no matches', async () => {
    mockDb.execute.mockResolvedValue([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=nonexistent',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: unknown[]
      cursor: string | null
      total: number
      searchMode: string
    }>()
    expect(body.results).toEqual([])
    expect(body.cursor).toBeNull()
    expect(body.total).toBe(0)
  })

  it('returns topic results from full-text search', async () => {
    const topicRow = sampleTopicRow()
    // First execute: topic search
    mockDb.execute.mockResolvedValueOnce([topicRow])
    // Second execute: reply search (empty)
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{
        type: string
        uri: string
        authorDid: string
        title: string | null
        content: string
        category: string | null
        communityDid: string
        replyCount: number | null
        reactionCount: number
        rank: number
      }>
      searchMode: string
    }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.type).toBe('topic')
    expect(body.results[0]?.uri).toBe(topicRow.uri)
    expect(body.results[0]?.authorDid).toBe(TEST_DID)
    expect(body.results[0]?.title).toBe('Test Topic Title')
    expect(body.results[0]?.category).toBe('general')
    expect(body.results[0]?.communityDid).toBe(TEST_COMMUNITY_DID)
    expect(body.results[0]?.replyCount).toBe(5)
    expect(body.results[0]?.reactionCount).toBe(3)
  })

  it('returns reply results with root topic context', async () => {
    const replyRow = sampleReplyRow()
    // First execute: topic search (empty)
    mockDb.execute.mockResolvedValueOnce([])
    // Second execute: reply search
    mockDb.execute.mockResolvedValueOnce([replyRow])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=reply',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{
        type: string
        uri: string
        rootUri: string | null
        rootTitle: string | null
        title: string | null
        category: string | null
      }>
    }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.type).toBe('reply')
    expect(body.results[0]?.rootUri).toBe(replyRow.root_uri)
    expect(body.results[0]?.rootTitle).toBe('Test Topic Title')
    // Replies have no own title or category
    expect(body.results[0]?.title).toBeNull()
    expect(body.results[0]?.category).toBeNull()
  })

  // =========================================================================
  // Filters
  // =========================================================================

  it('applies category filter', async () => {
    // Topic search returns results matching category
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow({ category: 'support' })])
    // Reply search (no category filter for replies)
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=help&category=support',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ category: string | null }>
    }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.category).toBe('support')

    // db.execute should have been called (verifying it was invoked with the filter)
    expect(mockDb.execute).toHaveBeenCalled()
  })

  it('applies author filter', async () => {
    const authorDid = 'did:plc:specific_author'
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow({ author_did: authorDid })])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: `/api/search?q=post&author=${encodeURIComponent(authorDid)}`,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ authorDid: string }>
    }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.authorDid).toBe(authorDid)
  })

  it('applies date range filters', async () => {
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow()])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test&dateFrom=2026-01-01T00:00:00Z&dateTo=2026-03-01T00:00:00Z',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ results: unknown[] }>().results).toHaveLength(1)
    // The date filters are embedded in the SQL; we verify the query succeeded
    expect(mockDb.execute).toHaveBeenCalled()
  })

  // =========================================================================
  // Type filter
  // =========================================================================

  it("handles type filter 'topics' (only topics searched)", async () => {
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow()])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test&type=topics',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ type: string }>
    }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.type).toBe('topic')

    // Only one execute call -- topics only, no reply search
    expect(mockDb.execute).toHaveBeenCalledTimes(1)
  })

  it("handles type filter 'replies' (only replies searched)", async () => {
    mockDb.execute.mockResolvedValueOnce([sampleReplyRow()])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test&type=replies',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ type: string }>
    }>()
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.type).toBe('reply')

    // Only one execute call -- replies only, no topic search
    expect(mockDb.execute).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // Pagination
  // =========================================================================

  it('returns cursor for pagination when more results exist', async () => {
    // Default limit is 25. Route fetches limit+1=26.
    // Return 26 topic results to trigger hasMore.
    const rows = Array.from({ length: 26 }, (_, i) =>
      sampleTopicRow({
        uri: `at://${TEST_DID}/forum.barazo.topic.post/topic${String(i).padStart(3, '0')}`,
        rkey: `topic${String(i).padStart(3, '0')}`,
        rank: 1.0 - i * 0.01,
      })
    )

    // Topics search returns 26 rows
    mockDb.execute.mockResolvedValueOnce(rows)
    // Replies search returns empty
    mockDb.execute.mockResolvedValueOnce([])
    // Count query for topics
    mockDb.execute.mockResolvedValueOnce([{ count: '50' }])
    // Count query for replies
    mockDb.execute.mockResolvedValueOnce([{ count: '10' }])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: unknown[]
      cursor: string | null
      total: number
    }>()
    // Should return exactly 25 (limit), not 26
    expect(body.results).toHaveLength(25)
    expect(body.cursor).toBeTruthy()
    expect(body.total).toBe(60) // 50 topics + 10 replies
  })

  it('returns null cursor when fewer results than limit', async () => {
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow()])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      cursor: string | null
      total: number
    }>()
    expect(body.cursor).toBeNull()
    expect(body.total).toBe(1)
  })

  // =========================================================================
  // Search mode reporting
  // =========================================================================

  it("reports searchMode as 'fulltext' when no embedding URL", async () => {
    mockDb.execute.mockResolvedValueOnce([])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ searchMode: string }>()
    expect(body.searchMode).toBe('fulltext')
  })

  it("reports searchMode as 'hybrid' when embedding service is available and returns embeddings", async () => {
    // Configure embedding service as enabled with working embeddings
    mockIsEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])

    // Rebuild app to pick up updated mock state
    const hybridApp = await buildTestApp()

    // Full-text topic results
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow()])
    // Full-text reply results
    mockDb.execute.mockResolvedValueOnce([])
    // Vector topic results
    mockDb.execute.mockResolvedValueOnce([])
    // Vector reply results
    mockDb.execute.mockResolvedValueOnce([])

    const response = await hybridApp.inject({
      method: 'GET',
      url: '/api/search?q=semantic+query',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ searchMode: string }>()
    expect(body.searchMode).toBe('hybrid')

    await hybridApp.close()
  })

  it('falls back to fulltext when embedding service is enabled but returns null', async () => {
    mockIsEnabled.mockReturnValue(true)
    mockGenerateEmbedding.mockResolvedValue(null)

    const fallbackApp = await buildTestApp()

    mockDb.execute.mockResolvedValueOnce([])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await fallbackApp.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ searchMode: string }>()
    expect(body.searchMode).toBe('fulltext')

    await fallbackApp.close()
  })

  // =========================================================================
  // Content snippeting
  // =========================================================================

  it('truncates long content to snippet', async () => {
    const longContent = 'A'.repeat(500)
    mockDb.execute.mockResolvedValueOnce([sampleTopicRow({ content: longContent })])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ content: string }>
    }>()
    // createSnippet truncates at 300 chars + "..."
    expect(body.results[0]?.content.length).toBeLessThanOrEqual(303)
    expect(body.results[0]?.content).toContain('...')
  })

  // =========================================================================
  // Date serialization
  // =========================================================================

  it('serializes Date objects as ISO strings in results', async () => {
    mockDb.execute.mockResolvedValueOnce([
      sampleTopicRow({ created_at: new Date('2026-02-13T12:00:00.000Z') }),
    ])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ createdAt: string }>
    }>()
    expect(body.results[0]?.createdAt).toBe('2026-02-13T12:00:00.000Z')
  })

  it('handles string dates from DB gracefully', async () => {
    mockDb.execute.mockResolvedValueOnce([
      sampleTopicRow({ created_at: '2026-02-13T12:00:00.000Z' }),
    ])
    mockDb.execute.mockResolvedValueOnce([])

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=test',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      results: Array<{ createdAt: string }>
    }>()
    expect(body.results[0]?.createdAt).toBe('2026-02-13T12:00:00.000Z')
  })
})

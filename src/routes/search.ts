import { sql } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { badRequest } from '../lib/api-errors.js'
import { loadMutedWords, contentMatchesMutedWords } from '../lib/muted-words.js'
import { createEmbeddingService } from '../services/embedding.js'
import { searchQuerySchema } from '../validation/search.js'
import type { Database } from '../db/index.js'

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const searchResultJsonSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' as const, enum: ['topic', 'reply'] },
    uri: { type: 'string' as const },
    rkey: { type: 'string' as const },
    authorDid: { type: 'string' as const },
    title: { type: ['string', 'null'] as const },
    content: { type: 'string' as const },
    category: { type: ['string', 'null'] as const },
    communityDid: { type: 'string' as const },
    replyCount: { type: ['integer', 'null'] as const },
    reactionCount: { type: 'integer' as const },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
    rank: { type: 'number' as const },
    rootUri: { type: ['string', 'null'] as const },
    rootTitle: { type: ['string', 'null'] as const },
    isMutedWord: { type: 'boolean' as const },
  },
}

const errorJsonSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
  },
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopicSearchRow {
  [key: string]: unknown
  uri: string
  rkey: string
  author_did: string
  title: string
  content: string
  category: string
  community_did: string
  reply_count: number
  reaction_count: number
  created_at: Date
  rank: number
}

interface ReplySearchRow {
  [key: string]: unknown
  uri: string
  rkey: string
  author_did: string
  content: string
  community_did: string
  reaction_count: number
  created_at: Date
  root_uri: string
  root_title: string | null
  rank: number
}

interface CountRow {
  [key: string]: unknown
  count: string
}

interface SearchResultItem {
  type: 'topic' | 'reply'
  uri: string
  rkey: string
  authorDid: string
  title: string | null
  content: string
  category: string | null
  communityDid: string
  replyCount: number | null
  reactionCount: number
  createdAt: string
  rank: number
  rootUri: string | null
  rootTitle: string | null
  isMutedWord?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a text snippet from content. Returns first ~300 characters,
 * truncating at a word boundary when possible.
 */
function createSnippet(content: string, maxLength = 300): string {
  if (content.length <= maxLength) {
    return content
  }
  return content.slice(0, maxLength) + '...'
}

/**
 * Encode a search cursor from rank + uri.
 */
function encodeCursor(rank: number, uri: string): string {
  return Buffer.from(JSON.stringify({ rank, uri })).toString('base64')
}

/**
 * Decode a search cursor. Returns null if invalid.
 */
function decodeCursor(cursor: string): { rank: number; uri: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as Record<
      string,
      unknown
    >
    if (typeof decoded.rank === 'number' && typeof decoded.uri === 'string') {
      return { rank: decoded.rank, uri: decoded.uri }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Merge full-text and vector search results using Reciprocal Rank Fusion.
 * RRF formula: score = sum(1 / (k + rank_i)) for each ranking system.
 * k=60 is the standard constant to prevent top-ranked items from dominating.
 */
function reciprocalRankFusion(
  fulltextResults: SearchResultItem[],
  vectorResults: SearchResultItem[],
  k = 60
): SearchResultItem[] {
  const scores = new Map<string, { score: number; item: SearchResultItem }>()

  // Score full-text results by their position (rank = position, 1-indexed)
  for (let i = 0; i < fulltextResults.length; i++) {
    const item = fulltextResults[i]
    if (!item) continue
    const rrfScore = 1.0 / (k + i + 1)
    scores.set(item.uri, { score: rrfScore, item })
  }

  // Score vector results by their position
  for (let i = 0; i < vectorResults.length; i++) {
    const item = vectorResults[i]
    if (!item) continue
    const rrfScore = 1.0 / (k + i + 1)
    const existing = scores.get(item.uri)
    if (existing) {
      existing.score += rrfScore
    } else {
      scores.set(item.uri, { score: rrfScore, item })
    }
  }

  // Sort by RRF score descending
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.item, rank: entry.score }))
}

// ---------------------------------------------------------------------------
// Search routes plugin
// ---------------------------------------------------------------------------

/**
 * Search routes for the Barazo forum.
 *
 * - GET /api/search -- Full-text search (with optional semantic/hybrid mode)
 */
export function searchRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware } = app

    const embeddingService = createEmbeddingService(
      env.EMBEDDING_URL,
      env.AI_EMBEDDING_DIMENSIONS,
      app.log
    )

    // -------------------------------------------------------------------
    // GET /api/search (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get(
      '/api/search',
      {
        preHandler: [authMiddleware.optionalAuth],
        schema: {
          tags: ['Search'],
          summary: 'Search topics and replies',
          querystring: {
            type: 'object',
            required: ['q'],
            properties: {
              q: { type: 'string', minLength: 1, maxLength: 500 },
              category: { type: 'string' },
              author: { type: 'string' },
              dateFrom: { type: 'string', format: 'date-time' },
              dateTo: { type: 'string', format: 'date-time' },
              type: {
                type: 'string',
                enum: ['topics', 'replies', 'all'],
                default: 'all',
              },
              limit: { type: 'string' },
              cursor: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: searchResultJsonSchema,
                },
                cursor: { type: ['string', 'null'] },
                total: { type: 'integer' },
                searchMode: {
                  type: 'string',
                  enum: ['fulltext', 'hybrid'],
                },
              },
            },
            400: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = searchQuerySchema.safeParse(request.query)
        if (!parsed.success) {
          throw badRequest('Invalid search parameters')
        }

        const {
          q: query,
          category,
          author,
          dateFrom,
          dateTo,
          type: searchType,
          limit,
          cursor,
        } = parsed.data

        // Parse cursor for pagination
        let cursorRank: number | undefined
        let cursorUri: string | undefined
        if (cursor) {
          const decoded = decodeCursor(cursor)
          if (decoded) {
            cursorRank = decoded.rank
            cursorUri = decoded.uri
          }
        }

        // Determine search mode
        let searchMode: 'fulltext' | 'hybrid' = 'fulltext'
        let queryEmbedding: number[] | null = null

        if (embeddingService.isEnabled()) {
          queryEmbedding = await embeddingService.generateEmbedding(query)
          if (queryEmbedding) {
            searchMode = 'hybrid'
          }
        }

        const allResults: SearchResultItem[] = []

        // -----------------------------------------------------------------
        // Full-text search: topics
        // -----------------------------------------------------------------
        if (searchType === 'topics' || searchType === 'all') {
          const topicResults = await searchTopicsFulltext(
            db,
            query,
            {
              category,
              author,
              dateFrom,
              dateTo,
              cursorRank,
              cursorUri,
            },
            limit + 1
          )

          for (const row of topicResults) {
            allResults.push({
              type: 'topic',
              uri: row.uri,
              rkey: row.rkey,
              authorDid: row.author_did,
              title: row.title,
              content: createSnippet(row.content),
              category: row.category,
              communityDid: row.community_did,
              replyCount: row.reply_count,
              reactionCount: row.reaction_count,
              createdAt:
                row.created_at instanceof Date
                  ? row.created_at.toISOString()
                  : String(row.created_at),
              rank: row.rank,
              rootUri: null,
              rootTitle: null,
            })
          }
        }

        // -----------------------------------------------------------------
        // Full-text search: replies
        // -----------------------------------------------------------------
        if (searchType === 'replies' || searchType === 'all') {
          const replyResults = await searchRepliesFulltext(
            db,
            query,
            {
              author,
              dateFrom,
              dateTo,
              cursorRank,
              cursorUri,
            },
            limit + 1
          )

          for (const row of replyResults) {
            allResults.push({
              type: 'reply',
              uri: row.uri,
              rkey: row.rkey,
              authorDid: row.author_did,
              title: null,
              content: createSnippet(row.content),
              category: null,
              communityDid: row.community_did,
              replyCount: null,
              reactionCount: row.reaction_count,
              createdAt:
                row.created_at instanceof Date
                  ? row.created_at.toISOString()
                  : String(row.created_at),
              rank: row.rank,
              rootUri: row.root_uri,
              rootTitle: row.root_title,
            })
          }
        }

        // -----------------------------------------------------------------
        // Hybrid search: merge with vector results via RRF
        // -----------------------------------------------------------------
        let mergedResults: SearchResultItem[]

        if (searchMode === 'hybrid' && queryEmbedding) {
          const vectorResults: SearchResultItem[] = []

          if (searchType === 'topics' || searchType === 'all') {
            const vecTopics = await searchTopicsVector(
              db,
              queryEmbedding,
              {
                category,
                author,
                dateFrom,
                dateTo,
              },
              limit
            )

            for (const row of vecTopics) {
              vectorResults.push({
                type: 'topic',
                uri: row.uri,
                rkey: row.rkey,
                authorDid: row.author_did,
                title: row.title,
                content: createSnippet(row.content),
                category: row.category,
                communityDid: row.community_did,
                replyCount: row.reply_count,
                reactionCount: row.reaction_count,
                createdAt:
                  row.created_at instanceof Date
                    ? row.created_at.toISOString()
                    : String(row.created_at),
                rank: row.rank,
                rootUri: null,
                rootTitle: null,
              })
            }
          }

          if (searchType === 'replies' || searchType === 'all') {
            const vecReplies = await searchRepliesVector(
              db,
              queryEmbedding,
              {
                author,
                dateFrom,
                dateTo,
              },
              limit
            )

            for (const row of vecReplies) {
              vectorResults.push({
                type: 'reply',
                uri: row.uri,
                rkey: row.rkey,
                authorDid: row.author_did,
                title: null,
                content: createSnippet(row.content),
                category: null,
                communityDid: row.community_did,
                replyCount: null,
                reactionCount: row.reaction_count,
                createdAt:
                  row.created_at instanceof Date
                    ? row.created_at.toISOString()
                    : String(row.created_at),
                rank: row.rank,
                rootUri: row.root_uri,
                rootTitle: row.root_title,
              })
            }
          }

          mergedResults = reciprocalRankFusion(allResults, vectorResults)
        } else {
          // Full-text only: sort all results by rank descending
          mergedResults = allResults.sort((a, b) => b.rank - a.rank)
        }

        // -----------------------------------------------------------------
        // Pagination
        // -----------------------------------------------------------------
        const hasMore = mergedResults.length > limit
        const pageResults = hasMore ? mergedResults.slice(0, limit) : mergedResults

        let nextCursor: string | null = null
        if (hasMore) {
          const lastResult = pageResults[pageResults.length - 1]
          if (lastResult) {
            nextCursor = encodeCursor(lastResult.rank, lastResult.uri)
          }
        }

        // Count total results (separate query for accurate count)
        let total = pageResults.length
        if (hasMore) {
          total = await countSearchResults(db, query, {
            category,
            author,
            dateFrom,
            dateTo,
            searchType,
          })
        }

        // Muted word annotation: flag matching content for client-side collapsing
        const communityDid = env.COMMUNITY_MODE === 'single' ? env.COMMUNITY_DID : undefined
        const mutedWords = await loadMutedWords(request.user?.did, communityDid, db)

        const annotatedResults = pageResults.map((r) => ({
          ...r,
          isMutedWord: contentMatchesMutedWords(r.content, mutedWords, r.title ?? undefined),
        }))

        return reply.status(200).send({
          results: annotatedResults,
          cursor: nextCursor,
          total,
          searchMode,
        })
      }
    )

    done()
  }
}

// ---------------------------------------------------------------------------
// Database query helpers
// ---------------------------------------------------------------------------

interface SearchFilters {
  category?: string | undefined
  author?: string | undefined
  dateFrom?: string | undefined
  dateTo?: string | undefined
  cursorRank?: number | undefined
  cursorUri?: string | undefined
}

/**
 * Full-text search for topics using PostgreSQL tsvector.
 */
async function searchTopicsFulltext(
  db: Database,
  query: string,
  filters: SearchFilters,
  fetchLimit: number
): Promise<TopicSearchRow[]> {
  const conditions: ReturnType<typeof sql>[] = [
    sql`search_vector @@ websearch_to_tsquery('english', ${query})`,
    sql`is_mod_deleted = false`,
  ]

  if (filters.category) {
    conditions.push(sql`category = ${filters.category}`)
  }
  if (filters.author) {
    conditions.push(sql`author_did = ${filters.author}`)
  }
  if (filters.dateFrom) {
    conditions.push(sql`created_at >= ${filters.dateFrom}::timestamptz`)
  }
  if (filters.dateTo) {
    conditions.push(sql`created_at <= ${filters.dateTo}::timestamptz`)
  }
  if (filters.cursorRank !== undefined && filters.cursorUri) {
    conditions.push(
      sql`(ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})), uri) < (${filters.cursorRank}, ${filters.cursorUri})`
    )
  }

  const whereClause = sql.join(conditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      uri, rkey, author_did, title, content, category, community_did,
      reply_count, reaction_count, created_at,
      ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})) AS rank
    FROM topics
    WHERE ${whereClause}
    ORDER BY rank DESC, created_at DESC
    LIMIT ${fetchLimit}
  `)

  return result as unknown as TopicSearchRow[]
}

/**
 * Full-text search for replies using PostgreSQL tsvector.
 * Joins with topics to provide root topic context.
 */
async function searchRepliesFulltext(
  db: Database,
  query: string,
  filters: Omit<SearchFilters, 'category'>,
  fetchLimit: number
): Promise<ReplySearchRow[]> {
  const conditions: ReturnType<typeof sql>[] = [
    sql`r.search_vector @@ websearch_to_tsquery('english', ${query})`,
  ]

  if (filters.author) {
    conditions.push(sql`r.author_did = ${filters.author}`)
  }
  if (filters.dateFrom) {
    conditions.push(sql`r.created_at >= ${filters.dateFrom}::timestamptz`)
  }
  if (filters.dateTo) {
    conditions.push(sql`r.created_at <= ${filters.dateTo}::timestamptz`)
  }
  if (filters.cursorRank !== undefined && filters.cursorUri) {
    conditions.push(
      sql`(ts_rank_cd(r.search_vector, websearch_to_tsquery('english', ${query})), r.uri) < (${filters.cursorRank}, ${filters.cursorUri})`
    )
  }

  const whereClause = sql.join(conditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      r.uri, r.rkey, r.author_did, r.content, r.community_did,
      r.reaction_count, r.created_at, r.root_uri,
      t.title AS root_title,
      ts_rank_cd(r.search_vector, websearch_to_tsquery('english', ${query})) AS rank
    FROM replies r
    LEFT JOIN topics t ON t.uri = r.root_uri
    WHERE ${whereClause}
    ORDER BY rank DESC, r.created_at DESC
    LIMIT ${fetchLimit}
  `)

  return result as unknown as ReplySearchRow[]
}

/**
 * Vector similarity search for topics.
 * Uses cosine distance operator (<=>).
 */
async function searchTopicsVector(
  db: Database,
  queryEmbedding: number[],
  filters: Omit<SearchFilters, 'cursorRank' | 'cursorUri'>,
  fetchLimit: number
): Promise<TopicSearchRow[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`

  const conditions: ReturnType<typeof sql>[] = [
    sql`embedding IS NOT NULL`,
    sql`is_mod_deleted = false`,
    sql`embedding <=> ${embeddingStr}::vector < 0.5`,
  ]

  if (filters.category) {
    conditions.push(sql`category = ${filters.category}`)
  }
  if (filters.author) {
    conditions.push(sql`author_did = ${filters.author}`)
  }
  if (filters.dateFrom) {
    conditions.push(sql`created_at >= ${filters.dateFrom}::timestamptz`)
  }
  if (filters.dateTo) {
    conditions.push(sql`created_at <= ${filters.dateTo}::timestamptz`)
  }

  const whereClause = sql.join(conditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      uri, rkey, author_did, title, content, category, community_did,
      reply_count, reaction_count, created_at,
      (1.0 - (embedding <=> ${embeddingStr}::vector)) AS rank
    FROM topics
    WHERE ${whereClause}
    ORDER BY embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${fetchLimit}
  `)

  return result as unknown as TopicSearchRow[]
}

/**
 * Vector similarity search for replies.
 * Uses cosine distance operator (<=>).
 */
async function searchRepliesVector(
  db: Database,
  queryEmbedding: number[],
  filters: Omit<SearchFilters, 'category' | 'cursorRank' | 'cursorUri'>,
  fetchLimit: number
): Promise<ReplySearchRow[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`

  const conditions: ReturnType<typeof sql>[] = [
    sql`r.embedding IS NOT NULL`,
    sql`r.embedding <=> ${embeddingStr}::vector < 0.5`,
  ]

  if (filters.author) {
    conditions.push(sql`r.author_did = ${filters.author}`)
  }
  if (filters.dateFrom) {
    conditions.push(sql`r.created_at >= ${filters.dateFrom}::timestamptz`)
  }
  if (filters.dateTo) {
    conditions.push(sql`r.created_at <= ${filters.dateTo}::timestamptz`)
  }

  const whereClause = sql.join(conditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      r.uri, r.rkey, r.author_did, r.content, r.community_did,
      r.reaction_count, r.created_at, r.root_uri,
      t.title AS root_title,
      (1.0 - (r.embedding <=> ${embeddingStr}::vector)) AS rank
    FROM replies r
    LEFT JOIN topics t ON t.uri = r.root_uri
    WHERE ${whereClause}
    ORDER BY r.embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${fetchLimit}
  `)

  return result as unknown as ReplySearchRow[]
}

/**
 * Count total matching results for pagination metadata.
 */
async function countSearchResults(
  db: Database,
  query: string,
  filters: {
    category?: string | undefined
    author?: string | undefined
    dateFrom?: string | undefined
    dateTo?: string | undefined
    searchType: 'topics' | 'replies' | 'all'
  }
): Promise<number> {
  let total = 0

  if (filters.searchType === 'topics' || filters.searchType === 'all') {
    const conditions: ReturnType<typeof sql>[] = [
      sql`search_vector @@ websearch_to_tsquery('english', ${query})`,
      sql`is_mod_deleted = false`,
    ]

    if (filters.category) {
      conditions.push(sql`category = ${filters.category}`)
    }
    if (filters.author) {
      conditions.push(sql`author_did = ${filters.author}`)
    }
    if (filters.dateFrom) {
      conditions.push(sql`created_at >= ${filters.dateFrom}::timestamptz`)
    }
    if (filters.dateTo) {
      conditions.push(sql`created_at <= ${filters.dateTo}::timestamptz`)
    }

    const whereClause = sql.join(conditions, sql` AND `)

    const result = await db.execute(sql`
      SELECT COUNT(*) AS count
      FROM topics
      WHERE ${whereClause}
    `)

    const rows = result as unknown as CountRow[]
    total += Number(rows[0]?.count ?? 0)
  }

  if (filters.searchType === 'replies' || filters.searchType === 'all') {
    const conditions: ReturnType<typeof sql>[] = [
      sql`search_vector @@ websearch_to_tsquery('english', ${query})`,
    ]

    if (filters.author) {
      conditions.push(sql`author_did = ${filters.author}`)
    }
    if (filters.dateFrom) {
      conditions.push(sql`created_at >= ${filters.dateFrom}::timestamptz`)
    }
    if (filters.dateTo) {
      conditions.push(sql`created_at <= ${filters.dateTo}::timestamptz`)
    }

    const whereClause = sql.join(conditions, sql` AND `)

    const result = await db.execute(sql`
      SELECT COUNT(*) AS count
      FROM replies
      WHERE ${whereClause}
    `)

    const rows = result as unknown as CountRow[]
    total += Number(rows[0]?.count ?? 0)
  }

  return total
}

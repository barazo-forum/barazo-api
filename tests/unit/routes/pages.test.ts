import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../../../src/config/env.js'
import type { AuthMiddleware, RequestUser } from '../../../src/auth/middleware.js'
import type { SessionService } from '../../../src/auth/session.js'
import type { SetupService } from '../../../src/setup/service.js'
import { type DbChain, createChainableProxy, createMockDb } from '../../helpers/mock-db.js'

// Import routes (no PDS mocking needed -- pages are local-only)
import { pageRoutes } from '../../../src/routes/pages.js'

// ---------------------------------------------------------------------------
// Mock env (minimal subset for page routes)
// ---------------------------------------------------------------------------

const mockEnv = {
  COMMUNITY_DID: 'did:plc:community123',
  RATE_LIMIT_WRITE: 10,
  RATE_LIMIT_READ_ANON: 100,
  RATE_LIMIT_READ_AUTH: 300,
} as Env

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = 'did:plc:testuser123'
const TEST_HANDLE = 'jay.bsky.team'
const TEST_SID = 'a'.repeat(64)
const ADMIN_DID = 'did:plc:admin999'
const TEST_NOW = '2026-02-13T12:00:00.000Z'
const COMMUNITY_DID = 'did:plc:test'

const PAGE_ID_1 = 'page-001'
const PAGE_ID_2 = 'page-002'

// ---------------------------------------------------------------------------
// Mock user builders
// ---------------------------------------------------------------------------

function testUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    did: TEST_DID,
    handle: TEST_HANDLE,
    sid: TEST_SID,
    ...overrides,
  }
}

function adminUser(): RequestUser {
  return testUser({ did: ADMIN_DID, handle: 'admin.bsky.social' })
}

// ---------------------------------------------------------------------------
// Chainable mock DB (shared helper)
// ---------------------------------------------------------------------------

const mockDb = createMockDb()

let insertChain: DbChain
let selectChain: DbChain
let updateChain: DbChain
let deleteChain: DbChain

function resetAllDbMocks(): void {
  insertChain = createChainableProxy()
  selectChain = createChainableProxy([])
  updateChain = createChainableProxy([])
  deleteChain = createChainableProxy()
  mockDb.insert.mockReturnValue(insertChain)
  mockDb.select.mockReturnValue(selectChain)
  mockDb.update.mockReturnValue(updateChain)
  mockDb.delete.mockReturnValue(deleteChain)
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async mock for Drizzle transaction
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => {
    await fn(mockDb)
  })
}

// ---------------------------------------------------------------------------
// Auth middleware mocks
// ---------------------------------------------------------------------------

function createMockAuthMiddleware(user?: RequestUser): AuthMiddleware {
  return {
    requireAuth: async (request, reply) => {
      if (!user) {
        await reply.status(401).send({ error: 'Authentication required' })
        return
      }
      request.user = user
    },
    optionalAuth: (request, _reply) => {
      if (user) {
        request.user = user
      }
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// Mock requireAdmin factory
// ---------------------------------------------------------------------------

function createMockRequireAdmin(user?: RequestUser) {
  return async (
    request: { user?: RequestUser },
    reply: { sent: boolean; status: (code: number) => { send: (body: unknown) => Promise<void> } }
  ) => {
    if (!user) {
      await reply.status(401).send({ error: 'Authentication required' })
      return
    }
    request.user = user
    if (user.did !== ADMIN_DID) {
      await reply.status(403).send({ error: 'Admin access required' })
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Sample page row (as returned from DB)
// ---------------------------------------------------------------------------

function samplePageRow(overrides?: Record<string, unknown>) {
  return {
    id: PAGE_ID_1,
    slug: 'terms-of-service',
    title: 'Terms of Service',
    content: '## Acceptance of terms\n\nBy accessing or using this forum...',
    status: 'published',
    metaDescription: 'Terms and conditions for using this forum.',
    parentId: null,
    sortOrder: 0,
    communityDid: COMMUNITY_DID,
    createdAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  const authMiddleware = createMockAuthMiddleware(user)
  const requireAdmin = createMockRequireAdmin(user)

  app.decorate('db', mockDb as never)
  app.decorate('env', mockEnv)
  app.decorate('authMiddleware', authMiddleware)
  app.decorate('requireAdmin', requireAdmin as never)
  app.decorate('firehose', {} as never)
  app.decorate('oauthClient', {} as never)
  app.decorate('sessionService', {} as SessionService)
  app.decorate('setupService', {} as SetupService)
  app.decorate('cache', {} as never)
  app.decorateRequest('user', undefined as RequestUser | undefined)
  app.decorateRequest('communityDid', undefined as string | undefined)
  app.addHook('onRequest', (request, _reply, done) => {
    request.communityDid = COMMUNITY_DID
    done()
  })

  await app.register(pageRoutes())
  await app.ready()

  return app
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('page routes', () => {
  // =========================================================================
  // PUBLIC: GET /api/pages (list published pages as tree)
  // =========================================================================

  describe('GET /api/pages', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp()
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns published pages as a tree with content snippets', async () => {
      const longContent = 'A'.repeat(300)
      selectChain.where.mockImplementation(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve([
            samplePageRow({ content: longContent }),
          ]),
      }))

      const response = await app.inject({
        method: 'GET',
        url: '/api/pages',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ pages: Array<{ content: string; children: unknown[] }> }>()
      expect(body.pages).toHaveLength(1)
      // Content should be a snippet (first 200 chars + '...' ellipsis)
      expect(body.pages[0].content.length).toBeLessThanOrEqual(203)
      expect(body.pages[0].content).toMatch(/\.\.\.$/)
      expect(body.pages[0].children).toEqual([])
    })

    it('returns empty array when no published pages exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/pages',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ pages: unknown[] }>().pages).toEqual([])
    })
  })

  // =========================================================================
  // PUBLIC: GET /api/pages/:slug (single published page)
  // =========================================================================

  describe('GET /api/pages/:slug', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp()
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns a published page with full content', async () => {
      selectChain.where.mockImplementation(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve([samplePageRow()]),
      }))

      const response = await app.inject({
        method: 'GET',
        url: '/api/pages/terms-of-service',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ slug: string; content: string }>()
      expect(body.slug).toBe('terms-of-service')
      expect(body.content).toBe('## Acceptance of terms\n\nBy accessing or using this forum...')
    })

    it('returns 404 for a draft page (filtered out by query)', async () => {
      // With status filter in the WHERE clause, a draft page is not returned by the DB
      selectChain.where.mockImplementation(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([]),
      }))

      const response = await app.inject({
        method: 'GET',
        url: '/api/pages/terms-of-service',
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 404 for non-existent page', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/pages/non-existent',
      })

      expect(response.statusCode).toBe(404)
    })
  })

  // =========================================================================
  // ADMIN: GET /api/admin/pages (list ALL pages as tree)
  // =========================================================================

  describe('GET /api/admin/pages', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns all pages including drafts', async () => {
      selectChain.where.mockImplementation(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve([
            samplePageRow(),
            samplePageRow({ id: PAGE_ID_2, slug: 'draft-page', status: 'draft', sortOrder: 1 }),
          ]),
      }))

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/pages',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ pages: Array<{ id: string; status: string }> }>()
      expect(body.pages).toHaveLength(2)
    })

    it('returns 401 without auth', async () => {
      const noAuthApp = await buildTestApp()
      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/api/admin/pages',
      })
      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })

    it('returns 403 for non-admin user', async () => {
      const regularApp = await buildTestApp(testUser())
      const response = await regularApp.inject({
        method: 'GET',
        url: '/api/admin/pages',
      })
      expect(response.statusCode).toBe(403)
      await regularApp.close()
    })
  })

  // =========================================================================
  // ADMIN: GET /api/admin/pages/:id (single page by ID)
  // =========================================================================

  describe('GET /api/admin/pages/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('returns a page by ID with full content', async () => {
      selectChain.where.mockImplementation(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve([samplePageRow()]),
      }))

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/pages/${PAGE_ID_1}`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ id: string; content: string }>()
      expect(body.id).toBe(PAGE_ID_1)
    })

    it('returns 404 for non-existent page', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/pages/page-nonexistent',
      })

      expect(response.statusCode).toBe(404)
    })
  })

  // =========================================================================
  // ADMIN: POST /api/admin/pages (create page)
  // =========================================================================

  describe('POST /api/admin/pages', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('creates a page with valid input', async () => {
      const created = samplePageRow()

      // Slug uniqueness check returns empty (no conflict)
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([]),
      }))

      // Insert returning
      insertChain.returning.mockImplementationOnce(() => ({
        ...insertChain,
        then: (resolve: (v: unknown) => void) => resolve([created]),
      }))

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/pages',
        payload: {
          title: 'Terms of Service',
          slug: 'terms-of-service',
          content: '## Acceptance of terms\n\nBy accessing or using this forum...',
          status: 'published',
          metaDescription: 'Terms and conditions for using this forum.',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json<{ slug: string }>()
      expect(body.slug).toBe('terms-of-service')
    })

    it('returns 400 for invalid input (missing title)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/pages',
        payload: {
          slug: 'no-title',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for reserved slug', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/pages',
        payload: {
          title: 'New Page',
          slug: 'new',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 409 for duplicate slug in same community', async () => {
      // Slug uniqueness check returns existing page
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([samplePageRow()]),
      }))

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/pages',
        payload: {
          title: 'Duplicate',
          slug: 'terms-of-service',
        },
      })

      expect(response.statusCode).toBe(409)
    })

    it('returns 400 for non-existent parentId', async () => {
      // Slug uniqueness check returns empty
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([]),
      }))
      // Parent check returns empty
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([]),
      }))

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/pages',
        payload: {
          title: 'Child Page',
          slug: 'child',
          parentId: 'page-nonexistent',
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 401 without auth', async () => {
      const noAuthApp = await buildTestApp()
      const response = await noAuthApp.inject({
        method: 'POST',
        url: '/api/admin/pages',
        payload: { title: 'Test', slug: 'test' },
      })
      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })

  // =========================================================================
  // ADMIN: PUT /api/admin/pages/:id (update page)
  // =========================================================================

  describe('PUT /api/admin/pages/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('updates a page title', async () => {
      const existing = samplePageRow()
      const updated = { ...existing, title: 'Updated Title', updatedAt: new Date() }

      // Find existing
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([existing]),
      }))

      // Update returning
      updateChain.returning.mockImplementationOnce(() => ({
        ...updateChain,
        then: (resolve: (v: unknown) => void) => resolve([updated]),
      }))

      const response = await app.inject({
        method: 'PUT',
        url: `/api/admin/pages/${PAGE_ID_1}`,
        payload: { title: 'Updated Title' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ title: string }>()
      expect(body.title).toBe('Updated Title')
    })

    it('returns 404 for non-existent page', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/pages/page-nonexistent',
        payload: { title: 'Updated' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 409 for duplicate slug on update', async () => {
      const existing = samplePageRow()

      // Find existing
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([existing]),
      }))

      // Slug uniqueness check returns existing page with different ID
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve([samplePageRow({ id: PAGE_ID_2, slug: 'other-slug' })]),
      }))

      const response = await app.inject({
        method: 'PUT',
        url: `/api/admin/pages/${PAGE_ID_1}`,
        payload: { slug: 'other-slug' },
      })

      expect(response.statusCode).toBe(409)
    })

    it('detects circular references when updating parentId', async () => {
      const parent = samplePageRow({ id: PAGE_ID_1, parentId: null })
      const child = samplePageRow({ id: PAGE_ID_2, parentId: PAGE_ID_1 })

      // Find existing (the parent page)
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([parent]),
      }))

      // Parent exists check
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([child]),
      }))

      // Fetch all pages for cycle detection
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([parent, child]),
      }))

      const response = await app.inject({
        method: 'PUT',
        url: `/api/admin/pages/${PAGE_ID_1}`,
        payload: { parentId: PAGE_ID_2 },
      })

      expect(response.statusCode).toBe(400)
    })

    it('rejects self-reference parentId', async () => {
      const existing = samplePageRow()

      // Find existing
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([existing]),
      }))

      // Parent exists check (returns existing which is the same page)
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([existing]),
      }))

      const response = await app.inject({
        method: 'PUT',
        url: `/api/admin/pages/${PAGE_ID_1}`,
        payload: { parentId: PAGE_ID_1 },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // =========================================================================
  // ADMIN: DELETE /api/admin/pages/:id (delete page)
  // =========================================================================

  describe('DELETE /api/admin/pages/:id', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await buildTestApp(adminUser())
    })

    afterAll(async () => {
      await app.close()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      resetAllDbMocks()
    })

    it('deletes a page with no children', async () => {
      // Find existing
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([samplePageRow()]),
      }))
      // Check children returns empty
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([]),
      }))

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/pages/${PAGE_ID_1}`,
      })

      expect(response.statusCode).toBe(204)
    })

    it('returns 404 for non-existent page', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/pages/page-nonexistent',
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 409 when page has children', async () => {
      // Find existing
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) => resolve([samplePageRow()]),
      }))
      // Check children returns a child
      selectChain.where.mockImplementationOnce(() => ({
        ...selectChain,
        then: (resolve: (v: unknown) => void) =>
          resolve([samplePageRow({ id: PAGE_ID_2, parentId: PAGE_ID_1 })]),
      }))

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/pages/${PAGE_ID_1}`,
      })

      expect(response.statusCode).toBe(409)
    })

    it('returns 401 without auth', async () => {
      const noAuthApp = await buildTestApp()
      const response = await noAuthApp.inject({
        method: 'DELETE',
        url: `/api/admin/pages/${PAGE_ID_1}`,
      })
      expect(response.statusCode).toBe(401)
      await noAuthApp.close()
    })
  })
})

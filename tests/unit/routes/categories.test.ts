import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../../src/config/env.js";
import type { AuthMiddleware, RequestUser } from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";
import { type DbChain, createChainableProxy, createMockDb } from "../../helpers/mock-db.js";

// Import routes (no PDS mocking needed -- categories are local-only)
import { categoryRoutes } from "../../../src/routes/categories.js";

// ---------------------------------------------------------------------------
// Mock env (minimal subset for category routes)
// ---------------------------------------------------------------------------

const mockEnv = {
  COMMUNITY_DID: "did:plc:community123",
  RATE_LIMIT_WRITE: 10,
  RATE_LIMIT_READ_ANON: 100,
  RATE_LIMIT_READ_AUTH: 300,
} as Env;

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:testuser123";
const TEST_HANDLE = "alice.bsky.social";
const TEST_SID = "a".repeat(64);
const ADMIN_DID = "did:plc:admin999";
const TEST_NOW = "2026-02-13T12:00:00.000Z";

const CATEGORY_ID_1 = "cat-001";
const CATEGORY_ID_2 = "cat-002";
const CATEGORY_ID_3 = "cat-003";

// ---------------------------------------------------------------------------
// Mock user builders
// ---------------------------------------------------------------------------

function testUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    did: TEST_DID,
    handle: TEST_HANDLE,
    sid: TEST_SID,
    ...overrides,
  };
}

function adminUser(): RequestUser {
  return testUser({ did: ADMIN_DID, handle: "admin.bsky.social" });
}

// ---------------------------------------------------------------------------
// Chainable mock DB (shared helper)
// ---------------------------------------------------------------------------

const mockDb = createMockDb();

let insertChain: DbChain;
let selectChain: DbChain;
let updateChain: DbChain;
let deleteChain: DbChain;

function resetAllDbMocks(): void {
  insertChain = createChainableProxy();
  selectChain = createChainableProxy([]);
  updateChain = createChainableProxy([]);
  deleteChain = createChainableProxy();
  mockDb.insert.mockReturnValue(insertChain);
  mockDb.select.mockReturnValue(selectChain);
  mockDb.update.mockReturnValue(updateChain);
  mockDb.delete.mockReturnValue(deleteChain);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async mock for Drizzle transaction
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => {
    await fn(mockDb);
  });
}

// ---------------------------------------------------------------------------
// Auth middleware mocks
// ---------------------------------------------------------------------------

function createMockAuthMiddleware(user?: RequestUser): AuthMiddleware {
  return {
    requireAuth: async (request, reply) => {
      if (!user) {
        await reply.status(401).send({ error: "Authentication required" });
        return;
      }
      request.user = user;
    },
    optionalAuth: (request, _reply) => {
      if (user) {
        request.user = user;
      }
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Mock requireAdmin factory
// ---------------------------------------------------------------------------

/**
 * Create a mock requireAdmin preHandler.
 * If the user is provided and their DID matches ADMIN_DID, they pass.
 * Otherwise, 403.
 */
function createMockRequireAdmin(user?: RequestUser) {
  return async (request: { user?: RequestUser }, reply: { sent: boolean; status: (code: number) => { send: (body: unknown) => Promise<void> } }) => {
    if (!user) {
      await reply.status(401).send({ error: "Authentication required" });
      return;
    }
    request.user = user;
    if (user.did !== ADMIN_DID) {
      await reply.status(403).send({ error: "Admin access required" });
      return;
    }
  };
}

// ---------------------------------------------------------------------------
// Sample category row (as returned from DB)
// ---------------------------------------------------------------------------

function sampleCategoryRow(overrides?: Record<string, unknown>) {
  return {
    id: CATEGORY_ID_1,
    slug: "general",
    name: "General Discussion",
    description: "Talk about anything",
    parentId: null,
    sortOrder: 0,
    communityDid: "did:plc:community123",
    maturityRating: "safe",
    createdAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sample community settings row
// ---------------------------------------------------------------------------

function sampleCommunitySettings(overrides?: Record<string, unknown>) {
  return {
    id: "default",
    initialized: true,
    communityDid: "did:plc:community123",
    adminDid: ADMIN_DID,
    communityName: "Test Community",
    maturityRating: "safe",
    createdAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const authMiddleware = createMockAuthMiddleware(user);
  const requireAdmin = createMockRequireAdmin(user);

  app.decorate("db", mockDb as never);
  app.decorate("env", mockEnv);
  app.decorate("authMiddleware", authMiddleware);
  app.decorate("requireAdmin", requireAdmin as never);
  app.decorate("firehose", {} as never);
  app.decorate("oauthClient", {} as never);
  app.decorate("sessionService", {} as SessionService);
  app.decorate("setupService", {} as SetupService);
  app.decorate("cache", {} as never);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  await app.register(categoryRoutes());
  await app.ready();

  return app;
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("category routes", () => {
  // =========================================================================
  // GET /api/categories (list / tree)
  // =========================================================================

  describe("GET /api/categories", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
    });

    it("returns empty array when no categories exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/categories",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ categories: unknown[] }>();
      expect(body.categories).toEqual([]);
    });

    it("returns categories as tree structure", async () => {
      const parent = sampleCategoryRow();
      const child = sampleCategoryRow({
        id: CATEGORY_ID_2,
        slug: "child",
        name: "Child Category",
        parentId: CATEGORY_ID_1,
        sortOrder: 1,
      });

      selectChain.where.mockResolvedValueOnce([parent, child]);

      const response = await app.inject({
        method: "GET",
        url: "/api/categories",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ categories: Array<{ id: string; children: Array<{ id: string }> }> }>();
      // Top-level should only have the parent
      expect(body.categories).toHaveLength(1);
      expect(body.categories[0]?.id).toBe(CATEGORY_ID_1);
      // Child should be nested
      expect(body.categories[0]?.children).toHaveLength(1);
      expect(body.categories[0]?.children[0]?.id).toBe(CATEGORY_ID_2);
    });

    it("returns deeply nested tree structure", async () => {
      const root = sampleCategoryRow();
      const child = sampleCategoryRow({
        id: CATEGORY_ID_2,
        slug: "child",
        name: "Child",
        parentId: CATEGORY_ID_1,
      });
      const grandchild = sampleCategoryRow({
        id: CATEGORY_ID_3,
        slug: "grandchild",
        name: "Grandchild",
        parentId: CATEGORY_ID_2,
      });

      selectChain.where.mockResolvedValueOnce([root, child, grandchild]);

      const response = await app.inject({
        method: "GET",
        url: "/api/categories",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ categories: Array<{ id: string; children: Array<{ id: string; children: Array<{ id: string }> }> }> }>();
      expect(body.categories).toHaveLength(1);
      expect(body.categories[0]?.children).toHaveLength(1);
      expect(body.categories[0]?.children[0]?.children).toHaveLength(1);
      expect(body.categories[0]?.children[0]?.children[0]?.id).toBe(CATEGORY_ID_3);
    });

    it("filters by parentId query parameter", async () => {
      selectChain.where.mockResolvedValueOnce([
        sampleCategoryRow({ parentId: CATEGORY_ID_1 }),
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/api/categories?parentId=${CATEGORY_ID_1}`,
      });

      expect(response.statusCode).toBe(200);
      expect(selectChain.where).toHaveBeenCalled();
    });

    it("includes maturityRating per category", async () => {
      const category = sampleCategoryRow({ maturityRating: "mature" });
      selectChain.where.mockResolvedValueOnce([category]);

      const response = await app.inject({
        method: "GET",
        url: "/api/categories",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ categories: Array<{ maturityRating: string }> }>();
      expect(body.categories[0]?.maturityRating).toBe("mature");
    });

    it("works without authentication (public endpoint)", async () => {
      const noAuthApp = await buildTestApp(undefined);
      selectChain.where.mockResolvedValueOnce([]);

      const response = await noAuthApp.inject({
        method: "GET",
        url: "/api/categories",
      });

      expect(response.statusCode).toBe(200);
      await noAuthApp.close();
    });
  });

  // =========================================================================
  // GET /api/categories/:slug
  // =========================================================================

  describe("GET /api/categories/:slug", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
    });

    it("returns a single category by slug with topicCount", async () => {
      const category = sampleCategoryRow();
      // First query: find category by slug
      selectChain.where.mockResolvedValueOnce([category]);
      // Second query: count topics
      selectChain.where.mockResolvedValueOnce([{ count: 5 }]);

      const response = await app.inject({
        method: "GET",
        url: "/api/categories/general",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ slug: string; topicCount: number }>();
      expect(body.slug).toBe("general");
      expect(body.topicCount).toBe(5);
    });

    it("returns 404 for non-existent category", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/categories/nonexistent",
      });

      expect(response.statusCode).toBe(404);
    });

    it("works without authentication (public endpoint)", async () => {
      const noAuthApp = await buildTestApp(undefined);
      const category = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([category]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);

      const response = await noAuthApp.inject({
        method: "GET",
        url: "/api/categories/general",
      });

      expect(response.statusCode).toBe(200);
      await noAuthApp.close();
    });
  });

  // =========================================================================
  // POST /api/admin/categories
  // =========================================================================

  describe("POST /api/admin/categories", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(adminUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
    });

    it("creates a category and returns 201", async () => {
      // Query community settings for maturity default
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      // Check slug uniqueness: no existing category
      selectChain.where.mockResolvedValueOnce([]);
      // Insert returns created row
      insertChain.returning.mockResolvedValueOnce([sampleCategoryRow()]);

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "General Discussion",
          slug: "general",
          description: "Talk about anything",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ id: string; slug: string }>();
      expect(body.slug).toBe("general");
    });

    it("creates a category with explicit maturityRating", async () => {
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      selectChain.where.mockResolvedValueOnce([]);
      insertChain.returning.mockResolvedValueOnce([
        sampleCategoryRow({ maturityRating: "mature" }),
      ]);

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Mature Content",
          slug: "mature-content",
          maturityRating: "mature",
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it("defaults maturityRating to community default when not provided", async () => {
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings({ maturityRating: "mature" })]);
      selectChain.where.mockResolvedValueOnce([]);
      insertChain.returning.mockResolvedValueOnce([
        sampleCategoryRow({ maturityRating: "mature" }),
      ]);

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Defaults to Mature",
          slug: "defaults-mature",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("returns 400 for maturityRating lower than community default", async () => {
      // Community default is "mature", trying to set "safe"
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings({ maturityRating: "mature" })]);

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Too Low",
          slug: "too-low",
          maturityRating: "safe",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 409 if slug already exists in community", async () => {
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      // Slug check: existing category found
      selectChain.where.mockResolvedValueOnce([sampleCategoryRow()]);

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Duplicate",
          slug: "general",
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it("returns 400 for invalid slug format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Bad Slug",
          slug: "INVALID SLUG!",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          slug: "no-name",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for missing slug", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "No Slug",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("validates parentId exists", async () => {
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      selectChain.where.mockResolvedValueOnce([]); // slug check
      selectChain.where.mockResolvedValueOnce([]); // parent lookup: not found

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Orphan",
          slug: "orphan",
          parentId: "nonexistent-parent",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("creates a category with valid parentId", async () => {
      const parent = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      selectChain.where.mockResolvedValueOnce([]); // slug check
      selectChain.where.mockResolvedValueOnce([parent]); // parent lookup: found
      // No cycle check needed since parent has no parentId
      insertChain.returning.mockResolvedValueOnce([
        sampleCategoryRow({
          id: CATEGORY_ID_2,
          slug: "child",
          name: "Child Category",
          parentId: CATEGORY_ID_1,
        }),
      ]);

      const response = await app.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Child Category",
          slug: "child",
          parentId: CATEGORY_ID_1,
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it("returns 401 when unauthenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "POST",
        url: "/api/admin/categories",
        payload: {
          name: "Unauth",
          slug: "unauth",
        },
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 403 when non-admin user", async () => {
      const regularApp = await buildTestApp(testUser());

      const response = await regularApp.inject({
        method: "POST",
        url: "/api/admin/categories",
        headers: { authorization: "Bearer user-token" },
        payload: {
          name: "Forbidden",
          slug: "forbidden",
        },
      });

      expect(response.statusCode).toBe(403);
      await regularApp.close();
    });
  });

  // =========================================================================
  // PUT /api/admin/categories/:id
  // =========================================================================

  describe("PUT /api/admin/categories/:id", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(adminUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
    });

    it("updates a category name", async () => {
      const existing = sampleCategoryRow();
      // Find category by id
      selectChain.where.mockResolvedValueOnce([existing]);
      // Fetch community settings for maturity validation (even though maturity isn't changing)
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      // Update returns updated row
      updateChain.returning.mockResolvedValueOnce([
        { ...existing, name: "Updated Name", updatedAt: new Date() },
      ]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Updated Name",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ name: string }>();
      expect(body.name).toBe("Updated Name");
    });

    it("returns 404 when category not found", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "PUT",
        url: "/api/admin/categories/nonexistent",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "Ghost",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("validates maturity cannot be lower than community default on update", async () => {
      const existing = sampleCategoryRow({ maturityRating: "mature" });
      selectChain.where.mockResolvedValueOnce([existing]);
      // Community default is "mature"
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings({ maturityRating: "mature" })]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "safe",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("validates parentId exists on update", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]); // community settings
      selectChain.where.mockResolvedValueOnce([]); // parent lookup: not found

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          parentId: "nonexistent-parent",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("detects circular reference on update (self-reference)", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]); // community settings
      selectChain.where.mockResolvedValueOnce([existing]); // parent lookup: found (itself)

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          parentId: CATEGORY_ID_1, // self-reference
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("detects circular reference on update (indirect cycle)", async () => {
      // Category B has parent A. Now try to set A's parent to B.
      const catA = sampleCategoryRow({ id: CATEGORY_ID_1, parentId: null });
      const catB = sampleCategoryRow({ id: CATEGORY_ID_2, parentId: CATEGORY_ID_1 });

      selectChain.where.mockResolvedValueOnce([catA]); // find category A
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]); // community settings
      selectChain.where.mockResolvedValueOnce([catB]); // parent lookup: B exists
      // Walk chain: B's parent is A (the category being updated) -> cycle
      // The route fetches all categories to check ancestors
      selectChain.where.mockResolvedValueOnce([catA, catB]); // all categories for cycle check

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          parentId: CATEGORY_ID_2,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("validates slug uniqueness on update", async () => {
      const existing = sampleCategoryRow();
      const otherCategory = sampleCategoryRow({ id: CATEGORY_ID_2, slug: "taken" });

      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]); // community settings
      selectChain.where.mockResolvedValueOnce([otherCategory]); // slug check: already taken

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          slug: "taken",
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it("explicitly sets updatedAt on update", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]);
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      const updatedRow = { ...existing, name: "New Name", updatedAt: new Date() };
      updateChain.returning.mockResolvedValueOnce([updatedRow]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          name: "New Name",
        },
      });

      expect(response.statusCode).toBe(200);
      // Verify update was called (which includes updatedAt)
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("returns 401 when unauthenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        payload: { name: "Unauth" },
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 403 when non-admin user", async () => {
      const regularApp = await buildTestApp(testUser());

      const response = await regularApp.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer user-token" },
        payload: { name: "Forbidden" },
      });

      expect(response.statusCode).toBe(403);
      await regularApp.close();
    });
  });

  // =========================================================================
  // DELETE /api/admin/categories/:id
  // =========================================================================

  describe("DELETE /api/admin/categories/:id", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(adminUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
    });

    it("deletes a category and returns 204", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]); // topic count: 0
      selectChain.where.mockResolvedValueOnce([]); // child categories: none

      const response = await app.inject({
        method: "DELETE",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
      });

      expect(response.statusCode).toBe(204);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("returns 404 when category not found", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/admin/categories/nonexistent",
        headers: { authorization: "Bearer admin-token" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 409 when category has topics", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([{ count: 3 }]); // topic count: 3

      const response = await app.inject({
        method: "DELETE",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain("3");
    });

    it("returns 409 when category has children", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]); // topic count: 0
      selectChain.where.mockResolvedValueOnce([
        sampleCategoryRow({ id: CATEGORY_ID_2, parentId: CATEGORY_ID_1 }),
      ]); // child categories: one found

      const response = await app.inject({
        method: "DELETE",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer admin-token" },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain("child");
    });

    it("returns 401 when unauthenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "DELETE",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 403 when non-admin user", async () => {
      const regularApp = await buildTestApp(testUser());

      const response = await regularApp.inject({
        method: "DELETE",
        url: `/api/admin/categories/${CATEGORY_ID_1}`,
        headers: { authorization: "Bearer user-token" },
      });

      expect(response.statusCode).toBe(403);
      await regularApp.close();
    });
  });

  // =========================================================================
  // PUT /api/admin/categories/:id/maturity
  // =========================================================================

  describe("PUT /api/admin/categories/:id/maturity", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(adminUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
    });

    it("updates maturity rating", async () => {
      const existing = sampleCategoryRow({ maturityRating: "safe" });
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings({ maturityRating: "safe" })]); // community settings
      updateChain.returning.mockResolvedValueOnce([
        { ...existing, maturityRating: "mature", updatedAt: new Date() },
      ]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "mature",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ maturityRating: string }>();
      expect(body.maturityRating).toBe("mature");
    });

    it("returns 400 when maturity is lower than community default", async () => {
      const existing = sampleCategoryRow({ maturityRating: "mature" });
      selectChain.where.mockResolvedValueOnce([existing]); // find category
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings({ maturityRating: "mature" })]); // community default is "mature"

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "safe", // lower than community "mature"
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 404 when category not found", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "PUT",
        url: "/api/admin/categories/nonexistent/maturity",
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "mature",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for invalid maturity value", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "invalid",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("explicitly sets updatedAt", async () => {
      const existing = sampleCategoryRow();
      selectChain.where.mockResolvedValueOnce([existing]);
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings()]);
      updateChain.returning.mockResolvedValueOnce([
        { ...existing, maturityRating: "mature", updatedAt: new Date() },
      ]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "mature",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("maturity hierarchy: safe < mature < adult", async () => {
      // Community default is "safe", setting to "adult" should work
      const existing = sampleCategoryRow({ maturityRating: "safe" });
      selectChain.where.mockResolvedValueOnce([existing]);
      selectChain.where.mockResolvedValueOnce([sampleCommunitySettings({ maturityRating: "safe" })]);
      updateChain.returning.mockResolvedValueOnce([
        { ...existing, maturityRating: "adult", updatedAt: new Date() },
      ]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        headers: { authorization: "Bearer admin-token" },
        payload: {
          maturityRating: "adult",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ maturityRating: string }>();
      expect(body.maturityRating).toBe("adult");
    });

    it("returns 401 when unauthenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        payload: { maturityRating: "mature" },
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 403 when non-admin user", async () => {
      const regularApp = await buildTestApp(testUser());

      const response = await regularApp.inject({
        method: "PUT",
        url: `/api/admin/categories/${CATEGORY_ID_1}/maturity`,
        headers: { authorization: "Bearer user-token" },
        payload: { maturityRating: "mature" },
      });

      expect(response.statusCode).toBe(403);
      await regularApp.close();
    });
  });
});

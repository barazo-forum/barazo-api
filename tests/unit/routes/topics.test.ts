import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../../src/config/env.js";
import type { AuthMiddleware, RequestUser } from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";

// ---------------------------------------------------------------------------
// Mock PDS client module (must be before importing routes)
// ---------------------------------------------------------------------------

const createRecordFn = vi.fn<(did: string, collection: string, record: Record<string, unknown>) => Promise<{ uri: string; cid: string }>>();
const updateRecordFn = vi.fn<(did: string, collection: string, rkey: string, record: Record<string, unknown>) => Promise<{ uri: string; cid: string }>>();
const deleteRecordFn = vi.fn<(did: string, collection: string, rkey: string) => Promise<void>>();

vi.mock("../../../src/lib/pds-client.js", () => ({
  createPdsClient: () => ({
    createRecord: createRecordFn,
    updateRecord: updateRecordFn,
    deleteRecord: deleteRecordFn,
  }),
}));

// Import routes AFTER mocking
import { topicRoutes } from "../../../src/routes/topics.js";

// ---------------------------------------------------------------------------
// Mock env (minimal subset for topic routes)
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
const TEST_URI = `at://${TEST_DID}/forum.barazo.topic.post/abc123`;
const TEST_RKEY = "abc123";
const TEST_CID = "bafyreiabc123456789";
const TEST_NOW = "2026-02-13T12:00:00.000Z";

const MOD_DID = "did:plc:moderator999";
const OTHER_DID = "did:plc:otheruser456";

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

// ---------------------------------------------------------------------------
// Mock firehose repo manager
// ---------------------------------------------------------------------------

const isTrackedFn = vi.fn<(did: string) => Promise<boolean>>();
const trackRepoFn = vi.fn<(did: string) => Promise<void>>();

const mockRepoManager = {
  isTracked: isTrackedFn,
  trackRepo: trackRepoFn,
  untrackRepo: vi.fn(),
  restoreTrackedRepos: vi.fn(),
};

const mockFirehose = {
  getRepoManager: () => mockRepoManager,
  start: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn().mockReturnValue({ connected: true, lastEventId: null }),
};

// ---------------------------------------------------------------------------
// Chainable mock DB
// ---------------------------------------------------------------------------

// Typed mock chain interface so we can access methods without non-null assertions.
type MockFn = ReturnType<typeof vi.fn>;

interface DbChain {
  values: MockFn;
  onConflictDoUpdate: MockFn;
  onConflictDoNothing: MockFn;
  set: MockFn;
  from: MockFn;
  where: MockFn;
  orderBy: MockFn;
  limit: MockFn;
  returning: MockFn;
}

function createChainableProxy(terminalResult: unknown = []): DbChain {
  const chain: DbChain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    onConflictDoNothing: vi.fn(),
    set: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    returning: vi.fn(),
  };

  // Default: every method returns the chain itself for chaining
  const methods: (keyof DbChain)[] = [
    "values", "onConflictDoUpdate", "onConflictDoNothing",
    "set", "from", "orderBy", "limit", "returning",
  ];
  for (const m of methods) {
    chain[m].mockImplementation(() => chain);
  }

  // Make `where` return a thenable chain so `await db.select().from().where()` works.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally thenable mock for Drizzle chain
  chain.where.mockImplementation(() => ({
    ...chain,
    then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
      Promise.resolve(terminalResult).then(resolve, reject),
    orderBy: chain.orderBy,
    limit: chain.limit,
    returning: chain.returning,
  }));

  return chain;
}

// Separate chainable mocks for each operation type
let insertChain: DbChain;
let selectChain: DbChain;
let updateChain: DbChain;
let deleteChain: DbChain;

const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
};

/**
 * Reset all DB mock chains to fresh state. Call this in beforeEach.
 */
function resetDbMocks(): void {
  insertChain = createChainableProxy();
  selectChain = createChainableProxy([]);
  updateChain = createChainableProxy([]);
  deleteChain = createChainableProxy();

  mockDb.insert.mockReturnValue(insertChain);
  mockDb.select.mockReturnValue(selectChain);
  mockDb.update.mockReturnValue(updateChain);
  mockDb.delete.mockReturnValue(deleteChain);

  // Transaction mock: invoke callback with a tx object that delegates to mockDb
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
// Sample topic row (as returned from DB)
// ---------------------------------------------------------------------------

function sampleTopicRow(overrides?: Record<string, unknown>) {
  return {
    uri: TEST_URI,
    rkey: TEST_RKEY,
    authorDid: TEST_DID,
    title: "Test Topic Title",
    content: "Test topic content goes here",
    contentFormat: null,
    category: "general",
    tags: ["test", "example"],
    communityDid: "did:plc:community123",
    cid: TEST_CID,
    labels: null,
    replyCount: 0,
    reactionCount: 0,
    lastActivityAt: new Date(TEST_NOW),
    createdAt: new Date(TEST_NOW),
    indexedAt: new Date(TEST_NOW),
    embedding: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("db", mockDb as never);
  app.decorate("env", mockEnv);
  app.decorate("authMiddleware", createMockAuthMiddleware(user));
  app.decorate("firehose", mockFirehose as never);
  app.decorate("oauthClient", {} as never);
  app.decorate("sessionService", {} as SessionService);
  app.decorate("setupService", {} as SetupService);
  app.decorate("cache", {} as never);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  await app.register(topicRoutes());
  await app.ready();

  return app;
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("topic routes", () => {
  // =========================================================================
  // POST /api/topics
  // =========================================================================

  describe("POST /api/topics", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetDbMocks();

      // Default mocks for successful create
      createRecordFn.mockResolvedValue({ uri: TEST_URI, cid: TEST_CID });
      isTrackedFn.mockResolvedValue(true);
    });

    it("creates a topic and returns 201", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "My First Topic",
          content: "This is the body of my topic.",
          category: "general",
          tags: ["hello", "world"],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ uri: string; cid: string }>();
      expect(body.uri).toBe(TEST_URI);
      expect(body.cid).toBe(TEST_CID);

      // Should have called PDS createRecord
      expect(createRecordFn).toHaveBeenCalledOnce();
      expect(createRecordFn.mock.calls[0]?.[0]).toBe(TEST_DID);
      expect(createRecordFn.mock.calls[0]?.[1]).toBe("forum.barazo.topic.post");

      // Should have inserted into DB
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("creates a topic without optional tags", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Tagless Topic",
          content: "No tags here.",
          category: "support",
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it("tracks new user's repo on first post", async () => {
      isTrackedFn.mockResolvedValue(false);
      trackRepoFn.mockResolvedValue(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "First Post",
          content: "This is my first ever post.",
          category: "introductions",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(isTrackedFn).toHaveBeenCalledWith(TEST_DID);
      expect(trackRepoFn).toHaveBeenCalledWith(TEST_DID);
    });

    it("does not track already-tracked user", async () => {
      isTrackedFn.mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Another Post",
          content: "Already tracked.",
          category: "general",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(isTrackedFn).toHaveBeenCalledWith(TEST_DID);
      expect(trackRepoFn).not.toHaveBeenCalled();
    });

    it("returns 400 for missing title", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "No title provided.",
          category: "general",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for missing content", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "No Content",
          category: "general",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for missing category", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "No Category",
          content: "Missing required field.",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for title exceeding max length", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "A".repeat(201),
          content: "Valid content.",
          category: "general",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for too many tags", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Too Many Tags",
          content: "Tags overload.",
          category: "general",
          tags: ["a", "b", "c", "d", "e", "f"],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for empty body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 502 when PDS write fails", async () => {
      createRecordFn.mockRejectedValueOnce(new Error("PDS unreachable"));

      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "PDS Fail Topic",
          content: "Should fail because PDS is down.",
          category: "general",
        },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe("POST /api/topics (unauthenticated)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 without auth", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/topics",
        payload: {
          title: "Unauth Topic",
          content: "Should not work.",
          category: "general",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // GET /api/topics (list)
  // =========================================================================

  describe("GET /api/topics", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetDbMocks();
    });

    it("returns empty list when no topics exist", async () => {
      // The list query ends with .limit() -- make it resolve to empty
      selectChain.limit.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/topics",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ topics: unknown[]; cursor: string | null }>();
      expect(body.topics).toEqual([]);
      expect(body.cursor).toBeNull();
    });

    it("returns topics with pagination cursor", async () => {
      // Request limit=2 -> route fetches limit+1=3 items
      // Return 3 items to trigger "hasMore"
      const rows = [
        sampleTopicRow(),
        sampleTopicRow({ uri: `at://${TEST_DID}/forum.barazo.topic.post/def456`, rkey: "def456" }),
        sampleTopicRow({ uri: `at://${TEST_DID}/forum.barazo.topic.post/ghi789`, rkey: "ghi789" }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      const response = await app.inject({
        method: "GET",
        url: "/api/topics?limit=2",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ topics: unknown[]; cursor: string | null }>();
      expect(body.topics).toHaveLength(2);
      expect(body.cursor).toBeTruthy();
    });

    it("returns null cursor when fewer items than limit", async () => {
      const rows = [sampleTopicRow()];
      selectChain.limit.mockResolvedValueOnce(rows);

      const response = await app.inject({
        method: "GET",
        url: "/api/topics?limit=25",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ topics: unknown[]; cursor: string | null }>();
      expect(body.topics).toHaveLength(1);
      expect(body.cursor).toBeNull();
    });

    it("filters by category", async () => {
      selectChain.limit.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/topics?category=support",
      });

      expect(response.statusCode).toBe(200);
      expect(selectChain.where).toHaveBeenCalled();
    });

    it("filters by tag", async () => {
      selectChain.limit.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/topics?tag=help",
      });

      expect(response.statusCode).toBe(200);
      expect(selectChain.where).toHaveBeenCalled();
    });

    it("respects custom limit", async () => {
      selectChain.limit.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/topics?limit=5",
      });

      expect(response.statusCode).toBe(200);
      expect(selectChain.limit).toHaveBeenCalled();
    });

    it("returns 400 for invalid limit (over max)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/topics?limit=999",
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for invalid limit (zero)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/topics?limit=0",
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for non-numeric limit", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/topics?limit=abc",
      });

      expect(response.statusCode).toBe(400);
    });

    it("accepts cursor parameter", async () => {
      const cursor = Buffer.from(JSON.stringify({ lastActivityAt: TEST_NOW, uri: TEST_URI })).toString("base64");
      selectChain.limit.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: `/api/topics?cursor=${encodeURIComponent(cursor)}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it("works without authentication (public endpoint)", async () => {
      const noAuthApp = await buildTestApp(undefined);
      selectChain.limit.mockResolvedValueOnce([]);

      const response = await noAuthApp.inject({
        method: "GET",
        url: "/api/topics",
      });

      expect(response.statusCode).toBe(200);
      await noAuthApp.close();
    });
  });

  // =========================================================================
  // GET /api/topics/:uri (single topic)
  // =========================================================================

  describe("GET /api/topics/:uri", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetDbMocks();
    });

    it("returns a single topic by URI", async () => {
      const row = sampleTopicRow();
      // select().from(topics).where() is the terminal call
      selectChain.where.mockResolvedValueOnce([row]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedUri}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ uri: string; title: string }>();
      expect(body.uri).toBe(TEST_URI);
      expect(body.title).toBe("Test Topic Title");
    });

    it("returns 404 for non-existent topic", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedUri = encodeURIComponent("at://did:plc:nonexistent/forum.barazo.topic.post/xyz");
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedUri}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("works without authentication (public endpoint)", async () => {
      const noAuthApp = await buildTestApp(undefined);
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await noAuthApp.inject({
        method: "GET",
        url: `/api/topics/${encodedUri}`,
      });

      expect(response.statusCode).toBe(200);
      await noAuthApp.close();
    });
  });

  // =========================================================================
  // PUT /api/topics/:uri
  // =========================================================================

  describe("PUT /api/topics/:uri", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetDbMocks();
      updateRecordFn.mockResolvedValue({ uri: TEST_URI, cid: "bafyreinewcid" });
    });

    it("updates a topic when user is the author", async () => {
      const existingRow = sampleTopicRow();
      // First: select().from(topics).where() -> find topic
      selectChain.where.mockResolvedValueOnce([existingRow]);
      // Then: update().set().where().returning() -> return updated row
      const updatedRow = { ...existingRow, title: "Updated Title", cid: "bafyreinewcid" };
      updateChain.returning.mockResolvedValueOnce([updatedRow]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Updated Title",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string }>();
      expect(body.title).toBe("Updated Title");
      expect(updateRecordFn).toHaveBeenCalledOnce();
    });

    it("returns 403 when user is not the author", async () => {
      const existingRow = sampleTopicRow({ authorDid: OTHER_DID });
      selectChain.where.mockResolvedValueOnce([existingRow]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Attempted Edit",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 404 when topic does not exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedUri = encodeURIComponent("at://did:plc:nobody/forum.barazo.topic.post/ghost");
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Ghost Topic",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for title exceeding max length", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodeURIComponent(TEST_URI)}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "A".repeat(201),
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 502 when PDS update fails", async () => {
      const existingRow = sampleTopicRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);
      updateRecordFn.mockRejectedValueOnce(new Error("PDS error"));

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          title: "Will Fail",
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it("accepts empty update (all fields optional)", async () => {
      const existingRow = sampleTopicRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);
      updateChain.returning.mockResolvedValueOnce([existingRow]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("PUT /api/topics/:uri (unauthenticated)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 without auth", async () => {
      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/topics/${encodedUri}`,
        payload: { title: "Unauth Edit" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // DELETE /api/topics/:uri
  // =========================================================================

  describe("DELETE /api/topics/:uri", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(testUser());
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetDbMocks();
      deleteRecordFn.mockResolvedValue(undefined);
    });

    it("deletes a topic when user is the author (deletes from PDS + DB)", async () => {
      const existingRow = sampleTopicRow(); // authorDid = TEST_DID
      // First select: find topic
      selectChain.where.mockResolvedValueOnce([existingRow]);
      // Author === user, so NO second select (no role lookup needed)

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);

      // Should have deleted from PDS
      expect(deleteRecordFn).toHaveBeenCalledOnce();
      expect(deleteRecordFn.mock.calls[0]?.[0]).toBe(TEST_DID);

      // Should have deleted from DB (replies + topics)
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("deletes topic as moderator (index-only delete, not from PDS)", async () => {
      const modApp = await buildTestApp(testUser({ did: MOD_DID, handle: "mod.bsky.social" }));

      const existingRow = sampleTopicRow({ authorDid: OTHER_DID });
      // First select: find topic
      selectChain.where.mockResolvedValueOnce([existingRow]);
      // Second select: check user role (moderator is not author)
      selectChain.where.mockResolvedValueOnce([{ did: MOD_DID, role: "moderator" }]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await modApp.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);

      // Moderator should NOT delete from PDS
      expect(deleteRecordFn).not.toHaveBeenCalled();

      // But should delete from DB index
      expect(mockDb.delete).toHaveBeenCalled();

      await modApp.close();
    });

    it("deletes topic as admin (index-only delete, not from PDS)", async () => {
      const adminApp = await buildTestApp(testUser({ did: MOD_DID, handle: "admin.bsky.social" }));

      const existingRow = sampleTopicRow({ authorDid: OTHER_DID });
      selectChain.where.mockResolvedValueOnce([existingRow]);
      selectChain.where.mockResolvedValueOnce([{ did: MOD_DID, role: "admin" }]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await adminApp.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);
      expect(deleteRecordFn).not.toHaveBeenCalled();

      await adminApp.close();
    });

    it("returns 403 when non-author regular user tries to delete", async () => {
      const existingRow = sampleTopicRow({ authorDid: OTHER_DID });
      selectChain.where.mockResolvedValueOnce([existingRow]);
      // User role lookup: regular user
      selectChain.where.mockResolvedValueOnce([{ did: TEST_DID, role: "user" }]);

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 404 when topic does not exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedUri = encodeURIComponent("at://did:plc:nobody/forum.barazo.topic.post/ghost");
      const response = await app.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 502 when PDS delete fails", async () => {
      const existingRow = sampleTopicRow(); // author = TEST_DID
      selectChain.where.mockResolvedValueOnce([existingRow]);
      deleteRecordFn.mockRejectedValueOnce(new Error("PDS delete failed"));

      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe("DELETE /api/topics/:uri (unauthenticated)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 without auth", async () => {
      const encodedUri = encodeURIComponent(TEST_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/topics/${encodedUri}`,
        headers: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });
});

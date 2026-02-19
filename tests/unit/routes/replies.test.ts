import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../../src/config/env.js";
import type { AuthMiddleware, RequestUser } from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";
import { type DbChain, createChainableProxy, createMockDb } from "../../helpers/mock-db.js";

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

// Mock anti-spam module (tested separately in anti-spam.test.ts)
vi.mock("../../../src/lib/anti-spam.js", () => ({
  loadAntiSpamSettings: vi.fn().mockResolvedValue({
    wordFilter: [],
    firstPostQueueCount: 3,
    newAccountDays: 7,
    newAccountWriteRatePerMin: 3,
    establishedWriteRatePerMin: 10,
    linkHoldEnabled: true,
    topicCreationDelayEnabled: false,
    burstPostCount: 5,
    burstWindowMinutes: 10,
    trustedPostThreshold: 10,
  }),
  isNewAccount: vi.fn().mockResolvedValue(false),
  isAccountTrusted: vi.fn().mockResolvedValue(true),
  checkWriteRateLimit: vi.fn().mockResolvedValue(false),
  runAntiSpamChecks: vi.fn().mockResolvedValue({ held: false, reasons: [] }),
}));

// Import routes AFTER mocking
import { replyRoutes } from "../../../src/routes/replies.js";

// ---------------------------------------------------------------------------
// Mock env (minimal subset for reply routes)
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

const TEST_TOPIC_URI = `at://${TEST_DID}/forum.barazo.topic.post/abc123`;
const TEST_TOPIC_CID = "bafyreiatopic123";
const TEST_TOPIC_RKEY = "abc123";

const TEST_REPLY_URI = `at://${TEST_DID}/forum.barazo.topic.reply/reply001`;
const TEST_REPLY_CID = "bafyreireply001";
const TEST_REPLY_RKEY = "reply001";

const TEST_PARENT_REPLY_URI = `at://${TEST_DID}/forum.barazo.topic.reply/parentreply001`;
const TEST_PARENT_REPLY_CID = "bafyreiparentreply001";

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
// Sample row builders
// ---------------------------------------------------------------------------

function sampleTopicRow(overrides?: Record<string, unknown>) {
  return {
    uri: TEST_TOPIC_URI,
    rkey: TEST_TOPIC_RKEY,
    authorDid: TEST_DID,
    title: "Test Topic Title",
    content: "Test topic content goes here",
    contentFormat: null,
    category: "general",
    tags: ["test", "example"],
    communityDid: "did:plc:community123",
    cid: TEST_TOPIC_CID,
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

function sampleReplyRow(overrides?: Record<string, unknown>) {
  return {
    uri: TEST_REPLY_URI,
    rkey: TEST_REPLY_RKEY,
    authorDid: TEST_DID,
    content: "This is a test reply",
    contentFormat: null,
    rootUri: TEST_TOPIC_URI,
    rootCid: TEST_TOPIC_CID,
    parentUri: TEST_TOPIC_URI,
    parentCid: TEST_TOPIC_CID,
    communityDid: "did:plc:community123",
    cid: TEST_REPLY_CID,
    labels: null,
    reactionCount: 0,
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
  app.decorate("interactionGraphService", {
    recordReply: vi.fn().mockResolvedValue(undefined),
    recordReaction: vi.fn().mockResolvedValue(undefined),
    recordCoParticipation: vi.fn().mockResolvedValue(undefined),
  } as never);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  await app.register(replyRoutes());
  await app.ready();

  return app;
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("reply routes", () => {
  // =========================================================================
  // POST /api/topics/:topicUri/replies
  // =========================================================================

  describe("POST /api/topics/:topicUri/replies", () => {
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

      // Default mocks for successful create
      createRecordFn.mockResolvedValue({ uri: TEST_REPLY_URI, cid: TEST_REPLY_CID });
      isTrackedFn.mockResolvedValue(true);
    });

    it("creates a reply to a topic and returns 201", async () => {
      // First select: look up topic
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "This is my reply to the topic.",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ uri: string; cid: string }>();
      expect(body.uri).toBe(TEST_REPLY_URI);
      expect(body.cid).toBe(TEST_REPLY_CID);

      // Should have called PDS createRecord
      expect(createRecordFn).toHaveBeenCalledOnce();
      expect(createRecordFn.mock.calls[0]?.[0]).toBe(TEST_DID);
      expect(createRecordFn.mock.calls[0]?.[1]).toBe("forum.barazo.topic.reply");

      // Verify record content
      const record = createRecordFn.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(record.content).toBe("This is my reply to the topic.");
      expect(record.community).toBe("did:plc:community123");
      expect((record.root as Record<string, unknown>).uri).toBe(TEST_TOPIC_URI);
      expect((record.root as Record<string, unknown>).cid).toBe(TEST_TOPIC_CID);
      // parent should also point to topic when no parentUri provided
      expect((record.parent as Record<string, unknown>).uri).toBe(TEST_TOPIC_URI);
      expect((record.parent as Record<string, unknown>).cid).toBe(TEST_TOPIC_CID);

      // Should have inserted into DB
      expect(mockDb.insert).toHaveBeenCalledOnce();

      // Should have updated topic replyCount + lastActivityAt
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("creates a threaded reply (with parentUri) and returns 201", async () => {
      // First select: look up topic
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      // Onboarding gate: no mandatory fields
      selectChain.where.mockResolvedValueOnce([]);
      // Second select: look up parent reply
      selectChain.where.mockResolvedValueOnce([sampleReplyRow({
        uri: TEST_PARENT_REPLY_URI,
        cid: TEST_PARENT_REPLY_CID,
      })]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "This is a threaded reply.",
          parentUri: TEST_PARENT_REPLY_URI,
        },
      });

      expect(response.statusCode).toBe(201);

      // Verify record has correct parent reference
      const record = createRecordFn.mock.calls[0]?.[2] as Record<string, unknown>;
      expect((record.root as Record<string, unknown>).uri).toBe(TEST_TOPIC_URI);
      expect((record.parent as Record<string, unknown>).uri).toBe(TEST_PARENT_REPLY_URI);
      expect((record.parent as Record<string, unknown>).cid).toBe(TEST_PARENT_REPLY_CID);
    });

    it("returns 400 when parentUri reply not found", async () => {
      // First select: look up topic
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      // Second select: parent reply not found
      selectChain.where.mockResolvedValueOnce([]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Reply to missing parent.",
          parentUri: "at://did:plc:nobody/forum.barazo.topic.reply/ghost",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("tracks new user's repo on first post", async () => {
      isTrackedFn.mockResolvedValue(false);
      trackRepoFn.mockResolvedValue(undefined);
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "First ever post reply.",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(isTrackedFn).toHaveBeenCalledWith(TEST_DID);
      expect(trackRepoFn).toHaveBeenCalledWith(TEST_DID);
    });

    it("does not track already-tracked user", async () => {
      isTrackedFn.mockResolvedValue(true);
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Already tracked reply.",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(isTrackedFn).toHaveBeenCalledWith(TEST_DID);
      expect(trackRepoFn).not.toHaveBeenCalled();
    });

    it("returns 404 when topic does not exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedTopicUri = encodeURIComponent("at://did:plc:nobody/forum.barazo.topic.post/ghost");
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Reply to nonexistent topic.",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for missing content", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for empty content", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for content exceeding max length", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "A".repeat(50001),
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 502 when PDS write fails", async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      createRecordFn.mockRejectedValueOnce(new Error("PDS unreachable"));

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Should fail because PDS is down.",
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it("creates a reply with self-labels and includes them in PDS record and DB insert", async () => {
      const labels = { values: [{ val: "nsfw" }, { val: "spoiler" }] };
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "This reply has self-labels.",
          labels,
        },
      });

      expect(response.statusCode).toBe(201);

      // Verify PDS record includes labels
      expect(createRecordFn).toHaveBeenCalledOnce();
      const pdsRecord = createRecordFn.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(pdsRecord.labels).toEqual(labels);

      // Verify DB insert includes labels
      expect(mockDb.insert).toHaveBeenCalledOnce();
      const insertValues = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertValues.labels).toEqual(labels);
    });

    it("creates a reply without labels (backwards compatible)", async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "This reply has no labels.",
        },
      });

      expect(response.statusCode).toBe(201);

      // Verify PDS record does NOT include labels key
      const pdsRecord = createRecordFn.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(pdsRecord).not.toHaveProperty("labels");

      // Verify DB insert has labels: null
      const insertValues = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertValues.labels).toBeNull();
    });
  });

  describe("POST /api/topics/:topicUri/replies (unauthenticated)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 without auth", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "POST",
        url: `/api/topics/${encodedTopicUri}/replies`,
        payload: {
          content: "Unauth reply.",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // GET /api/topics/:topicUri/replies
  // =========================================================================

  describe("GET /api/topics/:topicUri/replies", () => {
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

    it("returns empty list when no replies exist", async () => {
      // First select: look up topic
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      // Second: replies query ends with .limit()
      selectChain.limit.mockResolvedValueOnce([]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: unknown[]; cursor: string | null }>();
      expect(body.replies).toEqual([]);
      expect(body.cursor).toBeNull();
    });

    it("returns replies with pagination cursor", async () => {
      // First: look up topic
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      // limit=2 means fetch 3 items
      const rows = [
        sampleReplyRow(),
        sampleReplyRow({ uri: `at://${TEST_DID}/forum.barazo.topic.reply/reply002`, rkey: "reply002" }),
        sampleReplyRow({ uri: `at://${TEST_DID}/forum.barazo.topic.reply/reply003`, rkey: "reply003" }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies?limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: unknown[]; cursor: string | null }>();
      expect(body.replies).toHaveLength(2);
      expect(body.cursor).toBeTruthy();
    });

    it("returns null cursor when fewer items than limit", async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      selectChain.limit.mockResolvedValueOnce([sampleReplyRow()]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies?limit=25`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: unknown[]; cursor: string | null }>();
      expect(body.replies).toHaveLength(1);
      expect(body.cursor).toBeNull();
    });

    it("includes depth field in reply responses", async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);

      // A direct reply (parentUri === rootUri) should have depth 0
      const directReply = sampleReplyRow({
        parentUri: TEST_TOPIC_URI,
        parentCid: TEST_TOPIC_CID,
      });
      // A nested reply (parentUri !== rootUri) should have depth 1
      const nestedReply = sampleReplyRow({
        uri: `at://${TEST_DID}/forum.barazo.topic.reply/nested001`,
        rkey: "nested001",
        parentUri: TEST_REPLY_URI,
        parentCid: TEST_REPLY_CID,
      });
      selectChain.limit.mockResolvedValueOnce([directReply, nestedReply]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: Array<{ depth: number; parentUri: string }> }>();
      expect(body.replies).toHaveLength(2);
      expect(body.replies[0]?.depth).toBe(0);
      expect(body.replies[1]?.depth).toBe(1);
    });

    it("returns 404 when topic does not exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedTopicUri = encodeURIComponent("at://did:plc:nobody/forum.barazo.topic.post/ghost");
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for invalid limit (over max)", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies?limit=999`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for invalid limit (zero)", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies?limit=0`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for non-numeric limit", async () => {
      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies?limit=abc`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("accepts cursor parameter", async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      const cursor = Buffer.from(JSON.stringify({ createdAt: TEST_NOW, uri: TEST_REPLY_URI })).toString("base64");
      selectChain.limit.mockResolvedValueOnce([]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies?cursor=${encodeURIComponent(cursor)}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it("works without authentication (public endpoint)", async () => {
      const noAuthApp = await buildTestApp(undefined);
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      selectChain.limit.mockResolvedValueOnce([]);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await noAuthApp.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      await noAuthApp.close();
    });

    it("includes labels in reply list response", async () => {
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      const labels = { values: [{ val: "nsfw" }] };
      const rows = [
        sampleReplyRow({ labels }),
        sampleReplyRow({
          uri: `at://${TEST_DID}/forum.barazo.topic.reply/nolabel`,
          rkey: "nolabel",
          labels: null,
        }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: Array<{ uri: string; labels: { values: Array<{ val: string }> } | null }> }>();
      expect(body.replies).toHaveLength(2);
      expect(body.replies[0]?.labels).toEqual(labels);
      expect(body.replies[1]?.labels).toBeNull();
    });

    it("excludes replies by blocked users from list", async () => {
      const blockedDid = "did:plc:blockeduser";

      // Query order for authenticated GET /api/topics/:topicUri/replies:
      // 1. Topic lookup (where)
      // 2. Category maturity (where)
      // 3. User profile (where) -- if authenticated
      // 4. Block/mute preferences (where)
      // 5. Replies query (limit)
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      // Category maturity
      selectChain.where.mockResolvedValueOnce([{ maturityRating: "safe" }]);
      // User profile
      selectChain.where.mockResolvedValueOnce([{ declaredAge: null, maturityPref: "safe" }]);
      // Community settings: ageThreshold
      selectChain.where.mockResolvedValueOnce([{ ageThreshold: 16 }]);
      // Block/mute preferences
      selectChain.where.mockResolvedValueOnce([{
        blockedDids: [blockedDid],
        mutedDids: [],
      }]);

      // Return only non-blocked replies
      const rows = [
        sampleReplyRow({ authorDid: TEST_DID }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: Array<{ authorDid: string; isMuted: boolean }> }>();
      expect(body.replies.every((r) => r.authorDid !== blockedDid)).toBe(true);
    });

    it("annotates replies by muted users with isMuted: true", async () => {
      const mutedDid = "did:plc:muteduser";

      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      // Category maturity
      selectChain.where.mockResolvedValueOnce([{ maturityRating: "safe" }]);
      // User profile
      selectChain.where.mockResolvedValueOnce([{ declaredAge: null, maturityPref: "safe" }]);
      // Community settings: ageThreshold
      selectChain.where.mockResolvedValueOnce([{ ageThreshold: 16 }]);
      // Block/mute preferences
      selectChain.where.mockResolvedValueOnce([{
        blockedDids: [],
        mutedDids: [mutedDid],
      }]);

      const rows = [
        sampleReplyRow({ authorDid: mutedDid, uri: `at://${mutedDid}/forum.barazo.topic.reply/m1`, rkey: "m1" }),
        sampleReplyRow({ authorDid: TEST_DID }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: Array<{ authorDid: string; isMuted: boolean }> }>();
      expect(body.replies).toHaveLength(2);

      const mutedReply = body.replies.find((r) => r.authorDid === mutedDid);
      const normalReply = body.replies.find((r) => r.authorDid === TEST_DID);
      expect(mutedReply?.isMuted).toBe(true);
      expect(normalReply?.isMuted).toBe(false);
    });

    it("includes author profile on each reply", async () => {
      resetAllDbMocks();

      // Mock chain for authenticated GET /api/topics/:topicUri/replies:
      //   1. Topic lookup .where (terminal)
      //   2. Category maturity .where (terminal)
      //   3. User profile .where (terminal)
      //   4. Community settings .where (terminal)
      //   5. loadBlockMuteLists .where (terminal)
      //   6. Replies .where (chained → .orderBy().limit())
      //   7. resolveAuthors users .where (terminal)
      //   8. loadMutedWords global .where (terminal)

      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);          // 1: topic lookup
      selectChain.where.mockResolvedValueOnce([{ maturityRating: "safe" }]); // 2: category maturity
      selectChain.where.mockResolvedValueOnce([{ declaredAge: null, maturityPref: "safe" }]); // 3: user profile
      selectChain.where.mockResolvedValueOnce([{ ageThreshold: 16 }]);       // 4: community settings
      selectChain.where.mockResolvedValueOnce([{                             // 5: block/mute
        blockedDids: [],
        mutedDids: [],
      }]);
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- thenable mock for Drizzle chain
      selectChain.where.mockImplementationOnce(() => selectChain);           // 6: replies .where

      const rows = [
        sampleReplyRow({ authorDid: TEST_DID }),
        sampleReplyRow({ authorDid: OTHER_DID, uri: `at://${OTHER_DID}/forum.barazo.topic.reply/o1`, rkey: "o1" }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      selectChain.where.mockResolvedValueOnce([                              // 7: resolveAuthors users
        { did: TEST_DID, handle: TEST_HANDLE, displayName: "Alice", avatarUrl: "https://cdn.example.com/alice.jpg", bannerUrl: null, bio: null },
        { did: OTHER_DID, handle: "bob.bsky.social", displayName: "Bob", avatarUrl: null, bannerUrl: null, bio: null },
      ]);
      selectChain.where.mockResolvedValueOnce([]);                           // 8: loadMutedWords global

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await app.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: Array<{ authorDid: string; author: { did: string; handle: string; displayName: string | null; avatarUrl: string | null } }> }>();
      expect(body.replies).toHaveLength(2);

      // Verify resolved author profile data (not just DID fallback)
      const aliceReply = body.replies.find((r) => r.authorDid === TEST_DID);
      expect(aliceReply?.author).toEqual({
        did: TEST_DID,
        handle: TEST_HANDLE,
        displayName: "Alice",
        avatarUrl: "https://cdn.example.com/alice.jpg",
      });

      const bobReply = body.replies.find((r) => r.authorDid === OTHER_DID);
      expect(bobReply?.author).toEqual({
        did: OTHER_DID,
        handle: "bob.bsky.social",
        displayName: "Bob",
        avatarUrl: null,
      });
    });

    it("returns isMuted: false for all replies when unauthenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);
      // For unauthenticated users, no user profile query
      selectChain.where.mockResolvedValueOnce([sampleTopicRow()]);
      // Category maturity
      selectChain.where.mockResolvedValueOnce([{ maturityRating: "safe" }]);
      // No user profile or block/mute query for unauthenticated
      // Replies query
      const rows = [
        sampleReplyRow({ authorDid: TEST_DID }),
        sampleReplyRow({ authorDid: OTHER_DID, uri: `at://${OTHER_DID}/forum.barazo.topic.reply/o1`, rkey: "o1" }),
      ];
      selectChain.limit.mockResolvedValueOnce(rows);

      const encodedTopicUri = encodeURIComponent(TEST_TOPIC_URI);
      const response = await noAuthApp.inject({
        method: "GET",
        url: `/api/topics/${encodedTopicUri}/replies`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ replies: Array<{ authorDid: string; isMuted: boolean }> }>();
      expect(body.replies).toHaveLength(2);
      expect(body.replies.every((r) => !r.isMuted)).toBe(true);

      await noAuthApp.close();
    });
  });

  // =========================================================================
  // PUT /api/replies/:uri
  // =========================================================================

  describe("PUT /api/replies/:uri", () => {
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
      updateRecordFn.mockResolvedValue({ uri: TEST_REPLY_URI, cid: "bafyreinewcid" });
    });

    it("updates a reply when user is the author", async () => {
      const existingRow = sampleReplyRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);
      const updatedRow = { ...existingRow, content: "Updated reply content", cid: "bafyreinewcid" };
      updateChain.returning.mockResolvedValueOnce([updatedRow]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Updated reply content",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ content: string }>();
      expect(body.content).toBe("Updated reply content");
      expect(updateRecordFn).toHaveBeenCalledOnce();
    });

    it("returns 403 when user is not the author", async () => {
      const existingRow = sampleReplyRow({ authorDid: OTHER_DID });
      selectChain.where.mockResolvedValueOnce([existingRow]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Attempted edit by non-author.",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 404 when reply does not exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedUri = encodeURIComponent("at://did:plc:nobody/forum.barazo.topic.reply/ghost");
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Ghost reply edit.",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for missing content", async () => {
      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for empty content", async () => {
      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for content exceeding max length", async () => {
      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "A".repeat(50001),
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 502 when PDS update fails", async () => {
      const existingRow = sampleReplyRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);
      updateRecordFn.mockRejectedValueOnce(new Error("PDS error"));

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          content: "Will fail to update.",
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it("updates a reply with self-labels (PDS record + DB)", async () => {
      const existingRow = sampleReplyRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);
      const labels = { values: [{ val: "nsfw" }, { val: "spoiler" }] };
      const updatedRow = { ...existingRow, content: "Updated with labels", labels, cid: "bafyreinewcid" };
      updateChain.returning.mockResolvedValueOnce([updatedRow]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: { content: "Updated with labels", labels },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ labels: { values: Array<{ val: string }> } }>();
      expect(body.labels).toEqual(labels);

      // Verify PDS record includes labels
      expect(updateRecordFn).toHaveBeenCalledOnce();
      const pdsRecord = updateRecordFn.mock.calls[0]?.[3] as Record<string, unknown>;
      expect(pdsRecord.labels).toEqual(labels);

      // Verify DB update includes labels
      const dbUpdateSet = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(dbUpdateSet.labels).toEqual(labels);
    });

    it("does not change existing labels when labels field is omitted from update", async () => {
      const existingLabels = { values: [{ val: "nsfw" }] };
      const existingRow = sampleReplyRow({ labels: existingLabels });
      selectChain.where.mockResolvedValueOnce([existingRow]);
      const updatedRow = { ...existingRow, content: "New content", cid: "bafyreinewcid" };
      updateChain.returning.mockResolvedValueOnce([updatedRow]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
        payload: { content: "New content" },
      });

      expect(response.statusCode).toBe(200);

      // PDS record should preserve existing labels
      const pdsRecord = updateRecordFn.mock.calls[0]?.[3] as Record<string, unknown>;
      expect(pdsRecord.labels).toEqual(existingLabels);

      // DB update should NOT include labels key (partial update)
      const dbUpdateSet = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(dbUpdateSet).not.toHaveProperty("labels");
    });
  });

  describe("PUT /api/replies/:uri (unauthenticated)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 without auth", async () => {
      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "PUT",
        url: `/api/replies/${encodedUri}`,
        payload: { content: "Unauth edit." },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // DELETE /api/replies/:uri
  // =========================================================================

  describe("DELETE /api/replies/:uri", () => {
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
      deleteRecordFn.mockResolvedValue(undefined);
    });

    it("deletes a reply when user is the author (deletes from PDS + DB)", async () => {
      const existingRow = sampleReplyRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);

      // Should have deleted from PDS
      expect(deleteRecordFn).toHaveBeenCalledOnce();
      expect(deleteRecordFn.mock.calls[0]?.[0]).toBe(TEST_DID);

      // Should have deleted from DB
      expect(mockDb.delete).toHaveBeenCalled();

      // Should have decremented topic replyCount
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("deletes reply as moderator (index-only delete, not from PDS)", async () => {
      const modApp = await buildTestApp(testUser({ did: MOD_DID, handle: "mod.bsky.social" }));

      const existingRow = sampleReplyRow({ authorDid: OTHER_DID });
      // First select: find reply
      selectChain.where.mockResolvedValueOnce([existingRow]);
      // Second select: check user role
      selectChain.where.mockResolvedValueOnce([{ did: MOD_DID, role: "moderator" }]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await modApp.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);
      expect(deleteRecordFn).not.toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();

      await modApp.close();
    });

    it("deletes reply as admin (index-only delete, not from PDS)", async () => {
      const adminApp = await buildTestApp(testUser({ did: MOD_DID, handle: "admin.bsky.social" }));

      const existingRow = sampleReplyRow({ authorDid: OTHER_DID });
      selectChain.where.mockResolvedValueOnce([existingRow]);
      selectChain.where.mockResolvedValueOnce([{ did: MOD_DID, role: "admin" }]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await adminApp.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);
      expect(deleteRecordFn).not.toHaveBeenCalled();

      await adminApp.close();
    });

    it("returns 403 when non-author regular user tries to delete", async () => {
      const existingRow = sampleReplyRow({ authorDid: OTHER_DID });
      selectChain.where.mockResolvedValueOnce([existingRow]);
      selectChain.where.mockResolvedValueOnce([{ did: TEST_DID, role: "user" }]);

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 404 when reply does not exist", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const encodedUri = encodeURIComponent("at://did:plc:nobody/forum.barazo.topic.reply/ghost");
      const response = await app.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 502 when PDS delete fails", async () => {
      const existingRow = sampleReplyRow();
      selectChain.where.mockResolvedValueOnce([existingRow]);
      deleteRecordFn.mockRejectedValueOnce(new Error("PDS delete failed"));

      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe("DELETE /api/replies/:uri (unauthenticated)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp(undefined);
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 without auth", async () => {
      const encodedUri = encodeURIComponent(TEST_REPLY_URI);
      const response = await app.inject({
        method: "DELETE",
        url: `/api/replies/${encodedUri}`,
        headers: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });
});

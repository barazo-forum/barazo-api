import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../../src/config/env.js";
import type {
  AuthMiddleware,
  RequestUser,
} from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";
import {
  type DbChain,
  createChainableProxy,
  createMockDb,
} from "../../helpers/mock-db.js";

// Import routes
import { profileRoutes } from "../../../src/routes/profiles.js";

// ---------------------------------------------------------------------------
// Mock env
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
const COMMUNITY_DID = "did:plc:community123";
const TEST_NOW = "2026-02-14T12:00:00.000Z";

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
// Sample data builders
// ---------------------------------------------------------------------------

function sampleUserRow(overrides?: Record<string, unknown>) {
  return {
    did: TEST_DID,
    handle: TEST_HANDLE,
    displayName: "Alice",
    avatarUrl: "https://example.com/avatar.jpg",
    role: "user",
    isBanned: false,
    reputationScore: 0,
    firstSeenAt: new Date(TEST_NOW),
    lastActiveAt: new Date(TEST_NOW),
    declaredAge: null,
    maturityPref: "safe",
    ...overrides,
  };
}

function samplePrefsRow(overrides?: Record<string, unknown>) {
  return {
    did: TEST_DID,
    maturityLevel: "sfw",
    declaredAge: null,
    mutedWords: [],
    blockedDids: [],
    mutedDids: [],
    crossPostBluesky: false,
    crossPostFrontpage: false,
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  };
}

function sampleCommunityPrefsRow(overrides?: Record<string, unknown>) {
  return {
    did: TEST_DID,
    communityDid: COMMUNITY_DID,
    maturityOverride: null,
    mutedWords: null,
    blockedDids: null,
    mutedDids: null,
    notificationPrefs: null,
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chainable mock DB
// ---------------------------------------------------------------------------

const mockDb = createMockDb();

let selectChain: DbChain;
let selectDistinctChain: DbChain;
let insertChain: DbChain;
let deleteChain: DbChain;

function resetAllDbMocks(): void {
  selectChain = createChainableProxy([]);
  selectDistinctChain = createChainableProxy([]);
  insertChain = createChainableProxy();
  deleteChain = createChainableProxy();
  mockDb.insert.mockReturnValue(insertChain);
  mockDb.select.mockReturnValue(selectChain);
  mockDb.selectDistinct.mockReturnValue(selectDistinctChain);
  mockDb.update.mockReturnValue(createChainableProxy([]));
  mockDb.delete.mockReturnValue(deleteChain);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async mock for Drizzle transaction
  mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
    return await fn(mockDb);
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
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

// ---------------------------------------------------------------------------
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("db", mockDb as never);
  app.decorate("env", mockEnv);
  app.decorate("authMiddleware", createMockAuthMiddleware(user));
  app.decorate("firehose", {} as never);
  app.decorate("oauthClient", {} as never);
  app.decorate("sessionService", {} as SessionService);
  app.decorate("setupService", {} as SetupService);
  app.decorate("cache", {} as never);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  // Override the logger so we can capture log calls
  app.log.info = mockLogger.info;
  app.log.warn = mockLogger.warn;
  app.log.error = mockLogger.error;

  await app.register(profileRoutes());
  await app.ready();

  return app;
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("profile routes", () => {
  // =========================================================================
  // GET /api/users/:handle
  // =========================================================================

  describe("GET /api/users/:handle", () => {
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

    it("returns profile with activity summary", async () => {
      // 1st select: user by handle
      selectChain.where.mockResolvedValueOnce([sampleUserRow()]);
      // 2nd select: topic count
      selectChain.where.mockResolvedValueOnce([{ count: 5 }]);
      // 3rd select: reply count
      selectChain.where.mockResolvedValueOnce([{ count: 10 }]);
      // 4th select: reactions on topics
      selectChain.where.mockResolvedValueOnce([{ count: 3 }]);
      // 5th select: reactions on replies
      selectChain.where.mockResolvedValueOnce([{ count: 2 }]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/${TEST_HANDLE}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        did: string;
        handle: string;
        displayName: string;
        role: string;
        activity: {
          topicCount: number;
          replyCount: number;
          reactionsReceived: number;
        };
      }>();
      expect(body.did).toBe(TEST_DID);
      expect(body.handle).toBe(TEST_HANDLE);
      expect(body.displayName).toBe("Alice");
      expect(body.role).toBe("user");
      expect(body.activity.topicCount).toBe(5);
      expect(body.activity.replyCount).toBe(10);
      expect(body.activity.reactionsReceived).toBe(5);
    });

    it("returns 404 for unknown handle", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/users/nonexistent.bsky.social",
      });

      expect(response.statusCode).toBe(404);
    });

    it("serializes dates as ISO strings", async () => {
      selectChain.where.mockResolvedValueOnce([sampleUserRow()]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/${TEST_HANDLE}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        firstSeenAt: string;
        lastActiveAt: string;
      }>();
      expect(body.firstSeenAt).toBe(TEST_NOW);
      expect(body.lastActiveAt).toBe(TEST_NOW);
    });
  });

  // =========================================================================
  // GET /api/users/:handle/reputation
  // =========================================================================

  describe("GET /api/users/:handle/reputation", () => {
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

    it("returns computed reputation (topics*5 + replies*2 + reactions*1)", async () => {
      // User lookup
      selectChain.where.mockResolvedValueOnce([sampleUserRow()]);
      // Topics: 3
      selectChain.where.mockResolvedValueOnce([{ count: 3 }]);
      // Replies: 7
      selectChain.where.mockResolvedValueOnce([{ count: 7 }]);
      // Reactions on topics: 4
      selectChain.where.mockResolvedValueOnce([{ count: 4 }]);
      // Reactions on replies: 6
      selectChain.where.mockResolvedValueOnce([{ count: 6 }]);
      // selectDistinct for topic communities and reply communities
      selectDistinctChain.where.mockResolvedValueOnce([]);
      selectDistinctChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/${TEST_HANDLE}/reputation`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        did: string;
        handle: string;
        reputation: number;
        breakdown: {
          topicCount: number;
          replyCount: number;
          reactionsReceived: number;
        };
      }>();
      expect(body.did).toBe(TEST_DID);
      // reputation = (3 * 5) + (7 * 2) + (4 + 6) * 1 = 15 + 14 + 10 = 39
      expect(body.reputation).toBe(39);
      expect(body.breakdown.topicCount).toBe(3);
      expect(body.breakdown.replyCount).toBe(7);
      expect(body.breakdown.reactionsReceived).toBe(10);
    });

    it("returns 404 for unknown handle", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/users/nonexistent.bsky.social/reputation",
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns zero reputation for user with no activity", async () => {
      selectChain.where.mockResolvedValueOnce([sampleUserRow()]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      // selectDistinct for topic communities and reply communities
      selectDistinctChain.where.mockResolvedValueOnce([]);
      selectDistinctChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/${TEST_HANDLE}/reputation`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ reputation: number; communityCount: number }>();
      expect(body.reputation).toBe(0);
      expect(body.communityCount).toBe(0);
    });

    it("includes communityCount in reputation response", async () => {
      // User lookup
      selectChain.where.mockResolvedValueOnce([sampleUserRow()]);
      // Topics: 3
      selectChain.where.mockResolvedValueOnce([{ count: 3 }]);
      // Replies: 7
      selectChain.where.mockResolvedValueOnce([{ count: 7 }]);
      // Reactions on topics: 4
      selectChain.where.mockResolvedValueOnce([{ count: 4 }]);
      // Reactions on replies: 6
      selectChain.where.mockResolvedValueOnce([{ count: 6 }]);
      // Distinct communities from topics
      selectDistinctChain.where.mockResolvedValueOnce([
        { communityDid: "did:plc:comm-a" },
        { communityDid: "did:plc:comm-b" },
      ]);
      // Distinct communities from replies
      selectDistinctChain.where.mockResolvedValueOnce([
        { communityDid: "did:plc:comm-b" },
        { communityDid: "did:plc:comm-c" },
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/${TEST_HANDLE}/reputation`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        did: string;
        handle: string;
        reputation: number;
        breakdown: {
          topicCount: number;
          replyCount: number;
          reactionsReceived: number;
        };
        communityCount: number;
      }>();
      expect(body.communityCount).toBe(3); // comm-a, comm-b, comm-c (deduplicated)
    });

    it("counts distinct communities across topics and replies", async () => {
      // User lookup
      selectChain.where.mockResolvedValueOnce([sampleUserRow()]);
      // Topics: 2
      selectChain.where.mockResolvedValueOnce([{ count: 2 }]);
      // Replies: 1
      selectChain.where.mockResolvedValueOnce([{ count: 1 }]);
      // Reactions on topics: 0
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      // Reactions on replies: 0
      selectChain.where.mockResolvedValueOnce([{ count: 0 }]);
      // Topic communities -- user created topics only in comm-a
      selectDistinctChain.where.mockResolvedValueOnce([
        { communityDid: "did:plc:comm-a" },
      ]);
      // Reply communities -- user replied only in comm-b (different community)
      selectDistinctChain.where.mockResolvedValueOnce([
        { communityDid: "did:plc:comm-b" },
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/${TEST_HANDLE}/reputation`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ communityCount: number }>();
      // 2 distinct communities: comm-a (from topics) + comm-b (from replies)
      expect(body.communityCount).toBe(2);
    });
  });

  // =========================================================================
  // POST /api/users/me/age-declaration
  // =========================================================================

  describe("POST /api/users/me/age-declaration", () => {
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

    it("stores declared age and returns it", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/users/me/age-declaration",
        headers: { authorization: "Bearer test-token" },
        payload: { declaredAge: 16 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        declaredAge: number;
      }>();
      expect(body.success).toBe(true);
      expect(body.declaredAge).toBe(16);
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("accepts declaredAge 0 (rather not say)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/users/me/age-declaration",
        headers: { authorization: "Bearer test-token" },
        payload: { declaredAge: 0 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        declaredAge: number;
      }>();
      expect(body.success).toBe(true);
      expect(body.declaredAge).toBe(0);
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "POST",
        url: "/api/users/me/age-declaration",
        payload: { declaredAge: 16 },
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 400 when declaredAge is invalid", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/users/me/age-declaration",
        headers: { authorization: "Bearer test-token" },
        payload: { declaredAge: 17 },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when body is empty", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/users/me/age-declaration",
        headers: { authorization: "Bearer test-token" },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // GET /api/users/me/preferences
  // =========================================================================

  describe("GET /api/users/me/preferences", () => {
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

    it("returns existing preferences", async () => {
      selectChain.where.mockResolvedValueOnce([
        samplePrefsRow({ maturityLevel: "mature", crossPostBluesky: true }),
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/users/me/preferences",
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        maturityLevel: string;
        crossPostBluesky: boolean;
      }>();
      expect(body.maturityLevel).toBe("mature");
      expect(body.crossPostBluesky).toBe(true);
    });

    it("returns defaults when no preferences row exists", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/users/me/preferences",
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        maturityLevel: string;
        mutedWords: string[];
        crossPostBluesky: boolean;
        crossPostFrontpage: boolean;
      }>();
      expect(body.maturityLevel).toBe("sfw");
      expect(body.mutedWords).toEqual([]);
      expect(body.crossPostBluesky).toBe(false);
      expect(body.crossPostFrontpage).toBe(false);
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "GET",
        url: "/api/users/me/preferences",
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });
  });

  // =========================================================================
  // PUT /api/users/me/preferences
  // =========================================================================

  describe("PUT /api/users/me/preferences", () => {
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

    it("upserts preferences and returns updated values", async () => {
      // After upsert, the select returns updated prefs
      selectChain.where.mockResolvedValueOnce([
        samplePrefsRow({
          maturityLevel: "mature",
          mutedWords: ["spoiler"],
        }),
      ]);

      const response = await app.inject({
        method: "PUT",
        url: "/api/users/me/preferences",
        headers: { authorization: "Bearer test-token" },
        payload: {
          maturityLevel: "mature",
          mutedWords: ["spoiler"],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        maturityLevel: string;
        mutedWords: string[];
      }>();
      expect(body.maturityLevel).toBe("mature");
      expect(body.mutedWords).toEqual(["spoiler"]);
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "PUT",
        url: "/api/users/me/preferences",
        payload: { maturityLevel: "sfw" },
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 400 for invalid maturityLevel", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/users/me/preferences",
        headers: { authorization: "Bearer test-token" },
        payload: { maturityLevel: "invalid" },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // GET /api/users/me/communities/:communityId/preferences
  // =========================================================================

  describe("GET /api/users/me/communities/:communityId/preferences", () => {
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

    it("returns existing community preferences", async () => {
      selectChain.where.mockResolvedValueOnce([
        sampleCommunityPrefsRow({
          maturityOverride: "mature",
          notificationPrefs: {
            replies: true,
            reactions: false,
            mentions: true,
            modActions: true,
          },
        }),
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/me/communities/${COMMUNITY_DID}/preferences`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        communityDid: string;
        maturityOverride: string;
        notificationPrefs: { replies: boolean };
      }>();
      expect(body.communityDid).toBe(COMMUNITY_DID);
      expect(body.maturityOverride).toBe("mature");
      expect(body.notificationPrefs.replies).toBe(true);
    });

    it("returns defaults when no row exists", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: "GET",
        url: `/api/users/me/communities/${COMMUNITY_DID}/preferences`,
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        communityDid: string;
        maturityOverride: null;
        mutedWords: null;
        notificationPrefs: null;
      }>();
      expect(body.communityDid).toBe(COMMUNITY_DID);
      expect(body.maturityOverride).toBeNull();
      expect(body.mutedWords).toBeNull();
      expect(body.notificationPrefs).toBeNull();
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "GET",
        url: `/api/users/me/communities/${COMMUNITY_DID}/preferences`,
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });
  });

  // =========================================================================
  // PUT /api/users/me/communities/:communityId/preferences
  // =========================================================================

  describe("PUT /api/users/me/communities/:communityId/preferences", () => {
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

    it("upserts community preferences and returns updated values", async () => {
      // After upsert, the select returns updated prefs
      selectChain.where.mockResolvedValueOnce([
        sampleCommunityPrefsRow({
          maturityOverride: "sfw",
          mutedWords: ["spam"],
        }),
      ]);

      const response = await app.inject({
        method: "PUT",
        url: `/api/users/me/communities/${COMMUNITY_DID}/preferences`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          maturityOverride: "sfw",
          mutedWords: ["spam"],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        communityDid: string;
        maturityOverride: string;
        mutedWords: string[];
      }>();
      expect(body.communityDid).toBe(COMMUNITY_DID);
      expect(body.maturityOverride).toBe("sfw");
      expect(body.mutedWords).toEqual(["spam"]);
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "PUT",
        url: `/api/users/me/communities/${COMMUNITY_DID}/preferences`,
        payload: { maturityOverride: "sfw" },
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 400 for invalid maturityOverride", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/users/me/communities/${COMMUNITY_DID}/preferences`,
        headers: { authorization: "Bearer test-token" },
        payload: { maturityOverride: "adult" },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // DELETE /api/users/me
  // =========================================================================

  describe("DELETE /api/users/me", () => {
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

    it("deletes all data and returns 204", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/users/me",
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.statusCode).toBe(204);
      // Transaction should be called once
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      // Multiple delete calls within transaction (reactions, notifications x2,
      // reports, replies, topics, community prefs, user prefs, users)
      expect(mockDb.delete).toHaveBeenCalled();
      // Check at least 8 delete calls (one per table)
      expect(mockDb.delete.mock.calls.length).toBeGreaterThanOrEqual(8);
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);

      const response = await noAuthApp.inject({
        method: "DELETE",
        url: "/api/users/me",
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("logs the GDPR purge with the user DID", async () => {
      await app.inject({
        method: "DELETE",
        url: "/api/users/me",
        headers: { authorization: "Bearer test-token" },
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { did: TEST_DID },
        "GDPR Art. 17: all indexed data purged for user",
      );
    });
  });
});

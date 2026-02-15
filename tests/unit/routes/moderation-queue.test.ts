import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../../src/config/env.js";
import type { AuthMiddleware, RequestUser } from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";
import { type DbChain, createChainableProxy, createMockDb } from "../../helpers/mock-db.js";

// ---------------------------------------------------------------------------
// Mock require-moderator
// ---------------------------------------------------------------------------

const mockRequireModerator = vi.fn();

vi.mock("../../../src/auth/require-moderator.js", () => ({
  createRequireModerator: () => mockRequireModerator,
}));

// Import routes AFTER mocking
import { moderationQueueRoutes } from "../../../src/routes/moderation-queue.js";

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------

const mockEnv = {
  COMMUNITY_DID: "did:plc:community123",
} as Env;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOD_DID = "did:plc:moderator999";
const AUTHOR_DID = "did:plc:author123";
const CONTENT_URI = "at://did:plc:author123/forum.barazo.topic.post/abc123";

function modUser(): RequestUser {
  return { did: MOD_DID, handle: "mod.bsky.social", sid: "a".repeat(64) };
}

// ---------------------------------------------------------------------------
// Mock DB and cache
// ---------------------------------------------------------------------------

const mockDb = createMockDb();
const mockCache = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
};

let insertChain: DbChain;
let selectChain: DbChain;
let updateChain: DbChain;

function resetAllDbMocks(): void {
  insertChain = createChainableProxy();
  selectChain = createChainableProxy([]);
  updateChain = createChainableProxy([]);
  mockDb.insert.mockReturnValue(insertChain);
  mockDb.select.mockReturnValue(selectChain);
  mockDb.update.mockReturnValue(updateChain);
  mockDb.transaction.mockImplementation((fn: (tx: typeof mockDb) => Promise<void>) => {
    return fn(mockDb);
  });
}

// ---------------------------------------------------------------------------
// App builder
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

async function buildTestApp(user?: RequestUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("db", mockDb as never);
  app.decorate("env", mockEnv);
  app.decorate("authMiddleware", createMockAuthMiddleware(user));
  app.decorate("cache", mockCache as never);
  app.decorate("requireAdmin", mockRequireModerator);
  app.decorate("sessionService", {} as SessionService);
  app.decorate("setupService", {} as SetupService);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  mockRequireModerator.mockImplementation(async (request: { user: RequestUser | undefined }) => {
    if (user) {
      request.user = user;
    }
  });

  await app.register(moderationQueueRoutes());
  await app.ready();

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("moderation queue routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(modUser());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetAllDbMocks();
    vi.clearAllMocks();
    mockRequireModerator.mockImplementation(async (request: { user: RequestUser | undefined }) => {
      request.user = modUser();
    });
  });

  describe("GET /api/moderation/queue", () => {
    it("returns empty queue when no pending items", async () => {
      selectChain = createChainableProxy([]);
      mockDb.select.mockReturnValue(selectChain);

      const response = await app.inject({
        method: "GET",
        url: "/api/moderation/queue",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toEqual([]);
      expect(body.cursor).toBeNull();
    });

    it("returns queue items with cursor pagination", async () => {
      const now = new Date();
      const items = [
        {
          id: 2,
          contentUri: CONTENT_URI,
          contentType: "topic",
          authorDid: AUTHOR_DID,
          communityDid: "did:plc:community123",
          queueReason: "word_filter",
          matchedWords: ["spam"],
          status: "pending",
          reviewedBy: null,
          createdAt: now,
          reviewedAt: null,
        },
        {
          id: 1,
          contentUri: "at://did:plc:author123/forum.barazo.topic.post/def456",
          contentType: "reply",
          authorDid: AUTHOR_DID,
          communityDid: "did:plc:community123",
          queueReason: "first_post",
          matchedWords: null,
          status: "pending",
          reviewedBy: null,
          createdAt: new Date(now.getTime() - 1000),
          reviewedAt: null,
        },
      ];

      selectChain = createChainableProxy(items);
      mockDb.select.mockReturnValue(selectChain);

      const response = await app.inject({
        method: "GET",
        url: "/api/moderation/queue?status=pending",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      expect(body.items[0].queueReason).toBe("word_filter");
      expect(body.items[0].matchedWords).toEqual(["spam"]);
    });
  });

  describe("PUT /api/moderation/queue/:id", () => {
    it("approves a queued item", async () => {
      const now = new Date();
      const queueItem = {
        id: 1,
        contentUri: CONTENT_URI,
        contentType: "topic",
        authorDid: AUTHOR_DID,
        communityDid: "did:plc:community123",
        queueReason: "word_filter",
        matchedWords: ["spam"],
        status: "pending",
        reviewedBy: null,
        createdAt: now,
        reviewedAt: null,
      };

      // First select: fetch queue item
      const fetchChain = createChainableProxy([queueItem]);
      mockDb.select.mockReturnValueOnce(fetchChain);

      // Inside transaction:
      // other pending items for same URI
      const otherPendingChain = createChainableProxy([]);
      mockDb.select.mockReturnValueOnce(otherPendingChain);
      // existing trust record
      const trustChain = createChainableProxy([]);
      mockDb.select.mockReturnValueOnce(trustChain);
      // community settings for threshold
      const settingsChain = createChainableProxy([
        {
          moderationThresholds: {
            trustedPostThreshold: 10,
          },
        },
      ]);
      mockDb.select.mockReturnValueOnce(settingsChain);

      // Final select: updated queue item
      const updatedItem = { ...queueItem, status: "approved", reviewedBy: MOD_DID, reviewedAt: now };
      const finalChain = createChainableProxy([updatedItem]);
      mockDb.select.mockReturnValueOnce(finalChain);

      const response = await app.inject({
        method: "PUT",
        url: "/api/moderation/queue/1",
        payload: { action: "approve" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("approved");
      expect(body.reviewedBy).toBe(MOD_DID);
    });

    it("rejects already-reviewed items with 409", async () => {
      const queueItem = {
        id: 1,
        contentUri: CONTENT_URI,
        contentType: "topic",
        authorDid: AUTHOR_DID,
        communityDid: "did:plc:community123",
        queueReason: "word_filter",
        matchedWords: null,
        status: "approved",
        reviewedBy: MOD_DID,
        createdAt: new Date(),
        reviewedAt: new Date(),
      };

      const fetchChain = createChainableProxy([queueItem]);
      mockDb.select.mockReturnValue(fetchChain);

      const response = await app.inject({
        method: "PUT",
        url: "/api/moderation/queue/1",
        payload: { action: "approve" },
      });

      expect(response.statusCode).toBe(409);
    });

    it("returns 404 for non-existent queue item", async () => {
      const fetchChain = createChainableProxy([]);
      mockDb.select.mockReturnValue(fetchChain);

      const response = await app.inject({
        method: "PUT",
        url: "/api/moderation/queue/999",
        payload: { action: "approve" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/admin/moderation/word-filter", () => {
    it("returns current word filter list", async () => {
      const chain = createChainableProxy([{ wordFilter: ["spam", "scam"] }]);
      mockDb.select.mockReturnValue(chain);

      const response = await app.inject({
        method: "GET",
        url: "/api/admin/moderation/word-filter",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.words).toEqual(["spam", "scam"]);
    });

    it("returns empty array when no filter set", async () => {
      const chain = createChainableProxy([{ wordFilter: [] }]);
      mockDb.select.mockReturnValue(chain);

      const response = await app.inject({
        method: "GET",
        url: "/api/admin/moderation/word-filter",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.words).toEqual([]);
    });
  });

  describe("PUT /api/admin/moderation/word-filter", () => {
    it("updates word filter list", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/admin/moderation/word-filter",
        payload: { words: ["Spam", "SCAM", "fraud"] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Should be deduplicated and lowercased
      expect(body.words).toEqual(["spam", "scam", "fraud"]);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("rejects invalid payload", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/admin/moderation/word-filter",
        payload: { words: "" },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

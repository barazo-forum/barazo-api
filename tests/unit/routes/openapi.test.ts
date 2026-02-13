import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import type { Env } from "../../../src/config/env.js";
import type { AuthMiddleware, RequestUser } from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";

// ---------------------------------------------------------------------------
// Mock PDS client module (must be before importing routes)
// ---------------------------------------------------------------------------

vi.mock("../../../src/lib/pds-client.js", () => ({
  createPdsClient: () => ({
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
  }),
}));

// Import routes AFTER mocking
import { topicRoutes } from "../../../src/routes/topics.js";
import { replyRoutes } from "../../../src/routes/replies.js";

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
// Mock DB (minimal, routes won't be called)
// ---------------------------------------------------------------------------

const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
};

// ---------------------------------------------------------------------------
// Auth middleware mock
// ---------------------------------------------------------------------------

function createMockAuthMiddleware(): AuthMiddleware {
  return {
    requireAuth: async (_request, _reply) => {
      // No-op for OpenAPI spec tests
    },
    optionalAuth: async (_request, _reply) => {
      // No-op for OpenAPI spec tests
    },
  };
}

// ---------------------------------------------------------------------------
// Mock firehose
// ---------------------------------------------------------------------------

const mockFirehose = {
  getRepoManager: () => ({
    isTracked: vi.fn(),
    trackRepo: vi.fn(),
    untrackRepo: vi.fn(),
    restoreTrackedRepos: vi.fn(),
  }),
  start: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn().mockReturnValue({ connected: true, lastEventId: null }),
};

// ---------------------------------------------------------------------------
// Helper: build app with Swagger + routes for OpenAPI testing
// ---------------------------------------------------------------------------

async function buildOpenApiApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("db", mockDb as never);
  app.decorate("env", mockEnv);
  app.decorate("authMiddleware", createMockAuthMiddleware());
  app.decorate("firehose", mockFirehose as never);
  app.decorate("oauthClient", {} as never);
  app.decorate("sessionService", {} as SessionService);
  app.decorate("setupService", {} as SetupService);
  app.decorate("cache", {} as never);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  // Register Swagger (same config as app.ts)
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Barazo Forum API",
        description:
          "AT Protocol forum AppView -- portable identity, federated communities.",
        version: "0.1.0",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Primary server",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "Access token from /api/auth/callback or /api/auth/refresh",
          },
        },
      },
    },
  });

  // Register routes (so their schemas appear in OpenAPI)
  await app.register(topicRoutes());
  await app.register(replyRoutes());

  // OpenAPI spec endpoint
  app.get("/api/openapi.json", { schema: { hide: true } }, async (_request, reply) => {
    return reply
      .header("Content-Type", "application/json")
      .send(app.swagger());
  });

  await app.ready();
  return app;
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("OpenAPI spec endpoint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildOpenApiApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/openapi.json returns 200", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns valid JSON with Content-Type application/json", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    expect(response.headers["content-type"]).toContain("application/json");

    // Should not throw when parsing
    const body = response.json<Record<string, unknown>>();
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
  });

  it("contains openapi version 3.1.0", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{ openapi: string }>();
    expect(body.openapi).toBe("3.1.0");
  });

  it("contains API info with correct title and version", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{
      info: { title: string; version: string; description: string };
    }>();
    expect(body.info.title).toBe("Barazo Forum API");
    expect(body.info.version).toBe("0.1.0");
    expect(body.info.description).toBeTruthy();
  });

  it("contains topic paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{ paths: Record<string, unknown> }>();
    expect(body.paths).toBeDefined();
    expect(body.paths["/api/topics"]).toBeDefined();
    expect(body.paths["/api/topics/{uri}"]).toBeDefined();
  });

  it("contains reply paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{ paths: Record<string, unknown> }>();
    expect(body.paths).toBeDefined();
    expect(body.paths["/api/topics/{topicUri}/replies"]).toBeDefined();
    expect(body.paths["/api/replies/{uri}"]).toBeDefined();
  });

  it("contains bearerAuth security scheme", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{
      components: {
        securitySchemes: {
          bearerAuth: { type: string; scheme: string };
        };
      };
    }>();
    expect(body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(body.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("topic POST endpoint has correct HTTP methods", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{
      paths: Record<string, Record<string, unknown>>;
    }>();
    const topicsPath = body.paths["/api/topics"];
    expect(topicsPath).toBeDefined();

    // Should have POST and GET methods
    expect(topicsPath?.post).toBeDefined();
    expect(topicsPath?.get).toBeDefined();
  });

  it("topic CRUD endpoints have correct HTTP methods", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{
      paths: Record<string, Record<string, unknown>>;
    }>();
    const topicByUriPath = body.paths["/api/topics/{uri}"];
    expect(topicByUriPath).toBeDefined();

    // Should have GET, PUT, DELETE methods
    expect(topicByUriPath?.get).toBeDefined();
    expect(topicByUriPath?.put).toBeDefined();
    expect(topicByUriPath?.delete).toBeDefined();
  });

  it("reply endpoints have correct HTTP methods", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    // POST + GET on topic replies
    const topicRepliesPath = body.paths["/api/topics/{topicUri}/replies"];
    expect(topicRepliesPath?.post).toBeDefined();
    expect(topicRepliesPath?.get).toBeDefined();

    // PUT + DELETE on individual replies
    const replyByUriPath = body.paths["/api/replies/{uri}"];
    expect(replyByUriPath?.put).toBeDefined();
    expect(replyByUriPath?.delete).toBeDefined();
  });

  it("protected endpoints reference bearerAuth security", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/openapi.json",
    });

    const body = response.json<{
      paths: Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>;
    }>();

    // POST /api/topics should require bearerAuth
    const postTopics = body.paths["/api/topics"]?.post;
    expect(postTopics?.security).toBeDefined();
    expect(postTopics?.security).toEqual(
      expect.arrayContaining([expect.objectContaining({ bearerAuth: [] })]),
    );
  });
});

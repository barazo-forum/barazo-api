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
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../../src/config/env.js";
import type {
  AuthMiddleware,
  RequestUser,
} from "../../../src/auth/middleware.js";
import type { SessionService } from "../../../src/auth/session.js";
import type { SetupService } from "../../../src/setup/service.js";
import type { StorageService } from "../../../src/lib/storage.js";
import {
  type DbChain,
  createChainableProxy,
  createMockDb,
} from "../../helpers/mock-db.js";

// ---------------------------------------------------------------------------
// Mock sharp -- must be hoisted before route import
// ---------------------------------------------------------------------------

vi.mock("sharp", () => {
  const mockSharpInstance = {
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("processed-image")),
  };
  return {
    default: vi.fn(() => mockSharpInstance),
    __mockInstance: mockSharpInstance,
  };
});

// Import routes after mocks
import { uploadRoutes } from "../../../src/routes/uploads.js";

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------

const mockEnv = {
  COMMUNITY_DID: "did:plc:community123",
  UPLOAD_MAX_SIZE_BYTES: 5_242_880,
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
const COMMUNITY_DID = "did:plc:community456";

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
// Mock DB
// ---------------------------------------------------------------------------

const mockDb = createMockDb();

let insertChain: DbChain;

function resetAllDbMocks(): void {
  const selectChain = createChainableProxy([]);
  insertChain = createChainableProxy();
  const deleteChain = createChainableProxy();
  mockDb.insert.mockReturnValue(insertChain);
  mockDb.select.mockReturnValue(selectChain);
  mockDb.update.mockReturnValue(createChainableProxy([]));
  mockDb.delete.mockReturnValue(deleteChain);
}

// ---------------------------------------------------------------------------
// Mock storage
// ---------------------------------------------------------------------------

function createMockStorage(): StorageService {
  return {
    store: vi.fn().mockResolvedValue("http://localhost:3000/uploads/avatars/test.webp"),
    delete: vi.fn().mockResolvedValue(undefined),
  };
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
// Helper: build app with mocked deps
// ---------------------------------------------------------------------------

async function buildTestApp(
  user?: RequestUser,
  storageOverride?: StorageService,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Register multipart before routes (required for request.file())
  await app.register(multipart, {
    limits: { fileSize: mockEnv.UPLOAD_MAX_SIZE_BYTES },
  });

  const storage = storageOverride ?? createMockStorage();

  app.decorate("db", mockDb as never);
  app.decorate("env", mockEnv);
  app.decorate("authMiddleware", createMockAuthMiddleware(user));
  app.decorate("storage", storage);
  app.decorate("firehose", {} as never);
  app.decorate("oauthClient", {} as never);
  app.decorate("sessionService", {} as SessionService);
  app.decorate("setupService", {} as SetupService);
  app.decorate("cache", {} as never);
  app.decorateRequest("user", undefined as RequestUser | undefined);

  await app.register(uploadRoutes());
  await app.ready();

  return app;
}

// ---------------------------------------------------------------------------
// Helper: create multipart form body for Fastify inject
// ---------------------------------------------------------------------------

function createMultipartPayload(
  filename: string,
  mimetype: string,
  data: Buffer,
): { body: string; contentType: string } {
  const boundary = `----TestBoundary${String(Date.now())}`;
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimetype}`,
    "",
    data.toString("binary"),
    `--${boundary}--`,
  ].join("\r\n");

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("upload routes", () => {
  // =========================================================================
  // POST /api/communities/:communityDid/profile/avatar
  // =========================================================================

  describe("POST /api/communities/:communityDid/profile/avatar", () => {
    let app: FastifyInstance;
    let mockStorage: StorageService;

    beforeAll(async () => {
      mockStorage = createMockStorage();
      app = await buildTestApp(testUser(), mockStorage);
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
      (mockStorage.store as ReturnType<typeof vi.fn>).mockResolvedValue(
        "http://localhost:3000/uploads/avatars/test.webp",
      );
    });

    it("uploads avatar and returns URL", async () => {
      const imageData = Buffer.from("fake-png-data");
      const { body, contentType } = createMultipartPayload(
        "avatar.png",
        "image/png",
        imageData,
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json<{ url: string }>();
      expect(result.url).toBe(
        "http://localhost:3000/uploads/avatars/test.webp",
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockStorage.store).toHaveBeenCalledOnce();
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);
      const imageData = Buffer.from("fake-png-data");
      const { body, contentType } = createMultipartPayload(
        "avatar.png",
        "image/png",
        imageData,
      );

      const response = await noAuthApp.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: { "content-type": contentType },
        body,
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 400 when no file is uploaded", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": "multipart/form-data; boundary=----EmptyBoundary",
        },
        body: "------EmptyBoundary--\r\n",
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for invalid MIME type", async () => {
      const { body, contentType } = createMultipartPayload(
        "doc.pdf",
        "application/pdf",
        Buffer.from("not-an-image"),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(400);
    });

    it("accepts JPEG files", async () => {
      const { body, contentType } = createMultipartPayload(
        "photo.jpg",
        "image/jpeg",
        Buffer.from("jpeg-data"),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(200);
    });

    it("accepts WebP files", async () => {
      const { body, contentType } = createMultipartPayload(
        "photo.webp",
        "image/webp",
        Buffer.from("webp-data"),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(200);
    });

    it("accepts GIF files", async () => {
      const { body, contentType } = createMultipartPayload(
        "anim.gif",
        "image/gif",
        Buffer.from("gif-data"),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/avatar`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // POST /api/communities/:communityDid/profile/banner
  // =========================================================================

  describe("POST /api/communities/:communityDid/profile/banner", () => {
    let app: FastifyInstance;
    let mockStorage: StorageService;

    beforeAll(async () => {
      mockStorage = createMockStorage();
      app = await buildTestApp(testUser(), mockStorage);
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      resetAllDbMocks();
      (mockStorage.store as ReturnType<typeof vi.fn>).mockResolvedValue(
        "http://localhost:3000/uploads/banners/test.webp",
      );
    });

    it("uploads banner and returns URL", async () => {
      const imageData = Buffer.from("fake-png-data");
      const { body, contentType } = createMultipartPayload(
        "banner.png",
        "image/png",
        imageData,
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/banner`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json<{ url: string }>();
      expect(result.url).toBe(
        "http://localhost:3000/uploads/banners/test.webp",
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockStorage.store).toHaveBeenCalledOnce();
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("returns 401 when not authenticated", async () => {
      const noAuthApp = await buildTestApp(undefined);
      const imageData = Buffer.from("fake-png-data");
      const { body, contentType } = createMultipartPayload(
        "banner.png",
        "image/png",
        imageData,
      );

      const response = await noAuthApp.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/banner`,
        headers: { "content-type": contentType },
        body,
      });

      expect(response.statusCode).toBe(401);
      await noAuthApp.close();
    });

    it("returns 400 for invalid MIME type", async () => {
      const { body, contentType } = createMultipartPayload(
        "doc.txt",
        "text/plain",
        Buffer.from("not-an-image"),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/communities/${COMMUNITY_DID}/profile/banner`,
        headers: {
          authorization: "Bearer test-token",
          "content-type": contentType,
        },
        body,
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

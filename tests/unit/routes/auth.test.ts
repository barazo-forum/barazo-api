import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { SessionService, SessionWithToken, Session } from "../../../src/auth/session.js";
import type { Env } from "../../../src/config/env.js";
import { authRoutes } from "../../../src/routes/auth.js";

// ---------------------------------------------------------------------------
// Mock env (minimal subset needed by auth routes)
// ---------------------------------------------------------------------------

const mockEnv = {
  OAUTH_CLIENT_ID: "http://localhost",
  OAUTH_SESSION_TTL: 604800,
  OAUTH_ACCESS_TOKEN_TTL: 900,
} as Env;

// ---------------------------------------------------------------------------
// Standalone mock functions (avoids @typescript-eslint/unbound-method)
// ---------------------------------------------------------------------------

// OAuth client mock functions
const authorizeFn = vi.fn<(...args: unknown[]) => Promise<URL>>();
const callbackFn = vi.fn<(...args: unknown[]) => Promise<{ session: { did: string }; state: string | null }>>();

// Session service mock functions
const createSessionFn = vi.fn<(...args: unknown[]) => Promise<SessionWithToken>>();
const validateAccessTokenFn = vi.fn<(...args: unknown[]) => Promise<Session | undefined>>();
const refreshSessionFn = vi.fn<(...args: unknown[]) => Promise<SessionWithToken | undefined>>();
const deleteSessionFn = vi.fn<(...args: unknown[]) => Promise<void>>();
const deleteAllSessionsForDidFn = vi.fn<(...args: unknown[]) => Promise<number>>();

// ---------------------------------------------------------------------------
// Mock objects using standalone fns
// ---------------------------------------------------------------------------

const mockOAuthClient = {
  authorize: authorizeFn,
  callback: callbackFn,
  clientMetadata: {},
  jwks: { keys: [] },
};

const mockSessionService: SessionService = {
  createSession: createSessionFn,
  validateAccessToken: validateAccessTokenFn,
  refreshSession: refreshSessionFn,
  deleteSession: deleteSessionFn,
  deleteAllSessionsForDid: deleteAllSessionsForDidFn,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:test123456789";
const TEST_HANDLE = "alice.bsky.social";
const TEST_SID = "a".repeat(64);
const TEST_ACCESS_TOKEN = "b".repeat(64);
const TEST_ACCESS_TOKEN_HASH = "c".repeat(64);
const TEST_EXPIRES_AT = Date.now() + 900_000;

function makeMockSessionWithToken(): SessionWithToken {
  return {
    sid: TEST_SID,
    did: TEST_DID,
    handle: TEST_HANDLE,
    accessTokenHash: TEST_ACCESS_TOKEN_HASH,
    accessTokenExpiresAt: TEST_EXPIRES_AT,
    createdAt: Date.now(),
    accessToken: TEST_ACCESS_TOKEN,
  };
}

function makeMockSession(): Session {
  return {
    sid: TEST_SID,
    did: TEST_DID,
    handle: TEST_HANDLE,
    accessTokenHash: TEST_ACCESS_TOKEN_HASH,
    accessTokenExpiresAt: TEST_EXPIRES_AT,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("auth routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register cookie plugin
    await app.register(cookie, { secret: "a".repeat(32) });

    // Decorate with mocks
    app.decorate("env", mockEnv);
    app.decorate("sessionService", mockSessionService);

    // Register auth routes (cast needed because mock is not full NodeOAuthClient)
    await app.register(
      authRoutes(mockOAuthClient as Parameters<typeof authRoutes>[0]),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET /api/auth/login
  // =========================================================================

  describe("GET /api/auth/login", () => {
    it("returns redirect URL for valid handle", async () => {
      const redirectUrl = new URL("https://pds.example.com/oauth/authorize?code=abc");
      authorizeFn.mockResolvedValueOnce(redirectUrl);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/login?handle=alice.bsky.social",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ url: string }>();
      expect(body.url).toBe(redirectUrl.toString());
      expect(authorizeFn).toHaveBeenCalledWith(
        "alice.bsky.social",
        { scope: "atproto transition:generic" },
      );
    });

    it("returns 400 for missing handle", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/login",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid handle");
    });

    it("returns 400 for empty handle", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/login?handle=",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid handle");
    });

    it("returns 400 for whitespace-only handle", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/login?handle=%20%20",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid handle");
    });

    it("returns 502 when OAuth client throws", async () => {
      authorizeFn.mockRejectedValueOnce(new Error("PDS unreachable"));

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/login?handle=alice.bsky.social",
      });

      expect(response.statusCode).toBe(502);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Failed to initiate login");
    });
  });

  // =========================================================================
  // GET /api/auth/callback
  // =========================================================================

  describe("GET /api/auth/callback", () => {
    it("returns access token and sets cookie for valid callback", async () => {
      const mockSession = makeMockSessionWithToken();
      const mockOAuthSession = { did: TEST_DID };

      callbackFn.mockResolvedValueOnce({
        session: mockOAuthSession,
        state: "some-state",
      });
      createSessionFn.mockResolvedValueOnce(mockSession);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?iss=https://pds.example.com&code=test-code&state=test-state",
      });

      expect(response.statusCode).toBe(200);

      const body = response.json<{
        accessToken: string;
        expiresAt: number;
        did: string;
        handle: string;
      }>();
      expect(body.accessToken).toBe(TEST_ACCESS_TOKEN);
      expect(body.expiresAt).toBe(TEST_EXPIRES_AT);
      expect(body.did).toBe(TEST_DID);
      expect(body.handle).toBe(TEST_HANDLE);

      // Verify cookie was set
      const cookies = response.cookies;
      const refreshCookie = cookies.find(
        (c: { name: string }) => c.name === "atgora_refresh",
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.value).toBe(TEST_SID);
      expect(refreshCookie?.httpOnly).toBe(true);
      expect(refreshCookie?.sameSite).toBe("Strict");
      expect(refreshCookie?.path).toBe("/api/auth");
    });

    it("returns 400 for missing iss param", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?code=test-code&state=test-state",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid callback parameters");
    });

    it("returns 400 for missing code param", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?iss=https://pds.example.com&state=test-state",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid callback parameters");
    });

    it("returns 400 for missing state param", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?iss=https://pds.example.com&code=test-code",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid callback parameters");
    });

    it("returns 502 when OAuth client throws", async () => {
      callbackFn.mockRejectedValueOnce(new Error("Token exchange failed"));

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?iss=https://pds.example.com&code=test-code&state=test-state",
      });

      expect(response.statusCode).toBe(502);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("OAuth callback failed");
    });
  });

  // =========================================================================
  // POST /api/auth/refresh
  // =========================================================================

  describe("POST /api/auth/refresh", () => {
    it("returns new access token when valid refresh cookie", async () => {
      const mockSession = makeMockSessionWithToken();
      refreshSessionFn.mockResolvedValueOnce(mockSession);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        cookies: { atgora_refresh: TEST_SID },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        accessToken: string;
        expiresAt: number;
      }>();
      expect(body.accessToken).toBe(TEST_ACCESS_TOKEN);
      expect(body.expiresAt).toBe(TEST_EXPIRES_AT);

      // Verify refresh cookie was re-set
      const cookies = response.cookies;
      const refreshCookie = cookies.find(
        (c: { name: string }) => c.name === "atgora_refresh",
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.value).toBe(TEST_SID);
    });

    it("returns 401 when no cookie", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("No refresh token");
    });

    it("returns 401 when session expired and clears cookie", async () => {
      refreshSessionFn.mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        cookies: { atgora_refresh: TEST_SID },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Session expired");

      // Verify cookie was cleared
      const cookies = response.cookies;
      const refreshCookie = cookies.find(
        (c: { name: string }) => c.name === "atgora_refresh",
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.value).toBe("");
    });
  });

  // =========================================================================
  // DELETE /api/auth/session
  // =========================================================================

  describe("DELETE /api/auth/session", () => {
    it("returns 204 and clears cookie", async () => {
      deleteSessionFn.mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/auth/session",
        cookies: { atgora_refresh: TEST_SID },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");

      expect(deleteSessionFn).toHaveBeenCalledWith(TEST_SID);

      // Verify cookie was cleared
      const cookies = response.cookies;
      const refreshCookie = cookies.find(
        (c: { name: string }) => c.name === "atgora_refresh",
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.value).toBe("");
    });

    it("returns 204 when no cookie (idempotent)", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/auth/session",
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(deleteSessionFn).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /api/auth/me
  // =========================================================================

  describe("GET /api/auth/me", () => {
    it("returns user info for valid Bearer token", async () => {
      const mockSession = makeMockSession();
      validateAccessTokenFn.mockResolvedValueOnce(mockSession);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: {
          authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ did: string; handle: string }>();
      expect(body.did).toBe(TEST_DID);
      expect(body.handle).toBe(TEST_HANDLE);

      expect(validateAccessTokenFn).toHaveBeenCalledWith(TEST_ACCESS_TOKEN);
    });

    it("returns 401 for missing Authorization header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Authentication required");
    });

    it("returns 401 for non-Bearer authorization", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: {
          authorization: "Basic dXNlcjpwYXNz",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Authentication required");
    });

    it("returns 401 for invalid/expired token", async () => {
      validateAccessTokenFn.mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: {
          authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("Invalid or expired token");
    });
  });
});

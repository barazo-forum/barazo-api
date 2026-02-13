import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Cache } from "../../../src/cache/index.js";
import type { Logger } from "../../../src/lib/logger.js";
import type { Env } from "../../../src/config/env.js";

// Track constructor calls and mock event listener
const constructorArgs: Record<string, unknown>[] = [];
const mockAddEventListener = vi.fn();
const mockJwks = { keys: [] };

vi.mock("@atproto/oauth-client-node", () => {
  return {
    NodeOAuthClient: class MockNodeOAuthClient {
      clientMetadata: Record<string, unknown>;
      jwks: { keys: unknown[] };
      addEventListener = mockAddEventListener;

      constructor(options: { clientMetadata: Record<string, unknown> }) {
        constructorArgs.push(options as Record<string, unknown>);
        this.clientMetadata = options.clientMetadata;
        this.jwks = mockJwks;
      }
    },
  };
});

// Import after mock setup
const { createOAuthClient } = await import(
  "../../../src/auth/oauth-client.js"
);

function createMockCache() {
  const setFn = vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue("OK");
  const getFn = vi.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null);
  const delFn = vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1);
  return {
    cache: { set: setFn, get: getFn, del: delFn } as unknown as Cache,
    setFn,
    getFn,
    delFn,
  };
}

function createMockLogger() {
  const infoFn = vi.fn();
  return {
    logger: {
      debug: vi.fn(),
      info: infoFn,
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger,
    infoFn,
  };
}

function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: "postgresql://localhost/atgora",
    VALKEY_URL: "redis://localhost:6379",
    TAP_URL: "https://tap.example.com",
    TAP_ADMIN_PASSWORD: "test-password",
    HOST: "0.0.0.0",
    PORT: 3000,
    LOG_LEVEL: "info",
    CORS_ORIGINS: "http://localhost:3001",
    COMMUNITY_MODE: "single",
    COMMUNITY_NAME: "ATgora Community",
    RATE_LIMIT_AUTH: 10,
    RATE_LIMIT_WRITE: 10,
    RATE_LIMIT_READ_ANON: 100,
    RATE_LIMIT_READ_AUTH: 300,
    OAUTH_CLIENT_ID: "http://localhost",
    OAUTH_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/callback",
    SESSION_SECRET: "a".repeat(32),
    OAUTH_SESSION_TTL: 604800,
    OAUTH_ACCESS_TOKEN_TTL: 900,
    ...overrides,
  } as Env;
}

/** Get the most recent constructor options */
function getLastConstructorOptions(): Record<string, unknown> {
  expect(constructorArgs.length).toBeGreaterThan(0);
  return constructorArgs[constructorArgs.length - 1] as Record<string, unknown>;
}

describe("createOAuthClient", () => {
  let cacheMocks: ReturnType<typeof createMockCache>;
  let logMocks: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    constructorArgs.length = 0;
    vi.clearAllMocks();
    cacheMocks = createMockCache();
    logMocks = createMockLogger();
  });

  describe("loopback mode detection", () => {
    it("detects loopback mode when OAUTH_CLIENT_ID starts with http://localhost", () => {
      const env = createMockEnv({
        OAUTH_CLIENT_ID: "http://localhost",
        OAUTH_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/callback",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      const metadata = options.clientMetadata as { client_id: string };
      const clientId = metadata.client_id;

      // Loopback client_id encodes redirect_uri and scope as query params
      expect(clientId).toContain("http://localhost?");
      expect(clientId).toContain("redirect_uri=");
      expect(clientId).toContain("scope=");
      expect(clientId).toContain(encodeURIComponent("http://127.0.0.1:3000/api/auth/callback"));
      expect(clientId).toContain(encodeURIComponent("atproto transition:generic"));
    });

    it("uses production client_id when not starting with http://localhost", () => {
      const env = createMockEnv({
        OAUTH_CLIENT_ID: "https://forum.atgora.forum/oauth-client-metadata.json",
        OAUTH_REDIRECT_URI: "https://forum.atgora.forum/api/auth/callback",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      const metadata = options.clientMetadata as { client_id: string };
      expect(metadata.client_id).toBe(
        "https://forum.atgora.forum/oauth-client-metadata.json",
      );
    });
  });

  describe("client metadata", () => {
    it("sets required OAuth metadata fields", () => {
      const env = createMockEnv();

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      const metadata = options.clientMetadata as {
        client_name: string;
        scope: string;
        grant_types: string[];
        response_types: string[];
        application_type: string;
        token_endpoint_auth_method: string;
        dpop_bound_access_tokens: boolean;
      };

      expect(metadata.client_name).toBe("ATgora Forum");
      expect(metadata.scope).toBe("atproto transition:generic");
      expect(metadata.grant_types).toEqual(["authorization_code", "refresh_token"]);
      expect(metadata.response_types).toEqual(["code"]);
      expect(metadata.application_type).toBe("web");
      expect(metadata.token_endpoint_auth_method).toBe("none");
      expect(metadata.dpop_bound_access_tokens).toBe(true);
    });

    it("includes redirect_uris from env", () => {
      const env = createMockEnv({
        OAUTH_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/callback",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      const metadata = options.clientMetadata as { redirect_uris: string[] };
      expect(metadata.redirect_uris).toEqual([
        "http://127.0.0.1:3000/api/auth/callback",
      ]);
    });

    it("derives client_uri from OAUTH_CLIENT_ID in production mode", () => {
      const env = createMockEnv({
        OAUTH_CLIENT_ID: "https://forum.atgora.forum/oauth-client-metadata.json",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      const metadata = options.clientMetadata as { client_uri: string };
      expect(metadata.client_uri).toBe("https://forum.atgora.forum");
    });

    it("uses http://localhost as client_uri in loopback mode", () => {
      const env = createMockEnv({
        OAUTH_CLIENT_ID: "http://localhost",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      const metadata = options.clientMetadata as { client_uri: string };
      expect(metadata.client_uri).toBe("http://localhost");
    });
  });

  describe("stores and lock", () => {
    it("provides stateStore, sessionStore, and requestLock", () => {
      const env = createMockEnv();

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      const options = getLastConstructorOptions();
      expect(options.stateStore).toBeDefined();
      expect(options.sessionStore).toBeDefined();
      expect(options.requestLock).toBeDefined();
      expect(typeof options.requestLock).toBe("function");
    });
  });

  describe("event listeners", () => {
    it("registers updated and deleted event listeners", () => {
      const env = createMockEnv();

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      expect(mockAddEventListener).toHaveBeenCalledTimes(2);
      expect(mockAddEventListener).toHaveBeenCalledWith(
        "updated",
        expect.any(Function),
      );
      expect(mockAddEventListener).toHaveBeenCalledWith(
        "deleted",
        expect.any(Function),
      );
    });
  });

  describe("logging", () => {
    it("logs creation info in loopback mode", () => {
      const env = createMockEnv({
        OAUTH_CLIENT_ID: "http://localhost",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      expect(logMocks.infoFn).toHaveBeenCalledWith(
        { loopback: true, clientId: "(loopback)" },
        "Creating OAuth client",
      );
    });

    it("logs creation info in production mode", () => {
      const env = createMockEnv({
        OAUTH_CLIENT_ID: "https://forum.atgora.forum/oauth-client-metadata.json",
      });

      createOAuthClient(env, cacheMocks.cache, logMocks.logger);

      expect(logMocks.infoFn).toHaveBeenCalledWith(
        {
          loopback: false,
          clientId: "https://forum.atgora.forum/oauth-client-metadata.json",
        },
        "Creating OAuth client",
      );
    });
  });
});

describe("requestLock (via createOAuthClient internals)", () => {
  let cacheMocks: ReturnType<typeof createMockCache>;
  let logMocks: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    constructorArgs.length = 0;
    vi.clearAllMocks();
    cacheMocks = createMockCache();
    logMocks = createMockLogger();
  });

  it("acquires lock, executes function, and releases lock", async () => {
    const env = createMockEnv();

    createOAuthClient(env, cacheMocks.cache, logMocks.logger);

    const options = getLastConstructorOptions();
    const requestLock = options.requestLock as <T>(
      name: string,
      fn: () => T | PromiseLike<T>,
    ) => Promise<T>;

    // Mock successful lock acquisition
    cacheMocks.setFn.mockResolvedValueOnce("OK");

    const result = await requestLock("test-lock", () => "test-result");

    expect(result).toBe("test-result");
    expect(cacheMocks.setFn).toHaveBeenCalledWith(
      "atgora:oauth:lock:test-lock",
      "1",
      "EX",
      10,
      "NX",
    );
    // Lock released after function execution
    expect(cacheMocks.delFn).toHaveBeenCalledWith("atgora:oauth:lock:test-lock");
  });

  it("releases lock even when function throws", async () => {
    const env = createMockEnv();

    createOAuthClient(env, cacheMocks.cache, logMocks.logger);

    const options = getLastConstructorOptions();
    const requestLock = options.requestLock as <T>(
      name: string,
      fn: () => T | PromiseLike<T>,
    ) => Promise<T>;

    cacheMocks.setFn.mockResolvedValueOnce("OK");

    await expect(
      requestLock("test-lock", () => {
        throw new Error("function error");
      }),
    ).rejects.toThrow("function error");

    // Lock was still released
    expect(cacheMocks.delFn).toHaveBeenCalledWith("atgora:oauth:lock:test-lock");
  });

  it("retries once when lock is not acquired", async () => {
    const env = createMockEnv();

    createOAuthClient(env, cacheMocks.cache, logMocks.logger);

    const options = getLastConstructorOptions();
    const requestLock = options.requestLock as <T>(
      name: string,
      fn: () => T | PromiseLike<T>,
    ) => Promise<T>;

    // First attempt fails (null = not acquired), second succeeds
    cacheMocks.setFn
      .mockResolvedValueOnce(null as unknown as "OK")
      .mockResolvedValueOnce("OK");

    const result = await requestLock("test-lock", () => 42);

    expect(result).toBe(42);
    expect(cacheMocks.setFn).toHaveBeenCalledTimes(2);
  });

  it("throws when lock cannot be acquired after retry", async () => {
    const env = createMockEnv();

    createOAuthClient(env, cacheMocks.cache, logMocks.logger);

    const options = getLastConstructorOptions();
    const requestLock = options.requestLock as <T>(
      name: string,
      fn: () => T | PromiseLike<T>,
    ) => Promise<T>;

    // Both attempts fail
    cacheMocks.setFn
      .mockResolvedValueOnce(null as unknown as "OK")
      .mockResolvedValueOnce(null as unknown as "OK");

    await expect(
      requestLock("test-lock", () => "should not run"),
    ).rejects.toThrow("Could not acquire OAuth lock: test-lock");
  });
});

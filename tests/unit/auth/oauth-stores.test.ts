import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValkeyStateStore, ValkeySessionStore } from "../../../src/auth/oauth-stores.js";
import type { Cache } from "../../../src/cache/index.js";
import type { Logger } from "../../../src/lib/logger.js";
import type { NodeSavedState, NodeSavedSession } from "@atproto/oauth-client-node";

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
  const debugFn = vi.fn();
  const infoFn = vi.fn();
  const warnFn = vi.fn();
  const errorFn = vi.fn();
  return {
    logger: {
      debug: debugFn,
      info: infoFn,
      warn: warnFn,
      error: errorFn,
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger,
    debugFn,
    infoFn,
    warnFn,
    errorFn,
  };
}

// Minimal mock data that satisfies the type shape
const mockState: NodeSavedState = {
  dpopJwk: { kty: "EC", crv: "P-256", x: "test-x", y: "test-y" },
  iss: "https://pds.example.com",
  verifier: "test-verifier",
  appState: "test-app-state",
} as unknown as NodeSavedState;

const mockSession: NodeSavedSession = {
  dpopJwk: { kty: "EC", crv: "P-256", x: "test-x", y: "test-y" },
  tokenSet: {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "DPoP",
    expires_at: Date.now() + 900000,
    scope: "atproto transition:generic",
    sub: "did:plc:test-user-123",
    aud: "https://pds.example.com",
    iss: "https://pds.example.com",
  },
} as unknown as NodeSavedSession;

describe("ValkeyStateStore", () => {
  let setFn: ReturnType<typeof createMockCache>["setFn"];
  let getFn: ReturnType<typeof createMockCache>["getFn"];
  let delFn: ReturnType<typeof createMockCache>["delFn"];
  let debugFn: ReturnType<typeof createMockLogger>["debugFn"];
  let errorFn: ReturnType<typeof createMockLogger>["errorFn"];
  let store: ValkeyStateStore;

  beforeEach(() => {
    const mocks = createMockCache();
    const logMocks = createMockLogger();
    setFn = mocks.setFn;
    getFn = mocks.getFn;
    delFn = mocks.delFn;
    debugFn = logMocks.debugFn;
    errorFn = logMocks.errorFn;
    store = new ValkeyStateStore(mocks.cache, logMocks.logger);
  });

  describe("set", () => {
    it("stores state with correct key prefix and 5-minute TTL", async () => {
      await store.set("abc123", mockState);

      expect(setFn).toHaveBeenCalledWith(
        "barazo:oauth:state:abc123",
        JSON.stringify(mockState),
        "EX",
        300,
      );
    });

    it("logs debug on success", async () => {
      await store.set("abc123", mockState);

      expect(debugFn).toHaveBeenCalledWith(
        { key: "barazo:oauth:state:abc123" },
        "OAuth state stored",
      );
    });

    it("logs error and rethrows on cache failure", async () => {
      const error = new Error("Valkey connection refused");
      setFn.mockRejectedValueOnce(error);

      await expect(store.set("abc123", mockState)).rejects.toThrow(
        "Valkey connection refused",
      );
      expect(errorFn).toHaveBeenCalledWith(
        { err: error, key: "barazo:oauth:state:abc123" },
        "Failed to store OAuth state",
      );
    });
  });

  describe("get", () => {
    it("returns undefined when key not found", async () => {
      getFn.mockResolvedValueOnce(null);

      const result = await store.get("nonexistent");

      expect(result).toBeUndefined();
      expect(getFn).toHaveBeenCalledWith("barazo:oauth:state:nonexistent");
    });

    it("returns deserialized state when found", async () => {
      getFn.mockResolvedValueOnce(JSON.stringify(mockState));

      const result = await store.get("abc123");

      expect(result).toEqual(mockState);
    });

    it("logs error and rethrows on cache failure", async () => {
      const error = new Error("Valkey timeout");
      getFn.mockRejectedValueOnce(error);

      await expect(store.get("abc123")).rejects.toThrow("Valkey timeout");
      expect(errorFn).toHaveBeenCalledWith(
        { err: error, key: "barazo:oauth:state:abc123" },
        "Failed to retrieve OAuth state",
      );
    });
  });

  describe("del", () => {
    it("deletes with correct key prefix", async () => {
      await store.del("abc123");

      expect(delFn).toHaveBeenCalledWith("barazo:oauth:state:abc123");
    });

    it("logs debug on success", async () => {
      await store.del("abc123");

      expect(debugFn).toHaveBeenCalledWith(
        { key: "barazo:oauth:state:abc123" },
        "OAuth state deleted",
      );
    });

    it("logs error and rethrows on cache failure", async () => {
      const error = new Error("Valkey error");
      delFn.mockRejectedValueOnce(error);

      await expect(store.del("abc123")).rejects.toThrow("Valkey error");
      expect(errorFn).toHaveBeenCalledWith(
        { err: error, key: "barazo:oauth:state:abc123" },
        "Failed to delete OAuth state",
      );
    });
  });
});

describe("ValkeySessionStore", () => {
  let setFn: ReturnType<typeof createMockCache>["setFn"];
  let getFn: ReturnType<typeof createMockCache>["getFn"];
  let delFn: ReturnType<typeof createMockCache>["delFn"];
  let errorFn: ReturnType<typeof createMockLogger>["errorFn"];
  let store: ValkeySessionStore;
  let cache: Cache;
  const defaultTtl = 604800; // 7 days

  beforeEach(() => {
    const mocks = createMockCache();
    const logMocks = createMockLogger();
    cache = mocks.cache;
    setFn = mocks.setFn;
    getFn = mocks.getFn;
    delFn = mocks.delFn;
    errorFn = logMocks.errorFn;
    store = new ValkeySessionStore(mocks.cache, logMocks.logger, defaultTtl);
  });

  describe("set", () => {
    it("stores session with correct key prefix and configured TTL", async () => {
      const sub = "did:plc:test-user-123";
      await store.set(sub, mockSession);

      expect(setFn).toHaveBeenCalledWith(
        "barazo:oauth:session:did:plc:test-user-123",
        JSON.stringify(mockSession),
        "EX",
        604800,
      );
    });

    it("uses custom TTL when provided", async () => {
      const logMocks = createMockLogger();
      const customStore = new ValkeySessionStore(cache, logMocks.logger, 3600);
      await customStore.set("did:plc:test", mockSession);

      expect(setFn).toHaveBeenCalledWith(
        "barazo:oauth:session:did:plc:test",
        JSON.stringify(mockSession),
        "EX",
        3600,
      );
    });

    it("logs error and rethrows on cache failure", async () => {
      const error = new Error("Valkey write error");
      setFn.mockRejectedValueOnce(error);

      await expect(
        store.set("did:plc:test", mockSession),
      ).rejects.toThrow("Valkey write error");
      expect(errorFn).toHaveBeenCalledWith(
        { err: error, key: "barazo:oauth:session:did:plc:test" },
        "Failed to store OAuth session",
      );
    });
  });

  describe("get", () => {
    it("returns undefined when session not found", async () => {
      getFn.mockResolvedValueOnce(null);

      const result = await store.get("did:plc:nonexistent");

      expect(result).toBeUndefined();
    });

    it("returns deserialized session when found", async () => {
      getFn.mockResolvedValueOnce(JSON.stringify(mockSession));

      const result = await store.get("did:plc:test-user-123");

      expect(result).toEqual(mockSession);
      expect(getFn).toHaveBeenCalledWith(
        "barazo:oauth:session:did:plc:test-user-123",
      );
    });

    it("logs error and rethrows on cache failure", async () => {
      const error = new Error("Valkey read error");
      getFn.mockRejectedValueOnce(error);

      await expect(store.get("did:plc:test")).rejects.toThrow(
        "Valkey read error",
      );
    });
  });

  describe("del", () => {
    it("deletes with correct key prefix", async () => {
      await store.del("did:plc:test-user-123");

      expect(delFn).toHaveBeenCalledWith(
        "barazo:oauth:session:did:plc:test-user-123",
      );
    });

    it("logs error and rethrows on cache failure", async () => {
      const error = new Error("Valkey delete error");
      delFn.mockRejectedValueOnce(error);

      await expect(store.del("did:plc:test")).rejects.toThrow(
        "Valkey delete error",
      );
    });
  });

  describe("JSON serialization", () => {
    it("round-trips session data correctly through JSON", async () => {
      // Simulate set then get
      let storedData: string | null = null;
      setFn.mockImplementation(
        (_key: unknown, value: unknown) => {
          storedData = value as string;
          return Promise.resolve("OK");
        },
      );
      getFn.mockImplementation(() => Promise.resolve(storedData));

      await store.set("did:plc:roundtrip", mockSession);
      const retrieved = await store.get("did:plc:roundtrip");

      expect(retrieved).toEqual(mockSession);
    });
  });
});

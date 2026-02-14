import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSetupService } from "../../../src/setup/service.js";
import type { SetupService } from "../../../src/setup/service.js";
import type { PlcDidService, GenerateDidResult } from "../../../src/services/plc-did.js";
import type { Logger } from "../../../src/lib/logger.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockDb() {
  // Select chain: db.select().from().where() -> Promise<rows[]>
  const whereSelectFn = vi.fn<() => Promise<unknown[]>>();
  const fromFn = vi.fn<() => { where: typeof whereSelectFn }>().mockReturnValue({
    where: whereSelectFn,
  });
  const selectFn = vi.fn<() => { from: typeof fromFn }>().mockReturnValue({
    from: fromFn,
  });

  // Upsert chain: db.insert().values().onConflictDoUpdate().returning() -> Promise<rows[]>
  const returningFn = vi.fn<() => Promise<unknown[]>>();
  const onConflictDoUpdateFn = vi.fn<() => { returning: typeof returningFn }>().mockReturnValue({
    returning: returningFn,
  });
  const valuesFn = vi.fn<() => { onConflictDoUpdate: typeof onConflictDoUpdateFn }>().mockReturnValue({
    onConflictDoUpdate: onConflictDoUpdateFn,
  });
  const insertFn = vi.fn<() => { values: typeof valuesFn }>().mockReturnValue({
    values: valuesFn,
  });

  return {
    db: { select: selectFn, insert: insertFn },
    mocks: {
      selectFn,
      fromFn,
      whereSelectFn,
      insertFn,
      valuesFn,
      onConflictDoUpdateFn,
      returningFn,
    },
  };
}

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: "silent",
  } as unknown as Logger;
}

function createMockPlcDidService(): PlcDidService & {
  generateDid: ReturnType<typeof vi.fn>;
} {
  return {
    generateDid: vi.fn<() => Promise<GenerateDidResult>>(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:test123456789";
const DEFAULT_COMMUNITY_NAME = "Barazo Community";
const TEST_HANDLE = "community.barazo.forum";
const TEST_SERVICE_ENDPOINT = "https://community.barazo.forum";
const TEST_COMMUNITY_DID = "did:plc:communityabc123456";
const TEST_SIGNING_KEY = "a".repeat(64);
const TEST_ROTATION_KEY = "b".repeat(64);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SetupService", () => {
  let service: SetupService;
  let mocks: ReturnType<typeof createMockDb>["mocks"];
  let mockLogger: Logger;
  let mockPlcDidService: ReturnType<typeof createMockPlcDidService>;

  beforeEach(() => {
    const { db, mocks: m } = createMockDb();
    mocks = m;
    mockLogger = createMockLogger();
    mockPlcDidService = createMockPlcDidService();
    service = createSetupService(db as never, mockLogger, mockPlcDidService);
  });

  // =========================================================================
  // getStatus
  // =========================================================================

  describe("getStatus()", () => {
    it("returns { initialized: false } when no settings row exists", async () => {
      mocks.whereSelectFn.mockResolvedValueOnce([]);

      const result = await service.getStatus();

      expect(result).toStrictEqual({ initialized: false });
    });

    it("returns { initialized: false } when settings exist but not initialized", async () => {
      mocks.whereSelectFn.mockResolvedValueOnce([
        {
          initialized: false,
          communityName: "Test Community",
        },
      ]);

      const result = await service.getStatus();

      expect(result).toStrictEqual({ initialized: false });
    });

    it("returns { initialized: true, communityName } when initialized", async () => {
      mocks.whereSelectFn.mockResolvedValueOnce([
        {
          initialized: true,
          communityName: "My Forum",
        },
      ]);

      const result = await service.getStatus();

      expect(result).toStrictEqual({
        initialized: true,
        communityName: "My Forum",
      });
    });

    it("propagates database errors", async () => {
      mocks.whereSelectFn.mockRejectedValueOnce(new Error("Connection lost"));

      await expect(service.getStatus()).rejects.toThrow("Connection lost");
    });
  });

  // =========================================================================
  // initialize (basic, without PLC DID)
  // =========================================================================

  describe("initialize() without PLC DID", () => {
    it("returns success for first authenticated user when no row exists", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: null },
      ]);

      const result = await service.initialize({ did: TEST_DID });

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: DEFAULT_COMMUNITY_NAME,
      });
      expect(mocks.insertFn).toHaveBeenCalled();
      expect(mockPlcDidService.generateDid).not.toHaveBeenCalled();
    });

    it("returns success when row exists but not initialized", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: "Existing Name", communityDid: null },
      ]);

      const result = await service.initialize({ did: TEST_DID });

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: "Existing Name",
      });
      expect(mocks.insertFn).toHaveBeenCalled();
    });

    it("returns conflict error when already initialized", async () => {
      mocks.returningFn.mockResolvedValueOnce([]);

      const result = await service.initialize({ did: TEST_DID });

      expect(result).toStrictEqual({ alreadyInitialized: true });
    });

    it("accepts optional communityName", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: "Custom Name", communityDid: null },
      ]);

      const result = await service.initialize({
        did: TEST_DID,
        communityName: "Custom Name",
      });

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: "Custom Name",
      });
      expect(mocks.insertFn).toHaveBeenCalled();
    });

    it("preserves existing communityName when no override provided", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: "Keep This Name", communityDid: null },
      ]);

      const result = await service.initialize({ did: TEST_DID });

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: "Keep This Name",
      });
    });

    it("propagates database errors", async () => {
      mocks.returningFn.mockRejectedValueOnce(new Error("Connection lost"));

      await expect(
        service.initialize({ did: TEST_DID }),
      ).rejects.toThrow("Connection lost");
    });

    it("does not call PLC DID service when only handle is provided (no serviceEndpoint)", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: null },
      ]);

      await service.initialize({
        did: TEST_DID,
        handle: TEST_HANDLE,
      });

      expect(mockPlcDidService.generateDid).not.toHaveBeenCalled();
    });

    it("does not call PLC DID service when only serviceEndpoint is provided (no handle)", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: null },
      ]);

      await service.initialize({
        did: TEST_DID,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      });

      expect(mockPlcDidService.generateDid).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // initialize (with PLC DID generation)
  // =========================================================================

  describe("initialize() with PLC DID", () => {
    it("generates PLC DID when handle and serviceEndpoint are provided", async () => {
      mockPlcDidService.generateDid.mockResolvedValueOnce({
        did: TEST_COMMUNITY_DID,
        signingKey: TEST_SIGNING_KEY,
        rotationKey: TEST_ROTATION_KEY,
      });
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: TEST_COMMUNITY_DID },
      ]);

      const result = await service.initialize({
        did: TEST_DID,
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      });

      expect(mockPlcDidService.generateDid).toHaveBeenCalledOnce();
      expect(mockPlcDidService.generateDid).toHaveBeenCalledWith({
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      });

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: DEFAULT_COMMUNITY_NAME,
        communityDid: TEST_COMMUNITY_DID,
      });
    });

    it("includes communityDid in result when DID is generated", async () => {
      mockPlcDidService.generateDid.mockResolvedValueOnce({
        did: TEST_COMMUNITY_DID,
        signingKey: TEST_SIGNING_KEY,
        rotationKey: TEST_ROTATION_KEY,
      });
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: "My Forum", communityDid: TEST_COMMUNITY_DID },
      ]);

      const result = await service.initialize({
        did: TEST_DID,
        communityName: "My Forum",
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      });

      expect(result).toHaveProperty("communityDid", TEST_COMMUNITY_DID);
    });

    it("does not include communityDid in result when DID is null", async () => {
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: null },
      ]);

      const result = await service.initialize({ did: TEST_DID });

      expect(result).not.toHaveProperty("communityDid");
    });

    it("propagates PLC DID generation errors", async () => {
      mockPlcDidService.generateDid.mockRejectedValueOnce(
        new Error("PLC directory returned 500: Internal Server Error"),
      );

      await expect(
        service.initialize({
          did: TEST_DID,
          handle: TEST_HANDLE,
          serviceEndpoint: TEST_SERVICE_ENDPOINT,
        }),
      ).rejects.toThrow("PLC directory returned 500: Internal Server Error");
    });

    it("logs info when generating PLC DID", async () => {
      mockPlcDidService.generateDid.mockResolvedValueOnce({
        did: TEST_COMMUNITY_DID,
        signingKey: TEST_SIGNING_KEY,
        rotationKey: TEST_ROTATION_KEY,
      });
      mocks.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: TEST_COMMUNITY_DID },
      ]);

      await service.initialize({
        did: TEST_DID,
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      });

      const infoFn = mockLogger.info as ReturnType<typeof vi.fn>;
      expect(infoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: TEST_HANDLE,
          serviceEndpoint: TEST_SERVICE_ENDPOINT,
        }) as Record<string, unknown>,
        "Generating PLC DID during community setup",
      );
    });
  });

  // =========================================================================
  // initialize (without PlcDidService injected)
  // =========================================================================

  describe("initialize() without PlcDidService", () => {
    it("logs warning when handle/serviceEndpoint provided but no PlcDidService", async () => {
      // Create service without PlcDidService
      const { db, mocks: m } = createMockDb();
      const logger = createMockLogger();
      const serviceWithoutPlc = createSetupService(db as never, logger);

      m.returningFn.mockResolvedValueOnce([
        { communityName: DEFAULT_COMMUNITY_NAME, communityDid: null },
      ]);

      await serviceWithoutPlc.initialize({
        did: TEST_DID,
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      });

      const warnFn = logger.warn as ReturnType<typeof vi.fn>;
      expect(warnFn).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: TEST_HANDLE,
          serviceEndpoint: TEST_SERVICE_ENDPOINT,
        }) as Record<string, unknown>,
        "PLC DID generation requested but PlcDidService not available",
      );
    });
  });
});

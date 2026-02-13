import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSetupService } from "../../../src/setup/service.js";
import type { SetupService } from "../../../src/setup/service.js";
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:test123456789";
const DEFAULT_COMMUNITY_NAME = "Barazo Community";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SetupService", () => {
  let service: SetupService;
  let mocks: ReturnType<typeof createMockDb>["mocks"];
  let mockLogger: Logger;

  beforeEach(() => {
    const { db, mocks: m } = createMockDb();
    mocks = m;
    mockLogger = createMockLogger();
    service = createSetupService(db as never, mockLogger);
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
  // initialize
  // =========================================================================

  describe("initialize()", () => {
    it("returns success for first authenticated user when no row exists", async () => {
      mocks.returningFn.mockResolvedValueOnce([{ communityName: DEFAULT_COMMUNITY_NAME }]);

      const result = await service.initialize(TEST_DID);

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: DEFAULT_COMMUNITY_NAME,
      });
      expect(mocks.insertFn).toHaveBeenCalled();
    });

    it("returns success when row exists but not initialized", async () => {
      mocks.returningFn.mockResolvedValueOnce([{ communityName: "Existing Name" }]);

      const result = await service.initialize(TEST_DID);

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: "Existing Name",
      });
      expect(mocks.insertFn).toHaveBeenCalled();
    });

    it("returns conflict error when already initialized", async () => {
      mocks.returningFn.mockResolvedValueOnce([]);

      const result = await service.initialize(TEST_DID);

      expect(result).toStrictEqual({ alreadyInitialized: true });
    });

    it("accepts optional communityName", async () => {
      mocks.returningFn.mockResolvedValueOnce([{ communityName: "Custom Name" }]);

      const result = await service.initialize(TEST_DID, "Custom Name");

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: "Custom Name",
      });
      expect(mocks.insertFn).toHaveBeenCalled();
    });

    it("preserves existing communityName when no override provided", async () => {
      mocks.returningFn.mockResolvedValueOnce([{ communityName: "Keep This Name" }]);

      const result = await service.initialize(TEST_DID);

      expect(result).toStrictEqual({
        initialized: true,
        adminDid: TEST_DID,
        communityName: "Keep This Name",
      });
    });

    it("propagates database errors", async () => {
      mocks.returningFn.mockRejectedValueOnce(new Error("Connection lost"));

      await expect(service.initialize(TEST_DID)).rejects.toThrow(
        "Connection lost",
      );
    });
  });
});

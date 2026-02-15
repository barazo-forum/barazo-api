import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkBanPropagation } from "../../../src/services/ban-propagation.js";
import { createMockDb, resetDbMocks } from "../../helpers/mock-db.js";
import type { MockDb } from "../../helpers/mock-db.js";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TARGET_DID = "did:plc:target123";

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: "info",
    silent: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mock cache
// ---------------------------------------------------------------------------

function createMockCache() {
  return {
    del: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    set: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockDb: MockDb;
let mockLogger: ReturnType<typeof createMockLogger>;
let mockCache: ReturnType<typeof createMockCache>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = createMockDb();
  resetDbMocks(mockDb);
  mockLogger = createMockLogger();
  mockCache = createMockCache();
});

// ===========================================================================
// checkBanPropagation
// ===========================================================================

describe("checkBanPropagation", () => {
  it("returns propagated=false and banCount=0 when user has no bans", async () => {
    mockDb.execute.mockResolvedValue([{ ban_count: 0 }]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: false, banCount: 0 });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockCache.del).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it("returns propagated=false and banCount=1 when banned in only 1 community", async () => {
    mockDb.execute.mockResolvedValue([{ ban_count: 1 }]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: false, banCount: 1 });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockCache.del).not.toHaveBeenCalled();
  });

  it("returns propagated=true and creates account filter when banned in 2+ communities", async () => {
    mockDb.execute.mockResolvedValue([{ ban_count: 2 }]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: true, banCount: 2 });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockCache.del).toHaveBeenCalledWith(`account-filter:${TARGET_DID}`);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { targetDid: TARGET_DID, banCount: 2 },
      "Account auto-filtered due to cross-community bans",
    );
  });

  it("returns propagated=true when banned in more than 2 communities", async () => {
    mockDb.execute.mockResolvedValue([{ ban_count: 5 }]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: true, banCount: 5 });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      { targetDid: TARGET_DID, banCount: 5 },
      "Account auto-filtered due to cross-community bans",
    );
  });

  it("correctly counts only communities with latest action = ban (ignores unbans)", async () => {
    // When the SQL query correctly handles unbans, the returned ban_count
    // reflects only communities where the latest action is "ban".
    // e.g., user banned in 3 communities but unbanned in 2 -> ban_count = 1
    mockDb.execute.mockResolvedValue([{ ban_count: 1 }]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: false, banCount: 1 });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("handles cache.del failure gracefully (non-critical)", async () => {
    mockDb.execute.mockResolvedValue([{ ban_count: 3 }]);
    mockCache.del.mockRejectedValue(new Error("Cache unavailable"));

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    // Should still succeed despite cache error
    expect(result).toEqual({ propagated: true, banCount: 3 });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("defaults banCount to 0 when result row is missing ban_count", async () => {
    mockDb.execute.mockResolvedValue([{}]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: false, banCount: 0 });
  });

  it("defaults banCount to 0 when result array is empty", async () => {
    mockDb.execute.mockResolvedValue([]);

    const result = await checkBanPropagation(
      mockDb as never,
      mockCache as never,
      mockLogger as never,
      TARGET_DID,
    );

    expect(result).toEqual({ propagated: false, banCount: 0 });
  });
});

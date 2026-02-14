import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// We test loadBlockMuteLists as a pure function with a mock DB.
// ---------------------------------------------------------------------------

// We need to import after setting up any mocks, but this module has no
// side-effect imports that need mocking, so direct import is fine.
import { loadBlockMuteLists } from "../../../src/lib/block-mute.js";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function createMockDb() {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  // select().from().where() chain
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue([]);

  return {
    select: vi.fn().mockReturnValue(chain),
    chain,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadBlockMuteLists", () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it("returns empty lists for undefined user (unauthenticated)", async () => {
    const result = await loadBlockMuteLists(undefined, mockDb);

    expect(result).toEqual({ blockedDids: [], mutedDids: [] });
    // Should not have queried the DB at all
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns lists from preferences when they exist", async () => {
    const blockedDids = ["did:plc:blocked1", "did:plc:blocked2"];
    const mutedDids = ["did:plc:muted1"];

    mockDb.chain.where.mockResolvedValueOnce([{ blockedDids, mutedDids }]);

    const result = await loadBlockMuteLists("did:plc:testuser", mockDb);

    expect(result).toEqual({ blockedDids, mutedDids });
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("returns empty lists when no preferences row exists", async () => {
    // Default mock returns empty array (no rows)
    mockDb.chain.where.mockResolvedValueOnce([]);

    const result = await loadBlockMuteLists("did:plc:testuser", mockDb);

    expect(result).toEqual({ blockedDids: [], mutedDids: [] });
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("returns empty blockedDids when field is null in DB", async () => {
    mockDb.chain.where.mockResolvedValueOnce([{
      blockedDids: null,
      mutedDids: ["did:plc:muted1"],
    }]);

    const result = await loadBlockMuteLists("did:plc:testuser", mockDb);

    expect(result.blockedDids).toEqual([]);
    expect(result.mutedDids).toEqual(["did:plc:muted1"]);
  });

  it("returns empty mutedDids when field is null in DB", async () => {
    mockDb.chain.where.mockResolvedValueOnce([{
      blockedDids: ["did:plc:blocked1"],
      mutedDids: null,
    }]);

    const result = await loadBlockMuteLists("did:plc:testuser", mockDb);

    expect(result.blockedDids).toEqual(["did:plc:blocked1"]);
    expect(result.mutedDids).toEqual([]);
  });
});

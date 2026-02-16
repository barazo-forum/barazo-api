import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProfileSyncService } from "../../../src/services/profile-sync.js";
import type { ProfileSyncService } from "../../../src/services/profile-sync.js";
import type { Logger } from "../../../src/lib/logger.js";
import type { Database } from "../../../src/db/index.js";
import type { NodeOAuthClient } from "@atproto/oauth-client-node";

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

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
// Mock helpers
// ---------------------------------------------------------------------------

function createMockOAuthClient(overrides?: {
  restore?: ReturnType<typeof vi.fn>;
}) {
  return {
    restore: overrides?.restore ?? vi.fn(),
  } as unknown as NodeOAuthClient;
}

function createMockDb(overrides?: {
  whereReturn?: ReturnType<typeof vi.fn>;
}) {
  const whereFn = overrides?.whereReturn ?? vi.fn().mockResolvedValue(undefined);
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });

  return {
    update: updateFn,
    _mocks: { updateFn, setFn, whereFn },
  } as unknown as Database & {
    _mocks: {
      updateFn: ReturnType<typeof vi.fn>;
      setFn: ReturnType<typeof vi.fn>;
      whereFn: ReturnType<typeof vi.fn>;
    };
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:testuser123456789012";

const MOCK_PROFILE_RESPONSE = {
  success: true,
  data: {
    did: TEST_DID,
    handle: "alice.bsky.social",
    displayName: "Alice Wonderland",
    avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:testuser123456789012/bafkreiabc@jpeg",
    banner: "https://cdn.bsky.app/img/banner/plain/did:plc:testuser123456789012/bafkreixyz@jpeg",
    description: "Exploring the decentralized web.",
  },
};

const MOCK_MINIMAL_PROFILE_RESPONSE = {
  success: true,
  data: {
    did: TEST_DID,
    handle: "bob.bsky.social",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfileSyncService", () => {
  let service: ProfileSyncService;
  let mockLogger: Logger;
  let mockOAuthClient: NodeOAuthClient;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockGetProfile: ReturnType<typeof vi.fn>;
  let mockRestore: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockGetProfile = vi.fn().mockResolvedValue(MOCK_PROFILE_RESPONSE);

    // Mock session object that Agent constructor can use
    mockRestore = vi.fn().mockResolvedValue({});
    mockOAuthClient = createMockOAuthClient({ restore: mockRestore });
    mockDb = createMockDb();

    service = createProfileSyncService(mockOAuthClient, mockDb, mockLogger, {
      createAgent: () => ({
        getProfile: mockGetProfile,
      }),
    });
  });

  // -------------------------------------------------------------------------
  // Successful sync
  // -------------------------------------------------------------------------

  it("returns profile data on successful fetch", async () => {
    const result = await service.syncProfile(TEST_DID);

    expect(result).toStrictEqual({
      displayName: "Alice Wonderland",
      avatarUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:testuser123456789012/bafkreiabc@jpeg",
      bannerUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:testuser123456789012/bafkreixyz@jpeg",
      bio: "Exploring the decentralized web.",
    });
  });

  it("restores OAuth session for the given DID", async () => {
    await service.syncProfile(TEST_DID);

    expect(mockRestore).toHaveBeenCalledWith(TEST_DID);
  });

  it("calls getProfile with the user DID", async () => {
    await service.syncProfile(TEST_DID);

    expect(mockGetProfile).toHaveBeenCalledWith({ actor: TEST_DID });
  });

  it("updates the users table with profile data and lastActiveAt", async () => {
    await service.syncProfile(TEST_DID);

    expect(mockDb._mocks.updateFn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // No profile fields (minimal profile)
  // -------------------------------------------------------------------------

  it("returns null values when profile has no optional fields", async () => {
    mockGetProfile.mockResolvedValue(MOCK_MINIMAL_PROFILE_RESPONSE);

    const result = await service.syncProfile(TEST_DID);

    expect(result).toStrictEqual({
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    });
  });

  // -------------------------------------------------------------------------
  // OAuth restore failure
  // -------------------------------------------------------------------------

  it("returns null values when OAuth session restore fails", async () => {
    mockRestore.mockRejectedValue(new Error("No stored session"));

    const result = await service.syncProfile(TEST_DID);

    expect(result).toStrictEqual({
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    });
  });

  it("logs at debug level when OAuth session restore fails", async () => {
    mockRestore.mockRejectedValue(new Error("No stored session"));

    await service.syncProfile(TEST_DID);

    const debugFn = mockLogger.debug as ReturnType<typeof vi.fn>;
    expect(debugFn).toHaveBeenCalledWith(
      expect.objectContaining({ did: TEST_DID }) as Record<string, unknown>,
      expect.stringContaining("profile sync failed") as string,
    );
  });

  // -------------------------------------------------------------------------
  // getProfile failure
  // -------------------------------------------------------------------------

  it("returns null values when getProfile throws", async () => {
    mockGetProfile.mockRejectedValue(new Error("Network timeout"));

    const result = await service.syncProfile(TEST_DID);

    expect(result).toStrictEqual({
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    });
  });

  // -------------------------------------------------------------------------
  // DB update failure
  // -------------------------------------------------------------------------

  it("still returns profile data when DB update fails", async () => {
    mockDb = createMockDb({
      whereReturn: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    });

    service = createProfileSyncService(mockOAuthClient, mockDb, mockLogger, {
      createAgent: () => ({
        getProfile: mockGetProfile,
      }),
    });

    const result = await service.syncProfile(TEST_DID);

    expect(result).toStrictEqual({
      displayName: "Alice Wonderland",
      avatarUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:testuser123456789012/bafkreiabc@jpeg",
      bannerUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:testuser123456789012/bafkreixyz@jpeg",
      bio: "Exploring the decentralized web.",
    });
  });

  it("logs a warning when DB update fails", async () => {
    mockDb = createMockDb({
      whereReturn: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    });

    service = createProfileSyncService(mockOAuthClient, mockDb, mockLogger, {
      createAgent: () => ({
        getProfile: mockGetProfile,
      }),
    });

    await service.syncProfile(TEST_DID);

    const warnFn = mockLogger.warn as ReturnType<typeof vi.fn>;
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ did: TEST_DID }) as Record<string, unknown>,
      expect.stringContaining("profile DB update failed") as string,
    );
  });
});

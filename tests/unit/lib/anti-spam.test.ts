import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainableProxy, createMockDb } from "../../helpers/mock-db.js";

// ---------------------------------------------------------------------------
// Mock cache (ioredis-compatible)
// ---------------------------------------------------------------------------

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    zadd: vi.fn().mockResolvedValue(1),
    zcard: vi.fn().mockResolvedValue(0),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
  };
}

// Import after mocks set up
import {
  checkWordFilter,
  checkForUrls,
  isNewAccount,
  isAccountTrusted,
  needsFirstPostModeration,
  canCreateTopic,
  checkWriteRateLimit,
  checkBurstDetection,
  loadAntiSpamSettings,
  runAntiSpamChecks,
} from "../../../src/lib/anti-spam.js";

// ---------------------------------------------------------------------------
// checkWordFilter
// ---------------------------------------------------------------------------

describe("checkWordFilter", () => {
  it("returns no match for empty filter list", () => {
    const result = checkWordFilter("some content here", "Title", []);
    expect(result.matches).toBe(false);
    expect(result.matchedWords).toHaveLength(0);
  });

  it("matches exact word in content", () => {
    const result = checkWordFilter("this is spam content", undefined, ["spam"]);
    expect(result.matches).toBe(true);
    expect(result.matchedWords).toContain("spam");
  });

  it("matches word in title", () => {
    const result = checkWordFilter("clean content", "Spam title", ["spam"]);
    expect(result.matches).toBe(true);
    expect(result.matchedWords).toContain("spam");
  });

  it("is case-insensitive", () => {
    const result = checkWordFilter("SPAM here", undefined, ["spam"]);
    expect(result.matches).toBe(true);
  });

  it("does NOT match partial words", () => {
    const result = checkWordFilter("this is unspammy content", undefined, [
      "spam",
    ]);
    expect(result.matches).toBe(false);
  });

  it("matches multiple words", () => {
    const result = checkWordFilter("spam and scam content", undefined, [
      "spam",
      "scam",
      "fraud",
    ]);
    expect(result.matches).toBe(true);
    expect(result.matchedWords).toContain("spam");
    expect(result.matchedWords).toContain("scam");
    expect(result.matchedWords).not.toContain("fraud");
  });

  it("handles special regex characters in filter words", () => {
    // Word boundary \b requires a word/non-word transition.
    // Use a filter term with special regex chars that still has word boundaries.
    const result = checkWordFilter(
      "visit site.com today",
      undefined,
      ["site.com"],
    );
    expect(result.matches).toBe(true);
    // The dot is escaped so "siteXcom" should NOT match
    const result2 = checkWordFilter(
      "visit siteXcom today",
      undefined,
      ["site.com"],
    );
    expect(result2.matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkForUrls
// ---------------------------------------------------------------------------

describe("checkForUrls", () => {
  it("detects http URLs", () => {
    expect(checkForUrls("visit http://example.com")).toBe(true);
  });

  it("detects https URLs", () => {
    expect(checkForUrls("visit https://example.com/page")).toBe(true);
  });

  it("detects www URLs", () => {
    expect(checkForUrls("visit www.example.com")).toBe(true);
  });

  it("returns false for plain text without URLs", () => {
    expect(checkForUrls("just some plain text")).toBe(false);
  });

  it("detects URL in middle of text", () => {
    expect(checkForUrls("click https://test.io/path here")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isNewAccount
// ---------------------------------------------------------------------------

describe("isNewAccount", () => {
  const mockDb = createMockDb();

  beforeEach(() => {
    mockDb.select.mockReset();
  });

  it("returns true when no trust record exists", async () => {
    // First query: account_trust -- empty result
    const trustChain = createChainableProxy([]);
    mockDb.select.mockReturnValueOnce(trustChain);

    const result = await isNewAccount(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      7,
    );
    expect(result).toBe(true);
  });

  it("returns false when newAccountDays is 0 (disabled)", async () => {
    const result = await isNewAccount(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      0,
    );
    expect(result).toBe(false);
  });

  it("returns true when account has approved posts but is recent", async () => {
    // account_trust query -- has posts
    const trustChain = createChainableProxy([{ approvedPostCount: 5 }]);
    mockDb.select.mockReturnValueOnce(trustChain);

    // users.firstSeenAt -- recent (1 day ago)
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const userChain = createChainableProxy([{ firstSeenAt: oneDayAgo }]);
    mockDb.select.mockReturnValueOnce(userChain);

    const result = await isNewAccount(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      7,
    );
    expect(result).toBe(true);
  });

  it("returns false when account is old enough", async () => {
    // account_trust query
    const trustChain = createChainableProxy([{ approvedPostCount: 5 }]);
    mockDb.select.mockReturnValueOnce(trustChain);

    // users.firstSeenAt -- 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const userChain = createChainableProxy([{ firstSeenAt: tenDaysAgo }]);
    mockDb.select.mockReturnValueOnce(userChain);

    const result = await isNewAccount(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      7,
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAccountTrusted
// ---------------------------------------------------------------------------

describe("isAccountTrusted", () => {
  const mockDb = createMockDb();

  beforeEach(() => {
    mockDb.select.mockReset();
  });

  it("returns false when no trust record exists", async () => {
    const chain = createChainableProxy([]);
    mockDb.select.mockReturnValue(chain);

    const result = await isAccountTrusted(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      10,
    );
    expect(result).toBe(false);
  });

  it("returns true when isTrusted flag is set", async () => {
    const chain = createChainableProxy([{ isTrusted: true }]);
    mockDb.select.mockReturnValue(chain);

    const result = await isAccountTrusted(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      10,
    );
    expect(result).toBe(true);
  });

  it("returns false when isTrusted flag is false", async () => {
    const chain = createChainableProxy([{ isTrusted: false }]);
    mockDb.select.mockReturnValue(chain);

    const result = await isAccountTrusted(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      10,
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// needsFirstPostModeration
// ---------------------------------------------------------------------------

describe("needsFirstPostModeration", () => {
  const mockDb = createMockDb();

  beforeEach(() => {
    mockDb.select.mockReset();
  });

  it("returns false when disabled (count = 0)", async () => {
    const result = await needsFirstPostModeration(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      0,
    );
    expect(result).toBe(false);
  });

  it("returns true when no trust record exists", async () => {
    const chain = createChainableProxy([]);
    mockDb.select.mockReturnValue(chain);

    const result = await needsFirstPostModeration(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      3,
    );
    expect(result).toBe(true);
  });

  it("returns true when approved count is below threshold", async () => {
    const chain = createChainableProxy([{ approvedPostCount: 2 }]);
    mockDb.select.mockReturnValue(chain);

    const result = await needsFirstPostModeration(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      3,
    );
    expect(result).toBe(true);
  });

  it("returns false when approved count meets threshold", async () => {
    const chain = createChainableProxy([{ approvedPostCount: 3 }]);
    mockDb.select.mockReturnValue(chain);

    const result = await needsFirstPostModeration(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      3,
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canCreateTopic
// ---------------------------------------------------------------------------

describe("canCreateTopic", () => {
  const mockDb = createMockDb();

  beforeEach(() => {
    mockDb.select.mockReset();
  });

  it("returns true when feature is disabled", async () => {
    const result = await canCreateTopic(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      false,
    );
    expect(result).toBe(true);
  });

  it("returns false when no trust record and feature is enabled", async () => {
    const chain = createChainableProxy([]);
    mockDb.select.mockReturnValue(chain);

    const result = await canCreateTopic(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      true,
    );
    expect(result).toBe(false);
  });

  it("returns false when approved post count is 0", async () => {
    const chain = createChainableProxy([{ approvedPostCount: 0 }]);
    mockDb.select.mockReturnValue(chain);

    const result = await canCreateTopic(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      true,
    );
    expect(result).toBe(false);
  });

  it("returns true when approved post count > 0", async () => {
    const chain = createChainableProxy([{ approvedPostCount: 1 }]);
    mockDb.select.mockReturnValue(chain);

    const result = await canCreateTopic(
      mockDb as never,
      "did:plc:user1",
      "did:plc:community1",
      true,
    );
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkWriteRateLimit
// ---------------------------------------------------------------------------

describe("checkWriteRateLimit", () => {
  it("returns false when under the limit", async () => {
    const cache = createMockCache();
    cache.zcard.mockResolvedValue(2);

    const result = await checkWriteRateLimit(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      true, // new account
      {
        newAccountWriteRatePerMin: 3,
        establishedWriteRatePerMin: 10,
      } as never,
    );
    expect(result).toBe(false);
  });

  it("returns true when at the limit", async () => {
    const cache = createMockCache();
    cache.zcard.mockResolvedValue(3);

    const result = await checkWriteRateLimit(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      true,
      {
        newAccountWriteRatePerMin: 3,
        establishedWriteRatePerMin: 10,
      } as never,
    );
    expect(result).toBe(true);
  });

  it("uses established rate for non-new accounts", async () => {
    const cache = createMockCache();
    cache.zcard.mockResolvedValue(5);

    const result = await checkWriteRateLimit(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      false,
      {
        newAccountWriteRatePerMin: 3,
        establishedWriteRatePerMin: 10,
      } as never,
    );
    expect(result).toBe(false);
  });

  it("fails open when cache errors", async () => {
    const cache = createMockCache();
    cache.zremrangebyscore.mockRejectedValue(new Error("connection lost"));

    const result = await checkWriteRateLimit(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      true,
      {
        newAccountWriteRatePerMin: 3,
        establishedWriteRatePerMin: 10,
      } as never,
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkBurstDetection
// ---------------------------------------------------------------------------

describe("checkBurstDetection", () => {
  it("returns false when under threshold", async () => {
    const cache = createMockCache();
    cache.zcard.mockResolvedValue(3);

    const result = await checkBurstDetection(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      { burstPostCount: 5, burstWindowMinutes: 10 } as never,
    );
    expect(result).toBe(false);
  });

  it("returns true when at threshold", async () => {
    const cache = createMockCache();
    cache.zcard.mockResolvedValue(5);

    const result = await checkBurstDetection(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      { burstPostCount: 5, burstWindowMinutes: 10 } as never,
    );
    expect(result).toBe(true);
  });

  it("fails open when cache errors", async () => {
    const cache = createMockCache();
    cache.zremrangebyscore.mockRejectedValue(new Error("connection lost"));

    const result = await checkBurstDetection(
      cache as never,
      "did:plc:user1",
      "did:plc:community1",
      { burstPostCount: 5, burstWindowMinutes: 10 } as never,
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadAntiSpamSettings
// ---------------------------------------------------------------------------

describe("loadAntiSpamSettings", () => {
  const mockDb = createMockDb();

  beforeEach(() => {
    mockDb.select.mockReset();
  });

  it("returns defaults when no settings exist", async () => {
    const cache = createMockCache();
    const chain = createChainableProxy([]);
    mockDb.select.mockReturnValue(chain);

    const settings = await loadAntiSpamSettings(
      mockDb as never,
      cache as never,
      "did:plc:community1",
    );

    expect(settings.firstPostQueueCount).toBe(3);
    expect(settings.newAccountDays).toBe(7);
    expect(settings.linkHoldEnabled).toBe(true);
    expect(settings.burstPostCount).toBe(5);
  });

  it("returns cached settings when available", async () => {
    const cache = createMockCache();
    const cached = JSON.stringify({
      wordFilter: ["bad"],
      firstPostQueueCount: 5,
      newAccountDays: 14,
      newAccountWriteRatePerMin: 2,
      establishedWriteRatePerMin: 8,
      linkHoldEnabled: false,
      topicCreationDelayEnabled: false,
      burstPostCount: 10,
      burstWindowMinutes: 5,
      trustedPostThreshold: 20,
    });
    cache.get.mockResolvedValue(cached);

    const settings = await loadAntiSpamSettings(
      mockDb as never,
      cache as never,
      "did:plc:community1",
    );

    expect(settings.firstPostQueueCount).toBe(5);
    expect(settings.newAccountDays).toBe(14);
    expect(settings.wordFilter).toEqual(["bad"]);
    // Should not query DB
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runAntiSpamChecks (orchestrator)
// ---------------------------------------------------------------------------

describe("runAntiSpamChecks", () => {
  const mockDb = createMockDb();

  beforeEach(() => {
    mockDb.select.mockReset();
  });

  it("bypasses all checks for trusted accounts", async () => {
    const cache = createMockCache();

    // loadAntiSpamSettings - return defaults
    const settingsChain = createChainableProxy([
      {
        moderationThresholds: {
          autoBlockReportCount: 5,
          warnThreshold: 3,
          firstPostQueueCount: 3,
          newAccountDays: 7,
          newAccountWriteRatePerMin: 3,
          establishedWriteRatePerMin: 10,
          linkHoldEnabled: true,
          topicCreationDelayEnabled: true,
          burstPostCount: 5,
          burstWindowMinutes: 10,
          trustedPostThreshold: 10,
        },
        wordFilter: ["badword"],
      },
    ]);
    mockDb.select.mockReturnValueOnce(settingsChain);

    // isAccountTrusted - return true
    const trustChain = createChainableProxy([{ isTrusted: true }]);
    mockDb.select.mockReturnValueOnce(trustChain);

    const result = await runAntiSpamChecks(mockDb as never, cache as never, {
      authorDid: "did:plc:trusted",
      communityDid: "did:plc:community1",
      contentType: "topic",
      title: "Contains badword",
      content: "This has badword in it",
    });

    expect(result.held).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("bypasses all checks for moderators", async () => {
    const cache = createMockCache();

    // loadAntiSpamSettings
    const settingsChain = createChainableProxy([
      {
        moderationThresholds: {
          autoBlockReportCount: 5,
          warnThreshold: 3,
          firstPostQueueCount: 3,
          newAccountDays: 7,
          newAccountWriteRatePerMin: 3,
          establishedWriteRatePerMin: 10,
          linkHoldEnabled: true,
          topicCreationDelayEnabled: true,
          burstPostCount: 5,
          burstWindowMinutes: 10,
          trustedPostThreshold: 10,
        },
        wordFilter: ["badword"],
      },
    ]);
    mockDb.select.mockReturnValueOnce(settingsChain);

    // isAccountTrusted - not trusted
    const trustChain = createChainableProxy([]);
    mockDb.select.mockReturnValueOnce(trustChain);

    // user role check - moderator
    const userChain = createChainableProxy([{ role: "moderator" }]);
    mockDb.select.mockReturnValueOnce(userChain);

    const result = await runAntiSpamChecks(mockDb as never, cache as never, {
      authorDid: "did:plc:moderator",
      communityDid: "did:plc:community1",
      contentType: "topic",
      title: "Contains badword",
      content: "This has badword",
    });

    expect(result.held).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("flags content matching word filter", async () => {
    const cache = createMockCache();

    // loadAntiSpamSettings
    const settingsChain = createChainableProxy([
      {
        moderationThresholds: {
          autoBlockReportCount: 5,
          warnThreshold: 3,
          firstPostQueueCount: 0, // disabled
          newAccountDays: 7,
          newAccountWriteRatePerMin: 3,
          establishedWriteRatePerMin: 10,
          linkHoldEnabled: false, // disabled
          topicCreationDelayEnabled: false,
          burstPostCount: 50, // high threshold
          burstWindowMinutes: 10,
          trustedPostThreshold: 10,
        },
        wordFilter: ["spam", "scam"],
      },
    ]);
    mockDb.select.mockReturnValueOnce(settingsChain);

    // isAccountTrusted - false
    const trustChain = createChainableProxy([]);
    mockDb.select.mockReturnValueOnce(trustChain);

    // user role check - regular user
    const userChain = createChainableProxy([{ role: "user" }]);
    mockDb.select.mockReturnValueOnce(userChain);

    // isNewAccount - account_trust empty
    const newTrustChain = createChainableProxy([]);
    mockDb.select.mockReturnValueOnce(newTrustChain);

    const result = await runAntiSpamChecks(mockDb as never, cache as never, {
      authorDid: "did:plc:newuser",
      communityDid: "did:plc:community1",
      contentType: "reply",
      content: "This is spam content",
    });

    expect(result.held).toBe(true);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "word_filter",
          matchedWords: expect.arrayContaining(["spam"]) as string[],
        }),
      ]),
    );
  });
});

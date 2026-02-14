import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCrossPostService } from "../../../src/services/cross-post.js";
import type { PdsClient, PdsWriteResult } from "../../../src/lib/pds-client.js";
import { createMockDb, createChainableProxy } from "../../helpers/mock-db.js";
import type { DbChain } from "../../helpers/mock-db.js";

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: "info",
  silent: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock PDS client
// ---------------------------------------------------------------------------

function createMockPdsClient(): PdsClient & {
  createRecord: ReturnType<typeof vi.fn>;
  updateRecord: ReturnType<typeof vi.fn>;
  deleteRecord: ReturnType<typeof vi.fn>;
} {
  return {
    createRecord: vi.fn<(did: string, collection: string, record: Record<string, unknown>) => Promise<PdsWriteResult>>(),
    updateRecord: vi.fn<(did: string, collection: string, rkey: string, record: Record<string, unknown>) => Promise<PdsWriteResult>>(),
    deleteRecord: vi.fn<(did: string, collection: string, rkey: string) => Promise<void>>(),
  };
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:testuser123";
const TEST_TOPIC_URI = `at://${TEST_DID}/forum.barazo.topic.post/abc123`;
const TEST_BLUESKY_URI = `at://${TEST_DID}/app.bsky.feed.post/bsky001`;
const TEST_BLUESKY_CID = "bafyreibsky001";
const TEST_FRONTPAGE_URI = `at://${TEST_DID}/fyi.frontpage.post/fp001`;
const TEST_FRONTPAGE_CID = "bafyreifp001";
const TEST_PUBLIC_URL = "https://forum.example.com";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-post service", () => {
  let mockPds: ReturnType<typeof createMockPdsClient>;
  let mockDb: ReturnType<typeof createMockDb>;
  let insertChain: DbChain;
  let selectChain: DbChain;
  let deleteChain: DbChain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPds = createMockPdsClient();
    mockDb = createMockDb();
    insertChain = createChainableProxy();
    selectChain = createChainableProxy([]);
    deleteChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);
    mockDb.select.mockReturnValue(selectChain);
    mockDb.delete.mockReturnValue(deleteChain);
  });

  // =========================================================================
  // crossPostTopic
  // =========================================================================

  describe("crossPostTopic", () => {
    it("cross-posts to Bluesky when enabled", async () => {
      mockPds.createRecord.mockResolvedValue({
        uri: TEST_BLUESKY_URI,
        cid: TEST_BLUESKY_CID,
      });

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: false,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "My Topic",
        content: "Topic content here.",
        category: "general",
      });

      expect(mockPds.createRecord).toHaveBeenCalledOnce();
      const [did, collection, record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(did).toBe(TEST_DID);
      expect(collection).toBe("app.bsky.feed.post");
      expect(record.$type).toBe("app.bsky.feed.post");
      expect(record.text).toContain("My Topic");
      expect((record.embed as Record<string, unknown>).$type).toBe(
        "app.bsky.embed.external",
      );

      // Should insert cross-post record into DB
      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          topicUri: TEST_TOPIC_URI,
          crossPostUri: TEST_BLUESKY_URI,
        }) as Record<string, unknown>,
        "Cross-posted topic to Bluesky",
      );
    });

    it("cross-posts to Frontpage when enabled", async () => {
      mockPds.createRecord.mockResolvedValue({
        uri: TEST_FRONTPAGE_URI,
        cid: TEST_FRONTPAGE_CID,
      });

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: false,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Frontpage Topic",
        content: "Content for Frontpage.",
        category: "general",
      });

      expect(mockPds.createRecord).toHaveBeenCalledOnce();
      const [did, collection, record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(did).toBe(TEST_DID);
      expect(collection).toBe("fyi.frontpage.post");
      expect(record.title).toBe("Frontpage Topic");
      expect(record.url).toBe(`${TEST_PUBLIC_URL}/topics/abc123`);

      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("cross-posts to both Bluesky and Frontpage concurrently when both enabled", async () => {
      mockPds.createRecord
        .mockResolvedValueOnce({
          uri: TEST_BLUESKY_URI,
          cid: TEST_BLUESKY_CID,
        })
        .mockResolvedValueOnce({
          uri: TEST_FRONTPAGE_URI,
          cid: TEST_FRONTPAGE_CID,
        });

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Dual Post",
        content: "Content for both.",
        category: "general",
      });

      // Both services called
      expect(mockPds.createRecord).toHaveBeenCalledTimes(2);
      // Both DB inserts
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
      // Both logged
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it("does nothing when both services are disabled", async () => {
      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: false,
          frontpageEnabled: false,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "No Cross-Post",
        content: "Should not go anywhere.",
        category: "general",
      });

      expect(mockPds.createRecord).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("logs error but does not throw when Bluesky fails", async () => {
      mockPds.createRecord.mockRejectedValue(
        new Error("Bluesky PDS unreachable"),
      );

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: false,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      // Should NOT throw
      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Will Fail",
        content: "Bluesky is down.",
        category: "general",
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          topicUri: TEST_TOPIC_URI,
          service: "bluesky",
        }) as Record<string, unknown>,
        "Failed to cross-post to Bluesky",
      );
      // DB insert should NOT be called since PDS failed
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("continues Frontpage when Bluesky fails", async () => {
      mockPds.createRecord
        .mockRejectedValueOnce(new Error("Bluesky PDS error"))
        .mockResolvedValueOnce({
          uri: TEST_FRONTPAGE_URI,
          cid: TEST_FRONTPAGE_CID,
        });

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Partial Success",
        content: "One succeeds, one fails.",
        category: "general",
      });

      // Bluesky error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ service: "bluesky" }) as Record<string, unknown>,
        "Failed to cross-post to Bluesky",
      );

      // Frontpage success logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          crossPostUri: TEST_FRONTPAGE_URI,
        }) as Record<string, unknown>,
        "Cross-posted topic to Frontpage",
      );

      // Only the Frontpage cross-post stored in DB
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it("builds correct Bluesky post text with title and truncated content", async () => {
      mockPds.createRecord.mockResolvedValue({
        uri: TEST_BLUESKY_URI,
        cid: TEST_BLUESKY_CID,
      });

      const longContent = "A".repeat(500);

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: false,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Short Title",
        content: longContent,
        category: "general",
      });

      const [, , record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      const postText = record.text as string;
      // Post text should not exceed 300 chars
      expect(postText.length).toBeLessThanOrEqual(300);
      expect(postText).toContain("Short Title");
    });

    it("builds correct topic URL from AT URI", async () => {
      mockPds.createRecord.mockResolvedValue({
        uri: TEST_BLUESKY_URI,
        cid: TEST_BLUESKY_CID,
      });

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: false,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "URL Test",
        content: "Content.",
        category: "general",
      });

      const [, , record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      const embed = record.embed as Record<string, unknown>;
      const external = embed.external as Record<string, unknown>;
      expect(external.uri).toBe(`${TEST_PUBLIC_URL}/topics/abc123`);
    });
  });

  // =========================================================================
  // deleteCrossPosts
  // =========================================================================

  describe("deleteCrossPosts", () => {
    it("deletes all cross-posts for a topic from PDS and DB", async () => {
      selectChain.where.mockResolvedValueOnce([
        {
          id: "cp-1",
          topicUri: TEST_TOPIC_URI,
          service: "bluesky",
          crossPostUri: TEST_BLUESKY_URI,
          crossPostCid: TEST_BLUESKY_CID,
          authorDid: TEST_DID,
          createdAt: new Date(),
        },
        {
          id: "cp-2",
          topicUri: TEST_TOPIC_URI,
          service: "frontpage",
          crossPostUri: TEST_FRONTPAGE_URI,
          crossPostCid: TEST_FRONTPAGE_CID,
          authorDid: TEST_DID,
          createdAt: new Date(),
        },
      ]);

      mockPds.deleteRecord.mockResolvedValue(undefined);

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.deleteCrossPosts(TEST_TOPIC_URI, TEST_DID);

      // Should delete both records from PDS
      expect(mockPds.deleteRecord).toHaveBeenCalledTimes(2);
      expect(mockPds.deleteRecord).toHaveBeenCalledWith(
        TEST_DID,
        "app.bsky.feed.post",
        "bsky001",
      );
      expect(mockPds.deleteRecord).toHaveBeenCalledWith(
        TEST_DID,
        "fyi.frontpage.post",
        "fp001",
      );

      // Should delete DB rows
      expect(mockDb.delete).toHaveBeenCalledOnce();
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it("cleans up DB rows even when PDS delete fails", async () => {
      selectChain.where.mockResolvedValueOnce([
        {
          id: "cp-1",
          topicUri: TEST_TOPIC_URI,
          service: "bluesky",
          crossPostUri: TEST_BLUESKY_URI,
          crossPostCid: TEST_BLUESKY_CID,
          authorDid: TEST_DID,
          createdAt: new Date(),
        },
      ]);

      mockPds.deleteRecord.mockRejectedValue(
        new Error("PDS delete failed"),
      );

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: false,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      // Should NOT throw
      await service.deleteCrossPosts(TEST_TOPIC_URI, TEST_DID);

      // Warning logged for PDS failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          crossPostUri: TEST_BLUESKY_URI,
          service: "bluesky",
        }) as Record<string, unknown>,
        "Failed to delete cross-post from PDS (best-effort)",
      );

      // DB rows still deleted
      expect(mockDb.delete).toHaveBeenCalledOnce();
    });

    it("does nothing when no cross-posts exist for the topic", async () => {
      selectChain.where.mockResolvedValueOnce([]);

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
        },
      );

      await service.deleteCrossPosts(TEST_TOPIC_URI, TEST_DID);

      expect(mockPds.deleteRecord).not.toHaveBeenCalled();
      // DB delete still called (no-op if no rows match)
      expect(mockDb.delete).toHaveBeenCalledOnce();
    });
  });
});

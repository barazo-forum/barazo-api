import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCrossPostService } from "../../../src/services/cross-post.js";
import type { PdsClient, PdsWriteResult } from "../../../src/lib/pds-client.js";
import type { NotificationService } from "../../../src/services/notification.js";
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
  uploadBlob: ReturnType<typeof vi.fn>;
} {
  return {
    createRecord: vi.fn<(did: string, collection: string, record: Record<string, unknown>) => Promise<PdsWriteResult>>(),
    updateRecord: vi.fn<(did: string, collection: string, rkey: string, record: Record<string, unknown>) => Promise<PdsWriteResult>>(),
    deleteRecord: vi.fn<(did: string, collection: string, rkey: string) => Promise<void>>(),
    uploadBlob: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mock notification service
// ---------------------------------------------------------------------------

function createMockNotificationService(): NotificationService & {
  notifyOnReply: ReturnType<typeof vi.fn>;
  notifyOnReaction: ReturnType<typeof vi.fn>;
  notifyOnModAction: ReturnType<typeof vi.fn>;
  notifyOnMentions: ReturnType<typeof vi.fn>;
  notifyOnCrossPostFailure: ReturnType<typeof vi.fn>;
} {
  return {
    notifyOnReply: vi.fn().mockResolvedValue(undefined),
    notifyOnReaction: vi.fn().mockResolvedValue(undefined),
    notifyOnModAction: vi.fn().mockResolvedValue(undefined),
    notifyOnMentions: vi.fn().mockResolvedValue(undefined),
    notifyOnCrossPostFailure: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Mock OG image generation (avoid actual sharp calls in unit tests)
// ---------------------------------------------------------------------------

vi.mock("../../../src/services/og-image.js", () => ({
  generateOgImage: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
}));

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = "did:plc:testuser123";
const TEST_COMMUNITY_DID = "did:plc:community123";
const TEST_TOPIC_URI = `at://${TEST_DID}/forum.barazo.topic.post/abc123`;
const TEST_BLUESKY_URI = `at://${TEST_DID}/app.bsky.feed.post/bsky001`;
const TEST_BLUESKY_CID = "bafyreibsky001";
const TEST_FRONTPAGE_URI = `at://${TEST_DID}/fyi.frontpage.post/fp001`;
const TEST_FRONTPAGE_CID = "bafyreifp001";
const TEST_PUBLIC_URL = "https://forum.example.com";
const TEST_COMMUNITY_NAME = "Test Community";
const TEST_BLOB_REF = { $type: "blob", ref: { $link: "bafyblob123" }, mimeType: "image/png", size: 1234 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-post service", () => {
  let mockPds: ReturnType<typeof createMockPdsClient>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockNotifications: ReturnType<typeof createMockNotificationService>;
  let insertChain: DbChain;
  let selectChain: DbChain;
  let deleteChain: DbChain;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPds = createMockPdsClient();
    mockDb = createMockDb();
    mockNotifications = createMockNotificationService();
    insertChain = createChainableProxy();
    selectChain = createChainableProxy([]);
    deleteChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);
    mockDb.select.mockReturnValue(selectChain);
    mockDb.delete.mockReturnValue(deleteChain);

    // Default: blob upload succeeds
    mockPds.uploadBlob.mockResolvedValue(TEST_BLOB_REF);
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "My Topic",
        content: "Topic content here.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
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

    it("includes OG image as thumb in Bluesky embed", async () => {
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "OG Image Topic",
        content: "Testing OG image.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Should upload blob first
      expect(mockPds.uploadBlob).toHaveBeenCalledOnce();
      expect(mockPds.uploadBlob).toHaveBeenCalledWith(
        TEST_DID,
        expect.any(Buffer) as Buffer,
        "image/png",
      );

      // Embed should include thumb with the blob reference
      const [, , record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      const embed = record.embed as Record<string, unknown>;
      const external = embed.external as Record<string, unknown>;
      expect(external.thumb).toBe(TEST_BLOB_REF);
    });

    it("still cross-posts without thumb when OG image generation fails", async () => {
      // Mock OG image failure
      const { generateOgImage } = await import("../../../src/services/og-image.js");
      vi.mocked(generateOgImage).mockRejectedValueOnce(new Error("Image generation failed"));

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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "No Thumb Topic",
        content: "OG image will fail.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Should still create the post (without thumb)
      expect(mockPds.createRecord).toHaveBeenCalledOnce();
      const [, , record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      const embed = record.embed as Record<string, unknown>;
      const external = embed.external as Record<string, unknown>;
      expect(external.thumb).toBeUndefined();

      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          topicUri: TEST_TOPIC_URI,
        }) as Record<string, unknown>,
        expect.stringContaining("OG image") as string,
      );
    });

    it("still cross-posts without thumb when blob upload fails", async () => {
      mockPds.uploadBlob.mockRejectedValueOnce(new Error("Upload failed"));
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Upload Fail Topic",
        content: "Blob upload will fail.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Should still create the post
      expect(mockPds.createRecord).toHaveBeenCalledOnce();
      // Thumb should not be set
      const [, , record] = mockPds.createRecord.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      const embed = record.embed as Record<string, unknown>;
      const external = embed.external as Record<string, unknown>;
      expect(external.thumb).toBeUndefined();
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Frontpage Topic",
        content: "Content for Frontpage.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Dual Post",
        content: "Content for both.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "No Cross-Post",
        content: "Should not go anywhere.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      expect(mockPds.createRecord).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("notifies user when Bluesky cross-post fails", async () => {
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Will Fail",
        content: "Bluesky is down.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Error still logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          topicUri: TEST_TOPIC_URI,
          service: "bluesky",
        }) as Record<string, unknown>,
        "Failed to cross-post to Bluesky",
      );

      // User should be notified
      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledWith({
        topicUri: TEST_TOPIC_URI,
        authorDid: TEST_DID,
        service: "bluesky",
        communityDid: TEST_COMMUNITY_DID,
      });

      // DB insert should NOT be called since PDS failed
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("notifies user when Frontpage cross-post fails", async () => {
      mockPds.createRecord.mockRejectedValue(
        new Error("Frontpage PDS error"),
      );

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: false,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "FP Fail",
        content: "Frontpage is down.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledWith({
        topicUri: TEST_TOPIC_URI,
        authorDid: TEST_DID,
        service: "frontpage",
        communityDid: TEST_COMMUNITY_DID,
      });
    });

    it("notifies for each failed service independently", async () => {
      mockPds.createRecord.mockRejectedValue(
        new Error("PDS error"),
      );

      const service = createCrossPostService(
        mockPds,
        mockDb as never,
        mockLogger as never,
        {
          blueskyEnabled: true,
          frontpageEnabled: true,
          publicUrl: TEST_PUBLIC_URL,
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Both Fail",
        content: "Everything is broken.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Two failure notifications (one per service)
      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledTimes(2);
      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledWith(
        expect.objectContaining({ service: "bluesky" }) as Record<string, unknown>,
      );
      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledWith(
        expect.objectContaining({ service: "frontpage" }) as Record<string, unknown>,
      );
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Partial Success",
        content: "One succeeds, one fails.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Bluesky error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ service: "bluesky" }) as Record<string, unknown>,
        "Failed to cross-post to Bluesky",
      );

      // Bluesky failure notification sent
      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledOnce();
      expect(mockNotifications.notifyOnCrossPostFailure).toHaveBeenCalledWith(
        expect.objectContaining({ service: "bluesky" }) as Record<string, unknown>,
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "Short Title",
        content: longContent,
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "URL Test",
        content: "Content.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
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

    it("does not generate OG image for Frontpage-only cross-posts", async () => {
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.crossPostTopic({
        did: TEST_DID,
        topicUri: TEST_TOPIC_URI,
        title: "FP Only",
        content: "No OG needed.",
        category: "general",
        communityDid: TEST_COMMUNITY_DID,
      });

      // Should NOT upload a blob (Frontpage doesn't use thumbnails)
      expect(mockPds.uploadBlob).not.toHaveBeenCalled();
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
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
          communityName: TEST_COMMUNITY_NAME,
        },
        mockNotifications,
      );

      await service.deleteCrossPosts(TEST_TOPIC_URI, TEST_DID);

      expect(mockPds.deleteRecord).not.toHaveBeenCalled();
      // DB delete still called (no-op if no rows match)
      expect(mockDb.delete).toHaveBeenCalledOnce();
    });
  });
});

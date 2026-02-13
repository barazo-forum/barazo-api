import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecordHandler } from "../../../../src/firehose/handlers/record.js";
import type { RecordEvent } from "../../../../src/firehose/types.js";

function createMockIndexer() {
  return {
    handleCreate: vi.fn().mockResolvedValue(undefined),
    handleUpdate: vi.fn().mockResolvedValue(undefined),
    handleDelete: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RecordHandler", () => {
  let topicIndexer: ReturnType<typeof createMockIndexer>;
  let replyIndexer: ReturnType<typeof createMockIndexer>;
  let reactionIndexer: ReturnType<typeof createMockIndexer>;
  let db: ReturnType<typeof createMockDb>;
  let logger: ReturnType<typeof createMockLogger>;
  let handler: RecordHandler;

  beforeEach(() => {
    topicIndexer = createMockIndexer();
    replyIndexer = createMockIndexer();
    reactionIndexer = createMockIndexer();
    db = createMockDb();
    logger = createMockLogger();
    handler = new RecordHandler(
      {
        topic: topicIndexer,
        reply: replyIndexer,
        reaction: reactionIndexer,
      } as never,
      db as never,
      logger as never,
    );
  });

  describe("dispatch routing", () => {
    it("dispatches topic create to topic indexer", async () => {
      const event: RecordEvent = {
        id: 1,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        record: {
          title: "Test",
          content: "Content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafyabc",
        live: true,
      };

      await handler.handle(event);

      expect(topicIndexer.handleCreate).toHaveBeenCalledTimes(1);
      expect(replyIndexer.handleCreate).not.toHaveBeenCalled();
    });

    it("dispatches reply create to reply indexer", async () => {
      const event: RecordEvent = {
        id: 2,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "forum.barazo.topic.reply",
        rkey: "reply1",
        record: {
          content: "Reply",
          root: { uri: "at://did:plc:test/forum.barazo.topic.post/t1", cid: "bafyt" },
          parent: { uri: "at://did:plc:test/forum.barazo.topic.post/t1", cid: "bafyt" },
          community: "did:plc:community",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafyreply",
        live: true,
      };

      await handler.handle(event);

      expect(replyIndexer.handleCreate).toHaveBeenCalledTimes(1);
    });

    it("dispatches reaction create to reaction indexer", async () => {
      const event: RecordEvent = {
        id: 3,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "forum.barazo.interaction.reaction",
        rkey: "react1",
        record: {
          subject: { uri: "at://did:plc:test/forum.barazo.topic.post/t1", cid: "bafyt" },
          type: "like",
          community: "did:plc:community",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafyreact",
        live: true,
      };

      await handler.handle(event);

      expect(reactionIndexer.handleCreate).toHaveBeenCalledTimes(1);
    });

    it("dispatches update to the correct indexer", async () => {
      const event: RecordEvent = {
        id: 4,
        action: "update",
        did: "did:plc:test",
        rev: "rev2",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        record: {
          title: "Updated",
          content: "Updated content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafynew",
        live: true,
      };

      await handler.handle(event);

      expect(topicIndexer.handleUpdate).toHaveBeenCalledTimes(1);
    });

    it("dispatches delete to the correct indexer", async () => {
      const event: RecordEvent = {
        id: 5,
        action: "delete",
        did: "did:plc:test",
        rev: "rev3",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        live: true,
      };

      await handler.handle(event);

      expect(topicIndexer.handleDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation rejection", () => {
    it("skips events for unsupported collections", async () => {
      const event: RecordEvent = {
        id: 6,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "com.example.unknown",
        rkey: "abc123",
        record: { foo: "bar" },
        cid: "bafyabc",
        live: true,
      };

      await handler.handle(event);

      expect(topicIndexer.handleCreate).not.toHaveBeenCalled();
      expect(replyIndexer.handleCreate).not.toHaveBeenCalled();
      expect(reactionIndexer.handleCreate).not.toHaveBeenCalled();
    });

    it("skips create events with invalid records", async () => {
      const event: RecordEvent = {
        id: 7,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        record: { invalid: "data" },
        cid: "bafyabc",
        live: true,
      };

      await handler.handle(event);

      expect(topicIndexer.handleCreate).not.toHaveBeenCalled();
    });
  });

  describe("error catching", () => {
    it("catches and logs indexer errors without throwing", async () => {
      topicIndexer.handleCreate.mockRejectedValue(new Error("DB error"));

      const event: RecordEvent = {
        id: 8,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        record: {
          title: "Test",
          content: "Content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafyabc",
        live: true,
      };

      // Should NOT throw
      await expect(handler.handle(event)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("user upsert", () => {
    it("upserts a user stub on create events", async () => {
      const event: RecordEvent = {
        id: 9,
        action: "create",
        did: "did:plc:newuser",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        record: {
          title: "Test",
          content: "Content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafyabc",
        live: true,
      };

      await handler.handle(event);

      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("live flag", () => {
    it("passes live flag through to indexer", async () => {
      const event: RecordEvent = {
        id: 10,
        action: "create",
        did: "did:plc:test",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "abc123",
        record: {
          title: "Test",
          content: "Content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        cid: "bafyabc",
        live: false,
      };

      await handler.handle(event);

      const call = topicIndexer.handleCreate.mock.calls[0] as [{ live: boolean }];
      expect(call[0].live).toBe(false);
    });
  });
});

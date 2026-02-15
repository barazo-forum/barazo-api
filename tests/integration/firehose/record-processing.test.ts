import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../../src/db/index.js";
import type { Database } from "../../../src/db/index.js";
import { topics } from "../../../src/db/schema/topics.js";
import { replies } from "../../../src/db/schema/replies.js";
import { reactions } from "../../../src/db/schema/reactions.js";
import { users } from "../../../src/db/schema/users.js";
import { TopicIndexer } from "../../../src/firehose/indexers/topic.js";
import { ReplyIndexer } from "../../../src/firehose/indexers/reply.js";
import { ReactionIndexer } from "../../../src/firehose/indexers/reaction.js";
import { RecordHandler } from "../../../src/firehose/handlers/record.js";
import type { RecordEvent } from "../../../src/firehose/types.js";
import type { AccountAgeService } from "../../../src/services/account-age.js";
import type postgres from "postgres";

/** Stub that skips PLC resolution and always returns 'trusted'. */
function createStubAccountAgeService(): AccountAgeService {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    resolveCreationDate: async () => null,
    determineTrustStatus: () => "trusted",
  };
}

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://barazo:barazo_dev@localhost:5432/barazo";

function createLogger() {
  return {
    info: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
  };
}

/** Asserts a single-row query result and returns the row. */
function one<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

describe("firehose record processing (integration)", () => {
  let db: Database;
  let client: postgres.Sql;
  let handler: RecordHandler;

  beforeAll(() => {
    const conn = createDb(DATABASE_URL);
    db = conn.db;
    client = conn.client;

    const logger = createLogger();
    const topicIndexer = new TopicIndexer(db, logger as never);
    const replyIndexer = new ReplyIndexer(db, logger as never);
    const reactionIndexer = new ReactionIndexer(db, logger as never);

    handler = new RecordHandler(
      { topic: topicIndexer, reply: replyIndexer, reaction: reactionIndexer },
      db,
      logger as never,
      createStubAccountAgeService(),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    // Clean tables in correct FK-safe order
    await db.delete(reactions);
    await db.delete(replies);
    await db.delete(topics);
    await db.delete(users);
  });

  describe("topic lifecycle", () => {
    const topicEvent: RecordEvent = {
      id: 1,
      action: "create",
      did: "did:plc:integ-user1",
      rev: "rev1",
      collection: "forum.barazo.topic.post",
      rkey: "topic1",
      record: {
        title: "Integration Test Topic",
        content: "This is a test topic for integration testing.",
        community: "did:plc:community",
        category: "general",
        createdAt: "2026-01-15T10:00:00.000Z",
      },
      cid: "bafytopic1",
      live: true,
    };

    it("creates a topic and upserts user stub", async () => {
      await handler.handle(topicEvent);

      const topic = one(
        await db
          .select()
          .from(topics)
          .where(
            eq(
              topics.uri,
              "at://did:plc:integ-user1/forum.barazo.topic.post/topic1",
            ),
          ),
      );

      expect(topic.title).toBe("Integration Test Topic");
      expect(topic.authorDid).toBe("did:plc:integ-user1");
      expect(topic.category).toBe("general");
      expect(topic.communityDid).toBe("did:plc:community");
      expect(topic.replyCount).toBe(0);
      expect(topic.reactionCount).toBe(0);

      // Verify user stub was created
      const user = one(
        await db
          .select()
          .from(users)
          .where(eq(users.did, "did:plc:integ-user1")),
      );

      expect(user.handle).toBe("did:plc:integ-user1"); // Stub uses DID as handle
    });

    it("updates a topic", async () => {
      await handler.handle(topicEvent);

      const updateEvent: RecordEvent = {
        id: 2,
        action: "update",
        did: "did:plc:integ-user1",
        rev: "rev2",
        collection: "forum.barazo.topic.post",
        rkey: "topic1",
        record: {
          title: "Updated Topic Title",
          content: "Updated content for the topic.",
          community: "did:plc:community",
          category: "discussion",
          createdAt: "2026-01-15T10:00:00.000Z",
        },
        cid: "bafytopic1v2",
        live: true,
      };

      await handler.handle(updateEvent);

      const topic = one(
        await db
          .select()
          .from(topics)
          .where(
            eq(
              topics.uri,
              "at://did:plc:integ-user1/forum.barazo.topic.post/topic1",
            ),
          ),
      );

      expect(topic.title).toBe("Updated Topic Title");
      expect(topic.content).toBe("Updated content for the topic.");
      expect(topic.category).toBe("discussion");
      expect(topic.cid).toBe("bafytopic1v2");
    });

    it("deletes a topic", async () => {
      await handler.handle(topicEvent);

      const deleteEvent: RecordEvent = {
        id: 3,
        action: "delete",
        did: "did:plc:integ-user1",
        rev: "rev3",
        collection: "forum.barazo.topic.post",
        rkey: "topic1",
        live: true,
      };

      await handler.handle(deleteEvent);

      const result = await db
        .select()
        .from(topics)
        .where(
          eq(
            topics.uri,
            "at://did:plc:integ-user1/forum.barazo.topic.post/topic1",
          ),
        );

      expect(result).toHaveLength(0);
    });
  });

  describe("reply with count updates", () => {
    const topicUri =
      "at://did:plc:integ-user1/forum.barazo.topic.post/topic1";

    beforeEach(async () => {
      // Create a topic first for replies to attach to
      await handler.handle({
        id: 10,
        action: "create",
        did: "did:plc:integ-user1",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "topic1",
        record: {
          title: "Parent Topic",
          content: "Topic for reply tests",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-15T10:00:00.000Z",
        },
        cid: "bafytopic1",
        live: true,
      });
    });

    it("creates a reply and increments reply count", async () => {
      await handler.handle({
        id: 11,
        action: "create",
        did: "did:plc:integ-user2",
        rev: "rev1",
        collection: "forum.barazo.topic.reply",
        rkey: "reply1",
        record: {
          content: "This is a reply",
          root: { uri: topicUri, cid: "bafytopic1" },
          parent: { uri: topicUri, cid: "bafytopic1" },
          community: "did:plc:community",
          createdAt: "2026-01-15T11:00:00.000Z",
        },
        cid: "bafyreply1",
        live: true,
      });

      // Verify reply exists
      const reply = one(
        await db
          .select()
          .from(replies)
          .where(
            eq(
              replies.uri,
              "at://did:plc:integ-user2/forum.barazo.topic.reply/reply1",
            ),
          ),
      );

      expect(reply.content).toBe("This is a reply");
      expect(reply.rootUri).toBe(topicUri);

      // Verify reply count incremented
      const topic = one(
        await db.select().from(topics).where(eq(topics.uri, topicUri)),
      );

      expect(topic.replyCount).toBe(1);
    });

    it("handles multiple replies and correct count", async () => {
      // Add two replies
      for (let i = 1; i <= 2; i++) {
        await handler.handle({
          id: 20 + i,
          action: "create",
          did: `did:plc:integ-user${String(i + 1)}`,
          rev: "rev1",
          collection: "forum.barazo.topic.reply",
          rkey: `reply${String(i)}`,
          record: {
            content: `Reply ${String(i)}`,
            root: { uri: topicUri, cid: "bafytopic1" },
            parent: { uri: topicUri, cid: "bafytopic1" },
            community: "did:plc:community",
            createdAt: `2026-01-15T1${String(i)}:00:00.000Z`,
          },
          cid: `bafyreply${String(i)}`,
          live: true,
        });
      }

      const topic = one(
        await db.select().from(topics).where(eq(topics.uri, topicUri)),
      );

      expect(topic.replyCount).toBe(2);
    });
  });

  describe("reaction with count updates", () => {
    const topicUri =
      "at://did:plc:integ-user1/forum.barazo.topic.post/topic1";

    beforeEach(async () => {
      await handler.handle({
        id: 30,
        action: "create",
        did: "did:plc:integ-user1",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "topic1",
        record: {
          title: "Reactable Topic",
          content: "Topic for reaction tests",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-15T10:00:00.000Z",
        },
        cid: "bafytopic1",
        live: true,
      });
    });

    it("creates a reaction and increments reaction count on topic", async () => {
      await handler.handle({
        id: 31,
        action: "create",
        did: "did:plc:integ-user2",
        rev: "rev1",
        collection: "forum.barazo.interaction.reaction",
        rkey: "react1",
        record: {
          subject: { uri: topicUri, cid: "bafytopic1" },
          type: "like",
          community: "did:plc:community",
          createdAt: "2026-01-15T12:00:00.000Z",
        },
        cid: "bafyreact1",
        live: true,
      });

      // Verify reaction exists
      const reaction = one(
        await db
          .select()
          .from(reactions)
          .where(
            eq(
              reactions.uri,
              "at://did:plc:integ-user2/forum.barazo.interaction.reaction/react1",
            ),
          ),
      );

      expect(reaction.type).toBe("like");
      expect(reaction.subjectUri).toBe(topicUri);

      // Verify reaction count incremented on topic
      const topic = one(
        await db.select().from(topics).where(eq(topics.uri, topicUri)),
      );

      expect(topic.reactionCount).toBe(1);
    });
  });

  describe("idempotent replay", () => {
    it("replaying a topic create is idempotent (upsert)", async () => {
      const event: RecordEvent = {
        id: 40,
        action: "create",
        did: "did:plc:integ-user1",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "idem-topic1",
        record: {
          title: "Idempotent Topic",
          content: "Original content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-15T10:00:00.000Z",
        },
        cid: "bafyidem1",
        live: false,
      };

      // Process same event twice
      await handler.handle(event);
      await handler.handle(event);

      const result = await db
        .select()
        .from(topics)
        .where(
          eq(
            topics.uri,
            "at://did:plc:integ-user1/forum.barazo.topic.post/idem-topic1",
          ),
        );

      // Should still be exactly one row
      expect(result).toHaveLength(1);
      const topic = one(result);
      expect(topic.title).toBe("Idempotent Topic");
    });

    it("replaying a reply create does not duplicate rows", async () => {
      const topicUri =
        "at://did:plc:integ-user1/forum.barazo.topic.post/idem-topic2";

      // Create topic
      await handler.handle({
        id: 50,
        action: "create",
        did: "did:plc:integ-user1",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "idem-topic2",
        record: {
          title: "Topic for replay test",
          content: "Content",
          community: "did:plc:community",
          category: "general",
          createdAt: "2026-01-15T10:00:00.000Z",
        },
        cid: "bafyidem2",
        live: false,
      });

      const replyEvent: RecordEvent = {
        id: 51,
        action: "create",
        did: "did:plc:integ-user2",
        rev: "rev1",
        collection: "forum.barazo.topic.reply",
        rkey: "idem-reply1",
        record: {
          content: "Replay test reply",
          root: { uri: topicUri, cid: "bafyidem2" },
          parent: { uri: topicUri, cid: "bafyidem2" },
          community: "did:plc:community",
          createdAt: "2026-01-15T11:00:00.000Z",
        },
        cid: "bafyidemreply1",
        live: false,
      };

      // Reply uses onConflictDoNothing, so second insert is a no-op for the row.
      // In practice, Tap handles replay deduplication.
      await handler.handle(replyEvent);
      await handler.handle(replyEvent);

      const replyRows = await db
        .select()
        .from(replies)
        .where(
          eq(
            replies.uri,
            "at://did:plc:integ-user2/forum.barazo.topic.reply/idem-reply1",
          ),
        );

      // Exactly one reply row (onConflictDoNothing)
      expect(replyRows).toHaveLength(1);
    });
  });

  describe("unsupported and invalid records", () => {
    it("skips unsupported collections", async () => {
      const event: RecordEvent = {
        id: 60,
        action: "create",
        did: "did:plc:integ-user1",
        rev: "rev1",
        collection: "app.bsky.feed.post",
        rkey: "post1",
        record: { text: "Hello world" },
        cid: "bafypost1",
        live: true,
      };

      // Should not throw
      await handler.handle(event);

      // No topic should be created
      const result = await db.select().from(topics);
      expect(result).toHaveLength(0);
    });

    it("skips invalid record data", async () => {
      const event: RecordEvent = {
        id: 61,
        action: "create",
        did: "did:plc:integ-user1",
        rev: "rev1",
        collection: "forum.barazo.topic.post",
        rkey: "bad1",
        record: { invalid: "data" },
        cid: "bafybad1",
        live: true,
      };

      await handler.handle(event);

      const result = await db.select().from(topics);
      expect(result).toHaveLength(0);
    });
  });
});

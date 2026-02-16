import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNotificationService, extractMentions } from "../../../src/services/notification.js";
import type { NotificationService } from "../../../src/services/notification.js";
import { createMockDb, createChainableProxy, resetDbMocks } from "../../helpers/mock-db.js";
import type { MockDb } from "../../helpers/mock-db.js";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ACTOR_DID = "did:plc:actor123";
const TOPIC_AUTHOR_DID = "did:plc:topicauthor456";
const REPLY_AUTHOR_DID = "did:plc:replyauthor789";
const MODERATOR_DID = "did:plc:mod999";
const COMMUNITY_DID = "did:plc:community123";

const TOPIC_URI = `at://${TOPIC_AUTHOR_DID}/forum.barazo.topic.post/topic1`;
const REPLY_URI = `at://${ACTOR_DID}/forum.barazo.topic.reply/reply1`;
const PARENT_REPLY_URI = `at://${REPLY_AUTHOR_DID}/forum.barazo.topic.reply/parentreply1`;

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
  child: vi.fn(() => mockLogger),
  level: "info",
  silent: vi.fn(),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockDb: MockDb;
let service: NotificationService;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = createMockDb();
  resetDbMocks(mockDb);
  service = createNotificationService(mockDb as never, mockLogger as never);
});

// ===========================================================================
// extractMentions
// ===========================================================================

describe("extractMentions", () => {
  it("extracts single AT Protocol handle", () => {
    const result = extractMentions("Hello @alice.bsky.social, welcome!");
    expect(result).toEqual(["alice.bsky.social"]);
  });

  it("extracts multiple handles", () => {
    const result = extractMentions("cc @alice.bsky.social @bob.example.com");
    expect(result).toEqual(["alice.bsky.social", "bob.example.com"]);
  });

  it("deduplicates handles (case-insensitive)", () => {
    const result = extractMentions("@Alice.Bsky.Social and @alice.bsky.social");
    expect(result).toEqual(["alice.bsky.social"]);
  });

  it("ignores bare @word without a dot", () => {
    const result = extractMentions("Hello @everyone, this is a test");
    expect(result).toEqual([]);
  });

  it("limits to 10 unique mentions", () => {
    const handles = Array.from({ length: 15 }, (_, i) => `@user${String(i)}.bsky.social`);
    const content = handles.join(" ");
    const result = extractMentions(content);
    expect(result).toHaveLength(10);
  });

  it("returns empty array for content without mentions", () => {
    const result = extractMentions("No mentions here at all.");
    expect(result).toEqual([]);
  });

  it("handles handles with hyphens", () => {
    const result = extractMentions("Hey @my-handle.bsky.social");
    expect(result).toEqual(["my-handle.bsky.social"]);
  });

  it("handles handles with subdomains", () => {
    const result = extractMentions("@user.example.co.uk mentioned");
    expect(result).toEqual(["user.example.co.uk"]);
  });
});

// ===========================================================================
// notifyOnReply
// ===========================================================================

describe("notifyOnReply", () => {
  it("notifies topic author when someone replies", async () => {
    // Mock: select topic author
    const selectChain = createChainableProxy([{ authorDid: TOPIC_AUTHOR_DID }]);
    mockDb.select.mockReturnValue(selectChain);

    // Mock: insert notification
    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReply({
      replyUri: REPLY_URI,
      actorDid: ACTOR_DID,
      topicUri: TOPIC_URI,
      parentUri: TOPIC_URI, // direct reply to topic
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("does not notify when replying to own topic", async () => {
    // Actor IS the topic author
    const selectChain = createChainableProxy([{ authorDid: ACTOR_DID }]);
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReply({
      replyUri: REPLY_URI,
      actorDid: ACTOR_DID,
      topicUri: `at://${ACTOR_DID}/forum.barazo.topic.post/topic1`,
      parentUri: `at://${ACTOR_DID}/forum.barazo.topic.post/topic1`,
      communityDid: COMMUNITY_DID,
    });

    // insert should not be called for notifications (only select for topic lookup)
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("notifies both topic author and parent reply author for nested replies", async () => {
    // First select: topic author
    const topicSelectChain = createChainableProxy([{ authorDid: TOPIC_AUTHOR_DID }]);
    // Second select: parent reply author
    const parentSelectChain = createChainableProxy([{ authorDid: REPLY_AUTHOR_DID }]);

    mockDb.select
      .mockReturnValueOnce(topicSelectChain)
      .mockReturnValueOnce(parentSelectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReply({
      replyUri: REPLY_URI,
      actorDid: ACTOR_DID,
      topicUri: TOPIC_URI,
      parentUri: PARENT_REPLY_URI, // nested reply
      communityDid: COMMUNITY_DID,
    });

    // Should insert two notifications: one for topic author, one for parent reply author
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate notification when parent reply author is topic author", async () => {
    // Same author for topic and parent reply
    const topicSelectChain = createChainableProxy([{ authorDid: TOPIC_AUTHOR_DID }]);
    const parentSelectChain = createChainableProxy([{ authorDid: TOPIC_AUTHOR_DID }]);

    mockDb.select
      .mockReturnValueOnce(topicSelectChain)
      .mockReturnValueOnce(parentSelectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReply({
      replyUri: REPLY_URI,
      actorDid: ACTOR_DID,
      topicUri: TOPIC_URI,
      parentUri: PARENT_REPLY_URI,
      communityDid: COMMUNITY_DID,
    });

    // Only one notification (topic author = parent reply author)
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it("logs error and does not throw on DB failure", async () => {
    mockDb.select.mockReturnValue(
      createChainableProxy(Promise.reject(new Error("DB error"))),
    );

    await expect(
      service.notifyOnReply({
        replyUri: REPLY_URI,
        actorDid: ACTOR_DID,
        topicUri: TOPIC_URI,
        parentUri: TOPIC_URI,
        communityDid: COMMUNITY_DID,
      }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ===========================================================================
// notifyOnReaction
// ===========================================================================

describe("notifyOnReaction", () => {
  it("notifies topic author when their topic gets a reaction", async () => {
    const selectChain = createChainableProxy([{ authorDid: TOPIC_AUTHOR_DID }]);
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReaction({
      subjectUri: TOPIC_URI,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("notifies reply author when their reply gets a reaction", async () => {
    // First select (topic lookup): no match
    const noMatchChain = createChainableProxy([]);
    // Second select (reply lookup): match
    const replyChain = createChainableProxy([{ authorDid: REPLY_AUTHOR_DID }]);

    mockDb.select
      .mockReturnValueOnce(noMatchChain)
      .mockReturnValueOnce(replyChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReaction({
      subjectUri: PARENT_REPLY_URI,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("does not notify when reacting to own content", async () => {
    const selectChain = createChainableProxy([{ authorDid: ACTOR_DID }]);
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnReaction({
      subjectUri: `at://${ACTOR_DID}/forum.barazo.topic.post/mytopic`,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// notifyOnModAction
// ===========================================================================

describe("notifyOnModAction", () => {
  it("notifies content author of moderation action", async () => {
    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnModAction({
      targetUri: TOPIC_URI,
      moderatorDid: MODERATOR_DID,
      targetDid: TOPIC_AUTHOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("does not notify when moderator acts on own content", async () => {
    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnModAction({
      targetUri: TOPIC_URI,
      moderatorDid: MODERATOR_DID,
      targetDid: MODERATOR_DID, // same person
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// notifyOnMentions
// ===========================================================================

describe("notifyOnMentions", () => {
  it("resolves handles to DIDs and creates mention notifications", async () => {
    // Select: resolve handles
    const userSelectChain = createChainableProxy([
      { did: "did:plc:mentioned1", handle: "alice.bsky.social" },
    ]);
    mockDb.select.mockReturnValue(userSelectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnMentions({
      content: "Hey @alice.bsky.social check this out",
      subjectUri: REPLY_URI,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("does not create notifications for unresolved handles", async () => {
    // No users found for the handle
    const emptySelectChain = createChainableProxy([]);
    mockDb.select.mockReturnValue(emptySelectChain);

    await service.notifyOnMentions({
      content: "Hey @unknown.example.com",
      subjectUri: REPLY_URI,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("does not create notification for self-mention", async () => {
    const userSelectChain = createChainableProxy([
      { did: ACTOR_DID, handle: "me.bsky.social" },
    ]);
    mockDb.select.mockReturnValue(userSelectChain);

    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnMentions({
      content: "I am @me.bsky.social",
      subjectUri: REPLY_URI,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("skips when content has no mentions", async () => {
    await service.notifyOnMentions({
      content: "No mentions here",
      subjectUri: REPLY_URI,
      actorDid: ACTOR_DID,
      communityDid: COMMUNITY_DID,
    });

    // Should not even query the DB
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// notifyOnCrossPostFailure
// ===========================================================================

describe("notifyOnCrossPostFailure", () => {
  it("creates a cross_post_failed notification for the topic author", async () => {
    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnCrossPostFailure({
      topicUri: TOPIC_URI,
      authorDid: ACTOR_DID,
      service: "bluesky",
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("creates separate notifications for different failed services", async () => {
    const insertChain = createChainableProxy();
    mockDb.insert.mockReturnValue(insertChain);

    await service.notifyOnCrossPostFailure({
      topicUri: TOPIC_URI,
      authorDid: ACTOR_DID,
      service: "bluesky",
      communityDid: COMMUNITY_DID,
    });

    await service.notifyOnCrossPostFailure({
      topicUri: TOPIC_URI,
      authorDid: ACTOR_DID,
      service: "frontpage",
      communityDid: COMMUNITY_DID,
    });

    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it("logs error and does not throw on DB failure", async () => {
    const insertChain = createChainableProxy();
    insertChain.values.mockRejectedValue(new Error("DB error"));
    mockDb.insert.mockReturnValue(insertChain);

    await expect(
      service.notifyOnCrossPostFailure({
        topicUri: TOPIC_URI,
        authorDid: ACTOR_DID,
        service: "bluesky",
        communityDid: COMMUNITY_DID,
      }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

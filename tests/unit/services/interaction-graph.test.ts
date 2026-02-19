import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInteractionGraphService } from "../../../src/services/interaction-graph.js";
import type { InteractionGraphService } from "../../../src/services/interaction-graph.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
}

function makeChain(result: unknown = []) {
  const thenFn = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);

  const terminal = vi.fn().mockImplementation(() => ({ then: thenFn }));

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = terminal;
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = terminal;
  chain.onConflictDoNothing = terminal;
  chain.set = vi.fn().mockReturnValue(chain);
  chain.orderBy = terminal;
  chain.limit = terminal;
  chain.returning = terminal;
  chain.leftJoin = vi.fn().mockReturnValue(chain);

  return chain;
}

describe("InteractionGraphService", () => {
  let service: InteractionGraphService;
  let mockDb: ReturnType<typeof createMockDb>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    logger = createMockLogger();
    service = createInteractionGraphService(mockDb as never, logger as never);
  });

  describe("recordReply", () => {
    it("should upsert an interaction of type reply", async () => {
      const chain = makeChain();
      mockDb.insert.mockReturnValue(chain);

      await service.recordReply("did:replier", "did:author", "community1");

      expect(mockDb.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDid: "did:replier",
          targetDid: "did:author",
          communityId: "community1",
          interactionType: "reply",
        }),
      );
      expect(chain.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("should skip self-interaction", async () => {
      await service.recordReply("did:same", "did:same", "community1");

      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe("recordReaction", () => {
    it("should upsert an interaction of type reaction", async () => {
      const chain = makeChain();
      mockDb.insert.mockReturnValue(chain);

      await service.recordReaction("did:reactor", "did:author", "community1");

      expect(mockDb.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDid: "did:reactor",
          targetDid: "did:author",
          communityId: "community1",
          interactionType: "reaction",
        }),
      );
    });

    it("should skip self-interaction", async () => {
      await service.recordReaction("did:same", "did:same", "community1");

      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe("recordCoParticipation", () => {
    it("should create pairwise interactions for topic participants", async () => {
      const replyAuthors = [
        { authorDid: "did:a" },
        { authorDid: "did:b" },
        { authorDid: "did:c" },
      ];

      const selectChain = makeChain(replyAuthors);
      const insertChain = makeChain();

      mockDb.select.mockReturnValue(selectChain);
      mockDb.insert.mockReturnValue(insertChain);

      await service.recordCoParticipation(
        "at://did:plc:xxx/forum.barazo.topic.post/abc",
        "community1",
      );

      // 3 authors -> 3 pairs (a-b, a-c, b-c)
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it("should skip if more than 50 unique authors", async () => {
      const manyAuthors = Array.from({ length: 51 }, (_, i) => ({
        authorDid: `did:author${String(i)}`,
      }));

      const selectChain = makeChain(manyAuthors);
      mockDb.select.mockReturnValue(selectChain);

      await service.recordCoParticipation(
        "at://did:plc:xxx/forum.barazo.topic.post/abc",
        "community1",
      );

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("should skip if only one author", async () => {
      const singleAuthor = [{ authorDid: "did:a" }];
      const selectChain = makeChain(singleAuthor);
      mockDb.select.mockReturnValue(selectChain);

      await service.recordCoParticipation(
        "at://did:plc:xxx/forum.barazo.topic.post/abc",
        "community1",
      );

      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });
});

import { eq, and, sql, asc } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { createPdsClient } from "../lib/pds-client.js";
import { notFound, forbidden, badRequest } from "../lib/api-errors.js";
import { resolveMaxMaturity, maturityAllows } from "../lib/content-filter.js";
import type { MaturityUser } from "../lib/content-filter.js";
import { createReplySchema, updateReplySchema, replyQuerySchema } from "../validation/replies.js";
import { replies } from "../db/schema/replies.js";
import { topics } from "../db/schema/topics.js";
import { users } from "../db/schema/users.js";
import { categories } from "../db/schema/categories.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION = "forum.barazo.topic.reply";

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const replyJsonSchema = {
  type: "object" as const,
  properties: {
    uri: { type: "string" as const },
    rkey: { type: "string" as const },
    authorDid: { type: "string" as const },
    content: { type: "string" as const },
    contentFormat: { type: ["string", "null"] as const },
    rootUri: { type: "string" as const },
    rootCid: { type: "string" as const },
    parentUri: { type: "string" as const },
    parentCid: { type: "string" as const },
    communityDid: { type: "string" as const },
    cid: { type: "string" as const },
    depth: { type: "integer" as const },
    reactionCount: { type: "integer" as const },
    createdAt: { type: "string" as const, format: "date-time" as const },
    indexedAt: { type: "string" as const, format: "date-time" as const },
  },
};

const errorJsonSchema = {
  type: "object" as const,
  properties: {
    error: { type: "string" as const },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a reply row from the DB into a JSON-safe response object.
 * Converts Date fields to ISO strings and computes depth.
 */
function serializeReply(row: typeof replies.$inferSelect) {
  // Simple depth calculation for MVP:
  // depth 0 = direct reply to topic (parentUri === rootUri)
  // depth 1 = reply to a reply (parentUri !== rootUri)
  const depth = row.parentUri === row.rootUri ? 0 : 1;

  return {
    uri: row.uri,
    rkey: row.rkey,
    authorDid: row.authorDid,
    content: row.content,
    contentFormat: row.contentFormat ?? null,
    rootUri: row.rootUri,
    rootCid: row.rootCid,
    parentUri: row.parentUri,
    parentCid: row.parentCid,
    communityDid: row.communityDid,
    cid: row.cid,
    depth,
    reactionCount: row.reactionCount,
    createdAt: row.createdAt.toISOString(),
    indexedAt: row.indexedAt.toISOString(),
  };
}

/**
 * Encode a pagination cursor from createdAt + uri.
 */
function encodeCursor(createdAt: string, uri: string): string {
  return Buffer.from(JSON.stringify({ createdAt, uri })).toString("base64");
}

/**
 * Decode a pagination cursor. Returns null if invalid.
 */
function decodeCursor(cursor: string): { createdAt: string; uri: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<string, unknown>;
    if (typeof decoded.createdAt === "string" && typeof decoded.uri === "string") {
      return { createdAt: decoded.createdAt, uri: decoded.uri };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the rkey from an AT URI.
 * Format: at://did:plc:xxx/collection/rkey
 */
function extractRkey(uri: string): string {
  const parts = uri.split("/");
  const rkey = parts[parts.length - 1];
  if (!rkey) {
    throw badRequest("Invalid AT URI: missing rkey");
  }
  return rkey;
}

// ---------------------------------------------------------------------------
// Reply routes plugin
// ---------------------------------------------------------------------------

/**
 * Reply routes for the Barazo forum.
 *
 * - POST   /api/topics/:topicUri/replies  -- Create a reply
 * - GET    /api/topics/:topicUri/replies   -- List replies for a topic
 * - PUT    /api/replies/:uri               -- Update a reply
 * - DELETE /api/replies/:uri               -- Delete a reply
 */
export function replyRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware, firehose } = app;
    const pdsClient = createPdsClient(app.oauthClient, app.log);

    // -------------------------------------------------------------------
    // POST /api/topics/:topicUri/replies (auth required)
    // -------------------------------------------------------------------

    app.post("/api/topics/:topicUri/replies", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Replies"],
        summary: "Create a reply to a topic",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["topicUri"],
          properties: {
            topicUri: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 50000 },
            parentUri: { type: "string", minLength: 1 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              uri: { type: "string" },
              cid: { type: "string" },
              rkey: { type: "string" },
              content: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          400: errorJsonSchema,
          401: errorJsonSchema,
          404: errorJsonSchema,
          502: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const parsed = createReplySchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid reply data");
      }

      const { topicUri } = request.params as { topicUri: string };
      const decodedTopicUri = decodeURIComponent(topicUri);
      const { content, parentUri } = parsed.data;

      // Look up the parent topic
      const topicRows = await db
        .select()
        .from(topics)
        .where(eq(topics.uri, decodedTopicUri));

      const topic = topicRows[0];
      if (!topic) {
        throw notFound("Topic not found");
      }

      // Resolve parent reference
      let parentRefUri = topic.uri;
      let parentRefCid = topic.cid;

      if (parentUri) {
        // Look up the parent reply
        const parentReplyRows = await db
          .select()
          .from(replies)
          .where(eq(replies.uri, parentUri));

        const parentReply = parentReplyRows[0];
        if (!parentReply) {
          throw badRequest("Parent reply not found");
        }
        parentRefUri = parentReply.uri;
        parentRefCid = parentReply.cid;
      }

      const now = new Date().toISOString();

      // Build AT Protocol record
      const record: Record<string, unknown> = {
        content,
        community: topic.communityDid,
        root: { uri: topic.uri, cid: topic.cid },
        parent: { uri: parentRefUri, cid: parentRefCid },
        createdAt: now,
      };

      try {
        // Write record to user's PDS
        const result = await pdsClient.createRecord(user.did, COLLECTION, record);
        const rkey = extractRkey(result.uri);

        // Track repo if this is user's first post
        const repoManager = firehose.getRepoManager();
        const alreadyTracked = await repoManager.isTracked(user.did);
        if (!alreadyTracked) {
          await repoManager.trackRepo(user.did);
        }

        // Insert into local DB optimistically
        await db
          .insert(replies)
          .values({
            uri: result.uri,
            rkey,
            authorDid: user.did,
            content,
            rootUri: topic.uri,
            rootCid: topic.cid,
            parentUri: parentRefUri,
            parentCid: parentRefCid,
            communityDid: topic.communityDid,
            cid: result.cid,
            reactionCount: 0,
            createdAt: new Date(now),
            indexedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: replies.uri,
            set: {
              content,
              cid: result.cid,
              indexedAt: new Date(),
            },
          });

        // Update parent topic: increment replyCount, set lastActivityAt
        await db
          .update(topics)
          .set({
            replyCount: sql`${topics.replyCount} + 1`,
            lastActivityAt: new Date(),
          })
          .where(eq(topics.uri, decodedTopicUri));

        return await reply.status(201).send({
          uri: result.uri,
          cid: result.cid,
          rkey,
          content,
          createdAt: now,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err; // Re-throw ApiError instances
        }
        app.log.error({ err, did: user.did }, "Failed to create reply");
        return reply.status(502).send({ error: "Failed to create reply" });
      }
    });

    // -------------------------------------------------------------------
    // GET /api/topics/:topicUri/replies (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get("/api/topics/:topicUri/replies", {
      preHandler: [authMiddleware.optionalAuth],
      schema: {
        tags: ["Replies"],
        summary: "List replies for a topic with pagination",
        params: {
          type: "object",
          required: ["topicUri"],
          properties: {
            topicUri: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string" },
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              replies: { type: "array", items: replyJsonSchema },
              cursor: { type: ["string", "null"] },
            },
          },
          400: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { topicUri } = request.params as { topicUri: string };
      const decodedTopicUri = decodeURIComponent(topicUri);

      const parsedQuery = replyQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw badRequest("Invalid query parameters");
      }

      // Check that the topic exists
      const topicRows = await db
        .select()
        .from(topics)
        .where(eq(topics.uri, decodedTopicUri));

      const topic = topicRows[0];
      if (!topic) {
        throw notFound("Topic not found");
      }

      // Maturity check: verify the topic's category is within the user's allowed level
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";
      const catRows = await db
        .select({ maturityRating: categories.maturityRating })
        .from(categories)
        .where(
          and(
            eq(categories.slug, topic.category),
            eq(categories.communityDid, communityDid),
          ),
        );

      if (catRows.length === 0) {
        app.log.warn({ category: topic.category, communityDid }, "Category not found for maturity check, defaulting to safe");
      }
      const categoryRating = catRows[0]?.maturityRating ?? "safe";

      let userProfile: MaturityUser | undefined;
      if (request.user) {
        const userRows = await db
          .select({ ageDeclaredAt: users.ageDeclaredAt, maturityPref: users.maturityPref })
          .from(users)
          .where(eq(users.did, request.user.did));
        const row = userRows[0];
        if (row) {
          userProfile = row;
        }
      }

      const maxMaturity = resolveMaxMaturity(userProfile);
      if (!maturityAllows(maxMaturity, categoryRating)) {
        throw forbidden("Content restricted by maturity settings");
      }

      const { cursor, limit } = parsedQuery.data;
      const conditions = [eq(replies.rootUri, decodedTopicUri)];

      // Cursor-based pagination (ASC order for conversation flow)
      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${replies.createdAt}, ${replies.uri}) > (${decoded.createdAt}::timestamptz, ${decoded.uri})`,
          );
        }
      }

      const whereClause = and(...conditions);

      // Fetch limit + 1 to detect if there are more pages
      const fetchLimit = limit + 1;
      const rows = await db
        .select()
        .from(replies)
        .where(whereClause)
        .orderBy(asc(replies.createdAt))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;
      const serialized = resultRows.map(serializeReply);

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastRow = resultRows[resultRows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor(lastRow.createdAt.toISOString(), lastRow.uri);
        }
      }

      return reply.status(200).send({
        replies: serialized,
        cursor: nextCursor,
      });
    });

    // -------------------------------------------------------------------
    // PUT /api/replies/:uri (auth required, author only)
    // -------------------------------------------------------------------

    app.put("/api/replies/:uri", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Replies"],
        summary: "Update a reply (author only)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["uri"],
          properties: {
            uri: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 50000 },
          },
        },
        response: {
          200: replyJsonSchema,
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
          502: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const parsed = updateReplySchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid update data");
      }

      const { uri } = request.params as { uri: string };
      const decodedUri = decodeURIComponent(uri);

      // Fetch existing reply
      const existing = await db
        .select()
        .from(replies)
        .where(eq(replies.uri, decodedUri));

      const replyRow = existing[0];
      if (!replyRow) {
        throw notFound("Reply not found");
      }

      // Author check
      if (replyRow.authorDid !== user.did) {
        throw forbidden("Not authorized to edit this reply");
      }

      const { content } = parsed.data;
      const rkey = extractRkey(decodedUri);

      // Build updated record for PDS
      const updatedRecord: Record<string, unknown> = {
        content,
        community: replyRow.communityDid,
        root: { uri: replyRow.rootUri, cid: replyRow.rootCid },
        parent: { uri: replyRow.parentUri, cid: replyRow.parentCid },
        createdAt: replyRow.createdAt.toISOString(),
      };

      try {
        const result = await pdsClient.updateRecord(user.did, COLLECTION, rkey, updatedRecord);

        const updated = await db
          .update(replies)
          .set({
            content,
            cid: result.cid,
            indexedAt: new Date(),
          })
          .where(eq(replies.uri, decodedUri))
          .returning();

        const updatedRow = updated[0];
        if (!updatedRow) {
          throw notFound("Reply not found after update");
        }

        return await reply.status(200).send(serializeReply(updatedRow));
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err; // Re-throw ApiError instances
        }
        app.log.error({ err, uri: decodedUri }, "Failed to update reply");
        return await reply.status(502).send({ error: "Failed to update reply" });
      }
    });

    // -------------------------------------------------------------------
    // DELETE /api/replies/:uri (auth required, author or moderator)
    // -------------------------------------------------------------------

    app.delete("/api/replies/:uri", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Replies"],
        summary: "Delete a reply (author or moderator)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["uri"],
          properties: {
            uri: { type: "string" },
          },
        },
        response: {
          204: { type: "null" },
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
          502: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const { uri } = request.params as { uri: string };
      const decodedUri = decodeURIComponent(uri);

      // Fetch existing reply
      const existing = await db
        .select()
        .from(replies)
        .where(eq(replies.uri, decodedUri));

      const replyRow = existing[0];
      if (!replyRow) {
        throw notFound("Reply not found");
      }

      const isAuthor = replyRow.authorDid === user.did;

      // Check if user is a moderator or admin
      let isMod = false;
      if (!isAuthor) {
        const userRows = await db
          .select()
          .from(users)
          .where(eq(users.did, user.did));

        const userRow = userRows[0];
        isMod = userRow?.role === "moderator" || userRow?.role === "admin";
      }

      if (!isAuthor && !isMod) {
        throw forbidden("Not authorized to delete this reply");
      }

      try {
        // Author: delete from PDS AND DB
        // Moderator: delete from DB only (leave record on PDS)
        if (isAuthor) {
          const rkey = extractRkey(decodedUri);
          await pdsClient.deleteRecord(user.did, COLLECTION, rkey);
        }

        // Delete reply and update topic replyCount in a transaction
        await db.transaction(async (tx) => {
          await tx.delete(replies).where(eq(replies.uri, decodedUri));
          await tx
            .update(topics)
            .set({
              replyCount: sql`GREATEST(${topics.replyCount} - 1, 0)`,
            })
            .where(eq(topics.uri, replyRow.rootUri));
        });

        return await reply.status(204).send();
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err;
        }
        app.log.error({ err, uri: decodedUri }, "Failed to delete reply");
        return await reply.status(502).send({ error: "Failed to delete reply" });
      }
    });

    done();
  };
}

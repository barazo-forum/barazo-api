import { eq, and, desc, sql } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { createPdsClient } from "../lib/pds-client.js";
import { notFound, forbidden, badRequest } from "../lib/api-errors.js";
import { createTopicSchema, updateTopicSchema, topicQuerySchema } from "../validation/topics.js";
import { topics } from "../db/schema/topics.js";
import { replies } from "../db/schema/replies.js";
import { users } from "../db/schema/users.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION = "forum.barazo.topic.post";

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const topicJsonSchema = {
  type: "object" as const,
  properties: {
    uri: { type: "string" as const },
    rkey: { type: "string" as const },
    authorDid: { type: "string" as const },
    title: { type: "string" as const },
    content: { type: "string" as const },
    contentFormat: { type: ["string", "null"] as const },
    category: { type: "string" as const },
    tags: { type: ["array", "null"] as const, items: { type: "string" as const } },
    communityDid: { type: "string" as const },
    cid: { type: "string" as const },
    replyCount: { type: "integer" as const },
    reactionCount: { type: "integer" as const },
    lastActivityAt: { type: "string" as const, format: "date-time" as const },
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
 * Serialize a topic row from the DB into a JSON-safe response object.
 * Converts Date fields to ISO strings.
 */
function serializeTopic(row: typeof topics.$inferSelect) {
  return {
    uri: row.uri,
    rkey: row.rkey,
    authorDid: row.authorDid,
    title: row.title,
    content: row.content,
    contentFormat: row.contentFormat ?? null,
    category: row.category,
    tags: row.tags ?? null,
    communityDid: row.communityDid,
    cid: row.cid,
    replyCount: row.replyCount,
    reactionCount: row.reactionCount,
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    indexedAt: row.indexedAt.toISOString(),
  };
}

/**
 * Encode a pagination cursor from lastActivityAt + uri.
 */
function encodeCursor(lastActivityAt: string, uri: string): string {
  return Buffer.from(JSON.stringify({ lastActivityAt, uri })).toString("base64");
}

/**
 * Decode a pagination cursor. Returns null if invalid.
 */
function decodeCursor(cursor: string): { lastActivityAt: string; uri: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<string, unknown>;
    if (typeof decoded.lastActivityAt === "string" && typeof decoded.uri === "string") {
      return { lastActivityAt: decoded.lastActivityAt, uri: decoded.uri };
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
// Topic routes plugin
// ---------------------------------------------------------------------------

/**
 * Topic routes for the Barazo forum.
 *
 * - POST   /api/topics          -- Create a new topic
 * - GET    /api/topics           -- List topics (paginated)
 * - GET    /api/topics/:uri      -- Get a single topic
 * - PUT    /api/topics/:uri      -- Update a topic
 * - DELETE /api/topics/:uri      -- Delete a topic
 */
export function topicRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware, firehose } = app;
    const pdsClient = createPdsClient(app.oauthClient, app.log);

    // -------------------------------------------------------------------
    // POST /api/topics (auth required)
    // -------------------------------------------------------------------

    app.post("/api/topics", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Topics"],
        summary: "Create a new topic",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["title", "content", "category"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            content: { type: "string", minLength: 1, maxLength: 100000 },
            category: { type: "string", minLength: 1 },
            tags: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 30 },
              maxItems: 5,
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              uri: { type: "string" },
              cid: { type: "string" },
              rkey: { type: "string" },
              title: { type: "string" },
              category: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          400: errorJsonSchema,
          401: errorJsonSchema,
          502: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const parsed = createTopicSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid topic data");
      }

      const { title, content, category, tags } = parsed.data;
      const now = new Date().toISOString();
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      // Build AT Protocol record
      const record: Record<string, unknown> = {
        title,
        content,
        category,
        tags: tags ?? [],
        community: communityDid,
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

        // Insert into local DB optimistically (don't wait for firehose)
        await db
          .insert(topics)
          .values({
            uri: result.uri,
            rkey,
            authorDid: user.did,
            title,
            content,
            category,
            tags: tags ?? [],
            communityDid,
            cid: result.cid,
            replyCount: 0,
            reactionCount: 0,
            lastActivityAt: new Date(now),
            createdAt: new Date(now),
            indexedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: topics.uri,
            set: {
              title,
              content,
              category,
              tags: tags ?? [],
              cid: result.cid,
              indexedAt: new Date(),
            },
          });

        return await reply.status(201).send({
          uri: result.uri,
          cid: result.cid,
          rkey,
          title,
          category,
          createdAt: now,
        });
      } catch (err: unknown) {
        app.log.error({ err, did: user.did }, "Failed to create topic");
        return reply.status(502).send({ error: "Failed to create topic" });
      }
    });

    // -------------------------------------------------------------------
    // GET /api/topics (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get("/api/topics", {
      preHandler: [authMiddleware.optionalAuth],
      schema: {
        tags: ["Topics"],
        summary: "List topics with pagination",
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string" },
            limit: { type: "string" },
            category: { type: "string" },
            tag: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              topics: { type: "array", items: topicJsonSchema },
              cursor: { type: ["string", "null"] },
            },
          },
          400: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = topicQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw badRequest("Invalid query parameters");
      }

      const { cursor, limit, category, tag } = parsed.data;
      const conditions = [];

      // Category filter
      if (category) {
        conditions.push(eq(topics.category, category));
      }

      // Tag filter (jsonb contains)
      if (tag) {
        conditions.push(sql`${topics.tags} @> ${JSON.stringify([tag])}::jsonb`);
      }

      // Cursor-based pagination
      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${topics.lastActivityAt}, ${topics.uri}) < (${decoded.lastActivityAt}::timestamptz, ${decoded.uri})`,
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Fetch limit + 1 to detect if there are more pages
      const fetchLimit = limit + 1;
      const rows = await db
        .select()
        .from(topics)
        .where(whereClause)
        .orderBy(desc(topics.lastActivityAt))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;
      const serialized = resultRows.map(serializeTopic);

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastRow = resultRows[resultRows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor(lastRow.lastActivityAt.toISOString(), lastRow.uri);
        }
      }

      return reply.status(200).send({
        topics: serialized,
        cursor: nextCursor,
      });
    });

    // -------------------------------------------------------------------
    // GET /api/topics/:uri (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get("/api/topics/:uri", {
      preHandler: [authMiddleware.optionalAuth],
      schema: {
        tags: ["Topics"],
        summary: "Get a single topic by AT URI",
        params: {
          type: "object",
          required: ["uri"],
          properties: {
            uri: { type: "string" },
          },
        },
        response: {
          200: topicJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { uri } = request.params as { uri: string };
      const decodedUri = decodeURIComponent(uri);

      const rows = await db
        .select()
        .from(topics)
        .where(eq(topics.uri, decodedUri));

      const row = rows[0];
      if (!row) {
        throw notFound("Topic not found");
      }

      return reply.status(200).send(serializeTopic(row));
    });

    // -------------------------------------------------------------------
    // PUT /api/topics/:uri (auth required, author only)
    // -------------------------------------------------------------------

    app.put("/api/topics/:uri", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Topics"],
        summary: "Update a topic (author only)",
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
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            content: { type: "string", minLength: 1, maxLength: 100000 },
            category: { type: "string", minLength: 1 },
            tags: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 30 },
              maxItems: 5,
            },
          },
        },
        response: {
          200: topicJsonSchema,
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

      const parsed = updateTopicSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid update data");
      }

      const { uri } = request.params as { uri: string };
      const decodedUri = decodeURIComponent(uri);

      // Fetch existing topic
      const existing = await db
        .select()
        .from(topics)
        .where(eq(topics.uri, decodedUri));

      const topic = existing[0];
      if (!topic) {
        throw notFound("Topic not found");
      }

      // Author check
      if (topic.authorDid !== user.did) {
        throw forbidden("Not authorized to edit this topic");
      }

      const updates = parsed.data;
      const rkey = extractRkey(decodedUri);

      // Build updated record for PDS
      const updatedRecord: Record<string, unknown> = {
        title: updates.title ?? topic.title,
        content: updates.content ?? topic.content,
        category: updates.category ?? topic.category,
        tags: updates.tags ?? topic.tags ?? [],
        community: topic.communityDid,
        createdAt: topic.createdAt.toISOString(),
      };

      try {
        const result = await pdsClient.updateRecord(user.did, COLLECTION, rkey, updatedRecord);

        // Build DB update set
        const dbUpdates: Record<string, unknown> = {
          cid: result.cid,
          indexedAt: new Date(),
        };
        if (updates.title !== undefined) dbUpdates.title = updates.title;
        if (updates.content !== undefined) dbUpdates.content = updates.content;
        if (updates.category !== undefined) dbUpdates.category = updates.category;
        if (updates.tags !== undefined) dbUpdates.tags = updates.tags;

        const updated = await db
          .update(topics)
          .set(dbUpdates)
          .where(eq(topics.uri, decodedUri))
          .returning();

        const updatedRow = updated[0];
        if (!updatedRow) {
          throw notFound("Topic not found after update");
        }

        return await reply.status(200).send(serializeTopic(updatedRow));
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err; // Re-throw ApiError instances
        }
        app.log.error({ err, uri: decodedUri }, "Failed to update topic");
        return await reply.status(502).send({ error: "Failed to update topic" });
      }
    });

    // -------------------------------------------------------------------
    // DELETE /api/topics/:uri (auth required, author or moderator)
    // -------------------------------------------------------------------

    app.delete("/api/topics/:uri", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Topics"],
        summary: "Delete a topic (author or moderator)",
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

      // Fetch existing topic
      const existing = await db
        .select()
        .from(topics)
        .where(eq(topics.uri, decodedUri));

      const topic = existing[0];
      if (!topic) {
        throw notFound("Topic not found");
      }

      const isAuthor = topic.authorDid === user.did;

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
        throw forbidden("Not authorized to delete this topic");
      }

      try {
        // Author: delete from PDS AND DB
        // Moderator: delete from DB only (leave record on PDS)
        if (isAuthor) {
          const rkey = extractRkey(decodedUri);
          await pdsClient.deleteRecord(user.did, COLLECTION, rkey);
        }

        // Cascade delete in a transaction for consistency
        await db.transaction(async (tx) => {
          await tx.delete(replies).where(eq(replies.rootUri, decodedUri));
          await tx.delete(topics).where(eq(topics.uri, decodedUri));
        });

        return await reply.status(204).send();
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err;
        }
        app.log.error({ err, uri: decodedUri }, "Failed to delete topic");
        return await reply.status(502).send({ error: "Failed to delete topic" });
      }
    });

    done();
  };
}

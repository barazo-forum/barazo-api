import { eq, and, sql, asc } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { createPdsClient } from "../lib/pds-client.js";
import { notFound, forbidden, badRequest, conflict } from "../lib/api-errors.js";
import { createReactionSchema, reactionQuerySchema } from "../validation/reactions.js";
import { reactions } from "../db/schema/reactions.js";
import { topics } from "../db/schema/topics.js";
import { replies } from "../db/schema/replies.js";
import { communitySettings } from "../db/schema/community-settings.js";
import { checkOnboardingComplete } from "../lib/onboarding-gate.js";
import { createNotificationService } from "../services/notification.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION = "forum.barazo.interaction.reaction";
const TOPIC_COLLECTION = "forum.barazo.topic.post";
const REPLY_COLLECTION = "forum.barazo.topic.reply";

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const reactionJsonSchema = {
  type: "object" as const,
  properties: {
    uri: { type: "string" as const },
    rkey: { type: "string" as const },
    authorDid: { type: "string" as const },
    subjectUri: { type: "string" as const },
    type: { type: "string" as const },
    cid: { type: "string" as const },
    createdAt: { type: "string" as const, format: "date-time" as const },
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
 * Serialize a reaction row from the DB into a JSON-safe response object.
 * Converts Date fields to ISO strings.
 */
function serializeReaction(row: typeof reactions.$inferSelect) {
  return {
    uri: row.uri,
    rkey: row.rkey,
    authorDid: row.authorDid,
    subjectUri: row.subjectUri,
    type: row.type,
    cid: row.cid,
    createdAt: row.createdAt.toISOString(),
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

/**
 * Get the collection NSID from an AT URI.
 * Format: at://did/collection/rkey -> returns "collection"
 */
function getCollectionFromUri(uri: string): string | undefined {
  const parts = uri.split("/");
  return parts[3];
}

// ---------------------------------------------------------------------------
// Reaction routes plugin
// ---------------------------------------------------------------------------

/**
 * Reaction routes for the Barazo forum.
 *
 * - POST   /api/reactions      -- Create a reaction
 * - DELETE /api/reactions/:uri  -- Delete a reaction
 * - GET    /api/reactions       -- List reactions for a subject
 */
export function reactionRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware, firehose } = app;
    const pdsClient = createPdsClient(app.oauthClient, app.log);
    const notificationService = createNotificationService(db, app.log);

    // -------------------------------------------------------------------
    // POST /api/reactions (auth required)
    // -------------------------------------------------------------------

    app.post("/api/reactions", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Reactions"],
        summary: "Create a reaction on a topic or reply",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["subjectUri", "subjectCid", "type"],
          properties: {
            subjectUri: { type: "string", minLength: 1 },
            subjectCid: { type: "string", minLength: 1 },
            type: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              uri: { type: "string" },
              cid: { type: "string" },
              rkey: { type: "string" },
              type: { type: "string" },
              subjectUri: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
          409: errorJsonSchema,
          502: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const parsed = createReactionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid reaction data");
      }

      const { subjectUri, subjectCid, type: reactionType } = parsed.data;
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      // Onboarding gate: block if user hasn't completed mandatory onboarding
      const onboarding = await checkOnboardingComplete(db, user.did, communityDid);
      if (!onboarding.complete) {
        return reply.status(403).send({
          error: "Onboarding required",
          fields: onboarding.missingFields,
        });
      }

      // Fetch community settings to get the allowed reaction set
      const settingsRows = await db
        .select({ reactionSet: communitySettings.reactionSet })
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const settings = settingsRows[0];
      const reactionSet: string[] = settings?.reactionSet ?? ["like"];

      // Validate that the reaction type is in the community's allowed set
      if (!reactionSet.includes(reactionType)) {
        throw badRequest(
          `Reaction type "${reactionType}" is not allowed. Allowed types: ${reactionSet.join(", ")}`,
        );
      }

      // Verify subject exists and belongs to the same community
      const collection = getCollectionFromUri(subjectUri);
      let subjectExists = false;

      if (collection === TOPIC_COLLECTION) {
        const topicRows = await db
          .select({ uri: topics.uri })
          .from(topics)
          .where(
            and(
              eq(topics.uri, subjectUri),
              eq(topics.communityDid, communityDid),
            ),
          );
        subjectExists = topicRows.length > 0;
      } else if (collection === REPLY_COLLECTION) {
        const replyRows = await db
          .select({ uri: replies.uri })
          .from(replies)
          .where(
            and(
              eq(replies.uri, subjectUri),
              eq(replies.communityDid, communityDid),
            ),
          );
        subjectExists = replyRows.length > 0;
      }

      if (!subjectExists) {
        throw notFound("Subject not found");
      }

      const now = new Date().toISOString();

      // Build AT Protocol record
      const record: Record<string, unknown> = {
        subject: { uri: subjectUri, cid: subjectCid },
        type: reactionType,
        community: communityDid,
        createdAt: now,
      };

      try {
        // Write record to user's PDS
        const result = await pdsClient.createRecord(user.did, COLLECTION, record);
        const rkey = extractRkey(result.uri);

        // Track repo if this is user's first interaction
        const repoManager = firehose.getRepoManager();
        const alreadyTracked = await repoManager.isTracked(user.did);
        if (!alreadyTracked) {
          await repoManager.trackRepo(user.did);
        }

        // Optimistically insert into local DB + increment count in a transaction
        const insertResult = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(reactions)
            .values({
              uri: result.uri,
              rkey,
              authorDid: user.did,
              subjectUri,
              subjectCid,
              type: reactionType,
              communityDid,
              cid: result.cid,
              createdAt: new Date(now),
              indexedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning();

          // If no rows were inserted, the unique constraint was hit (duplicate reaction)
          if (inserted.length === 0) {
            return inserted;
          }

          // Increment reaction count on the subject
          if (collection === TOPIC_COLLECTION) {
            await tx
              .update(topics)
              .set({ reactionCount: sql`${topics.reactionCount} + 1` })
              .where(eq(topics.uri, subjectUri));
          } else if (collection === REPLY_COLLECTION) {
            await tx
              .update(replies)
              .set({ reactionCount: sql`${replies.reactionCount} + 1` })
              .where(eq(replies.uri, subjectUri));
          }

          return inserted;
        });

        if (insertResult.length === 0) {
          throw conflict("Reaction already exists");
        }

        // Fire-and-forget: generate notification for the content author
        notificationService.notifyOnReaction({
          subjectUri,
          actorDid: user.did,
          communityDid,
        }).catch((err: unknown) => {
          app.log.error({ err, subjectUri }, "Reaction notification failed");
        });

        return await reply.status(201).send({
          uri: result.uri,
          cid: result.cid,
          rkey,
          type: reactionType,
          subjectUri,
          createdAt: now,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err; // Re-throw ApiError instances
        }
        app.log.error({ err, did: user.did }, "Failed to create reaction");
        return reply.status(502).send({ error: "Failed to create reaction" });
      }
    });

    // -------------------------------------------------------------------
    // DELETE /api/reactions/:uri (auth required, author only)
    // -------------------------------------------------------------------

    app.delete("/api/reactions/:uri", {
      preHandler: [authMiddleware.requireAuth],
      schema: {
        tags: ["Reactions"],
        summary: "Delete a reaction (author only)",
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
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      // Fetch existing reaction (scoped to this community)
      const existing = await db
        .select()
        .from(reactions)
        .where(and(eq(reactions.uri, decodedUri), eq(reactions.communityDid, communityDid)));

      const reaction = existing[0];
      if (!reaction) {
        throw notFound("Reaction not found");
      }

      // Author check
      if (reaction.authorDid !== user.did) {
        throw forbidden("Not authorized to delete this reaction");
      }

      const rkey = extractRkey(decodedUri);

      try {
        // Delete from PDS
        await pdsClient.deleteRecord(user.did, COLLECTION, rkey);

        // In transaction: delete from DB + decrement count on subject
        await db.transaction(async (tx) => {
          await tx.delete(reactions).where(and(eq(reactions.uri, decodedUri), eq(reactions.communityDid, communityDid)));

          const subjectCollection = getCollectionFromUri(reaction.subjectUri);

          if (subjectCollection === TOPIC_COLLECTION) {
            await tx
              .update(topics)
              .set({
                reactionCount: sql`GREATEST(${topics.reactionCount} - 1, 0)`,
              })
              .where(eq(topics.uri, reaction.subjectUri));
          } else if (subjectCollection === REPLY_COLLECTION) {
            await tx
              .update(replies)
              .set({
                reactionCount: sql`GREATEST(${replies.reactionCount} - 1, 0)`,
              })
              .where(eq(replies.uri, reaction.subjectUri));
          }
        });

        return await reply.status(204).send();
      } catch (err: unknown) {
        if (err instanceof Error && "statusCode" in err) {
          throw err;
        }
        app.log.error({ err, uri: decodedUri }, "Failed to delete reaction");
        return await reply.status(502).send({ error: "Failed to delete reaction" });
      }
    });

    // -------------------------------------------------------------------
    // GET /api/reactions (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get("/api/reactions", {
      preHandler: [authMiddleware.optionalAuth],
      schema: {
        tags: ["Reactions"],
        summary: "List reactions for a subject URI",
        querystring: {
          type: "object",
          required: ["subjectUri"],
          properties: {
            subjectUri: { type: "string" },
            type: { type: "string" },
            cursor: { type: "string" },
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              reactions: { type: "array", items: reactionJsonSchema },
              cursor: { type: ["string", "null"] },
            },
          },
          400: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = reactionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw badRequest("Invalid query parameters");
      }

      const { subjectUri, type: reactionType, cursor, limit } = parsed.data;
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";
      const conditions = [eq(reactions.subjectUri, subjectUri), eq(reactions.communityDid, communityDid)];

      // Optional type filter
      if (reactionType) {
        conditions.push(eq(reactions.type, reactionType));
      }

      // Cursor-based pagination (ASC order)
      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${reactions.createdAt}, ${reactions.uri}) > (${decoded.createdAt}::timestamptz, ${decoded.uri})`,
          );
        }
      }

      const whereClause = and(...conditions);

      // Fetch limit + 1 to detect if there are more pages
      const fetchLimit = limit + 1;
      const rows = await db
        .select()
        .from(reactions)
        .where(whereClause)
        .orderBy(asc(reactions.createdAt))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;
      const serialized = resultRows.map(serializeReaction);

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastRow = resultRows[resultRows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor(lastRow.createdAt.toISOString(), lastRow.uri);
        }
      }

      return reply.status(200).send({
        reactions: serialized,
        cursor: nextCursor,
      });
    });

    done();
  };
}

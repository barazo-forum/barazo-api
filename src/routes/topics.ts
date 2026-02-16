import { eq, and, desc, sql, inArray, notInArray, isNotNull, ne, or } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { createPdsClient } from "../lib/pds-client.js";
import { notFound, forbidden, badRequest } from "../lib/api-errors.js";
import { resolveMaxMaturity, allowedRatings, maturityAllows } from "../lib/content-filter.js";
import type { MaturityUser } from "../lib/content-filter.js";
import { createTopicSchema, updateTopicSchema, topicQuerySchema } from "../validation/topics.js";
import { createCrossPostService } from "../services/cross-post.js";
import { loadBlockMuteLists } from "../lib/block-mute.js";
import { loadMutedWords, contentMatchesMutedWords } from "../lib/muted-words.js";
import {
  runAntiSpamChecks,
  loadAntiSpamSettings,
  isNewAccount,
  isAccountTrusted,
  checkWriteRateLimit,
  canCreateTopic,
} from "../lib/anti-spam.js";
import { tooManyRequests } from "../lib/api-errors.js";
import { moderationQueue } from "../db/schema/moderation-queue.js";
import { topics } from "../db/schema/topics.js";
import { replies } from "../db/schema/replies.js";
import { users } from "../db/schema/users.js";
import { categories } from "../db/schema/categories.js";
import { communitySettings } from "../db/schema/community-settings.js";
import { checkOnboardingComplete } from "../lib/onboarding-gate.js";
import { createNotificationService } from "../services/notification.js";

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
    labels: {
      type: ["object", "null"] as const,
      properties: {
        values: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: { val: { type: "string" as const } },
          },
        },
      },
    },
    communityDid: { type: "string" as const },
    cid: { type: "string" as const },
    replyCount: { type: "integer" as const },
    reactionCount: { type: "integer" as const },
    isMuted: { type: "boolean" as const },
    isMutedWord: { type: "boolean" as const },
    ozoneLabel: { type: ["string", "null"] as const },
    categoryMaturityRating: { type: "string" as const, enum: ["safe", "mature", "adult"] },
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
 * @param categoryMaturityRating - The maturity rating inherited from the topic's category.
 */
function serializeTopic(
  row: typeof topics.$inferSelect,
  categoryMaturityRating: string = "safe",
) {
  return {
    uri: row.uri,
    rkey: row.rkey,
    authorDid: row.authorDid,
    title: row.title,
    content: row.content,
    contentFormat: row.contentFormat ?? null,
    category: row.category,
    tags: row.tags ?? null,
    labels: row.labels ?? null,
    communityDid: row.communityDid,
    cid: row.cid,
    replyCount: row.replyCount,
    reactionCount: row.reactionCount,
    categoryMaturityRating,
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
    const notificationService = createNotificationService(db, app.log);
    const crossPostService = createCrossPostService(pdsClient, db, app.log, {
      blueskyEnabled: env.FEATURE_CROSSPOST_BLUESKY,
      frontpageEnabled: env.FEATURE_CROSSPOST_FRONTPAGE,
      publicUrl: env.PUBLIC_URL,
      communityName: env.COMMUNITY_NAME,
    }, notificationService);

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
            labels: {
              type: "object",
              properties: {
                values: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["val"],
                    properties: { val: { type: "string" } },
                  },
                },
              },
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
              moderationStatus: { type: "string", enum: ["approved", "held", "rejected"] },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
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

      const { title, content, category, tags, labels } = parsed.data;
      const now = new Date().toISOString();
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      // Onboarding gate: block if user hasn't completed mandatory onboarding
      const onboarding = await checkOnboardingComplete(db, user.did, communityDid);
      if (!onboarding.complete) {
        return reply.status(403).send({
          error: "Onboarding required",
          fields: onboarding.missingFields,
        });
      }

      // Maturity check: verify user can post in this category
      const catRows = await db
        .select({ maturityRating: categories.maturityRating })
        .from(categories)
        .where(
          and(
            eq(categories.slug, category),
            eq(categories.communityDid, communityDid),
          ),
        );

      const categoryRating = catRows[0]?.maturityRating ?? "safe";

      const userRows = await db
        .select({ declaredAge: users.declaredAge, maturityPref: users.maturityPref })
        .from(users)
        .where(eq(users.did, user.did));
      const userProfile: MaturityUser | undefined = userRows[0] ?? undefined;

      // Fetch community age threshold
      const settingsRows = await db
        .select({ ageThreshold: communitySettings.ageThreshold })
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));
      const ageThreshold = settingsRows[0]?.ageThreshold ?? 16;

      const maxMaturity = resolveMaxMaturity(userProfile, ageThreshold);
      if (!maturityAllows(maxMaturity, categoryRating)) {
        throw forbidden("Content restricted by maturity settings");
      }

      // Ozone label check: spam-labeled accounts get stricter rate limits
      let ozoneSpamLabeled = false;
      if (app.ozoneService) {
        ozoneSpamLabeled = await app.ozoneService.isSpamLabeled(user.did);
      }

      // Anti-spam checks
      const antiSpamSettings = await loadAntiSpamSettings(db, app.cache, communityDid);
      const trusted = !ozoneSpamLabeled && await isAccountTrusted(db, user.did, communityDid, antiSpamSettings.trustedPostThreshold);

      if (!trusted) {
        // Ozone spam-labeled accounts are always treated as new (stricter rate limits)
        const isNew = ozoneSpamLabeled || await isNewAccount(db, user.did, communityDid, antiSpamSettings.newAccountDays);

        // Write rate limit
        const rateLimited = await checkWriteRateLimit(app.cache, user.did, communityDid, isNew, antiSpamSettings);
        if (rateLimited) {
          throw tooManyRequests("Write rate limit exceeded. Please try again later.");
        }

        // Topic creation delay: new accounts need at least one approved reply
        if (antiSpamSettings.topicCreationDelayEnabled) {
          const canPost = await canCreateTopic(db, user.did, communityDid, true);
          if (!canPost) {
            throw forbidden("New accounts must have at least one approved reply before creating topics");
          }
        }
      }

      // Content-level anti-spam checks (word filter, first-post queue, link hold, burst)
      const spamResult = await runAntiSpamChecks(db, app.cache, {
        authorDid: user.did,
        communityDid,
        contentType: "topic",
        title,
        content,
      });

      // Build AT Protocol record
      const record: Record<string, unknown> = {
        title,
        content,
        category,
        tags: tags ?? [],
        community: communityDid,
        createdAt: now,
        ...(labels ? { labels } : {}),
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
        const contentModerationStatus = spamResult.held ? "held" : "approved";
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
            labels: labels ?? null,
            communityDid,
            cid: result.cid,
            replyCount: 0,
            reactionCount: 0,
            moderationStatus: contentModerationStatus,
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
              labels: labels ?? null,
              cid: result.cid,
              moderationStatus: contentModerationStatus,
              indexedAt: new Date(),
            },
          });

        // Insert moderation queue entries if held
        if (spamResult.held) {
          const queueEntries = spamResult.reasons.map((r) => ({
            contentUri: result.uri,
            contentType: "topic" as const,
            authorDid: user.did,
            communityDid,
            queueReason: r.reason,
            matchedWords: r.matchedWords ?? null,
          }));
          await db.insert(moderationQueue).values(queueEntries);

          app.log.info(
            {
              topicUri: result.uri,
              reasons: spamResult.reasons.map((r) => r.reason),
              authorDid: user.did,
            },
            "Topic held for moderation",
          );
        }

        // Fire cross-posting in background (fire-and-forget, does not block response)
        // Only cross-post if content is approved (not held)
        if (!spamResult.held && (env.FEATURE_CROSSPOST_BLUESKY || env.FEATURE_CROSSPOST_FRONTPAGE)) {
          crossPostService.crossPostTopic({
            did: user.did,
            topicUri: result.uri,
            title,
            content,
            category,
            communityDid,
          }).catch((err: unknown) => {
            app.log.error({ err, topicUri: result.uri }, "Cross-posting failed");
          });
        }

        // Fire-and-forget: generate mention notifications from topic content
        if (!spamResult.held) {
          notificationService.notifyOnMentions({
            content,
            subjectUri: result.uri,
            actorDid: user.did,
            communityDid,
          }).catch((err: unknown) => {
            app.log.error({ err, topicUri: result.uri }, "Mention notification failed");
          });
        }

        return await reply.status(201).send({
          uri: result.uri,
          cid: result.cid,
          rkey,
          title,
          category,
          moderationStatus: contentModerationStatus,
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

      // Maturity filtering: resolve user's max allowed maturity level
      let userProfile: MaturityUser | undefined;
      if (request.user) {
        const userRows = await db
          .select({ declaredAge: users.declaredAge, maturityPref: users.maturityPref })
          .from(users)
          .where(eq(users.did, request.user.did));
        const row = userRows[0];
        if (row) {
          userProfile = row;
        }
      }

      // Fetch community age threshold
      const settingsRowsList = await db
        .select({ ageThreshold: communitySettings.ageThreshold })
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));
      const listAgeThreshold = settingsRowsList[0]?.ageThreshold ?? 16;

      const maxMaturity = resolveMaxMaturity(userProfile, listAgeThreshold);
      const allowed = allowedRatings(maxMaturity);

      // Slug→maturityRating lookup, populated by the category queries below
      const categoryMaturityMap = new Map<string, string>();

      if (env.COMMUNITY_MODE === "global") {
        // ---------------------------------------------------------------
        // Global mode: multi-community filtering
        // ---------------------------------------------------------------

        // Get all community settings with a valid communityDid
        const communityRows = await db
          .select({
            communityDid: communitySettings.communityDid,
            maturityRating: communitySettings.maturityRating,
          })
          .from(communitySettings)
          .where(isNotNull(communitySettings.communityDid));

        // Filter: NEVER show adult communities in global mode,
        // check mature communities against user's max maturity preference
        const allowedCommunityDids = communityRows
          .filter((c) => {
            if (!c.communityDid) return false;
            if (c.maturityRating === "adult") return false;
            return maturityAllows(maxMaturity, c.maturityRating);
          })
          .map((c) => c.communityDid as string);

        if (allowedCommunityDids.length === 0) {
          return reply.status(200).send({ topics: [], cursor: null });
        }

        // Restrict topics to allowed communities
        conditions.push(inArray(topics.communityDid, allowedCommunityDids));

        // Also filter by category maturity across all allowed communities
        const allowedCats = await db
          .select({ slug: categories.slug, maturityRating: categories.maturityRating })
          .from(categories)
          .where(
            and(
              inArray(categories.communityDid, allowedCommunityDids),
              inArray(categories.maturityRating, allowed),
            ),
          );

        const allowedSlugs = [...new Set(allowedCats.map((c) => c.slug))];
        // Build slug→maturityRating lookup for serialization
        for (const cat of allowedCats) {
          categoryMaturityMap.set(cat.slug, cat.maturityRating);
        }
        if (allowedSlugs.length === 0) {
          return reply.status(200).send({ topics: [], cursor: null });
        }
        conditions.push(inArray(topics.category, allowedSlugs));

        // Exclude content from accounts < 24h old in global aggregator feeds.
        // Uses a query-time check so trust auto-upgrades after 24h without a cron job:
        // exclude WHERE trust_status = 'new' AND author's account_created_at > now() - 24h.
        // Content from new accounts remains visible in specific community feeds (single mode).
        conditions.push(
          or(
            ne(topics.trustStatus, "new"),
            sql`NOT EXISTS (
              SELECT 1 FROM users u
              WHERE u.did = ${topics.authorDid}
              AND u.account_created_at > NOW() - INTERVAL '24 hours'
            )`,
          ),
        );
      } else {
        // ---------------------------------------------------------------
        // Single mode: filter by the one configured community
        // ---------------------------------------------------------------

        const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

        // Get category slugs matching allowed maturity levels
        const allowedCategories = await db
          .select({ slug: categories.slug, maturityRating: categories.maturityRating })
          .from(categories)
          .where(
            and(
              eq(categories.communityDid, communityDid),
              inArray(categories.maturityRating, allowed),
            ),
          );

        const allowedSlugs = allowedCategories.map((c) => c.slug);
        // Build slug→maturityRating lookup for serialization
        for (const cat of allowedCategories) {
          categoryMaturityMap.set(cat.slug, cat.maturityRating);
        }

        // If no categories are allowed, return empty result
        if (allowedSlugs.length === 0) {
          return reply.status(200).send({ topics: [], cursor: null });
        }

        // Filter topics to only those in allowed categories
        conditions.push(inArray(topics.category, allowedSlugs));
      }

      // Only show approved content in public listings
      conditions.push(eq(topics.moderationStatus, "approved"));

      // Block/mute filtering: load the authenticated user's preferences
      const { blockedDids, mutedDids } = await loadBlockMuteLists(request.user?.did, db);

      // Exclude topics by blocked authors
      if (blockedDids.length > 0) {
        conditions.push(notInArray(topics.authorDid, blockedDids));
      }

      // Category filter (explicit user filter, further narrows results)
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
      const serialized = resultRows.map((row) =>
        serializeTopic(row, categoryMaturityMap.get(row.category) ?? "safe"),
      );

      // Ozone label annotation: flag content from spam-labeled accounts
      const ozoneMap = new Map<string, string | null>();
      if (app.ozoneService) {
        const uniqueDids = [...new Set(serialized.map((t) => t.authorDid))];
        for (const did of uniqueDids) {
          const isSpam = await app.ozoneService.isSpamLabeled(did);
          ozoneMap.set(did, isSpam ? "spam" : null);
        }
      }

      // Load muted words for content filtering
      const communityDid = env.COMMUNITY_MODE === "single"
        ? env.COMMUNITY_DID
        : undefined;
      const mutedWords = await loadMutedWords(request.user?.did, communityDid, db);

      // Annotate muted authors and muted word matches (content still returned, just flagged)
      const mutedSet = new Set(mutedDids);
      const annotatedTopics = serialized.map((t) => ({
        ...t,
        isMuted: mutedSet.has(t.authorDid),
        isMutedWord: contentMatchesMutedWords(t.content, mutedWords, t.title),
        ozoneLabel: ozoneMap.get(t.authorDid) ?? null,
      }));

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastRow = resultRows[resultRows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor(lastRow.lastActivityAt.toISOString(), lastRow.uri);
        }
      }

      return reply.status(200).send({
        topics: annotatedTopics,
        cursor: nextCursor,
      });
    });

    // -------------------------------------------------------------------
    // GET /api/topics/by-rkey/:rkey (public, no auth)
    // -------------------------------------------------------------------

    app.get("/api/topics/by-rkey/:rkey", {
      schema: {
        tags: ["Topics"],
        summary: "Get a single topic by rkey (for SEO/metadata)",
        params: {
          type: "object",
          required: ["rkey"],
          properties: {
            rkey: { type: "string" },
          },
        },
        response: {
          200: topicJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { rkey } = request.params as { rkey: string };

      const rows = await db
        .select()
        .from(topics)
        .where(eq(topics.rkey, rkey));

      const row = rows[0];
      if (!row) {
        throw notFound("Topic not found");
      }

      // Look up the category maturity rating
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";
      const catRows = await db
        .select({ maturityRating: categories.maturityRating })
        .from(categories)
        .where(
          and(
            eq(categories.slug, row.category),
            eq(categories.communityDid, communityDid),
          ),
        );
      const categoryRating = catRows[0]?.maturityRating ?? "safe";

      return reply.status(200).send(serializeTopic(row, categoryRating));
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
          403: errorJsonSchema,
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

      // Maturity check: verify the topic's category is within the user's allowed level
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";
      const catRows = await db
        .select({ maturityRating: categories.maturityRating })
        .from(categories)
        .where(
          and(
            eq(categories.slug, row.category),
            eq(categories.communityDid, communityDid),
          ),
        );

      if (catRows.length === 0) {
        app.log.warn({ category: row.category, communityDid }, "Category not found for maturity check, defaulting to safe");
      }
      const categoryRating = catRows[0]?.maturityRating ?? "safe";

      let userProfile: MaturityUser | undefined;
      if (request.user) {
        const userRows = await db
          .select({ declaredAge: users.declaredAge, maturityPref: users.maturityPref })
          .from(users)
          .where(eq(users.did, request.user.did));
        userProfile = userRows[0] ?? undefined;
      }

      // Fetch community age threshold
      const singleSettingsRows = await db
        .select({ ageThreshold: communitySettings.ageThreshold })
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));
      const singleAgeThreshold = singleSettingsRows[0]?.ageThreshold ?? 16;

      const maxMaturity = resolveMaxMaturity(userProfile, singleAgeThreshold);
      if (!maturityAllows(maxMaturity, categoryRating)) {
        throw forbidden("Content restricted by maturity settings");
      }

      return reply.status(200).send(serializeTopic(row, categoryRating));
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
            labels: {
              type: "object",
              properties: {
                values: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["val"],
                    properties: { val: { type: "string" } },
                  },
                },
              },
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

      // Resolve labels for PDS record: use provided value, or fall back to existing
      const resolvedLabels = updates.labels !== undefined ? (updates.labels ?? null) : (topic.labels ?? null);

      // Build updated record for PDS
      const updatedRecord: Record<string, unknown> = {
        title: updates.title ?? topic.title,
        content: updates.content ?? topic.content,
        category: updates.category ?? topic.category,
        tags: updates.tags ?? topic.tags ?? [],
        community: topic.communityDid,
        createdAt: topic.createdAt.toISOString(),
        ...(resolvedLabels ? { labels: resolvedLabels } : {}),
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
        if (updates.labels !== undefined) dbUpdates.labels = updates.labels ?? null;

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

        // Best-effort cross-post deletion (fire-and-forget)
        crossPostService.deleteCrossPosts(decodedUri, user.did).catch((err: unknown) => {
          app.log.warn({ err, topicUri: decodedUri }, "Failed to delete cross-posts");
        });

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

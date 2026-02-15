import { eq, and, desc, sql } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { badRequest } from "../lib/api-errors.js";
import {
  communityFilterQuerySchema,
  updateCommunityFilterSchema,
  accountFilterQuerySchema,
  updateAccountFilterSchema,
  globalReportQuerySchema,
} from "../validation/global-filters.js";
import { communityFilters } from "../db/schema/community-filters.js";
import { accountFilters } from "../db/schema/account-filters.js";

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const errorJsonSchema = {
  type: "object" as const,
  properties: {
    error: { type: "string" as const },
  },
};

const communityFilterJsonSchema = {
  type: "object" as const,
  properties: {
    communityDid: { type: "string" as const },
    status: { type: "string" as const },
    adminDid: { type: ["string", "null"] as const },
    reason: { type: ["string", "null"] as const },
    reportCount: { type: "number" as const },
    lastReviewedAt: { type: ["string", "null"] as const },
    filteredBy: { type: ["string", "null"] as const },
    createdAt: { type: "string" as const, format: "date-time" as const },
    updatedAt: { type: "string" as const, format: "date-time" as const },
  },
};

const accountFilterJsonSchema = {
  type: "object" as const,
  properties: {
    id: { type: "number" as const },
    did: { type: "string" as const },
    communityDid: { type: "string" as const },
    status: { type: "string" as const },
    reason: { type: ["string", "null"] as const },
    reportCount: { type: "number" as const },
    banCount: { type: "number" as const },
    lastReviewedAt: { type: ["string", "null"] as const },
    filteredBy: { type: ["string", "null"] as const },
    createdAt: { type: "string" as const, format: "date-time" as const },
    updatedAt: { type: "string" as const, format: "date-time" as const },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeCommunityFilter(row: typeof communityFilters.$inferSelect) {
  return {
    communityDid: row.communityDid,
    status: row.status,
    adminDid: row.adminDid,
    reason: row.reason,
    reportCount: row.reportCount,
    lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
    filteredBy: row.filteredBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeAccountFilter(row: typeof accountFilters.$inferSelect) {
  return {
    id: row.id,
    did: row.did,
    communityDid: row.communityDid,
    status: row.status,
    reason: row.reason,
    reportCount: row.reportCount,
    banCount: row.banCount,
    lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
    filteredBy: row.filteredBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function encodeCursor(updatedAt: string, id: string | number): string {
  return Buffer.from(JSON.stringify({ updatedAt, id })).toString("base64");
}

function decodeCursor(cursor: string): { updatedAt: string; id: string | number } | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64").toString("utf-8"),
    ) as Record<string, unknown>;
    if (
      typeof decoded.updatedAt === "string" &&
      (typeof decoded.id === "string" || typeof decoded.id === "number")
    ) {
      return { updatedAt: decoded.updatedAt, id: decoded.id };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Global filter routes plugin
// ---------------------------------------------------------------------------

export function globalFilterRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db } = app;
    const requireOperator = app.requireOperator;

    // -------------------------------------------------------------------
    // GET /api/global/filters/communities
    // -------------------------------------------------------------------

    app.get("/api/global/filters/communities", {
      preHandler: [requireOperator],
      schema: {
        tags: ["Global Filters"],
        summary: "List community filter statuses",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "warned", "filtered"] },
            cursor: { type: "string" },
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              filters: { type: "array", items: communityFilterJsonSchema },
              cursor: { type: ["string", "null"] },
            },
          },
          400: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = communityFilterQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw badRequest("Invalid query parameters");
      }

      const { status, cursor, limit } = parsed.data;
      const conditions = [];

      if (status) {
        conditions.push(eq(communityFilters.status, status));
      }

      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${communityFilters.updatedAt}, ${communityFilters.communityDid}) < (${decoded.updatedAt}::timestamptz, ${decoded.id})`,
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const fetchLimit = limit + 1;

      const rows = await db
        .select()
        .from(communityFilters)
        .where(whereClause)
        .orderBy(desc(communityFilters.updatedAt))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastRow = resultRows[resultRows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor(
            lastRow.updatedAt.toISOString(),
            lastRow.communityDid,
          );
        }
      }

      return reply.status(200).send({
        filters: resultRows.map(serializeCommunityFilter),
        cursor: nextCursor,
      });
    });

    // -------------------------------------------------------------------
    // PUT /api/global/filters/communities/:did
    // -------------------------------------------------------------------

    app.put("/api/global/filters/communities/:did", {
      preHandler: [requireOperator],
      schema: {
        tags: ["Global Filters"],
        summary: "Update community filter (upsert)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["did"],
          properties: { did: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "warned", "filtered"] },
            reason: { type: "string", maxLength: 1000 },
            adminDid: { type: "string" },
          },
        },
        response: {
          200: communityFilterJsonSchema,
          400: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      // requireOperator guarantees request.user is set
      const user = request.user as NonNullable<typeof request.user>;

      const { did } = request.params as { did: string };
      const parsed = updateCommunityFilterSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid filter data");
      }

      const { status, reason, adminDid } = parsed.data;

      const upserted = await db
        .insert(communityFilters)
        .values({
          communityDid: did,
          status,
          reason,
          adminDid,
          filteredBy: user.did,
          lastReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: communityFilters.communityDid,
          set: {
            status,
            reason,
            ...(adminDid !== undefined ? { adminDid } : {}),
            filteredBy: user.did,
            lastReviewedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      const row = upserted[0];
      if (!row) {
        throw badRequest("Failed to upsert community filter");
      }

      app.log.info(
        { communityDid: did, status, operatorDid: user.did },
        "Community filter updated",
      );

      return reply.status(200).send(serializeCommunityFilter(row));
    });

    // -------------------------------------------------------------------
    // GET /api/global/filters/accounts
    // -------------------------------------------------------------------

    app.get("/api/global/filters/accounts", {
      preHandler: [requireOperator],
      schema: {
        tags: ["Global Filters"],
        summary: "List account filter statuses",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "warned", "filtered"] },
            communityDid: { type: "string" },
            cursor: { type: "string" },
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              filters: { type: "array", items: accountFilterJsonSchema },
              cursor: { type: ["string", "null"] },
            },
          },
          400: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = accountFilterQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw badRequest("Invalid query parameters");
      }

      const { status, communityDid, cursor, limit } = parsed.data;
      const conditions = [];

      if (status) {
        conditions.push(eq(accountFilters.status, status));
      }

      if (communityDid) {
        conditions.push(eq(accountFilters.communityDid, communityDid));
      }

      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded && typeof decoded.id === "number") {
          conditions.push(
            sql`(${accountFilters.updatedAt}, ${accountFilters.id}) < (${decoded.updatedAt}::timestamptz, ${decoded.id})`,
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const fetchLimit = limit + 1;

      const rows = await db
        .select()
        .from(accountFilters)
        .where(whereClause)
        .orderBy(desc(accountFilters.updatedAt))
        .limit(fetchLimit);

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastRow = resultRows[resultRows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor(
            lastRow.updatedAt.toISOString(),
            lastRow.id,
          );
        }
      }

      return reply.status(200).send({
        filters: resultRows.map(serializeAccountFilter),
        cursor: nextCursor,
      });
    });

    // -------------------------------------------------------------------
    // PUT /api/global/filters/accounts/:did
    // -------------------------------------------------------------------

    app.put("/api/global/filters/accounts/:did", {
      preHandler: [requireOperator],
      schema: {
        tags: ["Global Filters"],
        summary: "Update account filter (upsert, global level)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["did"],
          properties: { did: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "warned", "filtered"] },
            reason: { type: "string", maxLength: 1000 },
          },
        },
        response: {
          200: accountFilterJsonSchema,
          400: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      // requireOperator guarantees request.user is set
      const user = request.user as NonNullable<typeof request.user>;

      const { did } = request.params as { did: string };
      const parsed = updateAccountFilterSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid filter data");
      }

      const { status, reason } = parsed.data;
      const globalSentinel = "__global__";

      const upserted = await db
        .insert(accountFilters)
        .values({
          did,
          communityDid: globalSentinel,
          status,
          reason,
          filteredBy: user.did,
          lastReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [accountFilters.did, accountFilters.communityDid],
          set: {
            status,
            reason,
            filteredBy: user.did,
            lastReviewedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      const row = upserted[0];
      if (!row) {
        throw badRequest("Failed to upsert account filter");
      }

      app.log.info(
        { accountDid: did, status, operatorDid: user.did },
        "Account filter updated",
      );

      return reply.status(200).send(serializeAccountFilter(row));
    });

    // -------------------------------------------------------------------
    // GET /api/global/reports/communities
    // -------------------------------------------------------------------

    app.get("/api/global/reports/communities", {
      preHandler: [requireOperator],
      schema: {
        tags: ["Global Filters"],
        summary: "Most-reported communities (aggregate reports)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              communities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    communityDid: { type: "string" },
                    reportCount: { type: "number" },
                    topicCount: { type: "number" },
                  },
                },
              },
            },
          },
          400: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = globalReportQuerySchema.safeParse(request.query);
      const limit = parsed.success ? parsed.data.limit : 25;

      // Aggregate reports by communityDid, join topics for post count
      interface CommunityReportRow {
        community_did: string;
        report_count: number;
        topic_count: number;
      }

      const rows = await db.execute(sql`
        SELECT
          r.community_did,
          count(DISTINCT r.id)::int AS report_count,
          COALESCE(t.topic_count, 0)::int AS topic_count
        FROM reports r
        LEFT JOIN (
          SELECT community_did, count(*)::int AS topic_count
          FROM topics
          GROUP BY community_did
        ) t ON t.community_did = r.community_did
        GROUP BY r.community_did, t.topic_count
        ORDER BY report_count DESC
        LIMIT ${limit}
      `) as unknown as CommunityReportRow[];

      return reply.status(200).send({
        communities: rows.map((r) => ({
          communityDid: r.community_did,
          reportCount: r.report_count,
          topicCount: r.topic_count,
        })),
      });
    });

    done();
  };
}

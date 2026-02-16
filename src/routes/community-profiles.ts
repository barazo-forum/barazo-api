import { eq, and } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { notFound, badRequest } from "../lib/api-errors.js";
import { resolveProfile } from "../lib/resolve-profile.js";
import type { SourceProfile, CommunityOverride } from "../lib/resolve-profile.js";
import { updateCommunityProfileSchema } from "../validation/community-profiles.js";
import { users } from "../db/schema/users.js";
import { communityProfiles } from "../db/schema/community-profiles.js";

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const errorJsonSchema = {
  type: "object" as const,
  properties: {
    error: { type: "string" as const },
  },
};

const communityProfileJsonSchema = {
  type: "object" as const,
  properties: {
    did: { type: "string" as const },
    handle: { type: "string" as const },
    displayName: { type: ["string", "null"] as const },
    avatarUrl: { type: ["string", "null"] as const },
    bannerUrl: { type: ["string", "null"] as const },
    bio: { type: ["string", "null"] as const },
    communityDid: { type: "string" as const },
    hasOverride: { type: "boolean" as const },
    source: {
      type: "object" as const,
      properties: {
        displayName: { type: ["string", "null"] as const },
        avatarUrl: { type: ["string", "null"] as const },
        bannerUrl: { type: ["string", "null"] as const },
        bio: { type: ["string", "null"] as const },
      },
    },
  },
};

const successJsonSchema = {
  type: "object" as const,
  properties: {
    success: { type: "boolean" as const },
  },
};

// ---------------------------------------------------------------------------
// Community profile routes plugin
// ---------------------------------------------------------------------------

/**
 * Per-community profile override endpoints.
 *
 * - GET    /api/communities/:communityDid/profile -- resolved profile in community
 * - PUT    /api/communities/:communityDid/profile -- update overrides
 * - DELETE /api/communities/:communityDid/profile -- reset to source
 */
export function communityProfileRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, authMiddleware } = app;

    // -------------------------------------------------------------------
    // GET /api/communities/:communityDid/profile (auth required)
    // -------------------------------------------------------------------

    app.get(
      "/api/communities/:communityDid/profile",
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ["Community Profiles"],
          summary: "Get own resolved profile in a community",
          security: [{ bearerAuth: [] }],
          params: {
            type: "object",
            required: ["communityDid"],
            properties: {
              communityDid: { type: "string" },
            },
          },
          response: {
            200: communityProfileJsonSchema,
            401: errorJsonSchema,
            404: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user;
        if (!requestUser) {
          return reply
            .status(401)
            .send({ error: "Authentication required" });
        }

        const { communityDid } = request.params as { communityDid: string };
        const userDid = requestUser.did;

        // Fetch source profile from users table
        const userRows = await db
          .select()
          .from(users)
          .where(eq(users.did, userDid));

        const user = userRows[0];
        if (!user) {
          throw notFound("User not found");
        }

        // Fetch community override
        const overrideRows = await db
          .select()
          .from(communityProfiles)
          .where(
            and(
              eq(communityProfiles.did, userDid),
              eq(communityProfiles.communityDid, communityDid),
            ),
          );

        const overrideRow = overrideRows[0];

        const source: SourceProfile = {
          did: user.did,
          handle: user.handle,
          displayName: user.displayName ?? null,
          avatarUrl: user.avatarUrl ?? null,
          bannerUrl: user.bannerUrl ?? null,
          bio: user.bio ?? null,
        };

        const override: CommunityOverride | null = overrideRow
          ? {
              displayName: overrideRow.displayName ?? null,
              avatarUrl: overrideRow.avatarUrl ?? null,
              bannerUrl: overrideRow.bannerUrl ?? null,
              bio: overrideRow.bio ?? null,
            }
          : null;

        const resolved = resolveProfile(source, override);

        return reply.status(200).send({
          did: resolved.did,
          handle: resolved.handle,
          displayName: resolved.displayName,
          avatarUrl: resolved.avatarUrl,
          bannerUrl: resolved.bannerUrl,
          bio: resolved.bio,
          communityDid,
          hasOverride: overrideRow != null,
          source: {
            displayName: source.displayName,
            avatarUrl: source.avatarUrl,
            bannerUrl: source.bannerUrl,
            bio: source.bio,
          },
        });
      },
    );

    // -------------------------------------------------------------------
    // PUT /api/communities/:communityDid/profile (auth required)
    // -------------------------------------------------------------------

    app.put(
      "/api/communities/:communityDid/profile",
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ["Community Profiles"],
          summary: "Update per-community profile overrides",
          security: [{ bearerAuth: [] }],
          params: {
            type: "object",
            required: ["communityDid"],
            properties: {
              communityDid: { type: "string" },
            },
          },
          body: {
            type: "object",
            properties: {
              displayName: { type: ["string", "null"] },
              bio: { type: ["string", "null"] },
            },
          },
          response: {
            200: successJsonSchema,
            400: errorJsonSchema,
            401: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user;
        if (!requestUser) {
          return reply
            .status(401)
            .send({ error: "Authentication required" });
        }

        const { communityDid } = request.params as { communityDid: string };

        const parsed = updateCommunityProfileSchema.safeParse(request.body);
        if (!parsed.success) {
          throw badRequest("Invalid community profile data");
        }

        const now = new Date();
        const updateData: Record<string, unknown> = { updatedAt: now };

        if (parsed.data.displayName !== undefined) {
          updateData["displayName"] = parsed.data.displayName;
        }
        if (parsed.data.bio !== undefined) {
          updateData["bio"] = parsed.data.bio;
        }

        // Upsert: use composite key (did, communityDid)
        await db
          .insert(communityProfiles)
          .values({
            did: requestUser.did,
            communityDid,
            ...parsed.data,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [communityProfiles.did, communityProfiles.communityDid],
            set: updateData,
          });

        return reply.status(200).send({ success: true });
      },
    );

    // -------------------------------------------------------------------
    // DELETE /api/communities/:communityDid/profile (auth required)
    // -------------------------------------------------------------------

    app.delete(
      "/api/communities/:communityDid/profile",
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ["Community Profiles"],
          summary: "Reset community profile to source (delete override)",
          security: [{ bearerAuth: [] }],
          params: {
            type: "object",
            required: ["communityDid"],
            properties: {
              communityDid: { type: "string" },
            },
          },
          response: {
            204: { type: "null" },
            401: errorJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const requestUser = request.user;
        if (!requestUser) {
          return reply
            .status(401)
            .send({ error: "Authentication required" });
        }

        const { communityDid } = request.params as { communityDid: string };

        await db
          .delete(communityProfiles)
          .where(
            and(
              eq(communityProfiles.did, requestUser.did),
              eq(communityProfiles.communityDid, communityDid),
            ),
          );

        return reply.status(204).send();
      },
    );

    done();
  };
}

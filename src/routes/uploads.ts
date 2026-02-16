import type { FastifyPluginCallback } from "fastify";
import sharp from "sharp";
import { badRequest } from "../lib/api-errors.js";
import { communityProfiles } from "../db/schema/community-profiles.js";

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const AVATAR_SIZE = { width: 400, height: 400 };
const BANNER_SIZE = { width: 1500, height: 500 };

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const errorJsonSchema = {
  type: "object" as const,
  properties: {
    error: { type: "string" as const },
  },
};

const uploadResponseJsonSchema = {
  type: "object" as const,
  properties: {
    url: { type: "string" as const },
  },
};

const paramsJsonSchema = {
  type: "object" as const,
  required: ["communityDid"],
  properties: {
    communityDid: { type: "string" as const },
  },
};

// ---------------------------------------------------------------------------
// Upload routes plugin
// ---------------------------------------------------------------------------

/**
 * Avatar and banner upload endpoints for community profiles.
 *
 * - POST /api/communities/:communityDid/profile/avatar
 * - POST /api/communities/:communityDid/profile/banner
 */
export function uploadRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, authMiddleware, storage, env } = app;
    const maxSize = env.UPLOAD_MAX_SIZE_BYTES;

    // -----------------------------------------------------------------
    // POST /api/communities/:communityDid/profile/avatar
    // -----------------------------------------------------------------

    app.post(
      "/api/communities/:communityDid/profile/avatar",
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ["Uploads"],
          summary: "Upload community profile avatar",
          security: [{ bearerAuth: [] }],
          consumes: ["multipart/form-data"],
          params: paramsJsonSchema,
          response: {
            200: uploadResponseJsonSchema,
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

        const file = await request.file();
        if (!file) throw badRequest("No file uploaded");
        if (!ALLOWED_MIMES.has(file.mimetype)) {
          throw badRequest("File must be JPEG, PNG, WebP, or GIF");
        }

        const buffer = await file.toBuffer();
        if (buffer.length > maxSize) {
          throw badRequest(
            `File too large (max ${String(Math.round(maxSize / 1024 / 1024))}MB)`,
          );
        }

        const processed = await sharp(buffer)
          .resize(AVATAR_SIZE.width, AVATAR_SIZE.height, { fit: "cover" })
          .webp({ quality: 85 })
          .toBuffer();

        const url = await storage.store(processed, "image/webp", "avatars");

        const now = new Date();
        await db
          .insert(communityProfiles)
          .values({
            did: requestUser.did,
            communityDid,
            avatarUrl: url,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [communityProfiles.did, communityProfiles.communityDid],
            set: { avatarUrl: url, updatedAt: now },
          });

        return reply.status(200).send({ url });
      },
    );

    // -----------------------------------------------------------------
    // POST /api/communities/:communityDid/profile/banner
    // -----------------------------------------------------------------

    app.post(
      "/api/communities/:communityDid/profile/banner",
      {
        preHandler: [authMiddleware.requireAuth],
        schema: {
          tags: ["Uploads"],
          summary: "Upload community profile banner",
          security: [{ bearerAuth: [] }],
          consumes: ["multipart/form-data"],
          params: paramsJsonSchema,
          response: {
            200: uploadResponseJsonSchema,
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

        const file = await request.file();
        if (!file) throw badRequest("No file uploaded");
        if (!ALLOWED_MIMES.has(file.mimetype)) {
          throw badRequest("File must be JPEG, PNG, WebP, or GIF");
        }

        const buffer = await file.toBuffer();
        if (buffer.length > maxSize) {
          throw badRequest(
            `File too large (max ${String(Math.round(maxSize / 1024 / 1024))}MB)`,
          );
        }

        const processed = await sharp(buffer)
          .resize(BANNER_SIZE.width, BANNER_SIZE.height, { fit: "cover" })
          .webp({ quality: 85 })
          .toBuffer();

        const url = await storage.store(processed, "image/webp", "banners");

        const now = new Date();
        await db
          .insert(communityProfiles)
          .values({
            did: requestUser.did,
            communityDid,
            bannerUrl: url,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [communityProfiles.did, communityProfiles.communityDid],
            set: { bannerUrl: url, updatedAt: now },
          });

        return reply.status(200).send({ url });
      },
    );

    done();
  };
}

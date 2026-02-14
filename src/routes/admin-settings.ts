import { eq } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { notFound, badRequest } from "../lib/api-errors.js";
import { isMaturityLowerThan } from "../lib/maturity.js";
import { updateSettingsSchema } from "../validation/admin-settings.js";
import { communitySettings } from "../db/schema/community-settings.js";
import { categories } from "../db/schema/categories.js";

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const settingsJsonSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const },
    initialized: { type: "boolean" as const },
    communityDid: { type: ["string", "null"] as const },
    adminDid: { type: ["string", "null"] as const },
    communityName: { type: "string" as const },
    maturityRating: { type: "string" as const, enum: ["safe", "mature", "adult"] },
    reactionSet: { type: "array" as const, items: { type: "string" as const } },
    createdAt: { type: "string" as const, format: "date-time" as const },
    updatedAt: { type: "string" as const, format: "date-time" as const },
  },
};

const errorJsonSchema = {
  type: "object" as const,
  properties: {
    error: { type: "string" as const },
    message: { type: "string" as const },
    statusCode: { type: "integer" as const },
  },
};

const conflictJsonSchema = {
  type: "object" as const,
  properties: {
    error: { type: "string" as const },
    message: { type: "string" as const },
    statusCode: { type: "integer" as const },
    details: {
      type: "object" as const,
      properties: {
        categories: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const },
              slug: { type: "string" as const },
              name: { type: "string" as const },
              maturityRating: { type: "string" as const },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeSettings(row: typeof communitySettings.$inferSelect) {
  return {
    id: row.id,
    initialized: row.initialized,
    communityDid: row.communityDid ?? null,
    adminDid: row.adminDid ?? null,
    communityName: row.communityName,
    maturityRating: row.maturityRating,
    reactionSet: row.reactionSet,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Admin settings routes plugin
// ---------------------------------------------------------------------------

/**
 * Admin settings routes for the Barazo forum.
 *
 * - GET  /api/admin/settings  -- Get community settings
 * - PUT  /api/admin/settings  -- Update community settings
 */
export function adminSettingsRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db } = app;
    const requireAdmin = app.requireAdmin;

    // -------------------------------------------------------------------
    // GET /api/admin/settings (admin only)
    // -------------------------------------------------------------------

    app.get("/api/admin/settings", {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Admin"],
        summary: "Get community settings",
        security: [{ bearerAuth: [] }],
        response: {
          200: settingsJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (_request, reply) => {
      const rows = await db
        .select()
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const row = rows[0];
      if (!row) {
        throw notFound("Community settings not found");
      }

      return reply.status(200).send(serializeSettings(row));
    });

    // -------------------------------------------------------------------
    // PUT /api/admin/settings (admin only)
    // -------------------------------------------------------------------

    app.put("/api/admin/settings", {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Admin"],
        summary: "Update community settings",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            communityName: { type: "string", minLength: 1, maxLength: 100 },
            maturityRating: { type: "string", enum: ["safe", "mature", "adult"] },
            reactionSet: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 30 },
              minItems: 1,
            },
          },
        },
        response: {
          200: settingsJsonSchema,
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
          409: conflictJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = updateSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid settings data");
      }

      const updates = parsed.data;

      // Require at least one field to update
      if (
        updates.communityName === undefined &&
        updates.maturityRating === undefined &&
        updates.reactionSet === undefined
      ) {
        throw badRequest("At least one field must be provided");
      }

      // Fetch current settings
      const rows = await db
        .select()
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const current = rows[0];
      if (!current) {
        throw notFound("Community settings not found");
      }

      // If the community maturity floor is being raised, check for incompatible
      // categories. Lowering the floor (relaxing constraints) is always allowed
      // because existing categories remain above the new, lower threshold.
      if (
        updates.maturityRating !== undefined &&
        updates.maturityRating !== current.maturityRating
      ) {
        const newRating = updates.maturityRating;
        const currentRating = current.maturityRating;

        if (isMaturityLowerThan(currentRating, newRating)) {
          // Raising maturity: find categories below the new threshold
          const communityDid = current.communityDid ?? "";
          const allCategories = await db
            .select()
            .from(categories)
            .where(eq(categories.communityDid, communityDid));

          // Filter in application code since maturity comparison is enum-based
          const belowThreshold = allCategories.filter((cat) =>
            isMaturityLowerThan(cat.maturityRating, newRating),
          );

          if (belowThreshold.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: `Cannot raise community maturity to "${newRating}": ${String(belowThreshold.length)} categories have a lower maturity rating. Update these categories first.`,
              statusCode: 409,
              details: {
                categories: belowThreshold.map((cat) => ({
                  id: cat.id,
                  slug: cat.slug,
                  name: cat.name,
                  maturityRating: cat.maturityRating,
                })),
              },
            });
          }
        }
      }

      // Build update set
      const dbUpdates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (updates.communityName !== undefined) {
        dbUpdates.communityName = updates.communityName;
      }
      if (updates.maturityRating !== undefined) {
        dbUpdates.maturityRating = updates.maturityRating;
      }
      if (updates.reactionSet !== undefined) {
        dbUpdates.reactionSet = updates.reactionSet;
      }

      const updated = await db
        .update(communitySettings)
        .set(dbUpdates)
        .where(eq(communitySettings.id, "default"))
        .returning();

      const updatedRow = updated[0];
      if (!updatedRow) {
        throw notFound("Community settings not found after update");
      }

      // TODO: Write to admin_audit_log table when implemented (standards/backend.md audit logging)
      app.log.info(
        {
          event: "settings_updated",
          did: request.user?.did,
          changes: Object.keys(parsed.data),
        },
        "Community settings updated",
      );

      return reply.status(200).send(serializeSettings(updatedRow));
    });

    done();
  };
}

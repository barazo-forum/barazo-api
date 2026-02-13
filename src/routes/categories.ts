import { eq, and, count } from "drizzle-orm";
import type { FastifyPluginCallback } from "fastify";
import { notFound, badRequest, conflict } from "../lib/api-errors.js";
import { isMaturityLowerThan } from "../lib/maturity.js";
import {
  createCategorySchema,
  updateCategorySchema,
  updateMaturitySchema,
  categoryQuerySchema,
} from "../validation/categories.js";
import { categories } from "../db/schema/categories.js";
import { communitySettings } from "../db/schema/community-settings.js";
import { topics } from "../db/schema/topics.js";

/**
 * Serialize a category row from the DB into a JSON-safe response object.
 * Converts Date fields to ISO strings.
 */
function serializeCategory(row: typeof categories.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    parentId: row.parentId ?? null,
    sortOrder: row.sortOrder,
    communityDid: row.communityDid,
    maturityRating: row.maturityRating,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface CategoryTreeNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  communityDid: string;
  maturityRating: string;
  createdAt: string;
  updatedAt: string;
  children: CategoryTreeNode[];
}

/**
 * Build a tree structure from a flat list of categories.
 * Returns only root-level categories (parentId === null), with children nested.
 */
function buildCategoryTree(rows: Array<typeof categories.$inferSelect>): CategoryTreeNode[] {
  const serialized = rows.map((row) => ({
    ...serializeCategory(row),
    children: [] as CategoryTreeNode[],
  }));

  const byId = new Map<string, CategoryTreeNode>();
  for (const node of serialized) {
    byId.set(node.id, node);
  }

  const roots: CategoryTreeNode[] = [];
  for (const node of serialized) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan -- treat as root
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Detect circular reference: check if setting `categoryId`'s parent to
 * `newParentId` would create a cycle. Walks up the ancestor chain of
 * `newParentId` to see if it reaches `categoryId`.
 */
function wouldCreateCycle(
  categoryId: string,
  newParentId: string,
  allCategories: Array<{ id: string; parentId: string | null }>,
): boolean {
  // Self-reference
  if (categoryId === newParentId) {
    return true;
  }

  const byId = new Map<string, { id: string; parentId: string | null }>();
  for (const cat of allCategories) {
    byId.set(cat.id, cat);
  }

  // Walk up from newParentId
  let current = newParentId;
  const visited = new Set<string>();
  while (current) {
    if (current === categoryId) {
      return true;
    }
    if (visited.has(current)) {
      // Already in a cycle (should not happen but protect against it)
      return true;
    }
    visited.add(current);
    const node = byId.get(current);
    if (!node?.parentId) {
      break;
    }
    current = node.parentId;
  }

  return false;
}

/**
 * Generate a random ID for a new category.
 */
function generateId(): string {
  return `cat-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const categoryJsonSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const },
    slug: { type: "string" as const },
    name: { type: "string" as const },
    description: { type: ["string", "null"] as const },
    parentId: { type: ["string", "null"] as const },
    sortOrder: { type: "integer" as const },
    communityDid: { type: "string" as const },
    maturityRating: { type: "string" as const, enum: ["safe", "mature", "adult"] },
    createdAt: { type: "string" as const, format: "date-time" as const },
    updatedAt: { type: "string" as const, format: "date-time" as const },
  },
};

const categoryWithTopicCountJsonSchema = {
  type: "object" as const,
  properties: {
    ...categoryJsonSchema.properties,
    topicCount: { type: "integer" as const },
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

// ---------------------------------------------------------------------------
// Category routes plugin
// ---------------------------------------------------------------------------

/**
 * Category routes for the Barazo forum.
 *
 * Public:
 * - GET    /api/categories           -- List categories (tree structure)
 * - GET    /api/categories/:slug     -- Get a single category
 *
 * Admin:
 * - POST   /api/admin/categories          -- Create a category
 * - PUT    /api/admin/categories/:id      -- Update a category
 * - DELETE /api/admin/categories/:id      -- Delete a category
 * - PUT    /api/admin/categories/:id/maturity -- Update maturity rating
 */
export function categoryRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, env, authMiddleware, requireAdmin } = app;

    // -------------------------------------------------------------------
    // GET /api/categories (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get("/api/categories", {
      preHandler: [authMiddleware.optionalAuth],
      schema: {
        tags: ["Categories"],
        summary: "List categories as a tree structure",
        querystring: {
          type: "object",
          properties: {
            parentId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
            properties: {
              categories: { type: "array" },
            },
          },
        },
      },
    }, async (request, reply) => {
      const parsed = categoryQuerySchema.safeParse(request.query);
      const parentId = parsed.success ? parsed.data.parentId : undefined;
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      const conditions = [eq(categories.communityDid, communityDid)];
      if (parentId !== undefined) {
        conditions.push(eq(categories.parentId, parentId));
      }

      const rows = await db
        .select()
        .from(categories)
        .where(and(...conditions));

      const tree = buildCategoryTree(rows);

      return reply.status(200).send({ categories: tree });
    });

    // -------------------------------------------------------------------
    // GET /api/categories/:slug (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get("/api/categories/:slug", {
      preHandler: [authMiddleware.optionalAuth],
      schema: {
        tags: ["Categories"],
        summary: "Get a single category by slug",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string" },
          },
        },
        response: {
          200: categoryWithTopicCountJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      const rows = await db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.slug, slug),
            eq(categories.communityDid, communityDid),
          ),
        );

      const row = rows[0];
      if (!row) {
        throw notFound("Category not found");
      }

      // Count topics in this category
      const topicCountResult = await db
        .select({ count: count() })
        .from(topics)
        .where(eq(topics.category, slug));

      const topicCount = topicCountResult[0]?.count ?? 0;

      return reply.status(200).send({
        ...serializeCategory(row),
        topicCount,
      });
    });

    // -------------------------------------------------------------------
    // POST /api/admin/categories (admin required)
    // -------------------------------------------------------------------

    app.post("/api/admin/categories", {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Categories (Admin)"],
        summary: "Create a new category",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["name", "slug"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            slug: { type: "string", minLength: 1, maxLength: 50 },
            description: { type: "string", maxLength: 500 },
            parentId: { type: "string" },
            sortOrder: { type: "integer", minimum: 0 },
            maturityRating: { type: "string", enum: ["safe", "mature", "adult"] },
          },
        },
        response: {
          201: categoryJsonSchema,
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          409: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid category data");
      }

      const { name, slug, description, parentId, sortOrder, maturityRating } = parsed.data;
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      // Fetch community settings for maturity default
      const settingsRows = await db
        .select()
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const settings = settingsRows[0];
      const communityDefault = settings?.maturityRating ?? "safe";
      const effectiveMaturity = maturityRating ?? communityDefault;

      // Validate: maturity cannot be lower than community default
      if (isMaturityLowerThan(effectiveMaturity, communityDefault)) {
        throw badRequest(
          `Category maturity rating "${effectiveMaturity}" cannot be lower than community default "${communityDefault}"`,
        );
      }

      // Check slug uniqueness within community
      const existingSlug = await db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.slug, slug),
            eq(categories.communityDid, communityDid),
          ),
        );

      if (existingSlug.length > 0) {
        throw conflict(`Category with slug "${slug}" already exists in this community`);
      }

      // Validate parentId if provided
      if (parentId !== undefined) {
        const parentRows = await db
          .select()
          .from(categories)
          .where(eq(categories.id, parentId));

        if (parentRows.length === 0) {
          throw badRequest(`Parent category "${parentId}" does not exist`);
        }
      }

      const now = new Date();
      const id = generateId();

      const inserted = await db
        .insert(categories)
        .values({
          id,
          slug,
          name,
          description: description ?? null,
          parentId: parentId ?? null,
          sortOrder: sortOrder ?? 0,
          communityDid,
          maturityRating: effectiveMaturity,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const created = inserted[0];
      if (!created) {
        throw badRequest("Failed to create category");
      }

      app.log.info(
        { categoryId: id, slug, adminDid: request.user?.did },
        "Category created",
      );

      return reply.status(201).send(serializeCategory(created));
    });

    // -------------------------------------------------------------------
    // PUT /api/admin/categories/:id (admin required)
    // -------------------------------------------------------------------

    app.put("/api/admin/categories/:id", {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Categories (Admin)"],
        summary: "Update a category",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            slug: { type: "string", minLength: 1, maxLength: 50 },
            description: { type: "string", maxLength: 500 },
            parentId: { type: "string" },
            sortOrder: { type: "integer", minimum: 0 },
            maturityRating: { type: "string", enum: ["safe", "mature", "adult"] },
          },
        },
        response: {
          200: categoryJsonSchema,
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
          409: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };

      // Find existing category
      const existingRows = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id));

      const existing = existingRows[0];
      if (!existing) {
        throw notFound("Category not found");
      }

      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid update data");
      }

      const updates = parsed.data;
      const communityDid = env.COMMUNITY_DID ?? "did:plc:placeholder";

      // Fetch community settings for maturity validation
      const settingsRows = await db
        .select()
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const settings = settingsRows[0];
      const communityDefault = settings?.maturityRating ?? "safe";

      // Validate maturity rating if provided
      if (updates.maturityRating !== undefined) {
        if (isMaturityLowerThan(updates.maturityRating, communityDefault)) {
          throw badRequest(
            `Category maturity rating "${updates.maturityRating}" cannot be lower than community default "${communityDefault}"`,
          );
        }
      }

      // Validate slug uniqueness if slug is being changed
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const existingSlug = await db
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.slug, updates.slug),
              eq(categories.communityDid, communityDid),
            ),
          );

        if (existingSlug.length > 0) {
          throw conflict(`Category with slug "${updates.slug}" already exists in this community`);
        }
      }

      // Validate parentId if provided
      if (updates.parentId !== undefined) {
        // Check parent exists
        const parentRows = await db
          .select()
          .from(categories)
          .where(eq(categories.id, updates.parentId));

        if (parentRows.length === 0) {
          throw badRequest(`Parent category "${updates.parentId}" does not exist`);
        }

        // Check for circular references
        // Self-reference is the simplest case
        if (updates.parentId === id) {
          throw badRequest("Category cannot be its own parent");
        }

        // Fetch all categories to check for cycles
        const allCats = await db
          .select()
          .from(categories)
          .where(eq(categories.communityDid, communityDid));

        if (wouldCreateCycle(id, updates.parentId, allCats)) {
          throw badRequest("Setting this parent would create a circular reference");
        }
      }

      // Build update set
      const dbUpdates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.slug !== undefined) dbUpdates.slug = updates.slug;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.parentId !== undefined) dbUpdates.parentId = updates.parentId;
      if (updates.sortOrder !== undefined) dbUpdates.sortOrder = updates.sortOrder;
      if (updates.maturityRating !== undefined) dbUpdates.maturityRating = updates.maturityRating;

      const updated = await db
        .update(categories)
        .set(dbUpdates)
        .where(eq(categories.id, id))
        .returning();

      const updatedRow = updated[0];
      if (!updatedRow) {
        throw notFound("Category not found after update");
      }

      app.log.info(
        { categoryId: id, updates: Object.keys(updates), adminDid: request.user?.did },
        "Category updated",
      );

      return reply.status(200).send(serializeCategory(updatedRow));
    });

    // -------------------------------------------------------------------
    // DELETE /api/admin/categories/:id (admin required)
    // -------------------------------------------------------------------

    app.delete("/api/admin/categories/:id", {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Categories (Admin)"],
        summary: "Delete a category",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        response: {
          204: { type: "null" },
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
          409: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };

      // Find existing category
      const existingRows = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id));

      const existing = existingRows[0];
      if (!existing) {
        throw notFound("Category not found");
      }

      // Check if category has topics
      const topicCountResult = await db
        .select({ count: count() })
        .from(topics)
        .where(eq(topics.category, existing.slug));

      const topicCount = topicCountResult[0]?.count ?? 0;
      if (topicCount > 0) {
        throw conflict(
          `Cannot delete category: it has ${String(topicCount)} topic(s). Move or delete them first.`,
        );
      }

      // Check if category has children
      const childRows = await db
        .select()
        .from(categories)
        .where(eq(categories.parentId, id));

      if (childRows.length > 0) {
        throw conflict(
          `Cannot delete category: it has ${String(childRows.length)} child category/categories. Move or delete them first.`,
        );
      }

      // Delete the category
      await db
        .delete(categories)
        .where(eq(categories.id, id));

      app.log.info(
        { categoryId: id, slug: existing.slug, adminDid: request.user?.did },
        "Category deleted",
      );

      return reply.status(204).send();
    });

    // -------------------------------------------------------------------
    // PUT /api/admin/categories/:id/maturity (admin required)
    // -------------------------------------------------------------------

    app.put("/api/admin/categories/:id/maturity", {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Categories (Admin)"],
        summary: "Update category maturity rating",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["maturityRating"],
          properties: {
            maturityRating: { type: "string", enum: ["safe", "mature", "adult"] },
          },
        },
        response: {
          200: categoryJsonSchema,
          400: errorJsonSchema,
          401: errorJsonSchema,
          403: errorJsonSchema,
          404: errorJsonSchema,
        },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };

      const parsed = updateMaturitySchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("Invalid maturity rating");
      }

      const { maturityRating } = parsed.data;

      // Find existing category
      const existingRows = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id));

      const existing = existingRows[0];
      if (!existing) {
        throw notFound("Category not found");
      }

      // Fetch community settings for maturity validation
      const settingsRows = await db
        .select()
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const settings = settingsRows[0];
      const communityDefault = settings?.maturityRating ?? "safe";

      // Validate: cannot be lower than community default
      if (isMaturityLowerThan(maturityRating, communityDefault)) {
        throw badRequest(
          `Category maturity rating "${maturityRating}" cannot be lower than community default "${communityDefault}"`,
        );
      }

      const updated = await db
        .update(categories)
        .set({
          maturityRating,
          updatedAt: new Date(),
        })
        .where(eq(categories.id, id))
        .returning();

      const updatedRow = updated[0];
      if (!updatedRow) {
        throw notFound("Category not found after update");
      }

      app.log.info(
        { categoryId: id, maturityRating, adminDid: request.user?.did },
        "Category maturity rating updated",
      );

      return reply.status(200).send(serializeCategory(updatedRow));
    });

    done();
  };
}

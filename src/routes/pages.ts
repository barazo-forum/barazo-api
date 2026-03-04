import { randomUUID } from 'node:crypto'
import { requireCommunityDid } from '../middleware/community-resolver.js'
import { eq, and } from 'drizzle-orm'
import type { FastifyPluginCallback } from 'fastify'
import { notFound, badRequest, conflict, errorResponseSchema } from '../lib/api-errors.js'
import { createPageSchema, updatePageSchema } from '../validation/pages.js'
import { pages } from '../db/schema/pages.js'

/**
 * Serialize a page row from the DB into a JSON-safe response object.
 * Converts Date fields to ISO strings.
 */
function serializePage(row: typeof pages.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    status: row.status,
    metaDescription: row.metaDescription ?? null,
    parentId: row.parentId ?? null,
    sortOrder: row.sortOrder,
    communityDid: row.communityDid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

interface PageTreeNode {
  id: string
  slug: string
  title: string
  content: string
  status: string
  metaDescription: string | null
  parentId: string | null
  sortOrder: number
  communityDid: string
  createdAt: string
  updatedAt: string
  children: PageTreeNode[]
}

/**
 * Build a tree structure from a flat list of pages.
 * Returns only root-level pages (parentId === null), with children nested.
 * Sorts children by sortOrder.
 */
function buildPageTree(rows: Array<typeof pages.$inferSelect>): PageTreeNode[] {
  const serialized = rows.map((row) => ({
    ...serializePage(row),
    children: [] as PageTreeNode[],
  }))

  const byId = new Map<string, PageTreeNode>()
  for (const node of serialized) {
    byId.set(node.id, node)
  }

  const roots: PageTreeNode[] = []
  for (const node of serialized) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId)
      if (parent) {
        parent.children.push(node)
      } else {
        // Orphan -- treat as root
        roots.push(node)
      }
    } else {
      roots.push(node)
    }
  }

  // Sort children by sortOrder
  const sortChildren = (nodes: PageTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder)
    for (const node of nodes) {
      sortChildren(node.children)
    }
  }
  sortChildren(roots)
  roots.sort((a, b) => a.sortOrder - b.sortOrder)

  return roots
}

/**
 * Detect circular reference: check if setting `pageId`'s parent to
 * `newParentId` would create a cycle. Walks up the ancestor chain of
 * `newParentId` to see if it reaches `pageId`.
 */
function wouldCreateCycle(
  pageId: string,
  newParentId: string,
  allPages: Array<{ id: string; parentId: string | null }>
): boolean {
  // Self-reference
  if (pageId === newParentId) {
    return true
  }

  const byId = new Map<string, { id: string; parentId: string | null }>()
  for (const page of allPages) {
    byId.set(page.id, page)
  }

  // Walk up from newParentId
  let current = newParentId
  const visited = new Set<string>()
  while (current) {
    if (current === pageId) {
      return true
    }
    if (visited.has(current)) {
      // Already in a cycle (should not happen but protect against it)
      return true
    }
    visited.add(current)
    const node = byId.get(current)
    if (!node?.parentId) {
      break
    }
    current = node.parentId
  }

  return false
}

/**
 * Generate a random ID for a new page.
 */
function generateId(): string {
  return `page-${randomUUID()}`
}

// ---------------------------------------------------------------------------
// OpenAPI JSON Schema definitions
// ---------------------------------------------------------------------------

const pageJsonSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    slug: { type: 'string' as const },
    title: { type: 'string' as const },
    content: { type: 'string' as const },
    status: { type: 'string' as const, enum: ['draft', 'published'] },
    metaDescription: { type: ['string', 'null'] as const },
    parentId: { type: ['string', 'null'] as const },
    sortOrder: { type: 'integer' as const },
    communityDid: { type: 'string' as const },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
    updatedAt: { type: 'string' as const, format: 'date-time' as const },
  },
}

// ---------------------------------------------------------------------------
// Page routes plugin
// ---------------------------------------------------------------------------

/**
 * Page routes for the Barazo forum (Admin Pages / Mini-CMS).
 *
 * Public:
 * - GET    /api/pages           -- List published pages (tree structure, content snippets)
 * - GET    /api/pages/:slug     -- Get a single published page (full content)
 *
 * Admin:
 * - GET    /api/admin/pages          -- List ALL pages (tree structure, including drafts)
 * - GET    /api/admin/pages/:id      -- Get a single page by ID (full content)
 * - POST   /api/admin/pages          -- Create a page
 * - PUT    /api/admin/pages/:id      -- Update a page
 * - DELETE /api/admin/pages/:id      -- Delete a page
 */
export function pageRoutes(): FastifyPluginCallback {
  return (app, _opts, done) => {
    const { db, authMiddleware, requireAdmin } = app

    // -------------------------------------------------------------------
    // GET /api/pages (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get(
      '/api/pages',
      {
        preHandler: [authMiddleware.optionalAuth],
        schema: {
          tags: ['Pages'],
          summary: 'List published pages as a tree structure',
          response: {
            200: {
              type: 'object',
              additionalProperties: true,
              properties: {
                pages: { type: 'array' },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const communityDid = requireCommunityDid(request)

        const rows = await db
          .select()
          .from(pages)
          .where(and(eq(pages.status, 'published'), eq(pages.communityDid, communityDid)))

        const tree = buildPageTree(rows)

        // Replace full content with snippets (first 200 chars)
        const truncateContent = (nodes: PageTreeNode[]): PageTreeNode[] => {
          return nodes.map((node) => ({
            ...node,
            content: node.content.length > 200 ? node.content.slice(0, 200) + '...' : node.content,
            children: truncateContent(node.children),
          }))
        }

        return reply.status(200).send({ pages: truncateContent(tree) })
      }
    )

    // -------------------------------------------------------------------
    // GET /api/pages/:slug (public, optionalAuth)
    // -------------------------------------------------------------------

    app.get(
      '/api/pages/:slug',
      {
        preHandler: [authMiddleware.optionalAuth],
        schema: {
          tags: ['Pages'],
          summary: 'Get a single published page by slug',
          params: {
            type: 'object',
            required: ['slug'],
            properties: {
              slug: { type: 'string' },
            },
          },
          response: {
            200: pageJsonSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { slug } = request.params as { slug: string }
        const communityDid = requireCommunityDid(request)

        const rows = await db
          .select()
          .from(pages)
          .where(
            and(
              eq(pages.slug, slug),
              eq(pages.communityDid, communityDid),
              eq(pages.status, 'published')
            )
          )

        const row = rows[0]
        if (!row) {
          throw notFound('Page not found')
        }

        return reply.status(200).send(serializePage(row))
      }
    )

    // -------------------------------------------------------------------
    // GET /api/admin/pages (admin required)
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/pages',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Pages (Admin)'],
          summary: 'List all pages as a tree structure (including drafts)',
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: 'object',
              additionalProperties: true,
              properties: {
                pages: { type: 'array' },
              },
            },
            401: errorResponseSchema,
            403: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const communityDid = requireCommunityDid(request)

        const rows = await db.select().from(pages).where(eq(pages.communityDid, communityDid))

        const tree = buildPageTree(rows)

        return reply.status(200).send({ pages: tree })
      }
    )

    // -------------------------------------------------------------------
    // GET /api/admin/pages/:id (admin required)
    // -------------------------------------------------------------------

    app.get(
      '/api/admin/pages/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Pages (Admin)'],
          summary: 'Get a single page by ID (including drafts)',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
            },
          },
          response: {
            200: pageJsonSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string }

        const rows = await db.select().from(pages).where(eq(pages.id, id))

        const row = rows[0]
        if (!row) {
          throw notFound('Page not found')
        }

        return reply.status(200).send(serializePage(row))
      }
    )

    // -------------------------------------------------------------------
    // POST /api/admin/pages (admin required)
    // -------------------------------------------------------------------

    app.post(
      '/api/admin/pages',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Pages (Admin)'],
          summary: 'Create a new page',
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            required: ['title', 'slug'],
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              slug: { type: 'string', minLength: 1, maxLength: 100 },
              content: { type: 'string', maxLength: 100000 },
              status: { type: 'string', enum: ['draft', 'published'] },
              metaDescription: { type: ['string', 'null'], maxLength: 320 },
              parentId: { type: ['string', 'null'] },
              sortOrder: { type: 'integer', minimum: 0 },
            },
          },
          response: {
            201: pageJsonSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = createPageSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid page data')
        }

        const { title, slug, content, status, metaDescription, parentId, sortOrder } = parsed.data
        const communityDid = requireCommunityDid(request)

        // Check slug uniqueness within community
        const existingSlug = await db
          .select()
          .from(pages)
          .where(and(eq(pages.slug, slug), eq(pages.communityDid, communityDid)))

        if (existingSlug.length > 0) {
          throw conflict(`Page with slug "${slug}" already exists in this community`)
        }

        // Validate parentId if provided
        if (parentId !== undefined && parentId !== null) {
          const parentRows = await db.select().from(pages).where(eq(pages.id, parentId))

          if (parentRows.length === 0) {
            throw badRequest(`Parent page "${parentId}" does not exist`)
          }
        }

        const now = new Date()
        const id = generateId()

        const inserted = await db
          .insert(pages)
          .values({
            id,
            slug,
            title,
            content,
            status,
            metaDescription: metaDescription ?? null,
            parentId: parentId ?? null,
            sortOrder: sortOrder ?? 0,
            communityDid,
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        const created = inserted[0]
        if (!created) {
          throw badRequest('Failed to create page')
        }

        app.log.info({ pageId: id, slug, adminDid: request.user?.did }, 'Page created')

        return reply.status(201).send(serializePage(created))
      }
    )

    // -------------------------------------------------------------------
    // PUT /api/admin/pages/:id (admin required)
    // -------------------------------------------------------------------

    app.put(
      '/api/admin/pages/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Pages (Admin)'],
          summary: 'Update a page',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
            },
          },
          body: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              slug: { type: 'string', minLength: 1, maxLength: 100 },
              content: { type: 'string', maxLength: 100000 },
              status: { type: 'string', enum: ['draft', 'published'] },
              metaDescription: { type: ['string', 'null'], maxLength: 320 },
              parentId: { type: ['string', 'null'] },
              sortOrder: { type: 'integer', minimum: 0 },
            },
          },
          response: {
            200: pageJsonSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string }

        // Find existing page
        const existingRows = await db.select().from(pages).where(eq(pages.id, id))

        const existing = existingRows[0]
        if (!existing) {
          throw notFound('Page not found')
        }

        const parsed = updatePageSchema.safeParse(request.body)
        if (!parsed.success) {
          throw badRequest('Invalid update data')
        }

        const updates = parsed.data
        const communityDid = requireCommunityDid(request)

        // Validate slug uniqueness if slug is being changed
        if (updates.slug !== undefined && updates.slug !== existing.slug) {
          const existingSlug = await db
            .select()
            .from(pages)
            .where(and(eq(pages.slug, updates.slug), eq(pages.communityDid, communityDid)))

          if (existingSlug.length > 0) {
            throw conflict(`Page with slug "${updates.slug}" already exists in this community`)
          }
        }

        // Validate parentId if provided (null = move to root, string = set parent)
        if (updates.parentId !== undefined && updates.parentId !== null) {
          // Check parent exists
          const parentRows = await db.select().from(pages).where(eq(pages.id, updates.parentId))

          if (parentRows.length === 0) {
            throw badRequest(`Parent page "${updates.parentId}" does not exist`)
          }

          // Check for circular references
          if (updates.parentId === id) {
            throw badRequest('Page cannot be its own parent')
          }

          // Fetch all pages to check for cycles
          const allPages = await db.select().from(pages).where(eq(pages.communityDid, communityDid))

          if (wouldCreateCycle(id, updates.parentId, allPages)) {
            throw badRequest('Setting this parent would create a circular reference')
          }
        }

        // Build update set
        const dbUpdates: Record<string, unknown> = {
          updatedAt: new Date(),
        }
        if (updates.title !== undefined) dbUpdates.title = updates.title
        if (updates.slug !== undefined) dbUpdates.slug = updates.slug
        if (updates.content !== undefined) dbUpdates.content = updates.content
        if (updates.status !== undefined) dbUpdates.status = updates.status
        if (updates.metaDescription !== undefined)
          dbUpdates.metaDescription = updates.metaDescription ?? null
        if (updates.parentId !== undefined) dbUpdates.parentId = updates.parentId ?? null
        if (updates.sortOrder !== undefined) dbUpdates.sortOrder = updates.sortOrder

        const updated = await db.update(pages).set(dbUpdates).where(eq(pages.id, id)).returning()

        const updatedRow = updated[0]
        if (!updatedRow) {
          throw notFound('Page not found after update')
        }

        app.log.info(
          { pageId: id, updates: Object.keys(updates), adminDid: request.user?.did },
          'Page updated'
        )

        return reply.status(200).send(serializePage(updatedRow))
      }
    )

    // -------------------------------------------------------------------
    // DELETE /api/admin/pages/:id (admin required)
    // -------------------------------------------------------------------

    app.delete(
      '/api/admin/pages/:id',
      {
        preHandler: [requireAdmin],
        schema: {
          tags: ['Pages (Admin)'],
          summary: 'Delete a page',
          security: [{ bearerAuth: [] }],
          params: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
            },
          },
          response: {
            204: { type: 'null' },
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string }

        // Find existing page
        const existingRows = await db.select().from(pages).where(eq(pages.id, id))

        const existing = existingRows[0]
        if (!existing) {
          throw notFound('Page not found')
        }

        // Check if page has children
        const childRows = await db.select().from(pages).where(eq(pages.parentId, id))

        if (childRows.length > 0) {
          throw conflict(
            `Cannot delete page: it has ${String(childRows.length)} child page(s). Move or delete them first.`
          )
        }

        // Delete the page
        await db.delete(pages).where(eq(pages.id, id))

        app.log.info(
          { pageId: id, slug: existing.slug, adminDid: request.user?.did },
          'Page deleted'
        )

        return reply.status(204).send()
      }
    )

    done()
  }
}

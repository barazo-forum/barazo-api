import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Valid page status values. */
export const pageStatusSchema = z.enum(['draft', 'published'])

export type PageStatus = z.infer<typeof pageStatusSchema>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Slugs reserved for UI routes that must not collide with page slugs. */
const RESERVED_SLUGS = ['new', 'edit', 'drafts'] as const

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Slug pattern: lowercase alphanumeric segments separated by single hyphens. */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Slug field with format validation and reserved-slug rejection. */
const slugField = z
  .string()
  .min(1, 'Slug is required')
  .max(100, 'Slug must be at most 100 characters')
  .regex(
    slugPattern,
    "Slug must be lowercase alphanumeric with single hyphens (e.g. 'terms-of-service')"
  )
  .refine(
    (val) => !RESERVED_SLUGS.includes(val as (typeof RESERVED_SLUGS)[number]),
    'This slug is reserved and cannot be used'
  )

/** Schema for creating a new page. */
export const createPageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title must be at most 200 characters'),
  slug: slugField,
  content: z.string().max(100_000, 'Content must be at most 100000 characters').default(''),
  status: pageStatusSchema.default('draft'),
  metaDescription: z
    .string()
    .max(320, 'Meta description must be at most 320 characters')
    .nullable()
    .optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z
    .number()
    .int('Sort order must be an integer')
    .min(0, 'Sort order must be non-negative')
    .optional(),
})

export type CreatePageInput = z.infer<typeof createPageSchema>

/** Schema for updating an existing page (all fields optional). */
export const updatePageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title must not be empty')
    .max(200, 'Title must be at most 200 characters')
    .optional(),
  slug: slugField.optional(),
  content: z.string().max(100_000, 'Content must be at most 100000 characters').optional(),
  status: pageStatusSchema.optional(),
  metaDescription: z
    .string()
    .max(320, 'Meta description must be at most 320 characters')
    .nullable()
    .optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z
    .number()
    .int('Sort order must be an integer')
    .min(0, 'Sort order must be non-negative')
    .optional(),
})

export type UpdatePageInput = z.infer<typeof updatePageSchema>

// ---------------------------------------------------------------------------
// Response schemas (for OpenAPI documentation)
// ---------------------------------------------------------------------------

/** Schema describing a single page in API responses. */
export const pageResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  content: z.string(),
  status: pageStatusSchema,
  metaDescription: z.string().nullable(),
  parentId: z.string().nullable(),
  sortOrder: z.number(),
  communityDid: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PageResponse = z.infer<typeof pageResponseSchema>

/** Schema describing a page with its children (tree structure). */
export const pageTreeResponseSchema: z.ZodType<PageTreeResponse> = z.lazy(() =>
  z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    content: z.string(),
    status: pageStatusSchema,
    metaDescription: z.string().nullable(),
    parentId: z.string().nullable(),
    sortOrder: z.number(),
    communityDid: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    children: z.array(pageTreeResponseSchema),
  })
)

export interface PageTreeResponse {
  id: string
  slug: string
  title: string
  content: string
  status: 'draft' | 'published'
  metaDescription: string | null
  parentId: string | null
  sortOrder: number
  communityDid: string
  createdAt: string
  updatedAt: string
  children: PageTreeResponse[]
}

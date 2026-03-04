import { describe, it, expect } from 'vitest'
import {
  pageStatusSchema,
  createPageSchema,
  updatePageSchema,
  pageResponseSchema,
  pageTreeResponseSchema,
} from '../../../src/validation/pages.js'

// ---------------------------------------------------------------------------
// pageStatusSchema
// ---------------------------------------------------------------------------

describe('pageStatusSchema', () => {
  it('accepts "draft"', () => {
    expect(pageStatusSchema.safeParse('draft').success).toBe(true)
  })

  it('accepts "published"', () => {
    expect(pageStatusSchema.safeParse('published').success).toBe(true)
  })

  it('rejects invalid status', () => {
    expect(pageStatusSchema.safeParse('archived').success).toBe(false)
    expect(pageStatusSchema.safeParse('').success).toBe(false)
    expect(pageStatusSchema.safeParse(42).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createPageSchema
// ---------------------------------------------------------------------------

describe('createPageSchema', () => {
  const validInput = {
    title: 'Terms of Service',
    slug: 'terms-of-service',
    content: '## Hello world',
    status: 'published' as const,
  }

  it('accepts valid minimal input (title + slug)', () => {
    const result = createPageSchema.safeParse({ title: 'About', slug: 'about' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe('')
      expect(result.data.status).toBe('draft')
    }
  })

  it('accepts valid full input', () => {
    const result = createPageSchema.safeParse({
      ...validInput,
      metaDescription: 'Our terms of service.',
      parentId: 'page-abc',
      sortOrder: 5,
    })
    expect(result.success).toBe(true)
  })

  // Title validation
  it('rejects empty title', () => {
    expect(createPageSchema.safeParse({ ...validInput, title: '' }).success).toBe(false)
  })

  it('rejects title over 200 chars', () => {
    expect(createPageSchema.safeParse({ ...validInput, title: 'x'.repeat(201) }).success).toBe(
      false
    )
  })

  it('accepts title at 200 chars', () => {
    expect(createPageSchema.safeParse({ ...validInput, title: 'x'.repeat(200) }).success).toBe(true)
  })

  // Slug validation
  it('rejects empty slug', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: '' }).success).toBe(false)
  })

  it('rejects slug over 100 chars', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'a'.repeat(101) }).success).toBe(false)
  })

  it('rejects slug with uppercase', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'About-Us' }).success).toBe(false)
  })

  it('rejects slug with spaces', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'about us' }).success).toBe(false)
  })

  it('rejects slug with consecutive hyphens', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'about--us' }).success).toBe(false)
  })

  it('rejects slug starting with a hyphen', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: '-about' }).success).toBe(false)
  })

  it('rejects slug ending with a hyphen', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'about-' }).success).toBe(false)
  })

  it('accepts valid slug with hyphens', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'terms-of-service' }).success).toBe(
      true
    )
  })

  // Reserved slugs
  it('rejects reserved slug "new"', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'new' }).success).toBe(false)
  })

  it('rejects reserved slug "edit"', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'edit' }).success).toBe(false)
  })

  it('rejects reserved slug "drafts"', () => {
    expect(createPageSchema.safeParse({ ...validInput, slug: 'drafts' }).success).toBe(false)
  })

  // Content validation
  it('defaults content to empty string', () => {
    const result = createPageSchema.safeParse({ title: 'Hi', slug: 'hi' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe('')
    }
  })

  it('rejects content over 100_000 chars', () => {
    expect(
      createPageSchema.safeParse({ ...validInput, content: 'x'.repeat(100_001) }).success
    ).toBe(false)
  })

  it('accepts content at 100_000 chars', () => {
    expect(
      createPageSchema.safeParse({ ...validInput, content: 'x'.repeat(100_000) }).success
    ).toBe(true)
  })

  // Status validation
  it('defaults status to draft', () => {
    const result = createPageSchema.safeParse({ title: 'Hi', slug: 'hi' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('draft')
    }
  })

  it('rejects invalid status', () => {
    expect(createPageSchema.safeParse({ ...validInput, status: 'archived' }).success).toBe(false)
  })

  // metaDescription validation
  it('accepts null metaDescription', () => {
    expect(createPageSchema.safeParse({ ...validInput, metaDescription: null }).success).toBe(true)
  })

  it('rejects metaDescription over 320 chars', () => {
    expect(
      createPageSchema.safeParse({ ...validInput, metaDescription: 'x'.repeat(321) }).success
    ).toBe(false)
  })

  it('accepts metaDescription at 320 chars', () => {
    expect(
      createPageSchema.safeParse({ ...validInput, metaDescription: 'x'.repeat(320) }).success
    ).toBe(true)
  })

  // parentId
  it('accepts parentId as a string', () => {
    expect(createPageSchema.safeParse({ ...validInput, parentId: 'page-123' }).success).toBe(true)
  })

  it('accepts null parentId', () => {
    expect(createPageSchema.safeParse({ ...validInput, parentId: null }).success).toBe(true)
  })

  // sortOrder
  it('rejects negative sortOrder', () => {
    expect(createPageSchema.safeParse({ ...validInput, sortOrder: -1 }).success).toBe(false)
  })

  it('rejects non-integer sortOrder', () => {
    expect(createPageSchema.safeParse({ ...validInput, sortOrder: 1.5 }).success).toBe(false)
  })

  it('accepts sortOrder of 0', () => {
    expect(createPageSchema.safeParse({ ...validInput, sortOrder: 0 }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updatePageSchema
// ---------------------------------------------------------------------------

describe('updatePageSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(updatePageSchema.safeParse({}).success).toBe(true)
  })

  it('accepts partial updates', () => {
    expect(updatePageSchema.safeParse({ title: 'New Title' }).success).toBe(true)
    expect(updatePageSchema.safeParse({ status: 'published' }).success).toBe(true)
    expect(updatePageSchema.safeParse({ content: 'New content' }).success).toBe(true)
  })

  it('rejects empty title', () => {
    expect(updatePageSchema.safeParse({ title: '' }).success).toBe(false)
  })

  it('rejects empty slug', () => {
    expect(updatePageSchema.safeParse({ slug: '' }).success).toBe(false)
  })

  it('accepts nullable parentId', () => {
    expect(updatePageSchema.safeParse({ parentId: null }).success).toBe(true)
  })

  it('accepts nullable metaDescription', () => {
    expect(updatePageSchema.safeParse({ metaDescription: null }).success).toBe(true)
  })

  it('rejects reserved slug "new"', () => {
    expect(updatePageSchema.safeParse({ slug: 'new' }).success).toBe(false)
  })

  it('rejects reserved slug "edit"', () => {
    expect(updatePageSchema.safeParse({ slug: 'edit' }).success).toBe(false)
  })

  it('rejects reserved slug "drafts"', () => {
    expect(updatePageSchema.safeParse({ slug: 'drafts' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pageResponseSchema
// ---------------------------------------------------------------------------

describe('pageResponseSchema', () => {
  it('accepts a valid page response', () => {
    const result = pageResponseSchema.safeParse({
      id: 'page-001',
      slug: 'about',
      title: 'About Us',
      content: '## About',
      status: 'published',
      metaDescription: null,
      parentId: null,
      sortOrder: 0,
      communityDid: 'did:plc:community123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing required fields', () => {
    expect(pageResponseSchema.safeParse({ id: 'page-001' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pageTreeResponseSchema
// ---------------------------------------------------------------------------

describe('pageTreeResponseSchema', () => {
  it('accepts a page with empty children', () => {
    const result = pageTreeResponseSchema.safeParse({
      id: 'page-001',
      slug: 'about',
      title: 'About Us',
      content: '## About',
      status: 'published',
      metaDescription: null,
      parentId: null,
      sortOrder: 0,
      communityDid: 'did:plc:community123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      children: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts nested children', () => {
    const result = pageTreeResponseSchema.safeParse({
      id: 'page-001',
      slug: 'legal',
      title: 'Legal',
      content: '',
      status: 'published',
      metaDescription: null,
      parentId: null,
      sortOrder: 0,
      communityDid: 'did:plc:community123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      children: [
        {
          id: 'page-002',
          slug: 'terms',
          title: 'Terms',
          content: '## Terms',
          status: 'published',
          metaDescription: null,
          parentId: 'page-001',
          sortOrder: 0,
          communityDid: 'did:plc:community123',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          children: [],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

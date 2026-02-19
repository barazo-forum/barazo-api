import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEmbeddingService } from '../../../src/services/embedding.js'

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'info',
  silent: vi.fn(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('embedding service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Disabled mode (no URL)
  // =========================================================================

  describe('when disabled (no URL)', () => {
    it('isEnabled returns false when URL is undefined', () => {
      const service = createEmbeddingService(undefined, 768, mockLogger as never)
      expect(service.isEnabled()).toBe(false)
    })

    it('isEnabled returns false when URL is empty string', () => {
      const service = createEmbeddingService('', 768, mockLogger as never)
      expect(service.isEnabled()).toBe(false)
    })

    it('generateEmbedding returns null when disabled', async () => {
      const service = createEmbeddingService(undefined, 768, mockLogger as never)
      const result = await service.generateEmbedding('test query')
      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Enabled mode
  // =========================================================================

  describe('when enabled', () => {
    const TEST_URL = 'http://localhost:11434/api/embeddings'
    const TEST_DIMENSIONS = 768
    const mockFetch = vi.fn()

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('isEnabled returns true when URL is provided', () => {
      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      expect(service.isEnabled()).toBe(true)
    })

    it('generateEmbedding returns embedding array on success', async () => {
      const expectedEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: expectedEmbedding }],
          }),
      })

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      const result = await service.generateEmbedding('test query')

      expect(result).toEqual(expectedEmbedding)
    })

    it('calls the correct URL with correct payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
      })

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      await service.generateEmbedding('hello world')

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(mockFetch.mock.calls[0]?.[0]).toBe(TEST_URL)

      const fetchOptions = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(fetchOptions.method).toBe('POST')
      expect(fetchOptions.headers).toEqual({
        'Content-Type': 'application/json',
      })

      const body = JSON.parse(fetchOptions.body as string) as {
        input: string
        model: string
        dimensions: number
      }
      expect(body.input).toBe('hello world')
      expect(body.model).toBe('default')
      expect(body.dimensions).toBe(TEST_DIMENSIONS)
    })

    it('returns null on API error (non-OK status)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      })

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      const result = await service.generateEmbedding('test query')

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { status: 500, url: TEST_URL },
        'Embedding API returned non-OK status'
      )
    })

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'))

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      const result = await service.generateEmbedding('test query')

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) as Error },
        'Failed to generate embedding'
      )
    })

    it('returns null on invalid response format (missing data)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      })

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      const result = await service.generateEmbedding('test query')

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Embedding API returned empty or invalid embedding'
      )
    })

    it('returns null on invalid response format (empty embedding)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [] }],
          }),
      })

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      const result = await service.generateEmbedding('test query')

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Embedding API returned empty or invalid embedding'
      )
    })

    it('returns null on invalid response format (non-array embedding)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: 'not-an-array' }],
          }),
      })

      const service = createEmbeddingService(TEST_URL, TEST_DIMENSIONS, mockLogger as never)
      const result = await service.generateEmbedding('test query')

      expect(result).toBeNull()
    })
  })
})

import type { Logger } from '../lib/logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingService {
  /** Generate an embedding vector for the given text. Returns null on failure or when disabled. */
  generateEmbedding(text: string): Promise<number[] | null>
  /** Whether the embedding service is configured and available. */
  isEnabled(): boolean
}

/** OpenAI-compatible embedding response. */
interface EmbeddingResponse {
  data: ReadonlyArray<{ embedding: number[] }>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create an embedding service that calls an OpenAI-compatible embedding API.
 *
 * If `embeddingUrl` is undefined or empty, the service operates in disabled mode:
 * `isEnabled()` returns false and `generateEmbedding()` always returns null.
 *
 * On network or API errors the service logs a warning and returns null -- it
 * never throws. This allows the search route to gracefully degrade to
 * full-text-only search when the embedding backend is unavailable.
 */
export function createEmbeddingService(
  embeddingUrl: string | undefined,
  dimensions: number,
  logger: Logger
): EmbeddingService {
  const enabled = typeof embeddingUrl === 'string' && embeddingUrl.length > 0

  return {
    isEnabled(): boolean {
      return enabled
    },

    async generateEmbedding(text: string): Promise<number[] | null> {
      if (!enabled || !embeddingUrl) {
        return null
      }

      try {
        const response = await fetch(embeddingUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: text,
            model: 'default',
            dimensions,
          }),
          signal: AbortSignal.timeout(10_000),
        })

        if (!response.ok) {
          logger.warn(
            { status: response.status, url: embeddingUrl },
            'Embedding API returned non-OK status'
          )
          return null
        }

        const body = (await response.json()) as EmbeddingResponse
        const embedding = body.data[0]?.embedding

        if (!Array.isArray(embedding) || embedding.length === 0) {
          logger.warn('Embedding API returned empty or invalid embedding')
          return null
        }

        return embedding
      } catch (err: unknown) {
        logger.warn({ err }, 'Failed to generate embedding')
        return null
      }
    },
  }
}

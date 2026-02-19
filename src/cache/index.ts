import { Redis } from 'ioredis'
import type { FastifyBaseLogger } from 'fastify'

export function createCache(valkeyUrl: string, logger: FastifyBaseLogger) {
  const cache = new Redis(valkeyUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 2000)
      return delay
    },
    lazyConnect: true,
  })

  cache.on('error', (err: Error) => {
    logger.error({ err }, 'Valkey connection error')
  })

  cache.on('connect', () => {
    logger.info('Connected to Valkey')
  })

  return cache
}

export type Cache = ReturnType<typeof createCache>

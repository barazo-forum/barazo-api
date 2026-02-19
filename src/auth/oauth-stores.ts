import type { NodeSavedSession, NodeSavedState } from '@atproto/oauth-client-node'
import type { Cache } from '../cache/index.js'
import type { Logger } from '../lib/logger.js'

const STATE_KEY_PREFIX = 'barazo:oauth:state:'
const SESSION_KEY_PREFIX = 'barazo:oauth:session:'

/** Default state TTL: 5 minutes (OAuth state is short-lived) */
const DEFAULT_STATE_TTL = 300

/**
 * Valkey-backed store for OAuth authorization state.
 * State entries are short-lived (5 minutes) and used during the
 * authorization code flow between redirect and callback.
 */
export class ValkeyStateStore {
  private readonly cache: Cache
  private readonly logger: Logger

  constructor(cache: Cache, logger: Logger) {
    this.cache = cache
    this.logger = logger
  }

  async set(key: string, state: NodeSavedState): Promise<void> {
    const cacheKey = `${STATE_KEY_PREFIX}${key}`
    try {
      await this.cache.set(cacheKey, JSON.stringify(state), 'EX', DEFAULT_STATE_TTL)
      this.logger.debug({ key: cacheKey }, 'OAuth state stored')
    } catch (err: unknown) {
      this.logger.error({ err, key: cacheKey }, 'Failed to store OAuth state')
      throw err
    }
  }

  async get(key: string): Promise<NodeSavedState | undefined> {
    const cacheKey = `${STATE_KEY_PREFIX}${key}`
    try {
      const data = await this.cache.get(cacheKey)
      if (data === null) {
        this.logger.debug({ key: cacheKey }, 'OAuth state not found')
        return undefined
      }
      return JSON.parse(data) as NodeSavedState
    } catch (err: unknown) {
      this.logger.error({ err, key: cacheKey }, 'Failed to retrieve OAuth state')
      throw err
    }
  }

  async del(key: string): Promise<void> {
    const cacheKey = `${STATE_KEY_PREFIX}${key}`
    try {
      await this.cache.del(cacheKey)
      this.logger.debug({ key: cacheKey }, 'OAuth state deleted')
    } catch (err: unknown) {
      this.logger.error({ err, key: cacheKey }, 'Failed to delete OAuth state')
      throw err
    }
  }
}

/**
 * Valkey-backed store for OAuth sessions.
 * Sessions persist across requests and are keyed by the user's DID (sub).
 * Default TTL is 7 days (604800 seconds), configurable via OAUTH_SESSION_TTL.
 */
export class ValkeySessionStore {
  private readonly cache: Cache
  private readonly logger: Logger
  private readonly ttl: number

  constructor(cache: Cache, logger: Logger, ttl: number) {
    this.cache = cache
    this.logger = logger
    this.ttl = ttl
  }

  async set(sub: string, session: NodeSavedSession): Promise<void> {
    const cacheKey = `${SESSION_KEY_PREFIX}${sub}`
    try {
      await this.cache.set(cacheKey, JSON.stringify(session), 'EX', this.ttl)
      this.logger.debug({ key: cacheKey }, 'OAuth session stored')
    } catch (err: unknown) {
      this.logger.error({ err, key: cacheKey }, 'Failed to store OAuth session')
      throw err
    }
  }

  async get(sub: string): Promise<NodeSavedSession | undefined> {
    const cacheKey = `${SESSION_KEY_PREFIX}${sub}`
    try {
      const data = await this.cache.get(cacheKey)
      if (data === null) {
        this.logger.debug({ key: cacheKey }, 'OAuth session not found')
        return undefined
      }
      return JSON.parse(data) as NodeSavedSession
    } catch (err: unknown) {
      this.logger.error({ err, key: cacheKey }, 'Failed to retrieve OAuth session')
      throw err
    }
  }

  async del(sub: string): Promise<void> {
    const cacheKey = `${SESSION_KEY_PREFIX}${sub}`
    try {
      await this.cache.del(cacheKey)
      this.logger.debug({ key: cacheKey }, 'OAuth session deleted')
    } catch (err: unknown) {
      this.logger.error({ err, key: cacheKey }, 'Failed to delete OAuth session')
      throw err
    }
  }
}

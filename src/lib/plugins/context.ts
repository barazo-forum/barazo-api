import { Agent } from '@atproto/api'

import type { Logger } from '../logger.js'

import type {
  PluginContext,
  PluginSettings,
  ScopedAtProto,
  ScopedCache,
  ScopedDatabase,
} from './types.js'

/** Adapter interface for the underlying cache (e.g. Valkey/ioredis). */
export interface CacheAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
}

export interface PluginContextOptions {
  pluginName: string
  pluginVersion: string
  permissions: string[]
  settings: Record<string, unknown>
  db: unknown
  cache: CacheAdapter | null
  oauthClient: unknown // NodeOAuthClient | null — typed as unknown to avoid coupling
  logger: Logger
  communityDid: string
}

function createPluginSettings(values: Record<string, unknown>): PluginSettings {
  const copy = { ...values }
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matches PluginSettings interface
    get<T = unknown>(key: string): T | undefined {
      return copy[key] as T | undefined
    },
    getAll(): Record<string, unknown> {
      return { ...copy }
    },
  }
}

function createScopedCache(cache: CacheAdapter, pluginName: string): ScopedCache {
  const prefix = `plugin:${pluginName}:`
  return {
    get(key: string): Promise<string | null> {
      return cache.get(`${prefix}${key}`)
    },
    set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      return cache.set(`${prefix}${key}`, value, ttlSeconds)
    },
    del(key: string): Promise<void> {
      return cache.del(`${prefix}${key}`)
    },
  }
}

function createScopedDatabase(db: unknown, _permissions: string[]): ScopedDatabase {
  return {
    execute(query: unknown): Promise<unknown> {
      return (db as { execute(q: unknown): Promise<unknown> }).execute(query)
    },
    query(_tableName: string): unknown {
      throw new Error('ScopedDatabase.query() is not yet implemented')
    },
  }
}

const BSKY_PUBLIC_API = 'https://public.api.bsky.app'

interface OAuthClientLike {
  restore(did: string): Promise<unknown>
}

function createScopedAtProto(
  oauthClient: OAuthClientLike,
  logger: Logger,
  pluginName: string
): ScopedAtProto {
  return {
    async getRecord(did: string, collection: string, rkey: string): Promise<unknown> {
      try {
        const agent = new Agent(new URL(BSKY_PUBLIC_API))
        const response = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection,
          rkey,
        })
        return response.data.value
      } catch (err: unknown) {
        logger.debug(
          { err, plugin: pluginName, did, collection, rkey },
          'ScopedAtProto getRecord failed'
        )
        return null
      }
    },

    async putRecord(did: string, collection: string, rkey: string, record: unknown): Promise<void> {
      const session = await oauthClient.restore(did)
      const agent = new Agent(session as ConstructorParameters<typeof Agent>[0])
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection,
        rkey,
        record: { $type: collection, ...(record as Record<string, unknown>) },
      })
    },

    async deleteRecord(did: string, collection: string, rkey: string): Promise<void> {
      const session = await oauthClient.restore(did)
      const agent = new Agent(session as ConstructorParameters<typeof Agent>[0])
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection,
        rkey,
      })
    },
  }
}

export function createPluginContext(options: PluginContextOptions): PluginContext {
  const {
    pluginName,
    pluginVersion,
    permissions,
    settings,
    db,
    cache,
    oauthClient,
    logger,
    communityDid,
  } = options

  const hasCachePermission =
    permissions.includes('cache:read') || permissions.includes('cache:write')

  const scopedCache = hasCachePermission && cache ? createScopedCache(cache, pluginName) : undefined

  const hasPdsPermission = permissions.includes('pds:read') || permissions.includes('pds:write')
  const scopedAtProto =
    hasPdsPermission && oauthClient
      ? createScopedAtProto(oauthClient as OAuthClientLike, logger, pluginName)
      : undefined

  return {
    pluginName,
    pluginVersion,
    communityDid,
    db: createScopedDatabase(db, permissions),
    settings: createPluginSettings(settings),
    logger: logger.child({ plugin: pluginName }),
    ...(scopedCache ? { cache: scopedCache } : {}),
    ...(scopedAtProto ? { atproto: scopedAtProto } : {}),
  } satisfies PluginContext
}

import { Agent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import type { Logger } from '../lib/logger.js'
import type { Database } from '../db/index.js'
import { users } from '../db/schema/users.js'
import { stripControlCharacters } from '../lib/sanitize-text.js'
import type { LoadedPlugin } from '../lib/plugins/types.js'
import { executeHook } from '../lib/plugins/runtime.js'
import { createPluginContext, type CacheAdapter } from '../lib/plugins/context.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Profile data fetched from the Bluesky public API. */
export interface ProfileData {
  displayName: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  bio: string | null
  followersCount: number
  followsCount: number
  atprotoPostsCount: number
  hasBlueskyProfile: boolean
  labels: Array<{ val: string; src: string; neg: boolean; cts: string }>
}

export interface ProfileSyncService {
  syncProfile(did: string): Promise<ProfileData>
}

/** Null profile returned on any failure. */
const NULL_PROFILE: ProfileData = {
  displayName: null,
  avatarUrl: null,
  bannerUrl: null,
  bio: null,
  followersCount: 0,
  followsCount: 0,
  atprotoPostsCount: 0,
  hasBlueskyProfile: false,
  labels: [],
}

// ---------------------------------------------------------------------------
// Public API agent factory (injectable for testing)
// ---------------------------------------------------------------------------

/** Bluesky public AppView API -- no auth required for profile reads. */
const BSKY_PUBLIC_API = 'https://public.api.bsky.app'

interface AgentLike {
  getProfile(params: { actor: string }): Promise<{
    data: {
      did?: string
      displayName?: string
      avatar?: string
      banner?: string
      description?: string
      followersCount?: number
      followsCount?: number
      postsCount?: number
      labels?: Array<{ val: string; src: string; uri: string; neg?: boolean; cts: string }>
    }
  }>
}

interface AgentFactory {
  createAgent(): AgentLike
}

const defaultAgentFactory: AgentFactory = {
  createAgent(): AgentLike {
    return new Agent(new URL(BSKY_PUBLIC_API))
  },
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface ProfileSyncOptions {
  agentFactory?: AgentFactory
  loadedPlugins?: Map<string, LoadedPlugin>
  enabledPlugins?: Set<string>
  oauthClient?: unknown
  cache?: CacheAdapter | null
  communityDid?: string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a profile sync service that fetches a user's AT Protocol profile
 * via the Bluesky public API at login time and updates the local users table.
 *
 * Uses the public AppView API (no auth required) so profile sync works
 * regardless of which OAuth scopes the user granted.
 *
 * @param db - Drizzle database instance
 * @param logger - Pino logger
 * @param options - Optional configuration including agent factory and plugin refs
 */
export function createProfileSyncService(
  db: Database,
  logger: Logger,
  options: ProfileSyncOptions = {}
): ProfileSyncService {
  const {
    agentFactory = defaultAgentFactory,
    loadedPlugins,
    enabledPlugins,
    oauthClient: pluginOauthClient,
    cache: pluginCache,
    communityDid: pluginCommunityDid,
  } = options
  return {
    async syncProfile(did: string): Promise<ProfileData> {
      // 1. Fetch profile from Bluesky public API (no auth needed)
      let profileData: ProfileData
      try {
        const agent = agentFactory.createAgent()
        const response = await agent.getProfile({ actor: did })
        const rawLabels = response.data.labels ?? []
        const labels = rawLabels
          .filter((l) => !l.neg)
          .map((l) => ({ val: l.val, src: l.src, neg: false as const, cts: l.cts }))

        const sanitizedName = stripControlCharacters(response.data.displayName ?? '')
        profileData = {
          displayName: sanitizedName || null,
          avatarUrl: response.data.avatar ?? null,
          bannerUrl: response.data.banner ?? null,
          bio: response.data.description ?? null,
          followersCount: response.data.followersCount ?? 0,
          followsCount: response.data.followsCount ?? 0,
          atprotoPostsCount: response.data.postsCount ?? 0,
          hasBlueskyProfile: true,
          labels,
        }
      } catch (err: unknown) {
        logger.debug({ did, err }, 'profile sync failed: could not fetch profile from public API')
        return NULL_PROFILE
      }

      // 2. Best-effort DB update
      try {
        await db
          .update(users)
          .set({
            displayName: profileData.displayName,
            avatarUrl: profileData.avatarUrl,
            bannerUrl: profileData.bannerUrl,
            bio: profileData.bio,
            followersCount: profileData.followersCount,
            followsCount: profileData.followsCount,
            atprotoPostsCount: profileData.atprotoPostsCount,
            hasBlueskyProfile: profileData.hasBlueskyProfile,
            atprotoLabels: profileData.labels,
            lastActiveAt: new Date(),
          })
          .where(eq(users.did, did))
      } catch (err: unknown) {
        logger.warn({ did, err }, 'profile DB update failed: could not persist profile data')
      }

      // Fire-and-forget plugin onProfileSync hooks
      if (loadedPlugins && enabledPlugins) {
        for (const [name, loaded] of loadedPlugins) {
          if (!enabledPlugins.has(name)) continue
          if (!loaded.hooks?.onProfileSync) continue

          try {
            const manifest = loaded.manifest as { permissions?: { backend?: string[] } }
            const ctx = createPluginContext({
              pluginName: loaded.name,
              pluginVersion: loaded.version,
              permissions: manifest.permissions?.backend ?? [],
              settings: {},
              db,
              cache: pluginCache ?? null,
              oauthClient: pluginOauthClient ?? null,
              logger,
              communityDid: pluginCommunityDid ?? '',
            })
            // eslint-disable-next-line @typescript-eslint/unbound-method -- plugin hooks are standalone functions
            const hookFn = loaded.hooks.onProfileSync as (...args: unknown[]) => Promise<void>
            void executeHook('onProfileSync', hookFn, ctx, logger, name, did).catch(
              (err: unknown) => {
                logger.warn({ err, plugin: name, did }, 'Plugin onProfileSync failed')
              }
            )
          } catch (err: unknown) {
            logger.warn(
              { err, plugin: name, did },
              'Failed to build plugin context for onProfileSync'
            )
          }
        }
      }

      return profileData
    },
  }
}

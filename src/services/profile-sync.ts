import { Agent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import type { NodeOAuthClient } from '@atproto/oauth-client-node'
import type { Logger } from '../lib/logger.js'
import type { Database } from '../db/index.js'
import { users } from '../db/schema/users.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Profile data extracted from the user's PDS. */
export interface ProfileData {
  displayName: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  bio: string | null
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
}

// ---------------------------------------------------------------------------
// Agent factory (injectable for testing)
// ---------------------------------------------------------------------------

interface AgentLike {
  getProfile(params: { actor: string }): Promise<{
    data: {
      displayName?: string
      avatar?: string
      banner?: string
      description?: string
    }
  }>
}

interface AgentFactory {
  createAgent(session: unknown): AgentLike
}

const defaultAgentFactory: AgentFactory = {
  createAgent(session: unknown): AgentLike {
    return new Agent(session as ConstructorParameters<typeof Agent>[0])
  },
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a profile sync service that fetches a user's AT Protocol profile
 * from their PDS at login time and updates the local users table.
 *
 * @param oauthClient - AT Protocol OAuth client for session restore
 * @param db - Drizzle database instance
 * @param logger - Pino logger
 * @param agentFactory - Optional factory for creating Agent instances (testing)
 */
export function createProfileSyncService(
  oauthClient: NodeOAuthClient,
  db: Database,
  logger: Logger,
  agentFactory: AgentFactory = defaultAgentFactory
): ProfileSyncService {
  return {
    async syncProfile(did: string): Promise<ProfileData> {
      // 1. Restore OAuth session and create agent
      let agent: AgentLike
      try {
        const session = await oauthClient.restore(did)
        agent = agentFactory.createAgent(session)
      } catch (err: unknown) {
        logger.debug({ did, err }, 'profile sync failed: could not restore OAuth session')
        return NULL_PROFILE
      }

      // 2. Fetch profile from PDS
      let profileData: ProfileData
      try {
        const response = await agent.getProfile({ actor: did })
        profileData = {
          displayName: response.data.displayName ?? null,
          avatarUrl: response.data.avatar ?? null,
          bannerUrl: response.data.banner ?? null,
          bio: response.data.description ?? null,
        }
      } catch (err: unknown) {
        logger.debug({ did, err }, 'profile sync failed: could not fetch profile from PDS')
        return NULL_PROFILE
      }

      // 3. Best-effort DB update
      try {
        await db
          .update(users)
          .set({
            displayName: profileData.displayName,
            avatarUrl: profileData.avatarUrl,
            bannerUrl: profileData.bannerUrl,
            bio: profileData.bio,
            lastActiveAt: new Date(),
          })
          .where(eq(users.did, did))
      } catch (err: unknown) {
        logger.warn({ did, err }, 'profile DB update failed: could not persist profile data')
      }

      return profileData
    },
  }
}

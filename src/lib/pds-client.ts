import { Agent } from '@atproto/api'
import type { NodeOAuthClient } from '@atproto/oauth-client-node'
import type { Logger } from './logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a successful record creation or update on the user's PDS. */
export interface PdsWriteResult {
  uri: string
  cid: string
}

/** PDS client interface for creating, updating, and deleting AT Protocol records. */
export interface PdsClient {
  createRecord(
    did: string,
    collection: string,
    record: Record<string, unknown>
  ): Promise<PdsWriteResult>

  updateRecord(
    did: string,
    collection: string,
    rkey: string,
    record: Record<string, unknown>
  ): Promise<PdsWriteResult>

  deleteRecord(did: string, collection: string, rkey: string): Promise<void>

  /**
   * Upload a binary blob (e.g. an image) to the user's PDS.
   * Returns the blob reference object suitable for embedding in records.
   */
  uploadBlob(did: string, data: Uint8Array, mimeType: string): Promise<unknown>
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Extract a meaningful message from an unknown PDS error.
 */
function pdsErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PDS client that uses the OAuth client to restore user sessions
 * and perform XRPC operations on the user's PDS.
 *
 * @param oauthClient - The AT Protocol OAuth client (provides session restore)
 * @param logger - Pino logger for structured logging
 */
export function createPdsClient(oauthClient: NodeOAuthClient, logger: Logger): PdsClient {
  /**
   * Restore an authenticated Agent for the given DID.
   * The OAuth client manages token refresh transparently.
   */
  async function getAgent(did: string): Promise<Agent> {
    const session = await oauthClient.restore(did)
    return new Agent(session)
  }

  return {
    async createRecord(
      did: string,
      collection: string,
      record: Record<string, unknown>
    ): Promise<PdsWriteResult> {
      logger.debug({ did, collection }, 'PDS createRecord')

      try {
        const agent = await getAgent(did)
        const response = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection,
          record,
        })

        return { uri: response.data.uri, cid: response.data.cid }
      } catch (err: unknown) {
        logger.error({ err, did, collection }, 'PDS createRecord failed: %s', pdsErrorMessage(err))
        throw err
      }
    },

    async updateRecord(
      did: string,
      collection: string,
      rkey: string,
      record: Record<string, unknown>
    ): Promise<PdsWriteResult> {
      logger.debug({ did, collection, rkey }, 'PDS updateRecord')

      try {
        const agent = await getAgent(did)
        const response = await agent.com.atproto.repo.putRecord({
          repo: did,
          collection,
          rkey,
          record,
        })

        return { uri: response.data.uri, cid: response.data.cid }
      } catch (err: unknown) {
        logger.error(
          { err, did, collection, rkey },
          'PDS updateRecord failed: %s',
          pdsErrorMessage(err)
        )
        throw err
      }
    },

    async deleteRecord(did: string, collection: string, rkey: string): Promise<void> {
      logger.debug({ did, collection, rkey }, 'PDS deleteRecord')

      try {
        const agent = await getAgent(did)
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection,
          rkey,
        })
      } catch (err: unknown) {
        logger.error(
          { err, did, collection, rkey },
          'PDS deleteRecord failed: %s',
          pdsErrorMessage(err)
        )
        throw err
      }
    },

    async uploadBlob(did: string, data: Uint8Array, mimeType: string): Promise<unknown> {
      logger.debug({ did, mimeType, size: data.length }, 'PDS uploadBlob')

      try {
        const agent = await getAgent(did)
        const response = await agent.uploadBlob(data, {
          encoding: mimeType,
        })

        return response.data.blob
      } catch (err: unknown) {
        logger.error({ err, did, mimeType }, 'PDS uploadBlob failed: %s', pdsErrorMessage(err))
        throw err
      }
    },
  }
}

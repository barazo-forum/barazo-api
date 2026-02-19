import { eq } from 'drizzle-orm'
import type { PdsClient } from '../lib/pds-client.js'
import type { Logger } from '../lib/logger.js'
import type { Database } from '../db/index.js'
import type { NotificationService } from './notification.js'
import { generateOgImage } from './og-image.js'
import { crossPosts } from '../db/schema/cross-posts.js'
import { userPreferences } from '../db/schema/user-preferences.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum grapheme length for Bluesky post text. */
const BLUESKY_TEXT_LIMIT = 300

/** Maximum length for the Bluesky embed description. */
const EMBED_DESCRIPTION_LIMIT = 300

/** AT Protocol collection for Bluesky posts. */
const BLUESKY_COLLECTION = 'app.bsky.feed.post'

/** AT Protocol collection for Frontpage link submissions. */
const FRONTPAGE_COLLECTION = 'fyi.frontpage.post'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossPostParams {
  did: string
  topicUri: string
  title: string
  content: string
  category: string
  communityDid: string
}

export interface CrossPostService {
  crossPostTopic(params: CrossPostParams): Promise<void>
  deleteCrossPosts(topicUri: string, did: string): Promise<void>
}

export interface CrossPostConfig {
  blueskyEnabled: boolean
  frontpageEnabled: boolean
  publicUrl: string
  communityName: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the rkey from an AT URI.
 * Format: at://did:plc:xxx/collection/rkey
 */
function extractRkey(uri: string): string {
  const parts = uri.split('/')
  return parts[parts.length - 1] ?? ''
}

/**
 * Truncate text to a maximum number of characters, appending ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength - 1) + '\u2026'
}

/**
 * Build the Bluesky post text from topic title and content.
 * Format: "{title}\n\n{truncated content}" (fitting within BLUESKY_TEXT_LIMIT).
 */
function buildBlueskyPostText(title: string, content: string): string {
  const prefix = title + '\n\n'
  const remainingChars = BLUESKY_TEXT_LIMIT - prefix.length

  if (remainingChars <= 0) {
    return truncate(title, BLUESKY_TEXT_LIMIT)
  }

  return prefix + truncate(content, remainingChars)
}

/**
 * Build the public URL for a topic from its AT URI.
 */
function buildTopicUrl(publicUrl: string, topicUri: string): string {
  const rkey = extractRkey(topicUri)
  return `${publicUrl}/topics/${rkey}`
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a cross-posting service that publishes topics to external platforms
 * (Bluesky, Frontpage) via the user's PDS.
 *
 * Cross-posts are fire-and-forget: failures are logged and the user is
 * notified, but they do not block topic creation. Each service is
 * independent -- a failure in one does not prevent the other from succeeding.
 *
 * Bluesky cross-posts include a branded OG image as a thumbnail in the
 * embed card (community name + category + topic title).
 */
export function createCrossPostService(
  pdsClient: PdsClient,
  db: Database,
  logger: Logger,
  config: CrossPostConfig,
  notificationService: NotificationService
): CrossPostService {
  /**
   * Generate and upload an OG image for use as a Bluesky embed thumbnail.
   * Returns the blob reference on success, or undefined on failure (best-effort).
   */
  async function generateAndUploadThumb(params: CrossPostParams): Promise<unknown> {
    try {
      const pngBuffer = await generateOgImage({
        title: params.title,
        category: params.category,
        communityName: config.communityName,
      })

      return await pdsClient.uploadBlob(params.did, pngBuffer, 'image/png')
    } catch (err: unknown) {
      logger.warn(
        { err, topicUri: params.topicUri },
        'Failed to generate or upload OG image for cross-post thumbnail'
      )
      return undefined
    }
  }

  /**
   * Cross-post a topic to Bluesky as an `app.bsky.feed.post` record
   * with an `app.bsky.embed.external` embed containing a link back
   * to the forum topic and a branded OG image thumbnail.
   */
  async function crossPostToBluesky(params: CrossPostParams, thumb: unknown): Promise<void> {
    const topicUrl = buildTopicUrl(config.publicUrl, params.topicUri)
    const postText = buildBlueskyPostText(params.title, params.content)

    const external: Record<string, unknown> = {
      uri: topicUrl,
      title: params.title,
      description: truncate(params.content, EMBED_DESCRIPTION_LIMIT),
    }

    if (thumb !== undefined) {
      external.thumb = thumb
    }

    const record: Record<string, unknown> = {
      $type: BLUESKY_COLLECTION,
      text: postText,
      createdAt: new Date().toISOString(),
      embed: {
        $type: 'app.bsky.embed.external',
        external,
      },
      langs: ['en'],
    }

    let result: { uri: string; cid: string }
    try {
      result = await pdsClient.createRecord(params.did, BLUESKY_COLLECTION, record)
    } catch (err: unknown) {
      if (isScopeError(err)) {
        await handleScopeRevocation(params.did, params.communityDid)
      }
      throw err
    }

    await db.insert(crossPosts).values({
      topicUri: params.topicUri,
      service: 'bluesky',
      crossPostUri: result.uri,
      crossPostCid: result.cid,
      authorDid: params.did,
    })

    logger.info(
      { topicUri: params.topicUri, crossPostUri: result.uri },
      'Cross-posted topic to Bluesky'
    )
  }

  /**
   * Cross-post a topic to Frontpage as an `fyi.frontpage.post` record
   * (link submission pointing back to the forum topic).
   */
  async function crossPostToFrontpage(params: CrossPostParams): Promise<void> {
    const topicUrl = buildTopicUrl(config.publicUrl, params.topicUri)

    const record: Record<string, unknown> = {
      title: params.title,
      url: topicUrl,
      createdAt: new Date().toISOString(),
    }

    let result: { uri: string; cid: string }
    try {
      result = await pdsClient.createRecord(params.did, FRONTPAGE_COLLECTION, record)
    } catch (err: unknown) {
      if (isScopeError(err)) {
        await handleScopeRevocation(params.did, params.communityDid)
      }
      throw err
    }

    await db.insert(crossPosts).values({
      topicUri: params.topicUri,
      service: 'frontpage',
      crossPostUri: result.uri,
      crossPostCid: result.cid,
      authorDid: params.did,
    })

    logger.info(
      { topicUri: params.topicUri, crossPostUri: result.uri },
      'Cross-posted topic to Frontpage'
    )
  }

  /**
   * Detect whether an error from the PDS indicates insufficient scope (403).
   */
  function isScopeError(err: unknown): boolean {
    if (err !== null && typeof err === 'object' && 'status' in err) {
      return (err as { status: number }).status === 403
    }
    return false
  }

  /**
   * Reset the cross-post scopes flag and notify the user when the PDS
   * rejects a cross-post due to insufficient scope / revoked authorization.
   */
  async function handleScopeRevocation(did: string, communityDid: string): Promise<void> {
    try {
      await db
        .update(userPreferences)
        .set({ crossPostScopesGranted: false, updatedAt: new Date() })
        .where(eq(userPreferences.did, did))

      await notificationService.notifyOnCrossPostScopeRevoked({
        authorDid: did,
        communityDid,
      })
    } catch (revokeErr: unknown) {
      logger.error({ err: revokeErr, did }, 'Failed to handle cross-post scope revocation')
    }
  }

  return {
    async crossPostTopic(params: CrossPostParams): Promise<void> {
      // Check if user has cross-post scopes granted before attempting
      const prefRows = await db
        .select({ crossPostScopesGranted: userPreferences.crossPostScopesGranted })
        .from(userPreferences)
        .where(eq(userPreferences.did, params.did))

      if (!(prefRows[0]?.crossPostScopesGranted ?? false)) {
        logger.info(
          { did: params.did, topicUri: params.topicUri },
          'Skipping cross-post: user has not authorized cross-post scopes'
        )
        return
      }

      // Generate and upload OG image for Bluesky (only if Bluesky is enabled)
      let thumb: unknown
      if (config.blueskyEnabled) {
        thumb = await generateAndUploadThumb(params)
      }

      const tasks: Promise<PromiseSettledResult<void>>[] = []

      if (config.blueskyEnabled) {
        tasks.push(
          crossPostToBluesky(params, thumb)
            .then<PromiseSettledResult<void>>(() => ({
              status: 'fulfilled' as const,
              value: undefined,
            }))
            .catch<PromiseSettledResult<void>>((err: unknown) => {
              logger.error(
                { err, topicUri: params.topicUri, service: 'bluesky' },
                'Failed to cross-post to Bluesky'
              )
              notificationService
                .notifyOnCrossPostFailure({
                  topicUri: params.topicUri,
                  authorDid: params.did,
                  service: 'bluesky',
                  communityDid: params.communityDid,
                })
                .catch((notifErr: unknown) => {
                  logger.error(
                    { err: notifErr, topicUri: params.topicUri },
                    'Failed to send cross-post failure notification'
                  )
                })
              return {
                status: 'rejected' as const,
                reason: err,
              }
            })
        )
      }

      if (config.frontpageEnabled) {
        tasks.push(
          crossPostToFrontpage(params)
            .then<PromiseSettledResult<void>>(() => ({
              status: 'fulfilled' as const,
              value: undefined,
            }))
            .catch<PromiseSettledResult<void>>((err: unknown) => {
              logger.error(
                { err, topicUri: params.topicUri, service: 'frontpage' },
                'Failed to cross-post to Frontpage'
              )
              notificationService
                .notifyOnCrossPostFailure({
                  topicUri: params.topicUri,
                  authorDid: params.did,
                  service: 'frontpage',
                  communityDid: params.communityDid,
                })
                .catch((notifErr: unknown) => {
                  logger.error(
                    { err: notifErr, topicUri: params.topicUri },
                    'Failed to send cross-post failure notification'
                  )
                })
              return {
                status: 'rejected' as const,
                reason: err,
              }
            })
        )
      }

      await Promise.all(tasks)
    },

    async deleteCrossPosts(topicUri: string, did: string): Promise<void> {
      const rows = await db.select().from(crossPosts).where(eq(crossPosts.topicUri, topicUri))

      for (const row of rows) {
        const rkey = extractRkey(row.crossPostUri)
        const collection = row.service === 'bluesky' ? BLUESKY_COLLECTION : FRONTPAGE_COLLECTION

        try {
          await pdsClient.deleteRecord(did, collection, rkey)
          logger.info(
            { crossPostUri: row.crossPostUri, service: row.service },
            'Deleted cross-post'
          )
        } catch (err: unknown) {
          logger.warn(
            { err, crossPostUri: row.crossPostUri, service: row.service },
            'Failed to delete cross-post from PDS (best-effort)'
          )
        }
      }

      // Always clean up DB rows regardless of PDS delete success
      await db.delete(crossPosts).where(eq(crossPosts.topicUri, topicUri))
    },
  }
}

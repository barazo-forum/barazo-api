import { eq } from "drizzle-orm";
import type { PdsClient } from "../lib/pds-client.js";
import type { Logger } from "../lib/logger.js";
import type { Database } from "../db/index.js";
import { crossPosts } from "../db/schema/cross-posts.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum grapheme length for Bluesky post text. */
const BLUESKY_TEXT_LIMIT = 300;

/** Maximum length for the Bluesky embed description. */
const EMBED_DESCRIPTION_LIMIT = 300;

/** AT Protocol collection for Bluesky posts. */
const BLUESKY_COLLECTION = "app.bsky.feed.post";

/** AT Protocol collection for Frontpage link submissions. */
const FRONTPAGE_COLLECTION = "fyi.frontpage.post";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossPostParams {
  did: string;
  topicUri: string;
  title: string;
  content: string;
  category: string;
}

export interface CrossPostService {
  crossPostTopic(params: CrossPostParams): Promise<void>;
  deleteCrossPosts(topicUri: string, did: string): Promise<void>;
}

export interface CrossPostConfig {
  blueskyEnabled: boolean;
  frontpageEnabled: boolean;
  publicUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the rkey from an AT URI.
 * Format: at://did:plc:xxx/collection/rkey
 */
function extractRkey(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * Truncate text to a maximum number of characters, appending ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "\u2026";
}

/**
 * Build the Bluesky post text from topic title and content.
 * Format: "{title}\n\n{truncated content}" (fitting within BLUESKY_TEXT_LIMIT).
 */
function buildBlueskyPostText(title: string, content: string): string {
  const prefix = title + "\n\n";
  const remainingChars = BLUESKY_TEXT_LIMIT - prefix.length;

  if (remainingChars <= 0) {
    return truncate(title, BLUESKY_TEXT_LIMIT);
  }

  return prefix + truncate(content, remainingChars);
}

/**
 * Build the public URL for a topic from its AT URI.
 */
function buildTopicUrl(publicUrl: string, topicUri: string): string {
  const rkey = extractRkey(topicUri);
  return `${publicUrl}/topics/${rkey}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a cross-posting service that publishes topics to external platforms
 * (Bluesky, Frontpage) via the user's PDS.
 *
 * Cross-posts are fire-and-forget: failures are logged but do not block
 * topic creation. Each service is independent -- a failure in one does
 * not prevent the other from succeeding.
 */
export function createCrossPostService(
  pdsClient: PdsClient,
  db: Database,
  logger: Logger,
  config: CrossPostConfig,
): CrossPostService {
  /**
   * Cross-post a topic to Bluesky as an `app.bsky.feed.post` record
   * with an `app.bsky.embed.external` embed containing a link back
   * to the forum topic.
   */
  async function crossPostToBluesky(params: CrossPostParams): Promise<void> {
    const topicUrl = buildTopicUrl(config.publicUrl, params.topicUri);
    const postText = buildBlueskyPostText(params.title, params.content);

    const record: Record<string, unknown> = {
      $type: BLUESKY_COLLECTION,
      text: postText,
      createdAt: new Date().toISOString(),
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: topicUrl,
          title: params.title,
          description: truncate(params.content, EMBED_DESCRIPTION_LIMIT),
        },
      },
      langs: ["en"],
    };

    const result = await pdsClient.createRecord(
      params.did,
      BLUESKY_COLLECTION,
      record,
    );

    await db.insert(crossPosts).values({
      topicUri: params.topicUri,
      service: "bluesky",
      crossPostUri: result.uri,
      crossPostCid: result.cid,
      authorDid: params.did,
    });

    logger.info(
      { topicUri: params.topicUri, crossPostUri: result.uri },
      "Cross-posted topic to Bluesky",
    );
  }

  /**
   * Cross-post a topic to Frontpage as an `fyi.frontpage.post` record
   * (link submission pointing back to the forum topic).
   */
  async function crossPostToFrontpage(params: CrossPostParams): Promise<void> {
    const topicUrl = buildTopicUrl(config.publicUrl, params.topicUri);

    const record: Record<string, unknown> = {
      title: params.title,
      url: topicUrl,
      createdAt: new Date().toISOString(),
    };

    const result = await pdsClient.createRecord(
      params.did,
      FRONTPAGE_COLLECTION,
      record,
    );

    await db.insert(crossPosts).values({
      topicUri: params.topicUri,
      service: "frontpage",
      crossPostUri: result.uri,
      crossPostCid: result.cid,
      authorDid: params.did,
    });

    logger.info(
      { topicUri: params.topicUri, crossPostUri: result.uri },
      "Cross-posted topic to Frontpage",
    );
  }

  return {
    async crossPostTopic(params: CrossPostParams): Promise<void> {
      const tasks: Promise<PromiseSettledResult<void>>[] = [];

      if (config.blueskyEnabled) {
        tasks.push(
          crossPostToBluesky(params)
            .then<PromiseSettledResult<void>>(() => ({
              status: "fulfilled" as const,
              value: undefined,
            }))
            .catch<PromiseSettledResult<void>>((err: unknown) => {
              logger.error(
                { err, topicUri: params.topicUri, service: "bluesky" },
                "Failed to cross-post to Bluesky",
              );
              return {
                status: "rejected" as const,
                reason: err,
              };
            }),
        );
      }

      if (config.frontpageEnabled) {
        tasks.push(
          crossPostToFrontpage(params)
            .then<PromiseSettledResult<void>>(() => ({
              status: "fulfilled" as const,
              value: undefined,
            }))
            .catch<PromiseSettledResult<void>>((err: unknown) => {
              logger.error(
                { err, topicUri: params.topicUri, service: "frontpage" },
                "Failed to cross-post to Frontpage",
              );
              return {
                status: "rejected" as const,
                reason: err,
              };
            }),
        );
      }

      await Promise.all(tasks);
    },

    async deleteCrossPosts(topicUri: string, did: string): Promise<void> {
      const rows = await db
        .select()
        .from(crossPosts)
        .where(eq(crossPosts.topicUri, topicUri));

      for (const row of rows) {
        const rkey = extractRkey(row.crossPostUri);
        const collection =
          row.service === "bluesky"
            ? BLUESKY_COLLECTION
            : FRONTPAGE_COLLECTION;

        try {
          await pdsClient.deleteRecord(did, collection, rkey);
          logger.info(
            { crossPostUri: row.crossPostUri, service: row.service },
            "Deleted cross-post",
          );
        } catch (err: unknown) {
          logger.warn(
            { err, crossPostUri: row.crossPostUri, service: row.service },
            "Failed to delete cross-post from PDS (best-effort)",
          );
        }
      }

      // Always clean up DB rows regardless of PDS delete success
      await db
        .delete(crossPosts)
        .where(eq(crossPosts.topicUri, topicUri));
    },
  };
}

import { sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import type { Logger } from '../lib/logger.js'
import { interactionGraph } from '../db/schema/interaction-graph.js'
import { replies } from '../db/schema/replies.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteractionGraphService {
  recordReply(replierDid: string, topicAuthorDid: string, communityId: string): Promise<void>
  recordReaction(reactorDid: string, contentAuthorDid: string, communityId: string): Promise<void>
  recordCoParticipation(topicUri: string, communityId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_COPARTICIPATION_AUTHORS = 50

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInteractionGraphService(
  db: Database,
  logger: Logger
): InteractionGraphService {
  async function upsertInteraction(
    sourceDid: string,
    targetDid: string,
    communityId: string,
    interactionType: 'reply' | 'reaction' | 'topic_coparticipation'
  ): Promise<void> {
    // Skip self-interaction
    if (sourceDid === targetDid) return

    await db
      .insert(interactionGraph)
      .values({
        sourceDid,
        targetDid,
        communityId,
        interactionType,
        weight: 1,
        firstInteractionAt: new Date(),
        lastInteractionAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          interactionGraph.sourceDid,
          interactionGraph.targetDid,
          interactionGraph.communityId,
          interactionGraph.interactionType,
        ],
        set: {
          weight: sql`${interactionGraph.weight} + 1`,
          lastInteractionAt: new Date(),
        },
      })
  }

  async function recordReply(
    replierDid: string,
    topicAuthorDid: string,
    communityId: string
  ): Promise<void> {
    await upsertInteraction(replierDid, topicAuthorDid, communityId, 'reply')
    logger.debug({ replierDid, topicAuthorDid, communityId }, 'Recorded reply interaction')
  }

  async function recordReaction(
    reactorDid: string,
    contentAuthorDid: string,
    communityId: string
  ): Promise<void> {
    await upsertInteraction(reactorDid, contentAuthorDid, communityId, 'reaction')
    logger.debug({ reactorDid, contentAuthorDid, communityId }, 'Recorded reaction interaction')
  }

  async function recordCoParticipation(topicUri: string, communityId: string): Promise<void> {
    // Get unique reply authors for the topic
    const authorRows = await db
      .select({ authorDid: replies.authorDid })
      .from(replies)
      .where(sql`${replies.rootUri} = ${topicUri}`)

    // Deduplicate
    const uniqueAuthors = [...new Set(authorRows.map((r) => r.authorDid))]

    // Skip if too many authors or not enough for pairs
    if (uniqueAuthors.length > MAX_COPARTICIPATION_AUTHORS || uniqueAuthors.length < 2) {
      if (uniqueAuthors.length > MAX_COPARTICIPATION_AUTHORS) {
        logger.debug(
          { topicUri, authorCount: uniqueAuthors.length },
          'Skipping co-participation: too many authors'
        )
      }
      return
    }

    // Create pairwise interactions
    for (let i = 0; i < uniqueAuthors.length; i++) {
      const authorA = uniqueAuthors[i]
      if (!authorA) continue
      for (let j = i + 1; j < uniqueAuthors.length; j++) {
        const authorB = uniqueAuthors[j]
        if (!authorB) continue
        await upsertInteraction(authorA, authorB, communityId, 'topic_coparticipation')
      }
    }

    logger.debug(
      { topicUri, authorCount: uniqueAuthors.length, communityId },
      'Recorded co-participation interactions'
    )
  }

  return { recordReply, recordReaction, recordCoParticipation }
}

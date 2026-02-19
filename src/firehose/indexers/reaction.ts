import { eq, sql } from 'drizzle-orm'
import { reactions } from '../../db/schema/reactions.js'
import { topics } from '../../db/schema/topics.js'
import { replies } from '../../db/schema/replies.js'
import type { Database } from '../../db/index.js'
import type { Logger } from '../../lib/logger.js'

const TOPIC_COLLECTION = 'forum.barazo.topic.post'
const REPLY_COLLECTION = 'forum.barazo.topic.reply'

interface CreateParams {
  uri: string
  rkey: string
  did: string
  cid: string
  record: Record<string, unknown>
  live: boolean
}

interface DeleteParams {
  uri: string
  rkey: string
  did: string
  subjectUri: string
}

function getCollectionFromUri(uri: string): string | undefined {
  // AT URI format: at://did/collection/rkey
  const parts = uri.split('/')
  // parts: ["at:", "", "did", "collection", "rkey"] for at://did/collection/rkey
  // But NSID collections have dots, so we need index 3
  return parts[3]
}

export class ReactionIndexer {
  constructor(
    private db: Database,
    private logger: Logger
  ) {}

  async handleCreate(params: CreateParams): Promise<void> {
    const { uri, rkey, did, cid, record } = params
    const subject = record['subject'] as { uri: string; cid: string }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(reactions)
        .values({
          uri,
          rkey,
          authorDid: did,
          subjectUri: subject.uri,
          subjectCid: subject.cid,
          type: record['type'] as string,
          communityDid: record['community'] as string,
          cid,
          createdAt: new Date(record['createdAt'] as string),
        })
        .onConflictDoNothing()

      await this.incrementReactionCount(tx as never, subject.uri)
    })

    this.logger.debug({ uri, did }, 'Indexed reaction')
  }

  async handleDelete(params: DeleteParams): Promise<void> {
    const { uri, subjectUri } = params

    await this.db.transaction(async (tx) => {
      await tx.delete(reactions).where(eq(reactions.uri, uri))
      await this.decrementReactionCount(tx as never, subjectUri)
    })

    this.logger.debug({ uri }, 'Deleted reaction')
  }

  private async incrementReactionCount(tx: Database, subjectUri: string): Promise<void> {
    const collection = getCollectionFromUri(subjectUri)

    if (collection === TOPIC_COLLECTION) {
      await tx
        .update(topics)
        .set({ reactionCount: sql`${topics.reactionCount} + 1` })
        .where(eq(topics.uri, subjectUri))
    } else if (collection === REPLY_COLLECTION) {
      await tx
        .update(replies)
        .set({ reactionCount: sql`${replies.reactionCount} + 1` })
        .where(eq(replies.uri, subjectUri))
    }
  }

  private async decrementReactionCount(tx: Database, subjectUri: string): Promise<void> {
    const collection = getCollectionFromUri(subjectUri)

    if (collection === TOPIC_COLLECTION) {
      await tx
        .update(topics)
        .set({
          reactionCount: sql`GREATEST(${topics.reactionCount} - 1, 0)`,
        })
        .where(eq(topics.uri, subjectUri))
    } else if (collection === REPLY_COLLECTION) {
      await tx
        .update(replies)
        .set({
          reactionCount: sql`GREATEST(${replies.reactionCount} - 1, 0)`,
        })
        .where(eq(replies.uri, subjectUri))
    }
  }
}

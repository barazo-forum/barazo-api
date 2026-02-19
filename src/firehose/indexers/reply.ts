import { eq, sql } from 'drizzle-orm'
import { replies } from '../../db/schema/replies.js'
import { topics } from '../../db/schema/topics.js'
import type { Database } from '../../db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { TrustStatus } from '../../services/account-age.js'

interface CreateParams {
  uri: string
  rkey: string
  did: string
  cid: string
  record: Record<string, unknown>
  live: boolean
  trustStatus: TrustStatus
}

interface UpdateParams {
  uri: string
  rkey: string
  did: string
  cid: string
  record: Record<string, unknown>
  live: boolean
  trustStatus: TrustStatus
}

interface DeleteParams {
  uri: string
  rkey: string
  did: string
  rootUri: string
}

export class ReplyIndexer {
  constructor(
    private db: Database,
    private logger: Logger
  ) {}

  async handleCreate(params: CreateParams): Promise<void> {
    const { uri, rkey, did, cid, record, trustStatus } = params

    const root = record['root'] as { uri: string; cid: string }
    const parent = record['parent'] as { uri: string; cid: string }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(replies)
        .values({
          uri,
          rkey,
          authorDid: did,
          content: record['content'] as string,
          contentFormat: (record['contentFormat'] as string | undefined) ?? null,
          rootUri: root.uri,
          rootCid: root.cid,
          parentUri: parent.uri,
          parentCid: parent.cid,
          communityDid: record['community'] as string,
          cid,
          labels: (record['labels'] as { values: { val: string }[] } | undefined) ?? null,
          createdAt: new Date(record['createdAt'] as string),
          trustStatus,
        })
        .onConflictDoNothing()

      // Increment reply count and update last activity
      await tx
        .update(topics)
        .set({
          replyCount: sql`${topics.replyCount} + 1`,
          lastActivityAt: new Date(),
        })
        .where(eq(topics.uri, root.uri))
    })

    this.logger.debug({ uri, did, trustStatus }, 'Indexed reply')
  }

  async handleUpdate(params: UpdateParams): Promise<void> {
    const { uri, cid, record } = params

    await this.db
      .update(replies)
      .set({
        content: record['content'] as string,
        contentFormat: (record['contentFormat'] as string | undefined) ?? null,
        cid,
        labels: (record['labels'] as { values: { val: string }[] } | undefined) ?? null,
        indexedAt: new Date(),
      })
      .where(eq(replies.uri, uri))

    this.logger.debug({ uri }, 'Updated reply')
  }

  async handleDelete(params: DeleteParams): Promise<void> {
    const { uri, rootUri } = params

    await this.db.transaction(async (tx) => {
      await tx.delete(replies).where(eq(replies.uri, uri))

      // Decrement reply count (floor at 0 via GREATEST)
      await tx
        .update(topics)
        .set({
          replyCount: sql`GREATEST(${topics.replyCount} - 1, 0)`,
        })
        .where(eq(topics.uri, rootUri))
    })

    this.logger.debug({ uri }, 'Deleted reply')
  }
}

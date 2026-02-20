import { eq } from 'drizzle-orm'
import { topics } from '../../db/schema/topics.js'
import type { Database } from '../../db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { TrustStatus } from '../../services/account-age.js'
import { clampCreatedAt } from '../clamp-timestamp.js'
import { sanitizeHtml, sanitizeText } from '../../lib/sanitize.js'

interface CreateParams {
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
}

export class TopicIndexer {
  constructor(
    private db: Database,
    private logger: Logger
  ) {}

  async handleCreate(params: CreateParams): Promise<void> {
    const { uri, rkey, did, cid, record, live, trustStatus } = params
    const clientCreatedAt = new Date(record['createdAt'] as string)
    const createdAt = live ? clampCreatedAt(clientCreatedAt) : clientCreatedAt

    await this.db
      .insert(topics)
      .values({
        uri,
        rkey,
        authorDid: did,
        title: sanitizeText(record['title'] as string),
        content: sanitizeHtml(record['content'] as string),
        contentFormat: (record['contentFormat'] as string | undefined) ?? null,
        category: record['category'] as string,
        tags: (record['tags'] as string[] | undefined) ?? null,
        communityDid: record['community'] as string,
        cid,
        labels: (record['labels'] as { values: { val: string }[] } | undefined) ?? null,
        createdAt,
        lastActivityAt: createdAt,
        trustStatus,
      })
      .onConflictDoUpdate({
        target: topics.uri,
        set: {
          title: sanitizeText(record['title'] as string),
          content: sanitizeHtml(record['content'] as string),
          contentFormat: (record['contentFormat'] as string | undefined) ?? null,
          category: record['category'] as string,
          tags: (record['tags'] as string[] | undefined) ?? null,
          cid,
          labels: (record['labels'] as { values: { val: string }[] } | undefined) ?? null,
          indexedAt: new Date(),
        },
      })

    this.logger.debug({ uri, did, trustStatus }, 'Indexed topic')
  }

  async handleUpdate(params: CreateParams): Promise<void> {
    const { uri, cid, record } = params

    await this.db
      .update(topics)
      .set({
        title: sanitizeText(record['title'] as string),
        content: sanitizeHtml(record['content'] as string),
        contentFormat: (record['contentFormat'] as string | undefined) ?? null,
        category: record['category'] as string,
        tags: (record['tags'] as string[] | undefined) ?? null,
        cid,
        labels: (record['labels'] as { values: { val: string }[] } | undefined) ?? null,
        indexedAt: new Date(),
      })
      .where(eq(topics.uri, uri))

    this.logger.debug({ uri }, 'Updated topic')
  }

  async handleDelete(params: DeleteParams): Promise<void> {
    const { uri } = params

    await this.db.update(topics).set({ isAuthorDeleted: true }).where(eq(topics.uri, uri))

    this.logger.debug({ uri }, 'Soft-deleted topic (author delete)')
  }
}

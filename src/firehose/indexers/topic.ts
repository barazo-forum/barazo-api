import { eq } from "drizzle-orm";
import { topics } from "../../db/schema/topics.js";
import type { Database } from "../../db/index.js";
import type { Logger } from "../../lib/logger.js";
import type { TrustStatus } from "../../services/account-age.js";

interface CreateParams {
  uri: string;
  rkey: string;
  did: string;
  cid: string;
  record: Record<string, unknown>;
  live: boolean;
  trustStatus: TrustStatus;
}

interface DeleteParams {
  uri: string;
  rkey: string;
  did: string;
}

export class TopicIndexer {
  constructor(
    private db: Database,
    private logger: Logger,
  ) {}

  async handleCreate(params: CreateParams): Promise<void> {
    const { uri, rkey, did, cid, record, trustStatus } = params;

    await this.db
      .insert(topics)
      .values({
        uri,
        rkey,
        authorDid: did,
        title: record["title"] as string,
        content: record["content"] as string,
        contentFormat: (record["contentFormat"] as string | undefined) ?? null,
        category: record["category"] as string,
        tags: (record["tags"] as string[] | undefined) ?? null,
        communityDid: record["community"] as string,
        cid,
        labels: (record["labels"] as { values: { val: string }[] } | undefined) ?? null,
        createdAt: new Date(record["createdAt"] as string),
        lastActivityAt: new Date(record["createdAt"] as string),
        trustStatus,
      })
      .onConflictDoUpdate({
        target: topics.uri,
        set: {
          title: record["title"] as string,
          content: record["content"] as string,
          contentFormat: (record["contentFormat"] as string | undefined) ?? null,
          category: record["category"] as string,
          tags: (record["tags"] as string[] | undefined) ?? null,
          cid,
          labels: (record["labels"] as { values: { val: string }[] } | undefined) ?? null,
          indexedAt: new Date(),
        },
      });

    this.logger.debug({ uri, did, trustStatus }, "Indexed topic");
  }

  async handleUpdate(params: CreateParams): Promise<void> {
    const { uri, cid, record } = params;

    await this.db
      .update(topics)
      .set({
        title: record["title"] as string,
        content: record["content"] as string,
        contentFormat: (record["contentFormat"] as string | undefined) ?? null,
        category: record["category"] as string,
        tags: (record["tags"] as string[] | undefined) ?? null,
        cid,
        labels: (record["labels"] as { values: { val: string }[] } | undefined) ?? null,
        indexedAt: new Date(),
      })
      .where(eq(topics.uri, uri));

    this.logger.debug({ uri }, "Updated topic");
  }

  async handleDelete(params: DeleteParams): Promise<void> {
    const { uri } = params;

    await this.db.delete(topics).where(eq(topics.uri, uri));

    this.logger.debug({ uri }, "Deleted topic");
  }
}

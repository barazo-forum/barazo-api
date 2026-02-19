import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import type { RecordEvent as TapRecordEvent, IdentityEvent as TapIdentityEvent } from '@atproto/tap'
import type { Database } from '../db/index.js'
import type { Logger } from '../lib/logger.js'
import type { Env } from '../config/env.js'
import { CursorStore } from './cursor.js'
import { RepoManager } from './repo-manager.js'
import { TopicIndexer } from './indexers/topic.js'
import { ReplyIndexer } from './indexers/reply.js'
import { ReactionIndexer } from './indexers/reaction.js'
import { RecordHandler } from './handlers/record.js'
import { IdentityHandler } from './handlers/identity.js'
import { createAccountAgeService } from '../services/account-age.js'
import type { RecordEvent, IdentityEvent } from './types.js'

interface FirehoseStatus {
  connected: boolean
  lastEventId: number | null
}

export class FirehoseService {
  private tap: Tap
  private channel: TapChannel | null = null
  private cursorStore: CursorStore
  private repoManager: RepoManager
  private recordHandler: RecordHandler
  private identityHandler: IdentityHandler
  private connected = false
  private lastEventId: number | null = null

  constructor(
    db: Database,
    private logger: Logger,
    env: Env
  ) {
    this.tap = new Tap(env.TAP_URL, {
      adminPassword: env.TAP_ADMIN_PASSWORD,
    })

    this.cursorStore = new CursorStore(db)
    this.repoManager = new RepoManager(db, this.tap, logger)

    const topicIndexer = new TopicIndexer(db, logger)
    const replyIndexer = new ReplyIndexer(db, logger)
    const reactionIndexer = new ReactionIndexer(db, logger)
    const accountAgeService = createAccountAgeService(logger)

    this.recordHandler = new RecordHandler(
      { topic: topicIndexer, reply: replyIndexer, reaction: reactionIndexer },
      db,
      logger,
      accountAgeService
    )

    this.identityHandler = new IdentityHandler(db, logger)
  }

  async start(): Promise<void> {
    try {
      await this.repoManager.restoreTrackedRepos()

      const indexer = new SimpleIndexer()

      indexer.record(async (evt: TapRecordEvent) => {
        const event: RecordEvent = {
          id: evt.id,
          action: evt.action,
          did: evt.did,
          rev: evt.rev,
          collection: evt.collection,
          rkey: evt.rkey,
          ...(evt.record !== undefined ? { record: evt.record as Record<string, unknown> } : {}),
          ...(evt.cid !== undefined ? { cid: evt.cid } : {}),
          live: evt.live,
        }

        await this.recordHandler.handle(event)
        this.lastEventId = evt.id
        this.cursorStore.saveCursor(BigInt(evt.id))
      })

      indexer.identity(async (evt: TapIdentityEvent) => {
        const event: IdentityEvent = {
          id: evt.id,
          did: evt.did,
          handle: evt.handle,
          isActive: evt.isActive,
          status: evt.status,
        }

        await this.identityHandler.handle(event)
        this.lastEventId = evt.id
        this.cursorStore.saveCursor(BigInt(evt.id))
      })

      indexer.error((err: Error) => {
        this.logger.error({ err }, 'Firehose indexer error')
      })

      this.channel = this.tap.channel(indexer)
      // Start in background (non-blocking)
      void this.channel.start().catch((err: unknown) => {
        this.logger.error({ err }, 'Firehose channel error')
        this.connected = false
      })

      this.connected = true
      this.logger.info('Firehose subscription started')
    } catch (err) {
      this.logger.error({ err }, 'Failed to start firehose service')
      this.connected = false
    }
  }

  async stop(): Promise<void> {
    if (this.channel) {
      await this.channel.destroy()
      this.channel = null
    }
    await this.cursorStore.flush()
    this.connected = false
    this.logger.info('Firehose subscription stopped')
  }

  getStatus(): FirehoseStatus {
    return {
      connected: this.connected,
      lastEventId: this.lastEventId,
    }
  }

  getRepoManager(): RepoManager {
    return this.repoManager
  }
}

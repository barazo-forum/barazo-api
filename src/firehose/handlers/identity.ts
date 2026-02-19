import { eq } from 'drizzle-orm'
import { users } from '../../db/schema/users.js'
import { topics } from '../../db/schema/topics.js'
import { replies } from '../../db/schema/replies.js'
import { reactions } from '../../db/schema/reactions.js'
import { trackedRepos } from '../../db/schema/tracked-repos.js'
import type { Database } from '../../db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { IdentityEvent } from '../types.js'

export class IdentityHandler {
  constructor(
    private db: Database,
    private logger: Logger
  ) {}

  async handle(event: IdentityEvent): Promise<void> {
    const { did, handle, status } = event

    switch (status) {
      case 'deleted':
        await this.purgeAccount(did)
        this.logger.info({ did }, 'Purged all data for deleted account')
        break

      case 'active':
        await this.upsertUser(did, handle)
        this.logger.debug({ did, handle }, 'Identity active')
        break

      case 'takendown':
      case 'suspended':
      case 'deactivated':
        this.logger.info({ did, handle, status }, 'Identity status change')
        break
    }
  }

  private async purgeAccount(did: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(reactions).where(eq(reactions.authorDid, did))
      await tx.delete(replies).where(eq(replies.authorDid, did))
      await tx.delete(topics).where(eq(topics.authorDid, did))
      await tx.delete(users).where(eq(users.did, did))
      await tx.delete(trackedRepos).where(eq(trackedRepos.did, did))
    })
  }

  private async upsertUser(did: string, handle: string): Promise<void> {
    await this.db
      .insert(users)
      .values({
        did,
        handle,
      })
      .onConflictDoUpdate({
        target: users.did,
        set: {
          handle,
          lastActiveAt: new Date(),
        },
      })
  }
}

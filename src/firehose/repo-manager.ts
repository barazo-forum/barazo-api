import { eq } from 'drizzle-orm'
import { trackedRepos } from '../db/schema/tracked-repos.js'
import type { Database } from '../db/index.js'
import type { Logger } from '../lib/logger.js'
import type { TapClient } from './types.js'

const BATCH_SIZE = 100

export class RepoManager {
  constructor(
    private db: Database,
    private tap: TapClient,
    private logger: Logger
  ) {}

  async trackRepo(did: string): Promise<void> {
    await this.db.insert(trackedRepos).values({ did }).onConflictDoNothing()

    await this.tap.addRepos([did])

    this.logger.debug({ did }, 'Tracked repo')
  }

  async untrackRepo(did: string): Promise<void> {
    await this.db.delete(trackedRepos).where(eq(trackedRepos.did, did))

    await this.tap.removeRepos([did])

    this.logger.debug({ did }, 'Untracked repo')
  }

  async restoreTrackedRepos(): Promise<void> {
    const rows = await this.db.select().from(trackedRepos)

    if (rows.length === 0) {
      this.logger.info('No tracked repos to restore')
      return
    }

    const dids = rows.map((r) => r.did)

    // Batch into chunks of BATCH_SIZE
    for (let i = 0; i < dids.length; i += BATCH_SIZE) {
      const batch = dids.slice(i, i + BATCH_SIZE)
      await this.tap.addRepos(batch)
    }

    this.logger.info({ count: dids.length }, 'Restored tracked repos')
  }

  async isTracked(did: string): Promise<boolean> {
    const rows = await this.db.select().from(trackedRepos).where(eq(trackedRepos.did, did))

    return rows.length > 0
  }
}

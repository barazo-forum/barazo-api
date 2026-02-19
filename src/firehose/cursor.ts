import { eq } from 'drizzle-orm'
import { firehoseCursor } from '../db/schema/firehose.js'
import type { Database } from '../db/index.js'

const DEFAULT_DEBOUNCE_MS = 5000

export class CursorStore {
  private db: Database
  private debounceMs: number
  private pendingCursor: bigint | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(db: Database, debounceMs = DEFAULT_DEBOUNCE_MS) {
    this.db = db
    this.debounceMs = debounceMs
  }

  async getCursor(): Promise<bigint | null> {
    const rows = await this.db.select().from(firehoseCursor).where(eq(firehoseCursor.id, 'default'))

    const row = rows[0]
    return row?.cursor ?? null
  }

  saveCursor(cursor: bigint): void {
    this.pendingCursor = cursor

    if (this.timer !== null) {
      return
    }

    this.timer = setTimeout(() => {
      void this.writeCursor()
    }, this.debounceMs)
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.writeCursor()
  }

  private async writeCursor(): Promise<void> {
    this.timer = null
    const cursor = this.pendingCursor
    if (cursor === null) {
      return
    }
    this.pendingCursor = null

    await this.db
      .update(firehoseCursor)
      .set({ cursor, updatedAt: new Date() })
      .where(eq(firehoseCursor.id, 'default'))
  }
}

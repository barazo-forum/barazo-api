import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 5,
  })

  const db = drizzle(client, { schema })

  return { db, client }
}

/**
 * Run pending Drizzle migrations against the database.
 * Idempotent -- already-applied migrations are skipped.
 */
export async function runMigrations(databaseUrl: string, migrationsFolder: string): Promise<void> {
  const migrationClient = postgres(databaseUrl, { max: 1 })
  const migrationDb = drizzle(migrationClient)
  await migrate(migrationDb, { migrationsFolder })
  await migrationClient.end()
}

export type Database = ReturnType<typeof createDb>['db']

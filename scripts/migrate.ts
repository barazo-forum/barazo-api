/* eslint-disable no-console -- CLI script, console is appropriate */
import { runMigrations } from '../src/db/index.js'

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const migrationsFolder = new URL('../drizzle', import.meta.url).pathname

try {
  await runMigrations(databaseUrl, migrationsFolder)
  console.log('Migrations applied successfully')
} catch (error) {
  console.error('Migration failed:', error)
  process.exit(1)
}

process.exit(0)

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import type { Logger } from '../logger.js'

import { pluginManifestSchema, type PluginManifest } from '../../validation/plugin-manifest.js'

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

export function topologicalSort(manifests: PluginManifest[]): PluginManifest[] {
  const nameToManifest = new Map<string, PluginManifest>()
  for (const m of manifests) {
    nameToManifest.set(m.name, m)
  }

  const sorted: PluginManifest[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected involving plugin "${name}"`)
    }

    visiting.add(name)
    const manifest = nameToManifest.get(name)
    if (manifest?.dependencies) {
      for (const dep of manifest.dependencies) {
        if (nameToManifest.has(dep)) {
          visit(dep)
        }
      }
    }
    visiting.delete(name)
    visited.add(name)
    if (manifest) {
      sorted.push(manifest)
    }
  }

  for (const m of manifests) {
    visit(m.name)
  }

  return sorted
}

// ---------------------------------------------------------------------------
// Validate and filter
// ---------------------------------------------------------------------------

export function validateAndFilterPlugins(
  rawManifests: unknown[],
  _barazoVersion: string,
  logger: Logger
): PluginManifest[] {
  const valid: PluginManifest[] = []

  for (const raw of rawManifests) {
    const result = pluginManifestSchema.safeParse(raw)
    if (!result.success) {
      const name = (raw as Record<string, unknown>).name ?? 'unknown'
      logger.warn({ name, errors: result.error.issues }, 'Skipping invalid plugin manifest')
      continue
    }
    valid.push(result.data)
  }

  // Check that all declared dependencies exist in the valid set
  const validNames = new Set(valid.map((m) => m.name))
  const filtered: PluginManifest[] = []

  for (const manifest of valid) {
    const missingDeps = (manifest.dependencies ?? []).filter((dep) => !validNames.has(dep))
    if (missingDeps.length > 0) {
      logger.warn(
        { plugin: manifest.name, missingDeps },
        'Skipping plugin with missing dependencies'
      )
      continue
    }
    filtered.push(manifest)
  }

  return filtered
}

// ---------------------------------------------------------------------------
// Discover plugins from node_modules
// ---------------------------------------------------------------------------

export async function discoverPlugins(
  nodeModulesPath: string,
  logger: Logger
): Promise<{ manifest: PluginManifest; packagePath: string }[]> {
  const results: { manifest: PluginManifest; packagePath: string }[] = []

  // Scan @barazo/plugin-* (scoped packages)
  const scopedDir = join(nodeModulesPath, '@barazo')
  try {
    const entries = await readdir(scopedDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('plugin-')) {
        const packagePath = join(scopedDir, entry.name)
        const manifest = await tryReadManifest(packagePath, logger)
        if (manifest) {
          results.push({ manifest, packagePath })
        }
      }
    }
  } catch {
    // @barazo directory may not exist -- that is fine
  }

  // Scan barazo-plugin-* (unscoped packages)
  try {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('barazo-plugin-')) {
        const packagePath = join(nodeModulesPath, entry.name)
        const manifest = await tryReadManifest(packagePath, logger)
        if (manifest) {
          results.push({ manifest, packagePath })
        }
      }
    }
  } catch {
    // node_modules may not exist -- that is fine
  }

  return results
}

async function tryReadManifest(
  packagePath: string,
  logger: Logger
): Promise<PluginManifest | null> {
  try {
    const raw = await readFile(join(packagePath, 'plugin.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const result = pluginManifestSchema.safeParse(parsed)
    if (!result.success) {
      logger.warn({ packagePath, errors: result.error.issues }, 'Invalid plugin.json, skipping')
      return null
    }
    return result.data
  } catch {
    // No plugin.json or unreadable -- skip silently
    return null
  }
}

// ---------------------------------------------------------------------------
// Sync discovered plugins to database
// ---------------------------------------------------------------------------

interface DbExecutor {
  execute(query: unknown): Promise<unknown>
}

export async function syncPluginsToDb(
  discovered: { manifest: PluginManifest; packagePath: string }[],
  db: DbExecutor,
  logger: Logger
): Promise<{ newPlugins: string[] }> {
  const existingRows = (await db.execute(sql`SELECT name FROM plugins`)) as Array<{
    name: string
  }>
  const existingNames = new Set(existingRows.map((r) => r.name))
  const newPlugins: string[] = []

  for (const { manifest } of discovered) {
    if (!existingNames.has(manifest.name)) {
      newPlugins.push(manifest.name)
    }
    const manifestJson = JSON.stringify(manifest)

    // Upsert plugin -- new plugins are inserted as disabled
    await db.execute(sql`
      INSERT INTO plugins (id, name, display_name, version, description, source, category, enabled, manifest_json, installed_at, updated_at)
      VALUES (gen_random_uuid(), ${manifest.name}, ${manifest.displayName}, ${manifest.version}, ${manifest.description}, ${manifest.source}, ${manifest.category}, false, ${manifestJson}::jsonb, now(), now())
      ON CONFLICT (name) DO UPDATE SET
        version = EXCLUDED.version,
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        source = EXCLUDED.source,
        category = EXCLUDED.category,
        manifest_json = EXCLUDED.manifest_json,
        updated_at = now()
    `)

    // Sync permissions: delete old, insert current
    const allPermissions = [...manifest.permissions.backend, ...manifest.permissions.frontend]

    await db.execute(sql`
      DELETE FROM plugin_permissions
      WHERE plugin_id = (SELECT id FROM plugins WHERE name = ${manifest.name})
    `)

    for (const permission of allPermissions) {
      await db.execute(sql`
        INSERT INTO plugin_permissions (id, plugin_id, permission, granted_at)
        VALUES (
          gen_random_uuid(),
          (SELECT id FROM plugins WHERE name = ${manifest.name}),
          ${permission},
          now()
        )
      `)
    }

    logger.info({ plugin: manifest.name, version: manifest.version }, 'Synced plugin to database')
  }

  return { newPlugins }
}

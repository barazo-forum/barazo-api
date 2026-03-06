import { join } from 'node:path'

import type { Logger } from '../logger.js'

import type { PluginContext, PluginHooks, LoadedPlugin } from './types.js'
import type { PluginManifest } from '../../validation/plugin-manifest.js'

// ---------------------------------------------------------------------------
// Hook reference parsing
// ---------------------------------------------------------------------------

export function resolveHookRef(ref: string): { modulePath: string; exportName: string } | null {
  const hashIndex = ref.indexOf('#')
  if (hashIndex <= 0) return null
  return {
    modulePath: ref.slice(0, hashIndex),
    exportName: ref.slice(hashIndex + 1),
  }
}

// ---------------------------------------------------------------------------
// Plugin short name
// ---------------------------------------------------------------------------

export function getPluginShortName(name: string): string {
  if (name.startsWith('@barazo/plugin-')) return name.slice('@barazo/plugin-'.length)
  if (name.startsWith('barazo-plugin-')) return name.slice('barazo-plugin-'.length)
  return name
}

// ---------------------------------------------------------------------------
// Hook execution
// ---------------------------------------------------------------------------

export async function executeHook(
  hookName: string,
  hookFn: (...args: unknown[]) => Promise<void> | void,
  ctx: PluginContext,
  logger: Logger,
  pluginName: string,
  ...extraArgs: unknown[]
): Promise<boolean> {
  try {
    await hookFn(ctx, ...extraArgs)
    logger.info({ plugin: pluginName, hook: hookName }, 'Plugin hook executed')
    return true
  } catch (err: unknown) {
    logger.error({ err, plugin: pluginName, hook: hookName }, 'Plugin hook failed')
    return false
  }
}

// ---------------------------------------------------------------------------
// Load hooks from manifest
// ---------------------------------------------------------------------------

const HOOK_NAMES = ['onInstall', 'onUninstall', 'onEnable', 'onDisable', 'onProfileSync'] as const

export async function loadPluginHooks(
  packagePath: string,
  manifest: PluginManifest,
  logger: Logger
): Promise<PluginHooks> {
  const hooks: PluginHooks = {}
  const hookEntries = manifest.hooks
  if (!hookEntries) return hooks

  for (const name of HOOK_NAMES) {
    const ref = hookEntries[name]
    if (!ref) continue

    const parsed = resolveHookRef(ref)
    if (!parsed) {
      logger.warn({ plugin: manifest.name, hook: name, ref }, 'Invalid hook reference, skipping')
      continue
    }

    try {
      const fullPath = join(packagePath, parsed.modulePath)
      const mod = (await import(fullPath)) as Record<string, unknown>
      const fn = mod[parsed.exportName]
      if (typeof fn === 'function') {
        // Each hook is assigned individually after type-checking the export.
        ;(hooks as Record<string, unknown>)[name] = fn
      } else {
        logger.warn(
          { plugin: manifest.name, hook: name, export: parsed.exportName },
          'Hook export is not a function'
        )
      }
    } catch (err: unknown) {
      logger.error({ err, plugin: manifest.name, hook: name }, 'Failed to load hook module')
    }
  }

  return hooks
}

// ---------------------------------------------------------------------------
// Build LoadedPlugin from discovery result
// ---------------------------------------------------------------------------

export async function buildLoadedPlugin(
  manifest: PluginManifest,
  packagePath: string,
  logger: Logger
): Promise<LoadedPlugin> {
  const hooks = await loadPluginHooks(packagePath, manifest, logger)

  return {
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    source: manifest.source,
    category: manifest.category,
    manifest: manifest as unknown as Record<string, unknown>,
    packagePath,
    hooks,
    ...(manifest.backend?.routes !== undefined && { routesPath: manifest.backend.routes }),
    ...(manifest.backend?.migrations !== undefined && {
      migrationsPath: manifest.backend.migrations,
    }),
  }
}

import type { Logger } from '../logger.js'

/** Scoped database access for plugins -- queries are restricted to plugin-owned tables. */
export interface ScopedDatabase {
  execute(query: unknown): Promise<unknown>
  query(tableName: string): unknown
}

/** Scoped AT Protocol operations (only available if plugin has pds:read or pds:write permission). */
export interface ScopedAtProto {
  getRecord(did: string, collection: string, rkey: string): Promise<unknown>
  putRecord(did: string, collection: string, rkey: string, record: unknown): Promise<void>
  deleteRecord(did: string, collection: string, rkey: string): Promise<void>
}

/** Scoped Valkey cache -- keys are auto-prefixed with plugin:<name>: */
export interface ScopedCache {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
}

/** Scoped HTTP client (only available if plugin has http:outbound permission). */
export interface ScopedHttp {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

/** Read-only access to plugin settings configured by the community admin. */
export interface PluginSettings {
  get(key: string): unknown
  getAll(): Record<string, unknown>
}

/** The sandbox API surface provided to every plugin. */
export interface PluginContext {
  readonly pluginName: string
  readonly pluginVersion: string
  readonly db: ScopedDatabase
  readonly settings: PluginSettings
  readonly atproto?: ScopedAtProto
  readonly cache?: ScopedCache
  readonly http?: ScopedHttp
  readonly logger: Logger
  readonly communityDid: string
}

/** Lifecycle hooks that a plugin can implement. */
export interface PluginHooks {
  onInstall?(ctx: PluginContext): Promise<void>
  onUninstall?(ctx: PluginContext): Promise<void>
  onEnable?(ctx: PluginContext): Promise<void>
  onDisable?(ctx: PluginContext): Promise<void>
  onProfileSync?(ctx: PluginContext, userDid: string): Promise<void>
}

/** A validated plugin ready for initialization. */
export interface LoadedPlugin {
  name: string
  displayName: string
  version: string
  description: string
  source: 'core' | 'official' | 'community' | 'experimental'
  category: string
  manifest: Record<string, unknown>
  packagePath: string
  hooks?: PluginHooks
  routesPath?: string
  migrationsPath?: string
}

/** Thrown when a plugin attempts an operation it lacks permission for. */
export class PluginPermissionError extends Error {
  constructor(pluginName: string, operation: string) {
    super(`Plugin "${pluginName}" does not have permission for: ${operation}`)
    this.name = 'PluginPermissionError'
  }
}

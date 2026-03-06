import { describe, expect, it, vi } from 'vitest'

import { topologicalSort, validateAndFilterPlugins } from '../../../../src/lib/plugins/loader.js'
import type { PluginManifest } from '../../../../src/validation/plugin-manifest.js'

function makeManifest(overrides: Partial<PluginManifest> & { name: string }): PluginManifest {
  return {
    displayName: overrides.name,
    version: '1.0.0',
    description: 'Test plugin',
    barazoVersion: '^1.0.0',
    source: 'community',
    category: 'social',
    author: { name: 'Test' },
    license: 'MIT',
    permissions: { backend: [], frontend: [] },
    ...overrides,
  }
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
  }
}

describe('topologicalSort', () => {
  it('returns plugins with no dependencies in original order', () => {
    const a = makeManifest({ name: '@barazo/plugin-a' })
    const b = makeManifest({ name: '@barazo/plugin-b' })
    const c = makeManifest({ name: '@barazo/plugin-c' })

    const sorted = topologicalSort([a, b, c])
    expect(sorted.map((m) => m.name)).toEqual([
      '@barazo/plugin-a',
      '@barazo/plugin-b',
      '@barazo/plugin-c',
    ])
  })

  it('orders dependencies before dependents', () => {
    const a = makeManifest({
      name: '@barazo/plugin-a',
      dependencies: ['@barazo/plugin-b'],
    })
    const b = makeManifest({ name: '@barazo/plugin-b' })

    const sorted = topologicalSort([a, b])
    const names = sorted.map((m) => m.name)
    expect(names.indexOf('@barazo/plugin-b')).toBeLessThan(names.indexOf('@barazo/plugin-a'))
  })

  it('handles multi-level dependency chains (A -> B -> C)', () => {
    const a = makeManifest({
      name: '@barazo/plugin-a',
      dependencies: ['@barazo/plugin-b'],
    })
    const b = makeManifest({
      name: '@barazo/plugin-b',
      dependencies: ['@barazo/plugin-c'],
    })
    const c = makeManifest({ name: '@barazo/plugin-c' })

    const sorted = topologicalSort([a, b, c])
    const names = sorted.map((m) => m.name)
    expect(names).toEqual(['@barazo/plugin-c', '@barazo/plugin-b', '@barazo/plugin-a'])
  })

  it('throws on circular dependencies', () => {
    const a = makeManifest({
      name: '@barazo/plugin-a',
      dependencies: ['@barazo/plugin-b'],
    })
    const b = makeManifest({
      name: '@barazo/plugin-b',
      dependencies: ['@barazo/plugin-a'],
    })

    expect(() => topologicalSort([a, b])).toThrow(/circular/i)
  })
})

describe('validateAndFilterPlugins', () => {
  it('passes valid manifests through', () => {
    const logger = makeLogger()
    const manifests = [
      makeManifest({ name: '@barazo/plugin-a' }),
      makeManifest({ name: '@barazo/plugin-b' }),
    ]

    const result = validateAndFilterPlugins(manifests, '1.0.0', logger as never)
    expect(result).toHaveLength(2)
  })

  it('filters out invalid manifests and logs warning', () => {
    const logger = makeLogger()
    const manifests = [
      makeManifest({ name: '@barazo/plugin-a' }),
      { name: 'invalid-name', version: 'not-semver' }, // invalid
    ]

    const result = validateAndFilterPlugins(manifests, '1.0.0', logger as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('@barazo/plugin-a')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('filters out plugins with missing dependencies and logs warning', () => {
    const logger = makeLogger()
    const manifests = [
      makeManifest({
        name: '@barazo/plugin-a',
        dependencies: ['@barazo/plugin-missing'],
      }),
      makeManifest({ name: '@barazo/plugin-b' }),
    ]

    const result = validateAndFilterPlugins(manifests, '1.0.0', logger as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('@barazo/plugin-b')
    expect(logger.warn).toHaveBeenCalled()
  })
})

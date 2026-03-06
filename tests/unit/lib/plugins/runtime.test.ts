import { describe, expect, it, vi } from 'vitest'

import {
  resolveHookRef,
  getPluginShortName,
  executeHook,
} from '../../../../src/lib/plugins/runtime.js'

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
  } as never
}

describe('resolveHookRef', () => {
  it('parses module path and export name from hook reference', () => {
    const result = resolveHookRef('./backend/hooks.js#onInstall')
    expect(result).toEqual({ modulePath: './backend/hooks.js', exportName: 'onInstall' })
  })

  it('returns null for reference without hash separator', () => {
    expect(resolveHookRef('./backend/hooks.js')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(resolveHookRef('')).toBeNull()
  })

  it('handles hash at position 0 as invalid', () => {
    expect(resolveHookRef('#onInstall')).toBeNull()
  })
})

describe('getPluginShortName', () => {
  it('strips @barazo/plugin- prefix', () => {
    expect(getPluginShortName('@barazo/plugin-signatures')).toBe('signatures')
  })

  it('strips barazo-plugin- prefix', () => {
    expect(getPluginShortName('barazo-plugin-editor')).toBe('editor')
  })

  it('returns name unchanged if no known prefix', () => {
    expect(getPluginShortName('some-plugin')).toBe('some-plugin')
  })
})

describe('executeHook', () => {
  it('calls the hook function and returns true on success', async () => {
    const hook = vi.fn().mockResolvedValue(undefined)
    const logger = makeLogger()
    const result = await executeHook('onEnable', hook, {} as never, logger, '@barazo/plugin-test')
    expect(result).toBe(true)
    expect(hook).toHaveBeenCalledWith({})
  })

  it('returns false and logs error when hook throws', async () => {
    const hook = vi.fn().mockRejectedValue(new Error('boom'))
    const logger = makeLogger()
    const result = await executeHook('onEnable', hook, {} as never, logger, '@barazo/plugin-test')
    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalled()
  })

  it('passes extra args to the hook for onProfileSync', async () => {
    const hook = vi.fn().mockResolvedValue(undefined)
    const logger = makeLogger()
    await executeHook(
      'onProfileSync',
      hook,
      {} as never,
      logger,
      '@barazo/plugin-test',
      'did:plc:user1'
    )
    expect(hook).toHaveBeenCalledWith({}, 'did:plc:user1')
  })
})

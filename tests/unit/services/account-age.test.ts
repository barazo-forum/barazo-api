import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAccountAgeService } from '../../../src/services/account-age.js'
import type { AccountAgeService } from '../../../src/services/account-age.js'

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}

describe('AccountAgeService', () => {
  let service: AccountAgeService
  let logger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    logger = createMockLogger()
    service = createAccountAgeService(logger as never)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('resolveCreationDate', () => {
    it('returns null for non-PLC DIDs', async () => {
      const result = await service.resolveCreationDate('did:web:example.com')

      expect(result).toBeNull()
      expect(logger.debug).toHaveBeenCalledWith(
        { did: 'did:web:example.com' },
        'Non-PLC DID, cannot resolve account creation date'
      )
    })

    it('resolves creation date from PLC directory audit log', async () => {
      const createdAt = '2026-02-14T10:00:00.000Z'
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue([
          { createdAt, type: 'plc_operation' },
          { createdAt: '2026-02-15T10:00:00.000Z', type: 'plc_operation' },
        ]),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as never)

      const result = await service.resolveCreationDate('did:plc:abc123')

      expect(result).toEqual(new Date(createdAt))
      expect(fetch).toHaveBeenCalledWith(
        'https://plc.directory/did%3Aplc%3Aabc123/log/audit',
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        })
      )
    })

    it('returns null on HTTP error', async () => {
      const mockResponse = { ok: false, status: 404 }
      vi.mocked(fetch).mockResolvedValue(mockResponse as never)

      const result = await service.resolveCreationDate('did:plc:missing')

      expect(result).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    })

    it('returns null on empty audit log', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as never)

      const result = await service.resolveCreationDate('did:plc:empty')

      expect(result).toBeNull()
    })

    it('returns null on invalid createdAt timestamp', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue([{ createdAt: 'not-a-date' }]),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as never)

      const result = await service.resolveCreationDate('did:plc:invalid')

      expect(result).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    })

    it('returns null on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const result = await service.resolveCreationDate('did:plc:network')

      expect(result).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    })

    it('returns null when first entry lacks createdAt field', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue([{ type: 'plc_operation' }]),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as never)

      const result = await service.resolveCreationDate('did:plc:nocreated')

      expect(result).toBeNull()
    })
  })

  describe('determineTrustStatus', () => {
    it("returns 'trusted' for null accountCreatedAt", () => {
      expect(service.determineTrustStatus(null)).toBe('trusted')
    })

    it("returns 'new' for account created less than 24h ago", () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      expect(service.determineTrustStatus(oneHourAgo)).toBe('new')
    })

    it("returns 'trusted' for account created more than 24h ago", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      expect(service.determineTrustStatus(twoDaysAgo)).toBe('trusted')
    })

    it("returns 'trusted' for account created exactly 24h ago", () => {
      const exactlyDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      expect(service.determineTrustStatus(exactlyDayAgo)).toBe('trusted')
    })

    it("returns 'new' for account created 23h59m ago", () => {
      const almostDayAgo = new Date(Date.now() - (24 * 60 * 60 * 1000 - 60_000))
      expect(service.determineTrustStatus(almostDayAgo)).toBe('new')
    })
  })
})

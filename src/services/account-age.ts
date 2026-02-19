import type { Logger } from '../lib/logger.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLC_DIRECTORY_URL = 'https://plc.directory'
const PLC_TIMEOUT_MS = 5000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single entry from the PLC directory audit log. */
interface PlcAuditEntry {
  createdAt: string
  [key: string]: unknown
}

export type TrustStatus = 'trusted' | 'new'

export interface AccountAgeService {
  /**
   * Resolve the account creation date for a DID from the PLC directory.
   * Returns null if resolution fails (non-PLC DID, network error, etc.).
   */
  resolveCreationDate(did: string): Promise<Date | null>

  /**
   * Determine trust status based on account creation date.
   * Accounts < 24 hours old are 'new', all others are 'trusted'.
   */
  determineTrustStatus(accountCreatedAt: Date | null): TrustStatus
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAccountAgeService(logger: Logger): AccountAgeService {
  async function resolveCreationDate(did: string): Promise<Date | null> {
    if (!did.startsWith('did:plc:')) {
      logger.debug({ did }, 'Non-PLC DID, cannot resolve account creation date')
      return null
    }

    try {
      const url = `${PLC_DIRECTORY_URL}/${encodeURIComponent(did)}/log/audit`
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(PLC_TIMEOUT_MS),
      })

      if (!response.ok) {
        logger.warn({ did, status: response.status }, 'PLC directory audit log lookup failed')
        return null
      }

      const entries = (await response.json()) as PlcAuditEntry[]

      if (!Array.isArray(entries) || entries.length === 0) {
        logger.warn({ did }, 'PLC directory returned empty audit log')
        return null
      }

      const firstEntry = entries[0]
      if (!firstEntry?.createdAt) {
        logger.warn({ did }, 'PLC audit log entry missing createdAt')
        return null
      }

      const createdAt = new Date(firstEntry.createdAt)
      if (isNaN(createdAt.getTime())) {
        logger.warn(
          { did, createdAt: firstEntry.createdAt },
          'Invalid createdAt timestamp in PLC audit log'
        )
        return null
      }

      return createdAt
    } catch (err) {
      logger.warn({ err, did }, 'Failed to resolve account creation date from PLC')
      return null
    }
  }

  function determineTrustStatus(accountCreatedAt: Date | null): TrustStatus {
    if (!accountCreatedAt) {
      return 'trusted' // Can't determine age → default to trusted
    }

    const ageMs = Date.now() - accountCreatedAt.getTime()
    return ageMs < TWENTY_FOUR_HOURS_MS ? 'new' : 'trusted'
  }

  return { resolveCreationDate, determineTrustStatus }
}

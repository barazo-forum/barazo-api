/**
 * Integration test: PLC DID creation with handle + serviceEndpoint
 * against the real plc.directory.
 *
 * HUMAN CHECKPOINT REQUIRED:
 * This test creates a real DID on plc.directory. It should only be run
 * manually during checkpoint validation, not in CI.
 *
 * To run: LIVE_PLC_TEST=1 pnpm vitest run tests/integration/plc-did-live.test.ts
 *
 * What to verify manually after running:
 * 1. The test outputs a DID -- look it up at https://plc.directory/{did}
 * 2. Verify the DID document contains:
 *    - alsoKnownAs: ["at://test-{timestamp}.barazo.forum"]
 *    - services.atproto_pds.endpoint: "https://test-{timestamp}.barazo.forum"
 *    - verificationMethods.atproto: a did:key
 *    - rotationKeys: [a did:key]
 * 3. Verify the DID was accepted (HTTP 200 from plc.directory, not rejected)
 *
 * Note: Each run creates a new permanent DID on plc.directory. The keys are
 * logged so the DID could be updated later if needed.
 */

import { describe, it, expect } from 'vitest'
import { createPlcDidService } from '../../src/services/plc-did.js'
import type { Logger } from '../../src/lib/logger.js'

const SHOULD_RUN = process.env.LIVE_PLC_TEST === '1'

function createTestLogger(): Logger {
  return {
    info: (...args: unknown[]) => {
      process.stdout.write(`[INFO] ${args.join(' ')}\n`)
    },
    error: (...args: unknown[]) => {
      process.stderr.write(`[ERROR] ${args.join(' ')}\n`)
    },
    warn: (...args: unknown[]) => {
      process.stderr.write(`[WARN] ${args.join(' ')}\n`)
    },
    debug: () => {
      /* empty */
    },
    fatal: (...args: unknown[]) => {
      process.stderr.write(`[FATAL] ${args.join(' ')}\n`)
    },
    trace: () => {
      /* empty */
    },
    child: () => createTestLogger(),
    silent: () => {
      /* empty */
    },
    level: 'info',
  } as unknown as Logger
}

describe.skipIf(!SHOULD_RUN)('PLC DID live integration (handle + serviceEndpoint)', () => {
  it('creates a DID on plc.directory with handle and serviceEndpoint', async () => {
    const logger = createTestLogger()
    const service = createPlcDidService(logger)

    // Use a unique timestamp-based handle to avoid collisions
    const timestamp = Date.now()
    const handle = `test-${String(timestamp)}.barazo.forum`
    const serviceEndpoint = `https://test-${String(timestamp)}.barazo.forum`

    process.stdout.write('\n=== PLC DID Live Test ===\n')
    process.stdout.write(`Handle: ${handle}\n`)
    process.stdout.write(`Service Endpoint: ${serviceEndpoint}\n`)

    const result = await service.generateDid({
      handle,
      serviceEndpoint,
    })

    // Verify the result structure
    expect(result.did).toMatch(/^did:plc:[a-z2-7]{24}$/)
    expect(result.signingKey).toMatch(/^[0-9a-f]{64}$/)
    expect(result.rotationKey).toMatch(/^[0-9a-f]{64}$/)

    process.stdout.write(`\nGenerated DID: ${result.did}\n`)
    process.stdout.write(`Signing Key (hex): ${result.signingKey}\n`)
    process.stdout.write(`Rotation Key (hex): ${result.rotationKey}\n`)
    process.stdout.write(`\nVerify at: https://plc.directory/${result.did}\n`)
    process.stdout.write('=== End PLC DID Live Test ===\n\n')

    // Verify the DID is resolvable from plc.directory
    const verifyResponse = await fetch(`https://plc.directory/${result.did}`)
    expect(verifyResponse.status).toBe(200)

    const didDoc = (await verifyResponse.json()) as Record<string, unknown>
    expect(didDoc.id).toBe(result.did)

    // Verify alsoKnownAs contains our handle
    const alsoKnownAs = didDoc.alsoKnownAs as string[]
    expect(alsoKnownAs).toContain(`at://${handle}`)

    // Verify service endpoint
    const services = didDoc.service as Array<{
      id: string
      type: string
      serviceEndpoint: string
    }>
    const pdsService = services.find((s) => s.type === 'AtprotoPersonalDataServer')
    expect(pdsService).toBeDefined()
    expect(pdsService?.serviceEndpoint).toBe(serviceEndpoint)
  }, 30_000) // 30s timeout for network call
})

/**
 * Setup wizard integration: verify the initialize endpoint passes
 * handle + serviceEndpoint through to PLC DID generation.
 *
 * This is tested with mocked PLC in the unit tests (setup.test.ts).
 * The live PLC test above verifies the actual plc.directory interaction.
 *
 * MANUAL VERIFICATION CHECKLIST:
 * [ ] Run: LIVE_PLC_TEST=1 pnpm vitest run tests/integration/plc-did-live.test.ts
 * [ ] Test passes (DID created successfully)
 * [ ] Visit https://plc.directory/{did} and verify the DID document
 * [ ] alsoKnownAs contains the test handle
 * [ ] Service endpoint is set correctly
 * [ ] Verification method (atproto) is a valid did:key
 * [ ] Rotation key is present
 */

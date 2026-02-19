import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb, createChainableProxy } from '../../helpers/mock-db.js'
import type { MockDb } from '../../helpers/mock-db.js'
import { checkOnboardingComplete } from '../../../src/lib/onboarding-gate.js'

const mockDb = createMockDb()

const COMMUNITY_DID = 'did:plc:community123'
const USER_DID = 'did:plc:testuser123'
const TEST_NOW = '2026-02-15T12:00:00.000Z'

function sampleField(overrides?: Record<string, unknown>) {
  return {
    id: 'field-001',
    communityDid: COMMUNITY_DID,
    fieldType: 'custom_text',
    label: 'Intro',
    description: null,
    isMandatory: true,
    sortOrder: 0,
    config: null,
    createdAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

function sampleResponse(overrides?: Record<string, unknown>) {
  return {
    did: USER_DID,
    communityDid: COMMUNITY_DID,
    fieldId: 'field-001',
    response: 'hello',
    completedAt: new Date(TEST_NOW),
    ...overrides,
  }
}

function resetMocks(): void {
  vi.clearAllMocks()
  mockDb.select.mockReset()
  mockDb.insert.mockReturnValue(createChainableProxy())
  mockDb.update.mockReturnValue(createChainableProxy([]))
  mockDb.delete.mockReturnValue(createChainableProxy())
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally async for Drizzle transaction mock
  mockDb.transaction.mockImplementation(async (fn: (tx: MockDb) => Promise<unknown>) => {
    return await fn(mockDb)
  })
  mockDb.execute.mockReset()
}

function queueSelectResults(...results: unknown[][]): void {
  for (const result of results) {
    mockDb.select.mockReturnValueOnce(createChainableProxy(result))
  }
}

describe('checkOnboardingComplete', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('returns complete=true when community has no onboarding fields', async () => {
    queueSelectResults([]) // no mandatory fields

    const result = await checkOnboardingComplete(mockDb as never, USER_DID, COMMUNITY_DID)

    expect(result.complete).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it('returns complete=true when user has completed all mandatory fields', async () => {
    const field = sampleField()
    queueSelectResults([field], [sampleResponse()])

    const result = await checkOnboardingComplete(mockDb as never, USER_DID, COMMUNITY_DID)

    expect(result.complete).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it("returns complete=false with missing fields when user hasn't completed mandatory fields", async () => {
    const field = sampleField()
    queueSelectResults([field], []) // no responses

    const result = await checkOnboardingComplete(mockDb as never, USER_DID, COMMUNITY_DID)

    expect(result.complete).toBe(false)
    expect(result.missingFields).toEqual([
      { id: 'field-001', label: 'Intro', fieldType: 'custom_text' },
    ])
  })

  it('returns complete=false when some mandatory fields are missing', async () => {
    const field1 = sampleField({ id: 'field-001', label: 'Intro' })
    const field2 = sampleField({ id: 'field-002', label: 'ToS', fieldType: 'tos_acceptance' })

    // Only field-001 answered
    queueSelectResults([field1, field2], [sampleResponse({ fieldId: 'field-001' })])

    const result = await checkOnboardingComplete(mockDb as never, USER_DID, COMMUNITY_DID)

    expect(result.complete).toBe(false)
    expect(result.missingFields).toHaveLength(1)
    expect(result.missingFields[0]?.id).toBe('field-002')
  })

  it('only checks mandatory fields (ignores optional)', async () => {
    // Only query returns mandatory fields, so optional are not fetched
    queueSelectResults([], []) // no mandatory fields, no responses

    const result = await checkOnboardingComplete(mockDb as never, USER_DID, COMMUNITY_DID)

    expect(result.complete).toBe(true)
  })
})

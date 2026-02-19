import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as secp256k1 from '@noble/secp256k1'
import {
  createPlcDidService,
  base32Encode,
  base58btcEncode,
  compressedPubKeyToDidKey,
  buildGenesisOperation,
  signGenesisOperation,
  computeDidFromSignedOperation,
} from '../../../src/services/plc-did.js'
import type { PlcDidService, PlcGenesisOperation } from '../../../src/services/plc-did.js'
import type { Logger } from '../../../src/lib/logger.js'

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  } as unknown as Logger
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_HANDLE = 'community.barazo.forum'
const TEST_SERVICE_ENDPOINT = 'https://community.barazo.forum'

// ---------------------------------------------------------------------------
// Tests: base32Encode
// ---------------------------------------------------------------------------

describe('base32Encode', () => {
  it('encodes empty bytes to empty string', () => {
    expect(base32Encode(new Uint8Array([]))).toBe('')
  })

  it('encodes known values correctly', () => {
    // "f" = 0x66 -> base32 = "my"
    const input = new Uint8Array([0x66])
    expect(base32Encode(input)).toBe('my')
  })

  it("encodes 'foobar' bytes correctly", () => {
    // "foobar" in base32 = "mzxw6ytboi"
    const input = new TextEncoder().encode('foobar')
    expect(base32Encode(input)).toBe('mzxw6ytboi')
  })

  it('produces 24 characters for 15 bytes input', () => {
    // 15 bytes = 120 bits -> 120 / 5 = 24 base32 chars
    const input = new Uint8Array(15).fill(0xff)
    const result = base32Encode(input)
    expect(result).toHaveLength(24)
  })
})

// ---------------------------------------------------------------------------
// Tests: base58btcEncode
// ---------------------------------------------------------------------------

describe('base58btcEncode', () => {
  it('encodes empty bytes to empty string', () => {
    expect(base58btcEncode(new Uint8Array([]))).toBe('')
  })

  it("preserves leading zero bytes as '1' characters", () => {
    const input = new Uint8Array([0, 0, 1])
    const result = base58btcEncode(input)
    expect(result.startsWith('11')).toBe(true)
  })

  it('encodes known value correctly', () => {
    // 0x00 0x00 0x00 0x01 = "1112"
    const input = new Uint8Array([0, 0, 0, 1])
    const result = base58btcEncode(input)
    expect(result).toBe('1112')
  })
})

// ---------------------------------------------------------------------------
// Tests: compressedPubKeyToDidKey
// ---------------------------------------------------------------------------

describe('compressedPubKeyToDidKey', () => {
  it("produces a did:key with 'z' multibase prefix", () => {
    const privKey = secp256k1.utils.randomSecretKey()
    const pubKey = secp256k1.getPublicKey(privKey, true)
    const didKey = compressedPubKeyToDidKey(pubKey)

    expect(didKey).toMatch(/^did:key:z/)
  })

  it('produces consistent output for same key', () => {
    const privKey = secp256k1.utils.randomSecretKey()
    const pubKey = secp256k1.getPublicKey(privKey, true)

    const result1 = compressedPubKeyToDidKey(pubKey)
    const result2 = compressedPubKeyToDidKey(pubKey)

    expect(result1).toBe(result2)
  })

  it('produces different output for different keys', () => {
    const privKey1 = secp256k1.utils.randomSecretKey()
    const privKey2 = secp256k1.utils.randomSecretKey()
    const pubKey1 = secp256k1.getPublicKey(privKey1, true)
    const pubKey2 = secp256k1.getPublicKey(privKey2, true)

    const result1 = compressedPubKeyToDidKey(pubKey1)
    const result2 = compressedPubKeyToDidKey(pubKey2)

    expect(result1).not.toBe(result2)
  })

  it('uses compressed public key (33 bytes)', () => {
    const privKey = secp256k1.utils.randomSecretKey()
    const pubKey = secp256k1.getPublicKey(privKey, true)

    // Compressed secp256k1 public key is 33 bytes
    expect(pubKey).toHaveLength(33)

    const didKey = compressedPubKeyToDidKey(pubKey)
    expect(didKey.startsWith('did:key:z')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: buildGenesisOperation
// ---------------------------------------------------------------------------

describe('buildGenesisOperation', () => {
  it('builds correct structure with all required fields', () => {
    const signingDidKey = 'did:key:zSigningKey123'
    const rotationDidKey = 'did:key:zRotationKey456'

    const op = buildGenesisOperation(
      signingDidKey,
      rotationDidKey,
      TEST_HANDLE,
      TEST_SERVICE_ENDPOINT
    )

    expect(op.type).toBe('plc_operation')
    expect(op.rotationKeys).toStrictEqual([rotationDidKey])
    expect(op.verificationMethods.atproto).toBe(signingDidKey)
    expect(op.alsoKnownAs).toStrictEqual([`at://${TEST_HANDLE}`])
    expect(op.services.atproto_pds.type).toBe('AtprotoPersonalDataServer')
    expect(op.services.atproto_pds.endpoint).toBe(TEST_SERVICE_ENDPOINT)
    expect(op.prev).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: signGenesisOperation
// ---------------------------------------------------------------------------

describe('signGenesisOperation', () => {
  it('produces a signed operation with base64url sig field', () => {
    const rotationPrivKey = secp256k1.utils.randomSecretKey()
    const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true)
    const signingPrivKey = secp256k1.utils.randomSecretKey()
    const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true)

    const op = buildGenesisOperation(
      compressedPubKeyToDidKey(signingPubKey),
      compressedPubKeyToDidKey(rotationPubKey),
      TEST_HANDLE,
      TEST_SERVICE_ENDPOINT
    )

    const signed = signGenesisOperation(op, rotationPrivKey)

    // sig field should exist and be a non-empty base64url string
    expect(signed.sig).toBeDefined()
    expect(signed.sig.length).toBeGreaterThan(0)
    // base64url uses only alphanumeric, -, _
    expect(signed.sig).toMatch(/^[A-Za-z0-9_-]+$/)

    // All original fields preserved
    expect(signed.type).toBe('plc_operation')
    expect(signed.rotationKeys).toStrictEqual(op.rotationKeys)
    expect(signed.verificationMethods).toStrictEqual(op.verificationMethods)
    expect(signed.prev).toBeNull()
  })

  it('produces different signatures for different operations', () => {
    const rotationPrivKey = secp256k1.utils.randomSecretKey()
    const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true)
    const signingPrivKey = secp256k1.utils.randomSecretKey()
    const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true)

    const op1 = buildGenesisOperation(
      compressedPubKeyToDidKey(signingPubKey),
      compressedPubKeyToDidKey(rotationPubKey),
      'handle1.example.com',
      'https://handle1.example.com'
    )

    const op2 = buildGenesisOperation(
      compressedPubKeyToDidKey(signingPubKey),
      compressedPubKeyToDidKey(rotationPubKey),
      'handle2.example.com',
      'https://handle2.example.com'
    )

    const signed1 = signGenesisOperation(op1, rotationPrivKey)
    const signed2 = signGenesisOperation(op2, rotationPrivKey)

    expect(signed1.sig).not.toBe(signed2.sig)
  })
})

// ---------------------------------------------------------------------------
// Tests: computeDidFromSignedOperation
// ---------------------------------------------------------------------------

describe('computeDidFromSignedOperation', () => {
  it('produces a DID in did:plc: format with 24 base32 chars', () => {
    const rotationPrivKey = secp256k1.utils.randomSecretKey()
    const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true)
    const signingPrivKey = secp256k1.utils.randomSecretKey()
    const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true)

    const op = buildGenesisOperation(
      compressedPubKeyToDidKey(signingPubKey),
      compressedPubKeyToDidKey(rotationPubKey),
      TEST_HANDLE,
      TEST_SERVICE_ENDPOINT
    )

    const signed = signGenesisOperation(op, rotationPrivKey)
    const did = computeDidFromSignedOperation(signed)

    expect(did).toMatch(/^did:plc:[a-z2-7]{24}$/)
  })

  it('produces consistent DID for same signed operation', () => {
    const rotationPrivKey = secp256k1.utils.randomSecretKey()
    const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true)
    const signingPrivKey = secp256k1.utils.randomSecretKey()
    const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true)

    const op = buildGenesisOperation(
      compressedPubKeyToDidKey(signingPubKey),
      compressedPubKeyToDidKey(rotationPubKey),
      TEST_HANDLE,
      TEST_SERVICE_ENDPOINT
    )

    const signed = signGenesisOperation(op, rotationPrivKey)

    const did1 = computeDidFromSignedOperation(signed)
    const did2 = computeDidFromSignedOperation(signed)

    expect(did1).toBe(did2)
  })

  it('produces different DIDs for different signed operations', () => {
    const buildSignedOp = (handle: string) => {
      const rotationPrivKey = secp256k1.utils.randomSecretKey()
      const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true)
      const signingPrivKey = secp256k1.utils.randomSecretKey()
      const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true)

      const op = buildGenesisOperation(
        compressedPubKeyToDidKey(signingPubKey),
        compressedPubKeyToDidKey(rotationPubKey),
        handle,
        `https://${handle}`
      )

      return signGenesisOperation(op, rotationPrivKey)
    }

    const did1 = computeDidFromSignedOperation(buildSignedOp('a.example.com'))
    const did2 = computeDidFromSignedOperation(buildSignedOp('b.example.com'))

    expect(did1).not.toBe(did2)
  })
})

// ---------------------------------------------------------------------------
// Tests: PlcDidService.generateDid (integration with mocked fetch)
// ---------------------------------------------------------------------------

describe('PlcDidService', () => {
  let service: PlcDidService
  let mockLogger: Logger
  let originalFetch: typeof globalThis.fetch
  let mockFetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>

  beforeEach(() => {
    mockLogger = createMockLogger()
    service = createPlcDidService(mockLogger)

    // Mock global fetch
    originalFetch = globalThis.fetch
    mockFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }))
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('generates a valid DID with correct format', async () => {
    const result = await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    expect(result.did).toMatch(/^did:plc:[a-z2-7]{24}$/)
  })

  it('returns hex-encoded signing key (64 chars)', async () => {
    const result = await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    expect(result.signingKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns hex-encoded rotation key (64 chars)', async () => {
    const result = await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    expect(result.rotationKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('submits to plc.directory by default', async () => {
    await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/plc\.directory\/did:plc:[a-z2-7]{24}$/)
    expect(init.method).toBe('POST')
    expect(init.headers).toStrictEqual({
      'Content-Type': 'application/json',
    })
  })

  it('submits to custom plc directory URL when specified', async () => {
    const customUrl = 'https://plc.test.local'

    await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
      plcDirectoryUrl: customUrl,
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/plc\.test\.local\/did:plc:[a-z2-7]{24}$/)
  })

  it('sends a valid signed operation in request body', async () => {
    await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>

    expect(body.type).toBe('plc_operation')
    expect(body.rotationKeys).toBeInstanceOf(Array)
    expect((body.rotationKeys as string[])[0]).toMatch(/^did:key:z/)
    expect((body.verificationMethods as Record<string, string>).atproto).toMatch(/^did:key:z/)
    expect(body.alsoKnownAs).toStrictEqual([`at://${TEST_HANDLE}`])
    expect(body.prev).toBeNull()
    expect(body.sig).toBeDefined()
    expect(typeof body.sig).toBe('string')
    expect((body.sig as string).length).toBeGreaterThan(0)
  })

  it('generates different DIDs on each call', async () => {
    const result1 = await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    const result2 = await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    expect(result1.did).not.toBe(result2.did)
    expect(result1.signingKey).not.toBe(result2.signingKey)
    expect(result1.rotationKey).not.toBe(result2.rotationKey)
  })

  it('throws when plc.directory returns non-200 status', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Invalid operation', { status: 400 }))

    await expect(
      service.generateDid({
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      })
    ).rejects.toThrow('PLC directory returned 400: Invalid operation')
  })

  it('throws when plc.directory returns server error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

    await expect(
      service.generateDid({
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      })
    ).rejects.toThrow('PLC directory returned 500: Internal Server Error')
  })

  it('throws when fetch itself fails (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      service.generateDid({
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      })
    ).rejects.toThrow('Network error')
  })

  it('logs info messages during generation', async () => {
    await service.generateDid({
      handle: TEST_HANDLE,
      serviceEndpoint: TEST_SERVICE_ENDPOINT,
    })

    const infoFn = mockLogger.info as ReturnType<typeof vi.fn>
    expect(infoFn).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      }) as Record<string, unknown>,
      'Generating PLC DID for community'
    )

    expect(infoFn).toHaveBeenCalledWith(
      expect.objectContaining({
        did: expect.stringMatching(/^did:plc:/) as string,
      }) as Record<string, unknown>,
      'PLC DID registered successfully'
    )
  })

  it('logs error when plc.directory rejects', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Bad request', { status: 400 }))

    await expect(
      service.generateDid({
        handle: TEST_HANDLE,
        serviceEndpoint: TEST_SERVICE_ENDPOINT,
      })
    ).rejects.toThrow()

    const errorFn = mockLogger.error as ReturnType<typeof vi.fn>
    expect(errorFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        body: 'Bad request',
      }) as Record<string, unknown>,
      'PLC directory rejected genesis operation'
    )
  })
})

// ---------------------------------------------------------------------------
// Tests: Full round-trip (key gen -> sign -> verify -> DID)
// ---------------------------------------------------------------------------

describe('PLC DID round-trip', () => {
  it('produces a valid secp256k1 signature that can be verified', async () => {
    const { createHash } = await import('node:crypto')
    const dagCborMod = await import('@ipld/dag-cbor')

    const rotationPrivKey = secp256k1.utils.randomSecretKey()
    const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true)
    const signingPrivKey = secp256k1.utils.randomSecretKey()
    const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true)

    const op: PlcGenesisOperation = buildGenesisOperation(
      compressedPubKeyToDidKey(signingPubKey),
      compressedPubKeyToDidKey(rotationPubKey),
      TEST_HANDLE,
      TEST_SERVICE_ENDPOINT
    )

    const signed = signGenesisOperation(op, rotationPrivKey)

    // Decode the signature from base64url (compact 64-byte format)
    const sigBytes = new Uint8Array(Buffer.from(signed.sig, 'base64url'))

    // Reconstruct the message that was signed (CBOR of unsigned op)
    const cborBytes = dagCborMod.encode(op)
    const hash = createHash('sha256').update(cborBytes).digest()

    // secp256k1 v3 verify() takes (signature, message, publicKey) as raw Bytes
    const isValid = secp256k1.verify(sigBytes, new Uint8Array(hash), rotationPubKey, {
      prehash: false,
    })

    expect(isValid).toBe(true)
  })
})

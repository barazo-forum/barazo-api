import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../../../src/lib/encryption.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_KEK = 'a'.repeat(32) // Minimum 32 characters
const TEST_PLAINTEXT = 'deadbeef'.repeat(8) // 64-char hex string (like a signing key)

/** Split encrypted string into [iv, ciphertext, tag] with type safety. */
function splitEncrypted(encrypted: string): [string, string, string] {
  const [iv, ciphertext, tag] = encrypted.split(':')
  if (iv === undefined || ciphertext === undefined || tag === undefined) {
    throw new Error('Expected 3 colon-separated parts')
  }
  return [iv, ciphertext, tag]
}

// ---------------------------------------------------------------------------
// encrypt / decrypt roundtrip
// ---------------------------------------------------------------------------

describe('encrypt', () => {
  it('returns a base64-encoded string with three colon-separated parts (iv:ciphertext:tag)', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)

    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)

    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow()
      expect(part.length).toBeGreaterThan(0)
    }
  })

  it('produces different ciphertext on each call (unique IV)', () => {
    const encrypted1 = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const encrypted2 = encrypt(TEST_PLAINTEXT, TEST_KEK)

    expect(encrypted1).not.toBe(encrypted2)

    // IVs should differ
    const [iv1] = splitEncrypted(encrypted1)
    const [iv2] = splitEncrypted(encrypted2)
    expect(iv1).not.toBe(iv2)
  })

  it('uses a 12-byte IV', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const [ivBase64] = splitEncrypted(encrypted)
    const ivBytes = Buffer.from(ivBase64, 'base64')
    expect(ivBytes.length).toBe(12)
  })

  it('produces a 16-byte auth tag', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const [, , tagBase64] = splitEncrypted(encrypted)
    const tagBytes = Buffer.from(tagBase64, 'base64')
    expect(tagBytes.length).toBe(16)
  })
})

describe('decrypt', () => {
  it('recovers the original plaintext', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const decrypted = decrypt(encrypted, TEST_KEK)

    expect(decrypted).toBe(TEST_PLAINTEXT)
  })

  it('handles empty string plaintext', () => {
    const encrypted = encrypt('', TEST_KEK)
    const decrypted = decrypt(encrypted, TEST_KEK)

    expect(decrypted).toBe('')
  })

  it('handles unicode plaintext', () => {
    const unicode = 'hello world \u{1F600} \u00E9\u00E8\u00EA'
    const encrypted = encrypt(unicode, TEST_KEK)
    const decrypted = decrypt(encrypted, TEST_KEK)

    expect(decrypted).toBe(unicode)
  })
})

// ---------------------------------------------------------------------------
// Wrong key
// ---------------------------------------------------------------------------

describe('decrypt with wrong key', () => {
  it('throws when decrypting with a different KEK', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const wrongKek = 'b'.repeat(32)

    expect(() => decrypt(encrypted, wrongKek)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Corrupted data
// ---------------------------------------------------------------------------

describe('decrypt with corrupted data', () => {
  it('throws when ciphertext is corrupted', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const [iv, ciphertextB64, tag] = splitEncrypted(encrypted)

    // Corrupt the ciphertext by flipping bits
    const ciphertextBytes = Buffer.from(ciphertextB64, 'base64')
    ciphertextBytes[0] = (ciphertextBytes[0] ?? 0) ^ 0xff
    const corrupted = `${iv}:${ciphertextBytes.toString('base64')}:${tag}`

    expect(() => decrypt(corrupted, TEST_KEK)).toThrow()
  })

  it('throws when auth tag is corrupted', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const [iv, ciphertext, tagB64] = splitEncrypted(encrypted)

    // Corrupt the auth tag
    const tagBytes = Buffer.from(tagB64, 'base64')
    tagBytes[0] = (tagBytes[0] ?? 0) ^ 0xff
    const corrupted = `${iv}:${ciphertext}:${tagBytes.toString('base64')}`

    expect(() => decrypt(corrupted, TEST_KEK)).toThrow()
  })

  it('throws when IV is corrupted', () => {
    const encrypted = encrypt(TEST_PLAINTEXT, TEST_KEK)
    const [ivB64, ciphertext, tag] = splitEncrypted(encrypted)

    // Corrupt the IV
    const ivBytes = Buffer.from(ivB64, 'base64')
    ivBytes[0] = (ivBytes[0] ?? 0) ^ 0xff
    const corrupted = `${ivBytes.toString('base64')}:${ciphertext}:${tag}`

    expect(() => decrypt(corrupted, TEST_KEK)).toThrow()
  })

  it('throws when encrypted string has wrong format (missing parts)', () => {
    expect(() => decrypt('onlyonepart', TEST_KEK)).toThrow()
    expect(() => decrypt('two:parts', TEST_KEK)).toThrow()
  })

  it('throws when encrypted string has empty parts', () => {
    expect(() => decrypt('::', TEST_KEK)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// HKDF key derivation
// ---------------------------------------------------------------------------

describe('key derivation', () => {
  it('derives different encryption keys from different KEKs', () => {
    const kek1 = 'a'.repeat(32)
    const kek2 = 'b'.repeat(32)

    const encrypted1 = encrypt(TEST_PLAINTEXT, kek1)
    const encrypted2 = encrypt(TEST_PLAINTEXT, kek2)

    // Can decrypt with matching key
    expect(decrypt(encrypted1, kek1)).toBe(TEST_PLAINTEXT)
    expect(decrypt(encrypted2, kek2)).toBe(TEST_PLAINTEXT)

    // Cannot cross-decrypt
    expect(() => decrypt(encrypted1, kek2)).toThrow()
    expect(() => decrypt(encrypted2, kek1)).toThrow()
  })
})

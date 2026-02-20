import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * HKDF info string for community key encryption.
 * Binds derived keys to this specific use case.
 */
const HKDF_INFO = 'barazo:community-keys'

/**
 * Derive a 256-bit AES key from the KEK using HKDF (SHA-256).
 */
function deriveKey(kek: string): Buffer {
  return Buffer.from(hkdfSync('sha256', kek, '', HKDF_INFO, 32))
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param kek - Key Encryption Key (minimum 32 characters, from AI_ENCRYPTION_KEY env var)
 * @returns Base64-encoded string in format `iv:ciphertext:tag`
 */
export function encrypt(plaintext: string, kek: string): string {
  const key = deriveKey(kek)
  const iv = randomBytes(12)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`
}

/**
 * Decrypt a string encrypted with {@link encrypt}.
 *
 * @param encrypted - Base64-encoded string in format `iv:ciphertext:tag`
 * @param kek - The same KEK used during encryption
 * @returns The original plaintext
 * @throws If the data is corrupted, tampered with, or the wrong key is used
 */
export function decrypt(encrypted: string, kek: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format: expected iv:ciphertext:tag')
  }

  const [ivB64, ciphertextB64, tagB64] = parts as [string, string, string]

  if (!ivB64 || !tagB64) {
    throw new Error('Invalid encrypted data format: empty component')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')

  if (iv.length !== 12) {
    throw new Error('Invalid IV length: expected 12 bytes')
  }

  if (tag.length !== 16) {
    throw new Error('Invalid auth tag length: expected 16 bytes')
  }

  const key = deriveKey(kek)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

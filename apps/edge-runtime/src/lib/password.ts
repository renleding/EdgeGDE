/**
 * EdgeGDE — Password Hashing (WebCrypto PBKDF2)
 *
 * Uses native Workers crypto.subtle — no npm dependencies.
 *
 * Hash format: base64(salt):base64(hash)
 * Salt: 32 random bytes
 * Iterations: 100,000 (OWASP 2023 recommendation)
 * Key length: 256 bits (SHA-256)
 *
 * @packageDocumentation
 */

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 32
const KEY_LENGTH = 256

function base64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
}

/**
 * Hash a password with a random salt.
 * Returns a composite string: base64(salt):base64(hash)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH,
  )
  return `${base64(salt.buffer)}:${base64(hash)}`
}

/**
 * Verify a password against a stored hash string.
 * Returns true if the password matches.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [saltB64, hashB64] = parts
  try {
    const salt = fromBase64(saltB64)
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const hash = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      KEY_LENGTH,
    )
    const computedB64 = base64(hash)
    // Constant-time comparison
    if (hashB64.length !== computedB64.length) return false
    let match = 0
    for (let i = 0; i < hashB64.length; i++) {
      match |= hashB64.charCodeAt(i) ^ computedB64.charCodeAt(i)
    }
    return match === 0
  } catch {
    return false
  }
}

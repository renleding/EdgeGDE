/**
 * Tests for consent policy integrity and token encryption (FRS-010 F01, F02-R05).
 *
 * These cover the two things that would silently break compliance rather than
 * loudly break: the consent text changing without a version bump, and refresh
 * tokens being stored unencrypted.
 */

import { describe, expect, it } from 'vitest'
import {
  CONSENT_POLICY_VERSION,
  CONSENT_TEXT,
  CONSENTED_FIELDS,
  sha256Hex,
} from '../src/consent-policy'
import { generateTokenKey, openToken, sealToken, TokenKeyMissingError } from '../src/crypto'
import { decodeIdToken } from '../src/oauth'
import { newId } from '../src/store'

describe('consent policy (F01-R02/R03, F01 AC5)', () => {
  it('carries a version', () => {
    expect(CONSENT_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  })

  it('states the standing, no-expiry nature of the authorisation', () => {
    // F01-R02 is explicit that there is no fixed expiry.
    expect(CONSENT_TEXT).toMatch(/no fixed expiry/i)
    expect(CONSENT_TEXT).toMatch(/withdraw/i)
  })

  it('names the cross-border disclosure (F01-N03, APP 8)', () => {
    expect(CONSENT_TEXT).toMatch(/United States/)
    expect(CONSENT_TEXT).toMatch(/Privacy Principle 8/)
  })

  it('states both retention rules, since F10-R03 forbids conflating them', () => {
    expect(CONSENT_TEXT).toMatch(/deleted when you withdraw/i)
    expect(CONSENT_TEXT).toMatch(/retained until\s+that policy expires/i)
  })

  it('scopes collection to odometer and FSD only (F04-R01a)', () => {
    expect([...CONSENTED_FIELDS]).toEqual([
      'Odometer',
      'MilesSinceReset',
      'SelfDrivingMilesSinceReset',
    ])
    // No behaviour fields may appear in the consent text's field promise.
    expect(CONSENT_TEXT).toMatch(/No location, no speed, no driving behaviour/)
  })

  it('promises no command capability', () => {
    expect(CONSENT_TEXT).toMatch(/cannot use, any\s+ability to send commands/i)
  })
})

describe('consent text hashing (F01 AC5)', () => {
  it('hashes deterministically so the stored hash is checkable', async () => {
    const a = await sha256Hex(CONSENT_TEXT)
    const b = await sha256Hex(CONSENT_TEXT)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes if the text changes by a single byte', async () => {
    const original = await sha256Hex(CONSENT_TEXT)
    const altered = await sha256Hex(CONSENT_TEXT + ' ')
    expect(altered).not.toBe(original)
  })
})

describe('token encryption at rest (F02-R05)', () => {
  const key = generateTokenKey()

  it('generates a 32-byte base64 key', () => {
    expect(atob(key).length).toBe(32)
  })

  it('round-trips a token', async () => {
    const sealed = await sealToken('refresh-token-value', key)
    expect(sealed.ciphertext).not.toContain('refresh-token-value')
    await expect(openToken(sealed, key)).resolves.toBe('refresh-token-value')
  })

  it('uses a distinct IV per call, so identical tokens differ on disk', async () => {
    const a = await sealToken('same', key)
    const b = await sealToken('same', key)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('rejects a tampered ciphertext rather than returning altered plaintext', async () => {
    const sealed = await sealToken('refresh-token-value', key)
    const bytes = atob(sealed.ciphertext).split('')
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0xff)
    const tampered = { ...sealed, ciphertext: btoa(bytes.join('')) }
    await expect(openToken(tampered, key)).rejects.toThrow()
  })

  it('cannot be decrypted with a different key', async () => {
    const sealed = await sealToken('refresh-token-value', key)
    await expect(openToken(sealed, generateTokenKey())).rejects.toThrow()
  })

  it('fails loudly when the key is unset', async () => {
    await expect(sealToken('x', '')).rejects.toBeInstanceOf(TokenKeyMissingError)
  })

  it('rejects a key that is not 32 bytes, naming the expected format', async () => {
    await expect(sealToken('x', btoa('too-short'))).rejects.toThrow(/32 bytes/)
  })
})

describe('id_token decoding (F01-R05)', () => {
  const payload = { sub: 'tesla-sub-123', email: 'member@example.com', name: 'A Member' }
  const jwt = `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`

  it('extracts sub, email and name', () => {
    expect(decodeIdToken(jwt)).toEqual(payload)
  })

  it('returns null rather than throwing on malformed input', () => {
    expect(decodeIdToken(undefined)).toBeNull()
    expect(decodeIdToken('not-a-jwt')).toBeNull()
    expect(decodeIdToken('a.b')).toBeNull()
    expect(decodeIdToken('a.!!!.c')).toBeNull()
  })
})

describe('identifier generation', () => {
  it('is lexicographically time-sortable', () => {
    const earlier = newId(1_700_000_000_000)
    const later = newId(1_700_000_001_000)
    expect(earlier < later).toBe(true)
  })

  it('is unique across a burst in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId(1_700_000_000_000)))
    expect(ids.size).toBe(500)
  })
})

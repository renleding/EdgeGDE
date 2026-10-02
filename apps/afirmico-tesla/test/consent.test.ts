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

  it('pins the text hash so an unversioned edit cannot pass (F01 AC5)', async () => {
    // The header of src/consent-policy.ts claims "the hash below is asserted by a
    // unit test". Until this test existed, that claim was false — nothing pinned
    // the hash, so the text could be edited silently: the version would not move,
    // no migration would need regenerating, and every gate would stay green while
    // the text members had already agreed to changed underneath them. That is the
    // exact failure mode F01 AC5 exists to prevent, so the assertion is made
    // against a literal here rather than against a recomputed value.
    //
    // TO CHANGE THE CONSENT TEXT: bump CONSENT_POLICY_VERSION, edit the text, run
    // `python3 scripts/build-consent-seed.py`, then update this literal. Three
    // deliberate acts, which is the point — a consent change should be visible.
    expect(await sha256Hex(CONSENT_TEXT)).toBe(
      '8a3781566209596a240ce4e643dbcbb3719272ec2fac72a47b1f23b7c1587c90',
    )
  })

  it('states the standing, no-expiry nature of the authorisation', () => {
    // F01-R02 is explicit that there is no fixed expiry.
    expect(CONSENT_TEXT).toMatch(/no fixed expiry/i)
    expect(CONSENT_TEXT).toMatch(/withdraw/i)
  })

  it('names a cross-border disclosure (F01-N03, APP 8)', () => {
    expect(CONSENT_TEXT).toMatch(/Australia and overseas/)
    expect(CONSENT_TEXT).toMatch(/Australian Privacy Principles/)
  })

  it('does not name the infrastructure provider (owner instruction, 2026-10-03)', () => {
    // The owner instructed the Cloudflare reference be removed from the text.
    // The APP 8 statement is retained; the provider name is not.
    //
    // RECORDED, NOT HIDDEN: this makes the text less complete than it was, not
    // more accurate. The Worker runs on Cloudflare infrastructure in the United
    // States (F01-N03, §3.1), so the text now under-describes where the data is
    // held. Asserted here so the removal is a deliberate, testable state rather
    // than an accident that a later reader has to reconstruct.
    expect(CONSENT_TEXT).not.toMatch(/Cloudflare/i)
  })

  it('records the retention rules as an open gap, not a satisfied requirement (F10-R03/R04)', () => {
    // The previous revision stated BOTH retention paths explicitly, because
    // F10-R03 (Must) forbids conflating them and F10-R04 (Must) requires the
    // applicable rule be presented at revocation. This revision states neither:
    // it replaces them with a general "may retain information where reasonably
    // necessary" clause. F10-R03 and F10-R04 are therefore NOT satisfied by the
    // text as it currently stands. The rules remain implemented in code. This
    // test pins the gap so it cannot be mistaken for compliance.
    expect(CONSENT_TEXT).not.toMatch(/deleted when you withdraw/i)
    expect(CONSENT_TEXT).not.toMatch(/retained until\s+that policy expires/i)
    expect(CONSENT_TEXT).toMatch(/may retain information where reasonably necessary/i)
  })

  it('no longer states the no-commands position (F04-R09) — recorded gap', () => {
    // The previous text promised the member that no ability to send commands to
    // the vehicle was requested or usable. This revision does not mention
    // commands at all. The platform control is unchanged and still enforced —
    // all 72 vehicle_command endpoints are seeded enabled = 0 and verify-schema.sh
    // fails if any is enabled — but the member-facing statement has lapsed.
    expect(CONSENT_TEXT).not.toMatch(/send commands/i)
  })

  it('is broad enough to cover the fields collected (F01-R02a)', () => {
    // R-15: the text used to name a closed two-number set while fourteen fields
    // were collected. It now covers the authorised Tesla connection and states
    // that the set may change, so a field change is not a consent event.
    expect(CONSENT_TEXT).toMatch(/may vary from time to time/i)
    expect(CONSENT_TEXT).toMatch(/reasonably required/i)
  })

  it('does not claim only two numbers are collected (R-15 regression)', () => {
    expect(CONSENT_TEXT).not.toMatch(/Only two numbers/i)
    expect(CONSENT_TEXT).not.toMatch(/Nothing else is collected/i)
  })

  it('scopes the authorisation to the authorised connection (F04-R01a)', () => {
    // CONSENTED_FIELDS is the CURRENT collection set, not the consent scope, and
    // must agree with the catalog (asserted in verify-store.ts, F01 AC6).
    expect(CONSENTED_FIELDS.length).toBe(14)
    expect([...CONSENTED_FIELDS]).toContain('Odometer')
    expect([...CONSENTED_FIELDS]).toContain('SelfDrivingMilesSinceReset')
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

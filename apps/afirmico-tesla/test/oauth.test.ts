/**
 * Security-critical unit tests for the Tesla OAuth helpers.
 *
 * These cover the parts that are expensive to get wrong in production: PKCE
 * derivation, state signing/verification, redirect URI construction, and cookie
 * handling. No network, no Workers runtime.
 */

import { describe, it, expect } from 'vitest'
import {
  SESSION_COOKIE,
  TESLA_SCOPES,
  assertConfigured,
  base64UrlEncode,
  buildAuthorizeUrl,
  clearCookie,
  generateCodeVerifier,
  generateState,
  parseCookies,
  s256Challenge,
  serializeCookie,
  verifyState,
} from '../src/oauth'

const SECRET = 'test-secret-not-a-real-key'

describe('base64UrlEncode', () => {
  it('is url-safe and unpadded', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 0, 1]))
    expect(encoded).not.toMatch(/[+/=]/)
  })
})

describe('PKCE', () => {
  it('produces a verifier within RFC 7636 length bounds and charset', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('produces a distinct verifier each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  it('matches the RFC 7636 Appendix B known-answer vector', async () => {
    // The published example: verifier -> S256 challenge.
    const challenge = await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('state signing', () => {
  it('round-trips a freshly signed state', async () => {
    const state = await generateState(SECRET)
    const verdict = await verifyState(state, SECRET)
    expect(verdict.ok).toBe(true)
  })

  it('rejects a state signed with a different secret', async () => {
    const state = await generateState('other-secret')
    const verdict = await verifyState(state, SECRET)
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a tampered payload', async () => {
    const state = await generateState(SECRET)
    const [body, signature] = state.split('.')
    const forged = `${body!.slice(0, -1)}X.${signature}`
    const verdict = await verifyState(forged, SECRET)
    expect(verdict.ok).toBe(false)
  })

  it('rejects an expired state', async () => {
    const state = await generateState(SECRET, 60, Date.now() - 3_600_000)
    const verdict = await verifyState(state, SECRET)
    expect(verdict).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects missing, empty, and malformed values without throwing', async () => {
    for (const bad of [undefined, '', 'nodot', '.sig', 'body.']) {
      const verdict = await verifyState(bad, SECRET)
      expect(verdict.ok).toBe(false)
    }
  })
})

describe('authorize URL', () => {
  it('carries the registered redirect, S256 challenge and minimum scopes', async () => {
    const url = new URL(buildAuthorizeUrl({
      clientId: 'client-123',
      redirectUri: 'https://auto.afirmi.co/auth/callback',
      state: 'signed-state',
      challenge: 'challenge-value',
    }))

    expect(url.origin + url.pathname).toBe('https://auth.tesla.com/oauth2/v3/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('https://auto.afirmi.co/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(url.searchParams.get('state')).toBe('signed-state')
  })

  it('requests no command or energy scopes', () => {
    const scope = buildAuthorizeUrl({
      clientId: 'client-123',
      redirectUri: 'https://auto.afirmi.co/auth/callback',
      state: 's',
      challenge: 'c',
    })
    const granted = new URL(scope).searchParams.get('scope')!.split(' ')

    expect(granted).toEqual([...TESLA_SCOPES])
    for (const forbidden of ['vehicle_cmds', 'energy_cmds', 'energy_device_data', 'enterprise_management']) {
      expect(granted).not.toContain(forbidden)
    }
  })
})

describe('config pre-flight', () => {
  it('reports only the fields the caller passes', () => {
    // The authorize redirect does not need the client secret, so passing only
    // clientId + stateSecret must not report the secret as missing.
    expect(assertConfigured({ clientId: 'a', stateSecret: 'b' })).toEqual([])
  })

  it('reports a supplied-but-empty field', () => {
    expect(assertConfigured({ clientId: 'a', clientSecret: '' })).toEqual([
      'TESLA_CLIENT_SECRET is not set',
    ])
  })

  it('reports every empty field when all are supplied', () => {
    expect(assertConfigured({ clientId: '', clientSecret: '', stateSecret: '' })).toEqual([
      'TESLA_CLIENT_ID is not set',
      'TESLA_CLIENT_SECRET is not set',
      'OAUTH_STATE_SECRET is not set',
    ])
  })

  it('reports nothing when configuration is complete', () => {
    expect(assertConfigured({ clientId: 'a', clientSecret: 'b', stateSecret: 'c' })).toEqual([])
  })
})

describe('cookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; afirmico_session=abc-123; b=2')).toMatchObject({
      a: '1',
      [SESSION_COOKIE]: 'abc-123',
      b: '2',
    })
  })

  it('tolerates missing or empty headers', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('always marks session cookies HttpOnly, Secure and SameSite', () => {
    const cookie = serializeCookie(SESSION_COOKIE, 'value', { maxAge: 60 })
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=60')
  })

  it('clears a cookie by expiring it', () => {
    expect(clearCookie(SESSION_COOKIE)).toContain('Max-Age=0')
  })
})

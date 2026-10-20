/**
 * Behavioral tests for the security headers middleware added to the member-
 * and operator-facing worker surface (auto.afirmi.co/*).
 *
 * Why behavioral: connect-copy.test.ts asserts source text because it was
 * written before any route-level harness existed. admin-console.test.ts
 * established the pattern of calling `app.fetch` against REAL SQLite, and
 * header behavior (middleware ordering, precedence, asset passthrough) is
 * only observable through actual responses — a source-text grep cannot
 * prove the headers land on a live response, nor that a route that sets
 * its own header is not double-written.
 *
 * What each header pins:
 *   - CSP: script-src 'self' without inline — the pages carry no JS, so an
 *     injection has nothing to execute; form-action 'self' pins the consent,
 *     details and admin login forms to same-origin submission.
 *   - HSTS: browser-enforced HTTPS for a year.
 *   - nosniff: blocks MIME-type confusion on HTML responses.
 *   - DENY framing (both CSP frame-ancestors and X-Frame-Options): the
 *     consent and admin login pages must never render inside a hostile
 *     iframe (clickjacking).
 *   - no-referrer: member data in URLs must not leak to cross-origin hops.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import app from '../src/index'
import { createSqliteD1, seedBaseline, type SqliteD1 } from './helpers/sqlite-d1'

const SECRET = 'test-admin-secret'

function makeEnv() {
  const kv = new Map<string, string>()
  const d1 = createSqliteD1()
  return {
    OAUTH_SESSIONS: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v) },
      delete: async (k: string) => { kv.delete(k) },
    },
    D1_TESLA: d1,
    RAW_PAYLOADS: { put: async () => {}, get: async () => null },
    TESLA_CLIENT_ID: 'test-client-id',
    TESLA_CLIENT_SECRET: 'test-client-secret',
    OAUTH_STATE_SECRET: 'test-state-secret',
    TOKEN_ENCRYPTION_KEY: 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk=',
    INGEST_SHARED_SECRET: SECRET,
    TESLA_AUDIENCE: 'https://fleet-api.test.tesla.com',
    ASSETS: { fetch: async () => new Response('splash', { status: 200 }) },
    _kv: kv,
    _d1: d1,
  } as never
}

function d1Of(env: ReturnType<typeof makeEnv>): SqliteD1 {
  return (env as never as { D1_TESLA: SqliteD1 }).D1_TESLA
}

const EXPECTED_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
} as const

describe('security headers middleware', () => {
  let env: ReturnType<typeof makeEnv>

  beforeEach(() => {
    env = makeEnv()
    seedBaseline(d1Of(env))
  })

  it('sets the full header set on the member-facing connect page', async () => {
    const res = await app.fetch(new Request('https://auto.afirmi.co/toca-connect'), env)
    expect(res.status).toBe(200)
    for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(res.headers.get(name)).toBe(value)
    }
  })

  it('sets the headers on a redirect response (auth-gated routes)', async () => {
    // No session cookie: /details must 303 to /toca-connect AND still carry
    // the headers — redirects are responses too.
    const res = await app.fetch(new Request('https://auto.afirmi.co/details'), env)
    expect(res.status).toBe(303)
    for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(res.headers.get(name)).toBe(value)
    }
  })

  it('sets the headers on 404 responses (unmatched paths)', async () => {
    const res = await app.fetch(new Request('https://auto.afirmi.co/no-such-path'), env)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-security-policy')).toBe(EXPECTED_HEADERS['content-security-policy'])
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})

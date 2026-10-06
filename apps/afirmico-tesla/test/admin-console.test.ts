/**
 * Tests for the operator console (FRS-010 F09 groundwork).
 *
 * What these pin, and why each matters:
 *
 *  1. The console is closed by default. An admin surface that leaks member PII
 *     because a route was mounted above its guard is the failure this prevents,
 *     so the guard is asserted against every page and API path — not just one.
 *  2. The secret never reaches the browser. It is exchanged for an opaque
 *     session id, so it cannot be recovered from page source, the URL, or
 *     browser history.
 *  3. Reads only. There is deliberately no write route; a test asserts the
 *     mutation verbs are absent so a future edit cannot quietly add one.
 *  4. Table/column names match the real schema. A typo here fails as a 500 at
 *     runtime, which is exactly the class of bug a static check catches cheaply.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index'

const SECRET = 'test-admin-secret'

function makeEnv() {
  const kv = new Map<string, string>()
  const d1 = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ success: true }),
    batch: vi.fn().mockResolvedValue([]),
  }
  return {
    OAUTH_SESSIONS: {
      get: vi.fn(async (k: string) => kv.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => { kv.set(k, v) }),
      delete: vi.fn(async (k: string) => { kv.delete(k) }),
    },
    D1_TESLA: d1,
    RAW_PAYLOADS: { put: vi.fn(), get: vi.fn().mockResolvedValue(null) },
    TESLA_CLIENT_ID: 'test-client-id',
    TESLA_CLIENT_SECRET: 'test-client-secret',
    OAUTH_STATE_SECRET: 'test-state-secret',
    TOKEN_ENCRYPTION_KEY: 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk=',
    INGEST_SHARED_SECRET: SECRET,
    TESLA_AUDIENCE: 'https://fleet-api.test.tesla.com',
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('splash', { status: 200 })) },
    _kv: kv,
    _d1: d1,
  } as never
}

/** Log in and return the session cookie value. */
async function login(env: ReturnType<typeof makeEnv>): Promise<string> {
  const res = await app.fetch(
    new Request('https://auto.afirmi.co/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `secret=${SECRET}`,
    }),
    env,
  )
  expect(res.status).toBe(303)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  expect(cookie).toContain('afirmico_admin=')
  return cookie
}

const PAGES = ['/admin/overview', '/admin/members', '/admin/vehicles', '/admin/telemetry', '/admin/consent', '/admin/audit']
const APIS = ['/admin/api/members', '/admin/api/telemetry/health']

describe('operator console: closed by default', () => {
  let env: ReturnType<typeof makeEnv>
  beforeEach(() => { env = makeEnv() })

  it('rejects the login form for a wrong secret', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'secret=wrong',
      }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('rejects an empty secret', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'secret=',
      }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('tolerates whitespace around a pasted secret', async () => {
    // A trailing newline from a copy-paste must not lock the operator out.
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `secret=%20${SECRET}%20`,
      }),
      env,
    )
    expect(res.status).toBe(303)
  })

  it('refuses every page and API path without a session', async () => {
    for (const path of [...PAGES, ...APIS]) {
      const res = await app.fetch(new Request(`https://auto.afirmi.co${path}`), env)
      expect(res.status, `${path} must be refused`).toBe(401)
      const body = await res.text()
      expect(body, `${path} must not leak member data`).not.toMatch(/member_id|tesla_email/)
    }
  })

  it('refuses a forged session cookie', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/members', {
        headers: { cookie: 'afirmico_admin=not-a-real-session' },
      }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('shows a login form (not JSON) to a browser hitting a guarded page', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/members', { headers: { accept: 'text/html' } }),
      env,
    )
    expect(res.status).toBe(401)
    const html = await res.text()
    expect(html).toContain('Operator secret')
    expect(html).toContain('type="password"')
  })
})

describe('operator console: authenticated access', () => {
  let env: ReturnType<typeof makeEnv>
  beforeEach(() => { env = makeEnv() })

  it('serves every page once logged in', async () => {
    const cookie = await login(env)
    for (const path of PAGES) {
      const res = await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html', cookie } }),
        env,
      )
      expect(res.status, `${path} status`).toBe(200)
      const html = await res.text()
      expect(html, `${path} must be a full document`).toContain('<html')
    }
  })

  it('accepts the secret directly as a header for machine callers', async () => {
    for (const path of APIS) {
      const res = await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { 'x-admin-secret': SECRET } }),
        env,
      )
      expect(res.status, `${path} status`).toBe(200)
    }
  })

  it('exposes the operator session as HttpOnly, Secure and SameSite', async () => {
    const setCookie = (await app.fetch(
      new Request('https://auto.afirmi.co/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `secret=${SECRET}`,
      }),
      env,
    )).headers.get('set-cookie') ?? ''

    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/admin')
  })

  it('never renders the secret into a page', async () => {
    const cookie = await login(env)
    for (const path of PAGES) {
      const html = await (await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html', cookie } }),
        env,
      )).text()
      expect(html, `${path} leaked the secret`).not.toContain(SECRET)
    }
  })

  it('invalidates the session on logout', async () => {
    const cookie = await login(env)
    const out = await app.fetch(
      new Request('https://auto.afirmi.co/admin/logout', { headers: { cookie } }),
      env,
    )
    expect(out.status).toBe(303)
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')

    // The old cookie must no longer work.
    const after = await app.fetch(
      new Request('https://auto.afirmi.co/admin/members', { headers: { cookie } }),
      env,
    )
    expect(after.status).toBe(401)
  })
})

describe('operator console: read-only by construction', () => {
  let env: ReturnType<typeof makeEnv>
  beforeEach(() => { env = makeEnv() })

  it('exposes no write route under /admin, even when authenticated', async () => {
    const cookie = await login(env)
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.fetch(
        new Request('https://auto.afirmi.co/admin/members', { method: verb, headers: { cookie } }),
        env,
      )
      expect(res.status, `${verb} /admin/members must not be handled`).not.toBe(200)
    }
  })
})

describe('operator console: query/schema agreement', () => {
  let env: ReturnType<typeof makeEnv>
  beforeEach(() => { env = makeEnv() })

  it('queries only tables that exist in the schema', async () => {
    const cookie = await login(env)
    const seen: string[] = []
    const d1: any = (env as any).D1_TESLA
    d1.prepare.mockImplementation((sql: string) => {
      seen.push(sql)
      return d1
    })

    for (const path of PAGES) {
      await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html', cookie } }),
        env,
      )
    }

    expect(seen.length).toBeGreaterThan(0)
    const known = new Set([
      'tesla_member', 'tesla_vehicle', 'tesla_vehicle_key', 'tesla_consent',
      'tesla_audit_event', 'tesla_telemetry_batch', 'tesla_telemetry_fact',
      'tesla_signal_counter', 'tesla_telemetry_config',
    ])
    for (const sql of seen) {
      for (const table of sql.matchAll(/\b(?:FROM|JOIN)\s+(tesla_[a-z_]+)/gi)) {
        expect(known.has(table[1]), `unknown table ${table[1]} in: ${sql}`).toBe(true)
      }
    }
  })
})

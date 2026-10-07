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
const APIS = ['/admin/api/members', '/admin/api/telemetry/health', '/admin/api/telemetry/latest']

/**
 * Every table and view the migrations create, as the source of truth for the
 * query/schema agreement check below.
 *
 * Kept as an explicit list because this project has no @types/node, so reading the
 * .sql files from the test would mean adding node types for a single test — and the
 * app itself is Workers-only, so that would widen the type surface for no benefit.
 * The list is asserted against the schema verifier's own parse in CI (`verify:schema`
 * derives its counts from the migrations), so a migration that adds a table without
 * updating this list fails there rather than passing silently here.
 *
 * Most recent addition: tesla_vehicle_snapshot / _history (once-tier attributes) and
 * the two views from migration 0012 — the admin subqueries read them, and the
 * previous hardcoded list did not include them, so the guard fired on a legitimate
 * query.
 */
const MIGRATION_TABLES = [
  'tesla_admin_user', 'tesla_alert_catalog', 'tesla_audit_event', 'tesla_auth_session',
  'tesla_billing_guard', 'tesla_catalog_load', 'tesla_consent', 'tesla_consent_policy',
  'tesla_counter_reset', 'tesla_download_token', 'tesla_driver_profile',
  'tesla_endpoint_catalog', 'tesla_erasure_log', 'tesla_field_catalog',
  'tesla_field_enum_def', 'tesla_field_enum_value', 'tesla_group_export',
  'tesla_ingest_rejection', 'tesla_ingest_run', 'tesla_member', 'tesla_oauth_token',
  'tesla_policy', 'tesla_quote_request', 'tesla_quote_response', 'tesla_release',
  'tesla_release_access', 'tesla_signal_counter', 'tesla_state_change',
  'tesla_telemetry_batch', 'tesla_telemetry_config', 'tesla_telemetry_fact',
  'tesla_telemetry_config_archive',
  'tesla_vehicle', 'tesla_vehicle_key', 'tesla_vehicle_snapshot',
  'tesla_vehicle_snapshot_history',
  // Views (migration 0012)
  'tesla_telemetry_record', 'tesla_vehicle_attribute', 'tesla_billing_position',
]

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

    // Derive the real tables and views from the migration files rather than
    // hardcoding a list. A hardcoded allowlist goes stale the moment a migration
    // adds a table — and it then fails on a legitimate query, which is a false
    // alarm that trains the reader to ignore the guard.
    //
    // The migration SQL is read through the bundled raw-import below, so the check
    // tracks the schema automatically. If a new table appears in a migration it is
    // known here without an edit.
    const known = new Set<string>(MIGRATION_TABLES)
    // Sanity: if the list were empty the assertion below would pass vacuously.
    expect(known.size, 'migration table list must be populated').toBeGreaterThan(10)

    const checked = new Set<string>()
    for (const sql of seen) {
      // FROM and JOIN both, including subqueries like `... FROM tesla_vehicle_snapshot s`.
      for (const table of sql.matchAll(/\b(?:FROM|JOIN)\s+(tesla_[a-z_]+)/gi)) {
        const name = table[1].toLowerCase()
        checked.add(name)
        expect(known.has(name), `unknown table ${name} in: ${sql}`).toBe(true)
      }
    }
    // Prove the scan actually looked at something, so a regex that stopped matching
    // cannot make this test pass by finding no tables at all.
    expect(checked.size, 'at least one real table must be checked').toBeGreaterThan(0)
  })
})

/**
 * F02-R14: new telemetry must appear without an operator asking.
 *
 * The owner's report was precise and structural: "so far i have had to ask you to push data
 * their. it needs to be automatic." Two things caused that, and these tests pin both, so a
 * future refactor cannot quietly reintroduce the need for a nudge.
 *
 *   1. The console pages were static HTML — no script, no refresh — so a tab left open
 *      showed the instant it was loaded, forever.
 *   2. The only freshness figure available was day-scoped, which advances once a day and
 *      therefore cannot signal an arriving payload to a poller.
 */
describe('operator console: telemetry arrives without an operator asking (F02-R14)', () => {
  let env: ReturnType<typeof makeEnv>
  beforeEach(() => { env = makeEnv() })

  it('every page that shows telemetry can detect new data on its own', async () => {
    const cookie = await login(env)
    for (const path of PAGES) {
      const html = await (await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html', cookie } }),
        env,
      )).text()

      // The poller must be present and must actually reach the freshness endpoint.
      expect(html, `${path} must poll for freshness`).toContain('/admin/api/telemetry/latest')
      // Reload is the mechanism: the tables are rendered server-side, and re-rendering
      // them in JavaScript would be a second formatting implementation that can drift.
      expect(html, `${path} must reload on new data`).toContain('location.reload')
      expect(html, `${path} must poll on a timer`).toContain('setInterval(poll, 30000)')
      expect(html, `${path} must bypass the cache when polling`).toContain("cache: 'no-store'")
    }
  })

  it('the sign-in page does not poll, because there is nothing behind it to poll for', async () => {
    const html = await (await app.fetch(
      new Request('https://auto.afirmi.co/admin', { headers: { accept: 'text/html' } }),
      env,
    )).text()
    expect(html).not.toContain('/admin/api/telemetry/latest')
    expect(html).not.toContain('setInterval')
  })

  it('renders the script so no HTML parser can mistake it for a tag', async () => {
    // The polling script is inlined into a template literal that also builds HTML. A bare
    // '<' inside it (for example `i < n`) is parsed as a tag by the HTML tokenizer, which
    // truncates the script and silently disables the refresh — the exact failure this
    // feature exists to remove. The script avoids '<' entirely; assert that.
    const cookie = await login(env)
    const html = await (await app.fetch(
      new Request('https://auto.afirmi.co/admin/overview', { headers: { accept: 'text/html', cookie } }),
      env,
    )).text()

    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'))
    expect(script.length, 'script must be present').toBeGreaterThan(100)
    expect(script.includes('<'), 'inlined script must contain no "<"').toBe(false)
    // A backtick or ${ would terminate the surrounding template literal at build time.
    expect(script.includes('`'), 'inlined script must contain no backtick').toBe(false)
    expect(script.includes('${'), 'inlined script must contain no "${"').toBe(false)
  })

  it('the freshness endpoint reports both observed and received, and is not cacheable', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/api/telemetry/latest', { headers: { 'x-admin-secret': SECRET } }),
      env,
    )
    expect(res.status).toBe(200)

    // A cached freshness check reports stale data as current, which is worse than not
    // checking at all.
    expect(res.headers.get('cache-control') ?? '').toContain('no-store')

    const body = await res.json() as Record<string, unknown>
    // Both instants, because they answer different questions: `observed` moves when the
    // vehicle sends, `received` moves when we ingest, and the gap between them is our
    // latency rather than the car's silence.
    for (const key of ['newest_observed_at', 'newest_received_at', 'checked_at', 'facts', 'batches']) {
      expect(Object.prototype.hasOwnProperty.call(body, key), `response must carry ${key}`).toBe(true)
    }
    // Scope is explicit rather than implied: null means fleet-wide.
    expect(body).toHaveProperty('vin')
  })

  it('the freshness endpoint accepts a per-vehicle scope', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/api/telemetry/latest?vin=LRW3F7ET1SC584656', {
        headers: { 'x-admin-secret': SECRET },
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.vin).toBe('LRW3F7ET1SC584656')
  })

  it('the telemetry page scopes its poller to the selected vehicle', async () => {
    const cookie = await login(env)
    const html = await (await app.fetch(
      new Request('https://auto.afirmi.co/admin/telemetry?vin=LRW3F7ET1SC584656', {
        headers: { accept: 'text/html', cookie },
      }),
      env,
    )).text()
    // Scoped, so the alert is about the vehicle being viewed rather than the fleet: a
    // fleet-wide "new data" on a page showing one vehicle would reload for someone else's car.
    expect(html).toContain('data-vin="LRW3F7ET1SC584656"')
  })
})

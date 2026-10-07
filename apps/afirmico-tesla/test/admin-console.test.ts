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
 *  4. The queries actually run. Every page and API route is exercised against
 *     REAL SQLite with the real migrations applied (test/helpers/sqlite-d1.ts).
 *
 * Why (4) matters, in the strongest terms this file can put it:
 *
 * These tests previously used `prepare: vi.fn().mockReturnThis()` — a double that accepted
 * ANY SQL. A column that did not exist was indistinguishable from one that did, and a
 * production endpoint shipped returning HTTP 500 with 295 tests green:
 *
 *     no such column: observed_at at offset 11: SQLITE_ERROR [code: 7500]
 *
 * That was the third production failure to come through this blind spot, so the mock is
 * gone rather than supplemented. A test double that cannot reject anything validates
 * nothing about the queries it stands in for.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import app from '../src/index'
import { createSqliteD1, assertRejectsInvalidSql, seedBaseline, MIGRATION_COUNT, type SqliteD1 } from './helpers/sqlite-d1'

const SECRET = 'test-admin-secret'

function makeEnv() {
  const kv = new Map<string, string>()
  // Real SQLite with every migration applied — not a permissive stub. See the note above:
  // the stub is what let a 500 ship.
  const d1 = createSqliteD1()
  assertRejectsInvalidSql(d1)
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

/** The D1 double, for tests that need to seed or inspect rows. */
function d1Of(env: ReturnType<typeof makeEnv>): SqliteD1 {
  return (env as never as { D1_TESLA: SqliteD1 }).D1_TESLA
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

describe('operator console: queries actually run against the real schema', () => {
  let env: ReturnType<typeof makeEnv>
  beforeEach(() => { env = makeEnv() })

  it('every page and API route returns 200 when driven through real SQLite', async () => {
    // This is the test that would have caught the production 500 on
    // /admin/api/telemetry/latest. The endpoint read `observed_at` from
    // tesla_telemetry_batch, which has no such column — the permissive mock returned a
    // null row instead of raising, so the suite stayed green while the endpoint 500'd.
    const cookie = await login(env)
    for (const path of PAGES) {
      const res = await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html', cookie } }),
        env,
      )
      expect(res.status, `${path} must not 500 against the real schema`).toBe(200)
    }
    for (const path of APIS) {
      const res = await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { 'x-admin-secret': SECRET } }),
        env,
      )
      expect(res.status, `${path} must not 500 against the real schema`).toBe(200)
    }
  })

  it('reports real row counts from seeded data, not a stubbed null', async () => {
    // Proves the pages read the database rather than a mock's fixed return: with rows
    // seeded, the values must move. A stub returning null for every `first()` would still
    // render "0", so asserting the count catches a regression back to a stub.
    const { vin } = seedBaseline(d1Of(env))
    const cookie = await login(env)
    const res = await app.fetch(
      new Request(`https://auto.afirmi.co/admin/api/telemetry/latest?vin=${vin}`, {
        headers: { 'x-admin-secret': SECRET },
      }),
      env,
    )
    const body = (await res.json()) as { facts: number; batches: number; newest_observed_at: string | null }
    expect(body.facts, 'seeded fact must be counted').toBe(1)
    expect(body.batches, 'seeded batch must be counted').toBe(1)
    expect(body.newest_observed_at, 'observed_at comes from the fact table').not.toBeNull()
  })

  it('reads the two instants from the tables that own them', async () => {
    // The exact confusion that caused the 500: `observed_at` is on tesla_telemetry_fact
    // (the vehicle's clock for a reading) and `received_at` is on tesla_telemetry_batch
    // (when the payload reached us). Seeding DIFFERENT values proves each is read from the
    // right place — no single-table query can satisfy both.
    const d1 = d1Of(env)
    seedBaseline(d1)
    d1._seed(`
      UPDATE tesla_telemetry_fact SET observed_at = '2026-10-07T01:00:00Z';
      UPDATE tesla_telemetry_batch SET received_at = '2026-10-07T09:00:00Z';
    `)
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/api/telemetry/latest', {
        headers: { 'x-admin-secret': SECRET },
      }),
      env,
    )
    const body = (await res.json()) as { newest_observed_at: string; newest_received_at: string }
    expect(body.newest_observed_at, 'from tesla_telemetry_fact').toBe('2026-10-07T01:00:00Z')
    expect(body.newest_received_at, 'from tesla_telemetry_batch').toBe('2026-10-07T09:00:00Z')
  })

  it('the per-vehicle scope filters, rather than ignoring the VIN', async () => {
    const { vin } = seedBaseline(d1Of(env))
    const cookie = await login(env)
    const mine = await app.fetch(
      new Request(`https://auto.afirmi.co/admin/api/telemetry/latest?vin=${vin}`, {
        headers: { 'x-admin-secret': SECRET },
      }),
      env,
    )
    const other = await app.fetch(
      new Request('https://auto.afirmi.co/admin/api/telemetry/latest?vin=5YJ3F7EB7LF697834', {
        headers: { 'x-admin-secret': SECRET },
      }),
      env,
    )
    expect(((await mine.json()) as { facts: number }).facts, 'the seeded VIN has data').toBe(1)
    expect(((await other.json()) as { facts: number }).facts, 'an unknown VIN has none').toBe(0)
  })

  it('the harness really applied every migration', () => {
    // If the migrations silently stopped being applied, every other test here would still
    // pass against an empty but permissive schema — so assert the schema exists.
    expect(MIGRATION_COUNT, 'migrations must be discoverable').toBeGreaterThan(10)
    const tables = d1Of(env)._rows(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name LIKE 'tesla_%'",
    )
    expect(tables.length, 'the migrated schema must be present').toBeGreaterThan(MIGRATION_COUNT)
  })

  it('enforces the schema constraints a permissive mock ignored', () => {
    // Not incidental: the mock accepted NULLs and out-of-range enum values that the
    // migrations forbid. Data-level mistakes are as invisible to a stub as column ones.
    const d1 = d1Of(env)
    expect(
      () => d1._seed("INSERT INTO tesla_member (member_id, toca_status, email, created_at, updated_at) VALUES ('m2','nonsense','a@b.c','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')"),
      'toca_status is CHECK constrained',
    ).toThrow()
    expect(
      () => d1._seed("INSERT INTO tesla_vehicle (vin, member_id, display_name, first_seen_at) VALUES ('V','no-such-member','X','2026-01-01T00:00:00Z')"),
      'tesla_vehicle.member_id is a real foreign key',
    ).toThrow()
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

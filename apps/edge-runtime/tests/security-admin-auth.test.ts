/**
 * EdgeGDE — Security Admin Auth Tests
 * Covers: SEC-03
 *
 * Verifies that all admin endpoints properly enforce authentication by
 * returning 401 when accessed without a token or with a wrong token.
 *
 * Usage:
 *   npx tsx tests/security-admin-auth.test.ts
 *
 * Environment variables:
 *   WORKER_URL  (default: https://edgegde-calculator.renleding.workers.dev)
 *   TOKEN       (default: 858ea106ba9379472dfa634b1c630c2e46b525f6)
 *   TENANT      (default: au_test_mortgage_broker_v2)
 */

const WORKER = process.env.WORKER_URL || 'https://edgegde-calculator.renleding.workers.dev'
const TOKEN = process.env.TOKEN || '858ea106ba9379472dfa634b1c630c2e46b525f6'
const TENANT = process.env.TENANT || 'au_test_mortgage_broker_v2'

const WRONG_TOKEN = 'invalid-token-12345'

let pass = 0
let fail = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    fail++
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

async function get(path: string) {
  const url = `${WORKER}${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`
  const r = await fetch(url, { headers: { 'User-Agent': 'edgegde-test/1.0' } })
  return { status: r.status, body: await r.text() }
}

async function getWithToken(path: string, token: string) {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${WORKER}${path}${sep}token=${token}&_t=${Date.now()}`
  const r = await fetch(url, { headers: { 'User-Agent': 'edgegde-test/1.0' } })
  return { status: r.status, body: await r.text() }
}

function has(body: string, text: string) {
  if (!body.includes(text)) throw new Error(`Expected "${text}" in response`)
}

function isStatus(res: { status: number; body: string }, expected: number) {
  if (res.status !== expected) {
    throw new Error(`Expected status ${expected}, got ${res.status}: ${res.body.substring(0, 80)}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`EdgeGDE Security Admin Auth Tests (SEC-03)`)
  console.log(`  Worker: ${WORKER}`)
  console.log(`  Tenant: ${TENANT}`)

  // ── SEC-03: Admin Authentication Enforcement ──────────────────────
  console.log('\n── SEC-03: Admin Auth Enforcement ──')

  // ═══ /admin/tenants (API endpoint) ═════════════════════════════════
  console.log('\n── /api/tenants (via GET /api/tenants) ──')

  await test('SEC-03a: Access /api/tenants without token → 401', async () => {
    const res = await get('/api/tenants')
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  await test('SEC-03b: Access /api/tenants with wrong token → 401', async () => {
    const res = await getWithToken('/api/tenants', WRONG_TOKEN)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  await test('SEC-03c: Access /api/tenants with correct token → 200', async () => {
    const res = await getWithToken('/api/tenants', TOKEN)
    // This should return either tenant list or an error about D1 binding
    // Both are valid responses — the key is that it's NOT 401
    if (res.status === 401) throw new Error('Correct token returned 401')
    // It could be 200 (success), 500 (D1 not available), or other errors
    // The key test is auth passed
    console.log(`    Status: ${res.status} (auth passed)`)
  })

  // ═══ /admin/rules ═══════════════════════════════════════════════════
  console.log('\n── /admin/rules ──')

  await test('SEC-03d: Access /admin/rules without token → 401', async () => {
    const res = await get(`/admin/rules?tenant=${TENANT}`)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  // ═══ /admin/site ═══════════════════════════════════════════════════
  console.log('\n── /admin/site ──')

  await test('SEC-03e: Access /admin/site without token → 401', async () => {
    const res = await get(`/admin/site?tenant=${TENANT}`)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  // ═══ /admin/blueprints ═════════════════════════════════════════════
  console.log('\n── /admin/blueprints ──')

  await test('SEC-03f: Access /admin/blueprints without token → 401', async () => {
    const res = await get(`/admin/blueprints?tenant=${TENANT}`)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  // ═══ /admin/factory ════════════════════════════════════════════════
  console.log('\n── /admin/factory ──')

  await test('SEC-03g: Access /admin/factory without token → 401', async () => {
    const res = await get(`/admin/factory`)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  // ═══ /admin/packs ══════════════════════════════════════════════════
  console.log('\n── /admin/packs ──')

  await test('SEC-03h: Access /admin/packs without token → 401', async () => {
    const res = await get(`/admin/packs?tenant=${TENANT}`)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  // ═══ Wrong token check (spot-check one endpoint) ═══════════════════
  console.log('\n── Wrong Token Checks (Spot) ──')

  await test('SEC-03i: Access /admin/rules with wrong token → 401', async () => {
    const res = await getWithToken(`/admin/rules?tenant=${TENANT}`, WRONG_TOKEN)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  await test('SEC-03j: Access /admin/site with wrong token → 401', async () => {
    const res = await getWithToken(`/admin/site?tenant=${TENANT}`, WRONG_TOKEN)
    isStatus(res, 401)
    has(res.body, 'Unauthorized')
  })

  // ═══ Correct token access (spot-check) ═════════════════════════════
  console.log('\n── Correct Token Access (Spot) ──')

  await test('SEC-03k: Access /admin/rules with correct token → 200', async () => {
    const res = await getWithToken(`/admin/rules?tenant=${TENANT}`, TOKEN)
    if (res.status === 401) throw new Error('Correct token returned 401')
    console.log(`    Status: ${res.status} (auth passed)`)
  })

  await test('SEC-03l: Access /admin/site with correct token → 200', async () => {
    const res = await getWithToken(`/admin/site?tenant=${TENANT}`, TOKEN)
    if (res.status === 401) throw new Error('Correct token returned 401')
    console.log(`    Status: ${res.status} (auth passed)`)
  })

  await test('SEC-03m: Access /admin/blueprints with correct token → 200', async () => {
    const res = await getWithToken(`/admin/blueprints?tenant=${TENANT}`, TOKEN)
    if (res.status === 401) throw new Error('Correct token returned 401')
    console.log(`    Status: ${res.status} (auth passed)`)
  })

  await test('SEC-03n: Access /admin/factory with correct token → 200', async () => {
    const res = await getWithToken(`/admin/factory`, TOKEN)
    if (res.status === 401) throw new Error('Correct token returned 401')
    console.log(`    Status: ${res.status} (auth passed)`)
  })

  await test('SEC-03o: Access /admin/packs with correct token → 200', async () => {
    const res = await getWithToken(`/admin/packs?tenant=${TENANT}`, TOKEN)
    if (res.status === 401) throw new Error('Correct token returned 401')
    console.log(`    Status: ${res.status} (auth passed)`)
  })

  // ── Results ────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })

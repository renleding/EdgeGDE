/**
 * EdgeGDE — Admin Pages Comprehensive Test Suite
 * Covers: Knowledge Base (KB), Rules, Site admin pages
 * Tests: Route availability, HTMX interactions, edge cases, error states, XSS
 *
 * Run: npx tsx tests/admin-pages.test.ts
 */

import assert from 'node:assert'
import { Hono } from 'hono'
import { adminRouter } from '../src/api/admin-views'
import { adminRulesRouter } from '../src/api/admin-rules'
import { adminSiteRouter } from '../src/api/admin-site'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const TEST_TENANT = 'au-mortgage-broker-afirmico'
let passed = 0
let failed = 0
let suite = ''

function run(name: string, fn: () => Promise<void> | void) {
  suite = name
  try {
    const result = fn()
    if (result instanceof Promise) {
      result.then(() => {
        passed++
        console.log(`  ✓ ${name}`)
      }).catch((e: any) => {
        failed++
        console.log(`  ✗ ${name}: ${e.message}`)
      })
      return
    }
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

function assertContains(body: string, text: string, msg?: string) {
  assert.ok(body.includes(text), msg || `Expected "${text}" in body`)
}

function assertNotContains(body: string, text: string, msg?: string) {
  assert.ok(!body.includes(text), msg || `Expected "${text}" NOT in body`)
}

function createMockEnv() {
  const kvStore = new Map<string, string>()

  return {
    TENANT_KV: {
      get: async (key: string, _ctx?: any) => kvStore.get(key) || null,
      put: async (key: string, value: string, _ctx?: any) => { kvStore.set(key, value) },
      delete: async (key: string) => { kvStore.delete(key) },
      _store: kvStore,
    },
    DB: {
      prepare: (_sql: string) => ({
        bind: (..._args: any[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true }),
        }),
      }),
    },
    LEAD_SCORING_QUEUE: {
      send: async (_msg: any) => {},
    },
  }
}

async function fetchText(router: Hono, path: string, env: any): Promise<string> {
  // Build a request directly against the router
  const url = new URL(path, 'http://localhost')
  const req = new Request(url.toString(), {
    headers: { Host: 'localhost' },
  })
  // We need to simulate the Hono context - use Hono's request mechanism
  const app = new Hono()
  
  // Add tenant + token query params to the request
  app.use('*', async (c, next) => {
    c.env = { ...env, ADMIN_API_TOKEN: '858ea106ba9379472dfa634b1c630c2e46b525f6' } as any
    await next()
  })
  app.route('/', router)

  const res = await app.request(req)
  return res.text()
}

async function fetchPost(router: Hono, path: string, env: any, formData?: Record<string, string>): Promise<string> {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.env = { ...env, ADMIN_API_TOKEN: '858ea106ba9379472dfa634b1c630c2e46b525f6' } as any
    await next()
  })
  app.route('/', router)

  const fd = new FormData()
  if (formData) {
    for (const [k, v] of Object.entries(formData)) fd.append(k, v)
  }

  const url = new URL(path, 'http://localhost')
  const req = new Request(url.toString(), {
    method: 'POST',
    body: fd,
    headers: { Host: 'localhost' },
  })
  const res = await app.request(req)
  return res.text()
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Knowledge Base Admin Pages
// ═══════════════════════════════════════════════════════════════════════════

async function runKbTests() {
  console.log('\n── Suite 1: Knowledge Base Admin (/admin/kb) ──')

  // 1.1 Main page loads with all elements
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'Knowledge Base', 'KB page title')
    assertContains(body, 'AFIRMICO Admin', 'Admin branding')
    assertContains(body, 'Pending', 'Pending tab')
    assertContains(body, 'Approved', 'Approved tab')
    assertContains(body, 'Rejected', 'Rejected tab')
    assertContains(body, 'Ingest New Source', 'Ingest section')
    assertContains(body, 'hx-post="/admin/kb/ingest-url', 'Ingest HTMX endpoint')
    run('1.1 main KB page loads with tabs and ingest form', () => {})
  }

  // 1.2 Nav links include tenant param
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb?tenant=${TEST_TENANT}`, env)
    assertContains(body, `href="/admin/kb?tenant=${TEST_TENANT}"`, 'KB nav link has tenant')
    assertContains(body, `href="/admin/rules?tenant=${TEST_TENANT}"`, 'Rules nav link has tenant')
    assertContains(body, `href="/admin/site?tenant=${TEST_TENANT}"`, 'Site nav link has tenant')
    run('1.2 nav links include tenant param', () => {})
  }

  // 1.3 Pending tab active by default
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'class="tab active"', 'Active tab class')
    assertContains(body, 'hx-get="/admin/kb/pending', 'Pending HTMX get')
    run('1.3 pending tab active by default', () => {})
  }

  // 1.4 Empty state when no pending
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No pending entries', 'Empty pending state')
    run('1.4 shows empty state when no entries', () => {})
  }

  // 1.5 Ingest form fields
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'type="url"', 'URL input type')
    assertContains(body, 'name="url"', 'URL field name')
    assertContains(body, 'name="topic"', 'Topic select name')
    assertContains(body, 'Auto-detect', 'Auto-detect option')
    assertContains(body, 'Rates', 'Rates topic')
    assertContains(body, 'Products', 'Products topic')
    assertContains(body, 'Policy', 'Policy topic')
    assertContains(body, 'Fees', 'Fees topic')
    assertContains(body, 'Compliance', 'Compliance topic')
    assertContains(body, 'General', 'General topic')
    run('1.5 ingest form has all fields and topic options', () => {})
  }

  // 1.6 GET /pending returns empty
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb/pending?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No pending entries')
    run('1.6 GET /pending returns empty with no data', () => {})
  }

  // 1.7 GET /pending shows entries
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:rates`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 't1', value: 'Interest rate 6.15% p.a.', source_ref: 'test' }], source_ref: 'https://example.com' })
    )
    const body = await fetchText(adminRouter, `/admin/kb/pending?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'Interest rate 6.15% p.a.', 'Pending entry value')
    assertContains(body, 'rates', 'Topic header')
    assertContains(body, 'hx-post="/admin/kb/approve?topic=rates"', 'Approve button')
    assertContains(body, 'hx-post="/admin/kb/reject?topic=rates"', 'Reject button')
    run('1.7 GET /pending shows entries with approve/reject', () => {})
  }

  // 1.8 GET /list returns empty
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb/list?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No approved entries')
    run('1.8 GET /list returns empty when no approved', () => {})
  }

  // 1.9 GET /rejected returns empty
  {
    const env = createMockEnv()
    const body = await fetchText(adminRouter, `/admin/kb/rejected?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No rejected entries')
    run('1.9 GET /rejected returns empty when no rejected', () => {})
  }

  // 1.10 POST /approve moves pending to approved
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:rates`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 'a1', value: 'Rate 5.99%', source_ref: 'test' }], source_ref: 'test' })
    )
    const body = await fetchPost(adminRouter, `/admin/kb/approve?tenant=${TEST_TENANT}&topic=rates`, env)
    assertContains(body, 'Approved', 'Approve response')
    assertContains(body, '1 entries', 'Entry count')

    // Verify pending deleted
    const pendingRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:kb_pending:rates`)
    assert.strictEqual(pendingRaw, null, 'Pending deleted after approve')

    // Verify approved exists
    const approvedRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:kb:rates`)
    assert.ok(approvedRaw, 'Approved entry exists')
    const approved = JSON.parse(approvedRaw!)
    assert.strictEqual(approved.entries.length, 1)
    assert.strictEqual(approved.entries[0].id, 'a1')
    run('1.10 POST /approve moves pending to approved', () => {})
  }

  // 1.11 POST /approve deduplicates
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb:rates`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 'dup1', value: 'Original', source_ref: 'old' }], updated_at: Date.now() })
    )
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:rates`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 'dup1', value: 'Updated', source_ref: 'new' }], source_ref: 'new' })
    )
    await fetchPost(adminRouter, `/admin/kb/approve?tenant=${TEST_TENANT}&topic=rates`, env)
    const approvedRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:kb:rates`)
    const approved = JSON.parse(approvedRaw!)
    assert.strictEqual(approved.entries.length, 1, 'Deduped to 1 entry')
    run('1.11 POST /approve deduplicates by id on merge', () => {})
  }

  // 1.12 POST /approve with no pending
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRouter, `/admin/kb/approve?tenant=${TEST_TENANT}&topic=nonexistent`, env)
    assertContains(body, 'No pending data')
    run('1.12 POST /approve with no pending returns error', () => {})
  }

  // 1.13 POST /reject moves pending to rejected
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:fees`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 'f1', value: 'Annual fee $395', source_ref: 'test' }], source_ref: 'test' })
    )
    const body = await fetchPost(adminRouter, `/admin/kb/reject?tenant=${TEST_TENANT}&topic=fees`, env)
    assertContains(body, 'Rejected')

    // Verify pending deleted, rejected created
    const pendingRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:kb_pending:fees`)
    assert.strictEqual(pendingRaw, null)
    const rejectedRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:kb_rejected:fees`)
    assert.ok(rejectedRaw)
    run('1.13 POST /reject moves pending to rejected', () => {})
  }

  // 1.14 POST /reject with no pending
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRouter, `/admin/kb/reject?tenant=${TEST_TENANT}&topic=nonexistent`, env)
    assertContains(body, 'No pending data')
    run('1.14 POST /reject with no pending returns error', () => {})
  }

  // 1.15 Missing topic on approve/reject
  {
    const env = createMockEnv()
    const body1 = await fetchPost(adminRouter, `/admin/kb/approve?tenant=${TEST_TENANT}`, env)
    assertContains(body1, 'Missing topic')
    const body2 = await fetchPost(adminRouter, `/admin/kb/reject?tenant=${TEST_TENANT}`, env)
    assertContains(body2, 'Missing topic')
    run('1.15 missing topic on approve/reject returns error', () => {})
  }

  // 1.16 Ingest URL with empty URL
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRouter, `/admin/kb/ingest-url?tenant=${TEST_TENANT}`, env, { url: '', topic: 'rates' })
    assertContains(body, 'URL required')
    run('1.16 POST /ingest-url with empty URL returns error', () => {})
  }

  // 1.17 Ingest URL enqueues
  {
    const env = createMockEnv()
    let queued = false
    env.LEAD_SCORING_QUEUE.send = async (msg: any) => {
      queued = true
      assert.strictEqual(msg.type, 'kb_ingest')
      assert.strictEqual(msg.tenantId, TEST_TENANT)
      assert.strictEqual(msg.url, 'https://example.com/rates')
    }
    const body = await fetchPost(adminRouter, `/admin/kb/ingest-url?tenant=${TEST_TENANT}`, env,
      { url: 'https://example.com/rates', topic: 'rates' })
    assertContains(body, 'Queued')
    assert.ok(queued, 'Queue send was called')
    run('1.17 POST /ingest-url enqueues to queue', () => {})
  }

  // 1.18 XSS escaping
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:rates`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 'xss1', value: '<script>alert("xss")</script>', source_ref: 'test' }], source_ref: 'test' })
    )
    const body = await fetchText(adminRouter, `/admin/kb/pending?tenant=${TEST_TENANT}`, env)
    assertNotContains(body, '<script>', 'Raw script tags escaped')
    assertContains(body, '&lt;script&gt;', 'HTML entities escaped')
    run('1.18 XSS escaped in rendered entries', () => {})
  }

  // 1.19 Special characters in entries
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:rates`,
      JSON.stringify({ entries: [{ type: 'knowledge', id: 'sc1', value: 'Rate > 5% & fee < $400 "discount"', source_ref: 'test' }], source_ref: 'test' })
    )
    const body = await fetchText(adminRouter, `/admin/kb/pending?tenant=${TEST_TENANT}`, env)
    assertContains(body, '&gt;', 'Greater-than escaped')
    assertContains(body, '&amp;', 'Ampersand escaped')
    assertContains(body, '&quot;', 'Quote escaped')
    run('1.19 HTML entities correctly escaped in entry values', () => {})
  }

  // 1.20 Large entry count (50+)
  {
    const env = createMockEnv()
    const entries = Array.from({ length: 60 }, (_, i) => ({
      type: 'knowledge', id: `bulk_${i}`, value: `Bulk entry ${i} with rate info`,
    }))
    await env.TENANT_KV.put(
      `tenant:${TEST_TENANT}:kb_pending:products`,
      JSON.stringify({ entries, source_ref: 'bulk' })
    )
    const body = await fetchText(adminRouter, `/admin/kb/pending?tenant=${TEST_TENANT}`, env)
    for (let i = 0; i < 60; i++) {
      assertContains(body, `Bulk entry ${i}`, `Entry ${i} rendered`)
    }
    run('1.20 handles 60+ entries without crashing', () => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Rules Admin Pages
// ═══════════════════════════════════════════════════════════════════════════

async function runRulesTests() {
  console.log('\n── Suite 2: Policy Rules Admin (/admin/rules) ──')

  // 2.1 Main page loads
  {
    const env = createMockEnv()
    const body = await fetchText(adminRulesRouter, `/admin/rules?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'Policy Rules')
    assertContains(body, 'Priority')
    assertContains(body, 'Condition')
    assertContains(body, 'Output')
    assertContains(body, 'Active')
    assertContains(body, 'Create Rule')
    assertContains(body, 'Test Conditions')
    run('2.1 main Rules page loads with table and forms', () => {})
  }

  // 2.2 Nav links
  {
    const env = createMockEnv()
    const body = await fetchText(adminRulesRouter, `/admin/rules?tenant=${TEST_TENANT}`, env)
    assertContains(body, `href="/admin/kb?tenant=${TEST_TENANT}"`, 'KB nav link')
    assertContains(body, `href="/admin/rules?tenant=${TEST_TENANT}"`, 'Rules nav link')
    assertContains(body, `href="/admin/site?tenant=${TEST_TENANT}"`, 'Site nav link')
    run('2.2 nav links include tenant param', () => {})
  }

  // 2.3 Empty state
  {
    const env = createMockEnv()
    const body = await fetchText(adminRulesRouter, `/admin/rules?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No rules yet')
    run('2.3 shows empty state when no rules', () => {})
  }

  // 2.4 Create form fields
  {
    const env = createMockEnv()
    const body = await fetchText(adminRulesRouter, `/admin/rules?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'name="condition"')
    assertContains(body, 'name="output"')
    assertContains(body, 'name="priority"')
    assertContains(body, 'hx-post="/admin/rules/create')
    run('2.4 create form has condition, output, priority fields', () => {})
  }

  // 2.5 Empty fields validation
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/create?tenant=${TEST_TENANT}`, env,
      { condition: '', output: '', priority: '50' })
    assertContains(body, 'Condition and output required')
    run('2.5 POST /create with empty fields returns error', () => {})
  }

  // 2.6 Invalid condition syntax
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/create?tenant=${TEST_TENANT}`, env,
      { condition: 'invalid @@ syntax !!!', output: 'stage=blocked', priority: '50' })
    assertContains(body, 'Invalid condition syntax')
    run('2.6 POST /create validates condition syntax', () => {})
  }

  // 2.7 Test form fields
  {
    const env = createMockEnv()
    const body = await fetchText(adminRulesRouter, `/admin/rules?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'name="mock_state"')
    assertContains(body, 'hx-post="/admin/rules/test')
    run('2.7 test form has mock_state field', () => {})
  }

  // 2.8 Test trigger
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/test?tenant=${TEST_TENANT}`, env,
      { condition: 'income < 30000', mock_state: '{"income": 25000}' })
    assertContains(body, 'TRIGGERED')
    run('2.8 POST /test returns triggered for matching condition', () => {})
  }

  // 2.9 Test no trigger
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/test?tenant=${TEST_TENANT}`, env,
      { condition: 'income < 30000', mock_state: '{"income": 50000}' })
    assertContains(body, 'Not triggered')
    run('2.9 POST /test returns not triggered for non-match', () => {})
  }

  // 2.10 Test invalid JSON
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/test?tenant=${TEST_TENANT}`, env,
      { condition: 'income < 30000', mock_state: 'not-json' })
    assertContains(body, 'Invalid JSON')
    run('2.10 POST /test with invalid JSON returns error', () => {})
  }

  // 2.11 Test empty condition
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/test?tenant=${TEST_TENANT}`, env,
      { condition: '', mock_state: '{}' })
    assertContains(body, 'Condition required')
    run('2.11 POST /test with empty condition returns error', () => {})
  }

  // 2.12 Toggle missing id
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/toggle?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'Missing id')
    run('2.12 POST /toggle with missing id returns error', () => {})
  }

  // 2.13 Test with nested conditions
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/test?tenant=${TEST_TENANT}`, env,
      { condition: 'income < 30000 AND employment == "full-time"', mock_state: '{"income": 25000, "employment": "full-time"}' })
    assertContains(body, 'TRIGGERED')
    run('2.13 POST /test with AND condition', () => {})
  }

  // 2.14 Test with OR condition
  {
    const env = createMockEnv()
    const body = await fetchPost(adminRulesRouter, `/admin/rules/test?tenant=${TEST_TENANT}`, env,
      { condition: 'income < 30000 OR lvr > 80', mock_state: '{"income": 50000, "lvr": 85}' })
    assertContains(body, 'TRIGGERED')
    run('2.14 POST /test with OR condition', () => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Site Admin Pages
// ═══════════════════════════════════════════════════════════════════════════

async function runSiteTests() {
  console.log('\n── Suite 3: Site Admin (/admin/site) ──')

  // 3.1 Main page loads
  {
    const env = createMockEnv()
    const body = await fetchText(adminSiteRouter, `/admin/site?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'AFIRMICO Admin')
    assertContains(body, 'Staging')
    assertContains(body, 'Production')
    assertContains(body, 'Tenant')
    assertContains(body, 'Actions')
    assertContains(body, 'Save Version')
    assertContains(body, 'Promote to Production')
    assertContains(body, 'Saved Versions')
    assertContains(body, 'Widget Embed')
    run('3.1 main Site page loads with status cards and actions', () => {})
  }

  // 3.2 Nav links
  {
    const env = createMockEnv()
    const body = await fetchText(adminSiteRouter, `/admin/site?tenant=${TEST_TENANT}`, env)
    assertContains(body, `href="/admin/kb?tenant=${TEST_TENANT}"`, 'KB nav')
    assertContains(body, `href="/admin/rules?tenant=${TEST_TENANT}"`, 'Rules nav')
    assertContains(body, `href="/admin/site?tenant=${TEST_TENANT}"`, 'Site nav')
    run('3.2 nav links include tenant param', () => {})
  }

  // 3.3 Empty statuses
  {
    const env = createMockEnv()
    const body = await fetchText(adminSiteRouter, `/admin/site?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No staging layout')
    assertContains(body, 'No production layout')
    run('3.3 shows empty statuses when no layouts exist', () => {})
  }

  // 3.4 Shows staging when set
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(`tenant:${TEST_TENANT}:layout:staging`, JSON.stringify({ type: 'Page', children: [] }))
    const body = await fetchText(adminSiteRouter, `/admin/site?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'Staging version')
    run('3.4 shows staging status when layout exists', () => {})
  }

  // 3.5 Promote button disabled when no staging
  {
    const env = createMockEnv()
    const body = await fetchText(adminSiteRouter, `/admin/site?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'disabled', 'Promote button disabled')
    run('3.5 promote button disabled when no staging', () => {})
  }

  // 3.6 POST /promote error when no staging
  {
    const env = createMockEnv()
    const body = await fetchPost(adminSiteRouter, `/admin/site/promote?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No staging layout to promote')
    run('3.6 POST /promote returns error with no staging', () => {})
  }

  // 3.7 POST /promote succeeds
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(`tenant:${TEST_TENANT}:layout:staging`, JSON.stringify({ type: 'Page', children: [{ type: 'Header', props: { title: 'Test' } }] }))
    const body = await fetchPost(adminSiteRouter, `/admin/site/promote?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'Promoted to production')
    const prodRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:layout:latest`)
    assert.ok(prodRaw, 'Production layout set')
    const prod = JSON.parse(prodRaw!)
    assert.strictEqual(prod.children[0].props.title, 'Test')
    run('3.7 POST /promote promotes staging to production', () => {})
  }

  // 3.8 POST /save-version error when no staging
  {
    const env = createMockEnv()
    const body = await fetchPost(adminSiteRouter, `/admin/site/save-version?tenant=${TEST_TENANT}`, env, { label: 'v1' })
    assertContains(body, 'No staging layout to save')
    run('3.8 POST /save-version with no staging returns error', () => {})
  }

  // 3.9 POST /save-version creates version
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(`tenant:${TEST_TENANT}:layout:staging`, JSON.stringify({ type: 'Page', children: [] }))
    const body = await fetchPost(adminSiteRouter, `/admin/site/save-version?tenant=${TEST_TENANT}`, env, { label: 'My Version' })
    assertContains(body, 'Saved as')
    const indexRaw = await env.TENANT_KV.get(`tenant:${TEST_TENANT}:staging:versions:index`)
    assert.ok(indexRaw, 'Version index created')
    const index = JSON.parse(indexRaw!)
    assert.strictEqual(index.length, 1)
    assert.strictEqual(index[0].label, 'My Version')
    run('3.9 POST /save-version creates version with label', () => {})
  }

  // 3.10 GET /versions shows versions
  {
    const env = createMockEnv()
    const body = await fetchText(adminSiteRouter, `/admin/site/versions?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'No saved versions')
    run('3.10 GET /versions returns empty state', () => {})
  }

  // 3.11 Widget embed
  {
    const env = createMockEnv()
    const body = await fetchText(adminSiteRouter, `/admin/site?tenant=${TEST_TENANT}`, env)
    assertContains(body, 'data-tenant="' + TEST_TENANT + '"')
    assertContains(body, 'widget.v1.0.0.js')
    assertContains(body, 'Preview Widget')
    assertContains(body, 'Open Site')
    run('3.11 widget embed section shows script tag with tenant', () => {})
  }

  // 3.12 Save version without label (auto-named)
  {
    const env = createMockEnv()
    await env.TENANT_KV.put(`tenant:${TEST_TENANT}:layout:staging`, JSON.stringify({ type: 'Page', children: [] }))
    const body = await fetchPost(adminSiteRouter, `/admin/site/save-version?tenant=${TEST_TENANT}`, env, { label: '' })
    assertContains(body, 'Saved as Version 1', 'Auto-named version')
    run('3.12 save version without label auto-names', () => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all suites
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('EdgeGDE — Admin Pages Comprehensive Test Suite')
  console.log('═══════════════════════════════════════════════')

  await runKbTests()
  await runRulesTests()
  await runSiteTests()

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
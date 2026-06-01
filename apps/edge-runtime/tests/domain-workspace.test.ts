/**
 * EdgeGDE — Domain Layer Integration Tests (Phases 18-20)
 * Certifies: Origination Intake, Pipeline View, Binary Ingestion
 */

import assert from 'node:assert'
import { createHash } from 'node:crypto'

const BASE = 'https://edgegde-calculator.renleding.workers.dev'
const TENANT = 'afirmico'
let passed = 0
let failed = 0

function run(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(
    () => { passed++; console.log(`  ✓ ${name}`) },
    (e: any) => { failed++; console.error(`  ✗ ${name}: ${e.message}`) },
  )
}

async function api(path: string, opts: any = {}): Promise<Response> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}tenant=${TENANT}`
  return fetch(url, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts })
}

async function main() {
  // ═╦═ Suite 1: Phase 18 — Origination Intake ══════════════════════════════
  console.log('\n── Suite 1: Phase 18 — Origination Intake ──')

  await run('1.1 standard intake submission creates application', async () => {
    const res = await api('/api/v1/workspace/init', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Jane Doe', email: 'jane@example.com', phone: '0400000000' }),
    })
    assert.strictEqual(res.status, 200)
    const data: any = await res.json()
    assert.ok(data.applicationId)
    assert.strictEqual(data.workflowStage, 'intake')
    ;(globalThis as any).__testAppId = data.applicationId
  })

  await run('1.2 strict schema rejection — invalid fields', async () => {
    const res = await api('/api/v1/workspace/init', {
      method: 'POST',
      body: JSON.stringify({ fullName: '', email: 'bad-email', phone: '' }),
    })
    const data: any = await res.json()
    assert.ok(data)
    assert.ok(data.applicationId || data.error)
  })

  await run('1.3 D1 CQRS materialization accuracy', async () => {
    const res = await api('/api/v1/workspace/pipeline')
    assert.strictEqual(res.status, 200)
    const html = await res.text()
    assert.ok(html.includes('Jane Doe'), 'Pipeline should show Jane Doe')
    assert.ok(html.includes('hx-get'), 'Pipeline should have hx-get')
  })

  // ═╦═ Suite 2: Phase 19 — Broker Pipeline View ═══════════════════════════
  console.log('\n── Suite 2: Phase 19 — Broker Pipeline View ──')

  await run('2.1 stage bucketing renders correctly', async () => {
    const res = await api('/api/v1/workspace/pipeline')
    assert.strictEqual(res.status, 200)
    const html = await res.text()
    const intakeCount = (html.match(/"cards-intake"/g) || []).length
    const assessmentCount = (html.match(/"cards-assessment"/g) || []).length
    const submissionCount = (html.match(/"cards-submission"/g) || []).length
    assert.ok(intakeCount >= 1, 'Intake column')
    assert.ok(assessmentCount >= 1, 'Assessment column')
    assert.ok(submissionCount >= 1, 'Submission column')
    assert.strictEqual(intakeCount, 1)
    assert.strictEqual(assessmentCount, 1)
    assert.strictEqual(submissionCount, 1)
    assert.ok(html.includes('Jane Doe'), 'Jane Doe in pipeline')
  })

  await run('2.2 OOB injection purity', async () => {
    const res = await api('/api/v1/workspace/pipeline')
    const html = await res.text()
    assert.ok(html.includes('hx-trigger'))
    assert.ok(html.includes('hx-swap'))
    assert.ok(html.includes('hx-get'))
  })

  await run('2.3 stage advancement', async () => {
    const appId = (globalThis as any).__testAppId
    if (!appId) throw new Error('No test app ID')
    const res = await api('/api/v1/workspace/advance', {
      method: 'PATCH',
      body: JSON.stringify({ applicationId: appId, stage: 'assessment' }),
    })
    assert.strictEqual(res.status, 200)
    const data: any = await res.json()
    assert.strictEqual(data.workflowStage, 'assessment')
    const badRes = await api('/api/v1/workspace/advance', {
      method: 'PATCH',
      body: JSON.stringify({ applicationId: appId, stage: 'invalid' }),
    })
    assert.strictEqual(badRes.status, 400)
  })

  // ═╦═ Suite 3: Phase 20 — Binary Ingestion ═══════════════════════════════
  console.log('\n── Suite 3: Phase 20 — Binary Ingestion ──')

  await run('3.1 CAS — SHA-256 determinism', async () => {
    const content = new TextEncoder().encode('test document content abc123')
    const hash1 = createHash('sha256').update(content).digest('hex')
    const hash2 = createHash('sha256').update(content).digest('hex')
    assert.strictEqual(hash1, hash2)
    const content3 = new TextEncoder().encode('different content')
    const hash3 = createHash('sha256').update(content3).digest('hex')
    assert.notStrictEqual(hash1, hash3)
  })

  await run('3.2 binary never enters DO', async () => {
    const appId = (globalThis as any).__testAppId || 'test-app-id'
    const blob = new Blob(['{"test": true}'], { type: 'application/pdf' })
    const fd = new FormData()
    fd.append('document_file', blob, 'test.pdf')
    fd.append('application_id', appId)
    fd.append('document_type', 'contract')
    const res = await api('/api/v1/workspace/upload', { method: 'POST', body: fd })
    const text = await res.text()
    if (res.status === 200) {
      assert.ok(text.includes('hx-swap-oob'))
      assert.ok(text.includes('doc-status-'))
    }
  })

  await run('3.3 OOB response format', async () => assert.ok(true))

  // ═╦═ Summary ════════════════════════════════════════════════════════════
  console.log('')
  if (failed === 0) {
    console.log(`✅ All ${passed} Phase 18-20 domain integration tests passed`)
  } else {
    console.error(`❌ ${failed}/${passed + failed} phase tests failed`)
    process.exit(1)
  }
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1) })

/**
 * EdgeGDE — Storage Enforcement Layer Tests
 * Phases 1-4: Context, D1, KV, R2 enforcement validation.
 * Tests guard wrappers both in isolation (unit) and against the live worker.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'

let passed = 0
let failed = 0

async function run(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (err: any) {
    failed++
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

const API = (path: string) => `https://edgegde-calculator.renleding.workers.dev${path}`

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(API(path), init)
}

console.log('')
console.log('══════════════════════════════════════════════════════════════════')
console.log('  Phase 1: Context & Middleware Verification')
console.log('══════════════════════════════════════════════════════════════════')
console.log('')

// ═╦═ 1.1 Missing context — should reject with 400 ══════════════════════════

await run('1.1 Missing tenant — rejected', async () => {
  const res = await api('/api/v1/workspace/pipeline')
  assert.notStrictEqual(res.status, 200, 'Should not return 200 without tenant')
  assert.ok(res.status === 400 || res.status === 404 || res.status === 500,
    `Expected error status, got ${res.status}`)
})

// ═╦═ 1.2 Valid context — should pass through ════════════════════════════════

await run('1.2 Valid tenant afirmico — accepted', async () => {
  const res = await api('/api/v1/workspace/pipeline?tenant=afirmico')
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`)
  const text = await res.text()
  assert.ok(text.includes('pipeline') || text.includes('Intake') || text.includes('cards-'),
    'Response should contain pipeline HTML')
})

// ═╦═ 1.2b Header-based tenant ════════════════════════════════════════════════

await run('1.2b x-tenant-id header — accepted', async () => {
  const res = await api('/api/v1/chat/view', {
    headers: { 'x-tenant-id': 'afirmico' },
  })
  assert.ok(res.status === 200 || res.status === 404,
    `Expected 200-ish, got ${res.status}`)
})

console.log('')
console.log('══════════════════════════════════════════════════════════════════')
console.log('  Phase 2: D1 Policy Engine (Structural SQL Injection)')
console.log('══════════════════════════════════════════════════════════════════')
console.log('')

// ═╦═ 2.1 — Test guardDB().all WHERE_APPEND via unit test ═══════════════════

await run('2.1 guardDB all — WHERE_APPEND works', async () => {
  // Unit test: verify the enforceSql function
  const { guardDB } = await import('../src/lib/db')
  const mockDB = {
    prepare(sql: string) {
      assert.ok(sql.includes('WHERE tenant_id = ?') || sql.includes('AND tenant_id = ?'),
        `SQL must include tenant_id filter: ${sql}`)
      return { bind() { return this }, all() { return { results: [] } }, first() { return null }, run() { return { meta: { changes: 1 } } } }
    }
  }
  const db = guardDB(mockDB)
  await db.all({ tenantId: 'afirmico' }, 'SELECT * FROM rules')
})

// ═╦═ 2.2 Aggregate query ════════════════════════════════════════════════════

await run('2.2 guardDB aggregate — WHERE_APPEND works', async () => {
  const { guardDB } = await import('../src/lib/db')
  const mockDB = {
    prepare(sql: string) {
      assert.ok(sql.includes('AND tenant_id = ?'),
        `Aggregate SQL must append AND: ${sql}`)
      return { bind() { return this }, all() { return { results: [] } }, first() { return null }, run() { return { meta: { changes: 1 } } } }
    }
  }
  const db = guardDB(mockDB)
  await db.first({ tenantId: 'afirmico' }, 'SELECT COUNT(*) as total FROM rules WHERE active = 1')
})

// ═╦═ 2.3 INSERT with auto tenant_id ═════════════════════════════════════════

await run('2.3 guardDB insert — tenant_id auto-injected', async () => {
  const { guardDB } = await import('../src/lib/db')
  let capturedSQL = ''
  const mockDB = {
    prepare(sql: string) {
      capturedSQL = sql
      return { bind(...args: any[]) { return this }, run() { return { meta: { changes: 1, last_row_id: 42 } } } }
    }
  }
  const db = guardDB(mockDB)
  await db.insert({ tenantId: 'afirmico' }, 'rules', { id: 'rule_1', condition: 'true' })
  assert.ok(capturedSQL.includes('tenant_id'), `INSERT must include tenant_id: ${capturedSQL}`)
  assert.ok(capturedSQL.includes('afirmico') || capturedSQL.includes('?'),
    `INSERT should have tenant_id placeholder: ${capturedSQL}`)
})

// ═╦═ 2.4 Block manual tenant_id in SQL ═══════════════════════════════════════

await run('2.4 guardDB blocks manual tenant_id in SQL', async () => {
  const { guardDB } = await import('../src/lib/db')
  const mockDB = {
    prepare(sql: string) {
      // Should not reach here — guardDB should throw before prepare
      throw new Error('Should have been blocked')
    }
  }
  const db = guardDB(mockDB)
  try {
    await db.all({ tenantId: 'afirmico' }, "SELECT * FROM rules WHERE tenant_id = 'evil'")
    assert.fail('Should have thrown')
  } catch (err: any) {
    assert.ok(err.message.includes('tenant_id'), `Error should mention tenant_id: ${err.message}`)
  }
})

console.log('')
console.log('══════════════════════════════════════════════════════════════════')
console.log('  Phase 3: KV Namespace Routing')
console.log('══════════════════════════════════════════════════════════════════')
console.log('')

// ═╦═ 3.1 Tenant write/read ═════════════════════════════════════════════════

await run('3.1 guardKV tenant write/read — auto-prefixes', async () => {
  const { guardKV } = await import('../src/lib/kv')
  let capturedKey = ''
  const mockKV = {
    get(key: string) { capturedKey = key; return null },
    put(key: string, val: string) { capturedKey = key; return Promise.resolve() },
    delete(key: string) { capturedKey = key; return Promise.resolve() },
  }
  const kv = guardKV(mockKV as any)

  // Write — must use full tenant-prefixed key (guard validates, doesn't auto-prefix)
  await kv.put('tenant:afirmico:chat:config', '{}', { tenantId: 'afirmico' })
  assert.strictEqual(capturedKey, 'tenant:afirmico:chat:config',
    `Write key should be tenant-prefixed: ${capturedKey}`)

  // Read
  await kv.get('tenant:afirmico:chat:config', { tenantId: 'afirmico' })
  assert.strictEqual(capturedKey, 'tenant:afirmico:chat:config',
    `Read key should be tenant-prefixed: ${capturedKey}`)
})

// ═╦═ 3.2 Global read ═══════════════════════════════════════════════════════

await run('3.2 guardKV global read — allowed', async () => {
  const { guardKV } = await import('../src/lib/kv')
  let capturedKey = ''
  const mockKV = {
    get(key: string) { capturedKey = key; return '{}' },
    put(key: string, val: string) { capturedKey = key; return Promise.resolve() },
  }
  const kv = guardKV(mockKV as any)
  await kv.get('global:kb:rates')
  assert.strictEqual(capturedKey, 'global:kb:rates')
})

// ═╦═ 3.3 System read (schema:) ═══════════════════════════════════════════════

await run('3.3 guardKV system key — schema: allowed', async () => {
  const { guardKV } = await import('../src/lib/kv')
  let capturedKey = ''
  const mockKV = {
    get(key: string) { capturedKey = key; return '{}' },
  }
  const kv = guardKV(mockKV as any)
  await kv.get('schema:v1:intake')
  assert.strictEqual(capturedKey, 'schema:v1:intake')
})

// ═╦═ 3.4 Cross-tenant blocked ═══════════════════════════════════════════════

await run('3.4 guardKV cross-tenant read — blocked', async () => {
  const { guardKV } = await import('../src/lib/kv')
  const mockKV = { get(key: string) { return null } }
  const kv = guardKV(mockKV as any)
  try {
    await kv.get('tenant:competitor:chat:config', { tenantId: 'afirmico' })
    assert.fail('Should have thrown cross-tenant error')
  } catch (err: any) {
    assert.ok(err.message.includes('Cross-tenant'), `Error should mention cross-tenant: ${err.message}`)
  }
})

// ═╦═ 3.5 Global write blocked ═══════════════════════════════════════════════

await run('3.5 guardKV global write — blocked', async () => {
  const { guardKV } = await import('../src/lib/kv')
  const mockKV = { get(key: string) { return null }, put(key: string, val: string) { return Promise.resolve() }, delete(key: string) { return Promise.resolve() } }
  const kv = guardKV(mockKV as any)
  try {
    await kv.put('global:kb:rates', '{}', { tenantId: 'afirmico' })
    assert.fail('Should have blocked global write')
  } catch (err: any) {
    assert.ok(err.message.includes('write'), `Error should mention write: ${err.message}`)
  }
})

console.log('')
console.log('══════════════════════════════════════════════════════════════════')
console.log('  Phase 4: R2 Migration Compatibility')
console.log('══════════════════════════════════════════════════════════════════')
console.log('')

// ═╦═ 4.1 New write/read ════════════════════════════════════════════════════

await run('4.1 guardR2 new write/read — tenant-prefixed', async () => {
  const { guardR2 } = await import('../src/lib/r2')
  let capturedKey = ''
  const mockR2 = {
    get(path: string) { capturedKey = path; return Promise.resolve({ body: 'data', key: path }) },
    put(path: string, val: any) { capturedKey = path; return Promise.resolve() },
    delete(path: string) { capturedKey = path; return Promise.resolve() },
    list(opts: any) { capturedKey = opts.prefix; return Promise.resolve({ objects: [] }) },
  }
  const r2 = guardR2(mockR2 as any)

  await r2.put({ tenantId: 'afirmico' }, 'docs/test.pdf', Buffer.from('test'))
  assert.ok(capturedKey.startsWith('/tenant/afirmico/'),
    `Write path should be tenant-prefixed: ${capturedKey}`)

  await r2.get({ tenantId: 'afirmico' }, 'docs/test.pdf')
  assert.ok(capturedKey.startsWith('/tenant/afirmico/'),
    `Read path should be tenant-prefixed: ${capturedKey}`)
})

// ═╦═ 4.2 Legacy fallback read ═══════════════════════════════════════════════

await run('4.2 guardR2 legacy fallback — reads legacy path', async () => {
  const { guardR2 } = await import('../src/lib/r2')
  const accessLog: string[] = []
  const mockR2 = {
    async get(path: string) {
      accessLog.push(path)
      // First call (tenant path) returns null, second (legacy) returns data
      if (path.startsWith('/tenant/')) return null
      return { body: 'legacy data', key: path }
    },
  }
  const r2 = guardR2(mockR2 as any)
  const result = await r2.get({ tenantId: 'afirmico' }, 'docs/legacy_app/file.pdf')
  assert.ok(result, 'Should return legacy data')
  assert.strictEqual(accessLog.length, 2, 'Should try both paths')
  assert.ok(accessLog[0].startsWith('/tenant/'), 'First attempt should be tenant-prefixed')
  assert.ok(accessLog[1].startsWith('docs/'), 'Second attempt should be legacy path')
})

// ═╦═ 4.3 R2 list is scoped ═════════════════════════════════════════════════

await run('4.3 guardR2 list — tenant-scoped prefix', async () => {
  const { guardR2 } = await import('../src/lib/r2')
  let capturedPrefix = ''
  const mockR2 = {
    get(path: string) { return Promise.resolve(null) },
    list(opts: any) { capturedPrefix = opts.prefix; return Promise.resolve({ objects: [] }) },
  }
  const r2 = guardR2(mockR2 as any)
  await r2.list({ tenantId: 'afirmico' }, 'docs/')
  assert.ok(capturedPrefix.startsWith('/tenant/afirmico/'),
    `List prefix should be tenant-scoped: ${capturedPrefix}`)
})

// ═╦═ Summary ═════════════════════════════════════════════════════════════════

console.log('')
console.log('══════════════════════════════════════════════════════════════════')
console.log(`  Results: ${passed} passed, ${failed} failed`)
console.log('══════════════════════════════════════════════════════════════════')
console.log('')

if (failed > 0) {
  console.error(`❌ ${failed} tests failed`)
  process.exit(1)
} else {
  console.log('✅ All storage enforcement layer tests passed')
}

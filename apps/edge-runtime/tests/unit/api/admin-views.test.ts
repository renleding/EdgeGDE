/**
 * EdgeGDE — Admin KB Views Test
 *
 * Tests the admin knowledge base controller in src/api/admin-views.ts.
 * Uses Hono test client with mocked KV bindings.
 *
 * Coverage targets: render functions, route handlers, error handling branches
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminRouter } from '../../../src/api/admin-views'

// ═══════════════════════════════════════════════════════════════════════════
// Mock KV store with Cloudflare Workers-like API
// ═══════════════════════════════════════════════════════════════════════════

function knowledgeEntry(id: string, value: string, overrides: Record<string, any> = {}) {
  return {
    id,
    value,
    type: 'knowledge',
    description: overrides.description || `Entry ${id}`,
    source_ref: overrides.source_ref || 'test',
    updated_at: overrides.updated_at || Date.now(),
    ...overrides,
  }
}

function createMockKv() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string, _ctx?: any) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    _store: store,
  }
}

function makeCtx(kv: ReturnType<typeof createMockKv>, query: Record<string, string> = {}) {
  const url = new URL('http://localhost/admin/kb')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return {
    req: {
      query: (key: string) => query[key] ?? null,
      json: async () => { throw new Error('not implemented') },
      formData: async () => { throw new Error('not implemented') },
    },
    env: { TENANT_KV: kv },
    html: vi.fn((body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })),
    json: vi.fn((body: any, status?: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
    executionCtx: { waitUntil: vi.fn() },
  } as any
}

// ═══════════════════════════════════════════════════════════════════════════
// Render Function Tests — pure string output
// ═══════════════════════════════════════════════════════════════════════════

describe('Page Layout (via route output)', () => {
  it('renders the KB page with correct HTML structure', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv, { tenant: 'test-tenant' })
    const res = await adminRouter.fetch(new Request('http://localhost/?tenant=test-tenant'), ctx.env)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('AFIRMICO Admin')
    expect(text).toContain('Knowledge Base')
    expect(text).toContain('Ingest URL')
    expect(text).toContain('Upload File')
    expect(text).toContain('htmx.org')
  })

  it('renders navigation with all 4 tabs', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/'), ctx.env)
    const text = await res.text()
    expect(text).toContain('/admin/kb')
    expect(text).toContain('/admin/config')
    expect(text).toContain('/admin/rules')
    expect(text).toContain('/admin/site')
  })

  it('includes token in query params when provided', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv, { token: 'abc123' })
    const res = await adminRouter.fetch(new Request('http://localhost/?token=abc123'), ctx.env)
    const text = await res.text()
    expect(text).toContain('token=abc123')
  })
})

describe('GET /admin/kb (root)', () => {
  it('returns pending tab content when KV has pending entries', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb_pending:rates',
      JSON.stringify({
        entries: [knowledgeEntry('e1', 'Rate 5.5%', { source_ref: 'https://example.com/rates' })],
        source_ref: 'https://example.com/rates',
      }),
    )
    const ctx = makeCtx(kv)

    // Mock kv.get to use our store
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)

    const res = await adminRouter.fetch(new Request('http://localhost/'), ctx.env)
    const text = await res.text()
    expect(text).toContain('Rate 5.5%')
    expect(text).toContain('rates')
    expect(text).toContain('Pending')
  })

  it('shows empty state when no pending entries', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/'), ctx.env)
    const text = await res.text()
    expect(text).toContain('No pending entries')
  })

  it('uses default tenant when none provided', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/'), ctx.env)
    expect(res.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Tab Endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /admin/kb/pending', () => {
  it('returns pending entries HTML', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb_pending:products',
      JSON.stringify({
        entries: [
          knowledgeEntry('p1', 'Home Loan Basic'),
          knowledgeEntry('p2', 'Home Loan Premium', { trigger: 'income > 100k' }),
        ],
        source_ref: 'manual',
      }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/pending'), ctx.env)
    const text = await res.text()
    expect(text).toContain('Home Loan Basic')
    expect(text).toContain('Home Loan Premium')
    expect(text).toContain('trigger')
  })

  it('returns empty message when no pending', async () => {
    const kv = createMockKv()
    kv.get.mockImplementation(async () => null)
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/pending'), ctx.env)
    const text = await res.text()
    expect(text).toContain('No pending entries')
  })
})

describe('GET /admin/kb/list', () => {
  it('returns approved entries HTML', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb:compliance',
      JSON.stringify({
        entries: [
          knowledgeEntry('c1', 'Compliance text v1'),
        ],
        source_ref: 'ingested',
      }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/list'), ctx.env)
    const text = await res.text()
    expect(text).toContain('Compliance text v1')
    expect(text).toContain('compliance')
  })

  it('returns empty message when no approved entries', async () => {
    const kv = createMockKv()
    kv.get.mockImplementation(async () => null)
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/list'), ctx.env)
    const text = await res.text()
    expect(text).toContain('No approved entries')
  })
})

describe('GET /admin/kb/rejected', () => {
  it('returns rejected entries HTML', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb_rejected:fees',
      JSON.stringify({
        entries: [knowledgeEntry('f1', 'Rejected fee schedule')],
        source_ref: 'upload',
      }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/rejected'), ctx.env)
    const text = await res.text()
    expect(text).toContain('Rejected fee schedule')
    expect(text).toContain('(rejected)')
  })

  it('returns empty when no rejected entries', async () => {
    const kv = createMockKv()
    kv.get.mockImplementation(async () => null)
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/rejected'), ctx.env)
    const text = await res.text()
    expect(text).toContain('No rejected entries')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Approve / Reject Endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/kb/approve', () => {
  it('requires topic parameter', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/approve', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('Missing topic')
  })

  it('reports when KV binding is missing', async () => {
    const ctx = makeCtx(createMockKv())
    ctx.env = {} // No TENANT_KV
    const res = await adminRouter.fetch(new Request('http://localhost/approve?topic=rates', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('KV binding not available')
  })

  it('approves pending entries and rebuilds config', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb_pending:rates',
      JSON.stringify({
        entries: [
          knowledgeEntry('r1', 'Rate 5.5%'),
          knowledgeEntry('r2', 'Rate 6.0%'),
        ],
        source_ref: 'https://example.com',
      }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    kv.put.mockImplementation(async (key: string, value: string) => { kv._store.set(key, value) })
    kv.delete.mockImplementation(async (key: string) => { kv._store.delete(key) })

    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/approve?topic=rates', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('Approved')
    expect(text).toContain('2 entries')

    // Verify pending was cleared
    const pendingStillThere = kv._store.has('tenant:au-mortgage-broker-afirmico:kb_pending:rates')
    expect(pendingStillThere).toBe(false)
  })
})

describe('POST /admin/kb/reject', () => {
  it('requires topic parameter', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/reject', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('Missing topic')
  })

  it('rejects pending entries and moves to rejected state', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb_pending:fees',
      JSON.stringify({
        entries: [knowledgeEntry('f1', 'Bad fee data')],
        source_ref: 'test',
      }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    kv.put.mockImplementation(async (key: string, value: string) => { kv._store.set(key, value) })
    kv.delete.mockImplementation(async (key: string) => { kv._store.delete(key) })

    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/reject?topic=fees', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('Rejected')

    // Verify moved to rejected
    expect(kv._store.has('tenant:au-mortgage-broker-afirmico:kb_rejected:fees')).toBe(true)
    expect(kv._store.has('tenant:au-mortgage-broker-afirmico:kb_pending:fees')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Delete Endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/kb/delete-entry', () => {
  it('requires topic and entryId', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/delete-entry', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('Missing topic or entryId')
  })

  it('deletes specific entry from pending state', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb_pending:rates',
      JSON.stringify({
        entries: [
          knowledgeEntry('r1', 'Keep me'),
          knowledgeEntry('r2', 'Delete me'),
        ],
      }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    kv.put.mockImplementation(async (key: string, value: string) => { kv._store.set(key, value) })

    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(
      new Request('http://localhost/delete-entry?topic=rates&entryId=r2&state=pending', { method: 'POST' }),
      ctx.env,
    )
    expect(res.status).toBe(200)

    const remaining = JSON.parse(kv._store.get('tenant:au-mortgage-broker-afirmico:kb_pending:rates')!)
    expect(remaining.entries).toHaveLength(1)
    expect(remaining.entries[0].id).toBe('r1')
  })
})

describe('POST /admin/kb/delete-topic', () => {
  it('deletes entire topic from approved state', async () => {
    const kv = createMockKv()
    kv._store.set(
      'tenant:au-mortgage-broker-afirmico:kb:rates',
      JSON.stringify({ entries: [knowledgeEntry('r1', 'Rate 5%')] }),
    )
    kv.get.mockImplementation(async (key: string) => kv._store.get(key) ?? null)
    kv.delete.mockImplementation(async (key: string) => { kv._store.delete(key) })

    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(
      new Request('http://localhost/delete-topic?topic=rates&state=approved', { method: 'POST' }),
      ctx.env,
    )
    const text = await res.text()
    expect(text).toContain('Deleted')
    expect(kv._store.has('tenant:au-mortgage-broker-afirmico:kb:rates')).toBe(false)
  })

  it('returns error when topic is missing', async () => {
    const kv = createMockKv()
    const ctx = makeCtx(kv)
    const res = await adminRouter.fetch(new Request('http://localhost/delete-topic', { method: 'POST' }), ctx.env)
    const text = await res.text()
    expect(text).toContain('Missing topic')
  })
})

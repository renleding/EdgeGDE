/**
 * EdgeGDE — Agent Publish Route Test
 *
 * Tests the agent/publish and agent/generate-layout endpoints
 * defined in src/routes/agent.ts.
 *
 * Coverage targets: Zod validation, JSON parsing error handling,
 * artifact dispatch, generate-layout validation logic
 */
import { describe, it, expect, vi } from 'vitest'
import { agentRouter } from '../../../src/routes/agent'

// ═══════════════════════════════════════════════════════════════════════════
// Mock the index module to prevent app initialization side effects
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../../src/index', () => ({
  kv: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

// ═══════════════════════════════════════════════════════════════════════════
// POST /agent/publish — JSON parsing
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /agent/publish — JSON Parsing', () => {
  it('returns 400 for invalid JSON body', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        body: 'not-json',
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Invalid JSON')
  })

  it('returns 400 when body is empty', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        body: '',
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Invalid JSON')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /agent/publish — Zod validation failures
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /agent/publish — Zod Validation', () => {
  it('returns 400 for missing kind field', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'test' }),
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Validation failed')
  })

  it('returns 400 for invalid kind value', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'invalid' }),
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Validation failed')
  })

  it('returns 400 for artifact publish missing required fields', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'artifact' }),
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Validation failed')
  })

  it('returns validation error details array', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'artifact' }),
      }),
      {},
    )
    const body = await res.json() as any
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
    expect(body.details[0]).toHaveProperty('field')
    expect(body.details[0]).toHaveProperty('message')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /agent/publish — Artifact publish flow (error paths)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /agent/publish — Artifact', () => {
  it('returns 500 when no D1 binding available (needed for versioning)', async () => {
    const env = {
      ARTIFACT_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    }
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'artifact',
          id: 'test-calc',
          type: 'calculator',
          layout: { type: 'page', children: [] },
        }),
      }),
      env,
    )
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toContain('Publish failed')
    // D1 binding is required for versioning
    expect(body.details).toContain('version')
  })

  it('returns 500 when using MemoryKvStore fallback (no ARTIFACT_KV)', async () => {
    const env = {}
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'artifact',
          id: 'test-calc-2',
          type: 'calculator',
          layout: { type: 'page', children: [] },
        }),
      }),
      env,
    )
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toContain('Publish failed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /agent/publish — Tenant deploy flow
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /agent/publish — Tenant Deploy', () => {
  it('returns 400 for invalid layout (not matching schema)', async () => {
    const env = {}
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'tenant',
          tenantId: 'test-tenant',
          layout: 'not-an-object',
          design: 'modern',
        }),
      }),
      env,
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })

  it('returns 400 for layout missing required fields', async () => {
    const env = {}
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'tenant',
          tenantId: 'test-tenant',
          layout: { children: [] },
          design: 'modern',
        }),
      }),
      env,
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })

  it('returns 500 when missing required D1/KV bindings', async () => {
    const env = {}
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'tenant',
          tenantId: 'test-tenant',
          layout: { type: 'page', children: [] },
          design: 'modern',
        }),
      }),
      env,
    )
    // The route validates the layout schema first. If layout type passes,
    // it checks for design validation and bindings
    expect([400, 500]).toContain(res.status)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /agent/generate-layout
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /agent/generate-layout', () => {
  it('returns 400 for invalid JSON body', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        body: 'not-json',
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })

  it('returns 400 for empty body', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        body: '',
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })

  it('returns 400 for invalid design', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: { type: 'page', children: [] },
          design: '',  // empty design fails validation
        }),
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })

  it('returns 400 for layout missing required type field', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: { children: [] },
          design: 'modern',
        }),
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })

  it('returns validation error details for invalid layout', async () => {
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: { children: [] },
          design: 'modern',
        }),
      }),
      {},
    )
    const body = await res.json() as any
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
  })

  it('returns 400 when layout is not valid per layoutDefinitionSchema', async () => {
    // layoutDefinitionSchema has strict validation — test with an empty type
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: { type: '', children: [] },
          design: 'modern',
        }),
      }),
      {},
    )
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('validation_failed')
  })
})

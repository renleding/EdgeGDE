import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { tenantResolver, getTenantCtx } from '../../../src/middleware/tenant-context'

type Vars = {
  tenantId?: string
  tenant?: { tenantId: string }
}

function makeApp() {
  const app = new Hono<{ Variables: Vars }>()
  app.use('*', tenantResolver as any)
  app.get('/test', (c) => c.json({ tenantId: c.get('tenantId') }))
  return app
}

describe('tenantResolver middleware', () => {
  it('uses x-tenant-id header', async () => {
    const app = makeApp()
    const res = await app.request('/test', { headers: { 'x-tenant-id': 'acme-co' } })
    const body = (await res.json()) as { tenantId: string }
    expect(body.tenantId).toBe('acme-co')
  })

  it('falls back to tenant query param', async () => {
    const app = makeApp()
    const res = await app.request('/test?tenant=beta-labs')
    const body = (await res.json()) as { tenantId: string }
    expect(body.tenantId).toBe('beta-labs')
  })

  it('uses the default tenant when neither header nor query present', async () => {
    const app = makeApp()
    const res = await app.request('/test')
    const body = (await res.json()) as { tenantId: string }
    expect(body.tenantId).toBe('au-mortgage-broker-afirmico')
  })

  it('rejects tenant ids with invalid characters', async () => {
    const app = makeApp()
    const res = await app.request('/test', { headers: { 'x-tenant-id': 'bad tenant!' } })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid tenant identifier')
  })

  it('rejects tenant ids longer than 64 chars', async () => {
    const app = makeApp()
    const res = await app.request('/test', { headers: { 'x-tenant-id': 'a'.repeat(65) } })
    expect(res.status).toBe(400)
  })

  it('uses existing tenant context when pre-resolved', async () => {
    const app = new Hono<{ Variables: Vars }>()
    app.use('*', async (c, next) => {
      c.set('tenant', { tenantId: 'pre-resolved' })
      await next()
    })
    app.use('*', tenantResolver as any)
    app.get('/test', (c) => c.json({ tenantId: c.get('tenantId') }))
    const res = await app.request('/test', { headers: { 'x-tenant-id': 'ignored' } })
    const body = (await res.json()) as { tenantId: string }
    expect(body.tenantId).toBe('pre-resolved')
  })
})

describe('getTenantCtx helper', () => {
  it('extracts tenantId and sessionId', async () => {
    const app = new Hono()
    app.get('/x', (c) => {
      const ctx = getTenantCtx(c)
      return c.json(ctx)
    })
    const res = await app.request('/x?tenant=my-tenant&session_id=sess-9')
    const body = (await res.json()) as { tenantId: string; sessionId: string }
    expect(body.tenantId).toBe('my-tenant')
    expect(body.sessionId).toBe('sess-9')
  })

  it('defaults tenantId when absent', async () => {
    const app = new Hono()
    app.get('/x', (c) => c.json(getTenantCtx(c)))
    const res = await app.request('/x')
    const body = (await res.json()) as { tenantId: string }
    expect(body.tenantId).toBe('au-mortgage-broker-afirmico')
  })
})

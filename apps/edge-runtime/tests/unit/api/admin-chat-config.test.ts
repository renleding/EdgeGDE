import { describe, it, expect } from 'vitest'
import { adminChatConfigTenantRouter } from '../../../src/api/admin-chat-config'

/**
 * Route-reachability tests for the tenant chat-config edit surface.
 * Guards against regression of the /admin/tenants/:tenantId/config mount
 * (EG-FEAT-0002 follow-up).
 */
function makeEnv() {
  const store = new Map<string, string>()
  const kv = {
    async get(key: string) { return store.get(key) || null },
    async put(key: string, value: string | object) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)) },
    async del(key: string) { store.delete(key) },
  }
  return {
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) },
    TENANT_KV: kv,
    // AUDIT_LEDGER Durable Object stub — accepts any /append and returns ok
    AUDIT_LEDGER: {
      idFromName: () => 'audit-id',
      get: () => ({ fetch: async () => new Response('ok', { status: 200 }) }),
    },
    store,
  }
}

describe('adminChatConfigTenantRouter route reachability', () => {
  it('GET /:tenantId/config returns the tenant config edit page (200)', async () => {
    const env = makeEnv()
    const req = new Request('http://localhost/tenant-a/config')
    const res = await adminChatConfigTenantRouter.fetch(req, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Chat Config')
    expect(html).toContain('tenant-a')
  })

  it('POST /:tenantId/config persists a valid config and returns the saved page with hash', async () => {
    const env = makeEnv()
    const form = new FormData()
    form.set('objective', 'Collect mortgage readiness')
    form.set('priorityOrder', 'fullName\nincome')
    form.set('fields', JSON.stringify([
      { fieldName: 'fullName', label: 'Full Name', fieldType: 'text', validation: { required: true } },
      { fieldName: 'income', label: 'Income', fieldType: 'number', validation: { required: true, min: 0 } },
    ]))
    form.set('rules', '[]')
    form.set('topics', 'rates\ncompliance')
    form.set('systemInstructions', 'Be concise.')
    form.set('title', 'Tenant Chat')
    form.set('greeting', 'Hello')
    form.set('colorAccent', '#58a6ff')

    const req = new Request('http://localhost/tenant-a/config', { method: 'POST', body: form })
    const res = await adminChatConfigTenantRouter.fetch(req, makeEnv())
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Saved tenant chat config. Hash:')
  })

  it('POST invalid config returns 400 with validation errors', async () => {
    const form = new FormData()
    form.set('objective', '')
    form.set('priorityOrder', '')
    form.set('fields', 'not-json')
    form.set('rules', '[]')
    const req = new Request('http://localhost/tenant-a/config', { method: 'POST', body: form })
    const res = await adminChatConfigTenantRouter.fetch(req, makeEnv())
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('Validation failed')
  })
})
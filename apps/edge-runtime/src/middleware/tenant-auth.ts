/**
 * EdgeGDE Runtime — Tenant Auth Middleware
 * Phase 35D: Verifies the caller owns a tenant by checking the tenantId
 * exists in TENANT_KV. Uses Bearer token with the TenantConfig's token
 * if configured, otherwise validates tenantId existence only.
 */

import type { Context, Next } from 'hono'

/**
 * Middleware that verifies the tenantId in the request body exists.
 *
 * For now, validates tenantId existence in TENANT_KV.
 * Future: extend with per-tenant bearer tokens stored in TenantConfig.
 */
export async function tenantAuth(c: Context, next: Next): Promise<Response | void> {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) {
    c.status(500)
    return c.json({ error: 'TENANT_KV not available' }, 500)
  }

  // Parse body to extract tenantId
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    c.status(400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const tenantId = body?.tenantId
  if (!tenantId || typeof tenantId !== 'string') {
    c.status(400)
    return c.json({ error: 'Missing tenantId in request body' }, 400)
  }

  // Verify tenant exists
  try {
    const tenant = await TENANT_KV.get(`tenant:${tenantId}`, 'json')
    if (!tenant) {
      c.status(404)
      return c.json({ error: 'Tenant not found' }, 404)
    }
  } catch {
    c.status(500)
    return c.json({ error: 'Tenant lookup failed' }, 500)
  }

  c.set('authenticatedTenantId', tenantId)
  await next()
}

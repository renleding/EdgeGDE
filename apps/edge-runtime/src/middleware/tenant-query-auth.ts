/**
 * EdgeGDE Runtime — Query-based Tenant Auth Middleware
 * Validates tenant exists via ?tenant= query parameter (for chat/workspace routes).
 */
import type { Context, Next } from 'hono'

export async function tenantQueryAuth(c: Context, next: Next): Promise<Response | void> {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) {
    c.status(500)
    return c.json({ error: 'TENANT_KV not available' }, 500)
  }

  const tenantId = c.req.query('tenant')
  if (!tenantId || typeof tenantId !== 'string') {
    c.status(400)
    return c.json({ error: 'Missing tenant in query parameter' }, 400)
  }

  // Verify tenant config exists
  try {
    const config = await TENANT_KV.get('tenant:' + tenantId + ':chat:config', 'json')
    if (!config) {
      c.status(404)
      return c.json({ error: 'Tenant not found' }, 404)
    }
  } catch {
    c.status(500)
    return c.json({ error: 'Tenant lookup failed' }, 500)
  }

  await next()
}

import type { Context, Next, MiddlewareHandler } from 'hono'

export interface TenantCtx {
  tenantId: string
  sessionId?: string
}

/**
 * Tenant resolver middleware for Hono.
 * Priority: x-tenant-id header → query param tenant → default
 */
export const tenantResolver: MiddlewareHandler = async (c: Context, next: Next) => {
  // Check if already resolved by existing tenant middleware
  const existingTenant = c.get('tenant')
  if (existingTenant?.tenantId) {
    c.set('tenantId', existingTenant.tenantId)
    await next()
    return
  }

  const tenantId =
    c.req.header('x-tenant-id') ||
    c.req.query('tenant') ||
    'au-mortgage-broker-afirmico'

  if (!tenantId) {
    return c.json({ error: 'x-tenant-id header or tenant query param required' }, 400)
  }

  // Validate — reject empty or suspicious
  if (tenantId.length < 1 || tenantId.length > 64 || /[^a-z0-9_-]/i.test(tenantId)) {
    return c.json({ error: 'Invalid tenant identifier' }, 400)
  }

  c.set('tenantId', tenantId)
  await next()
}

/**
 * Extract tenant context from a Hono request context.
 */
export function getTenantCtx(c: Context): TenantCtx {
  return {
    tenantId: c.get('tenantId') as string || c.req.query('tenant') || 'au-mortgage-broker-afirmico',
    sessionId: c.req.query('session_id') || undefined,
  }
}

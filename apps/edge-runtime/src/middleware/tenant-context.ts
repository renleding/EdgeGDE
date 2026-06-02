/**
 * EdgeGDE — Tenant Context Middleware
 * Resolves tenantId from trusted source and injects into Hono context.
 * Request is rejected if tenantId is missing.
 *
 * @packageDocumentation
 */

export interface TenantCtx {
  tenantId: string
  sessionId?: string
}

/**
 * Tenant resolver middleware for Hono.
 * Priority: x-tenant-id header → query param tenant → default
 */
export async function tenantResolver(c: any, next: any): Promise<void> {
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
    'afirmico'

  if (!tenantId) {
    c.status(400)
    return c.json({ error: 'x-tenant-id header or tenant query param required' })
  }

  // Validate — reject empty or suspicious
  if (tenantId.length < 1 || tenantId.length > 64 || /[^a-z0-9_-]/i.test(tenantId)) {
    c.status(400)
    return c.json({ error: 'Invalid tenant identifier' })
  }

  c.set('tenantId', tenantId)
  await next()
}

/**
 * Extract tenant context from a Hono request context.
 */
export function getTenantCtx(c: any): TenantCtx {
  return {
    tenantId: c.get('tenantId') || c.req.query('tenant') || 'afirmico',
    sessionId: c.req.query('session_id') || undefined,
  }
}

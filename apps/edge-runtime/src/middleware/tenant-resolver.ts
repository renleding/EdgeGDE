/**
 * EdgeGDE Runtime — Tenant Resolver Middleware
 * Phase 34 v7.0: Resilient, cached, migration-aware tenant resolution.
 *
 * RESOLUTION ORDER (strict):
 *   1. In-memory cache lookup
 *   2. TENANT_KV lookup
 *   3. Legacy ARTIFACT_KV migration
 *   4. Stale cache fallback (KV partition resilience)
 *   5. 404
 *
 * This middleware MUST be the first `.use()` call in index.ts.
 */

import type { Context, Next } from 'hono'
import type { TenantConfig } from '../lib/tenant'
import devSeed from '../lib/dev_seed.json'
import { getCachedTenant, setCachedTenant } from '../lib/cache'

// ═══════════════════════════════════════════════════════════════════════════
// Dev Detection
// ═══════════════════════════════════════════════════════════════════════════

function isDevEnvironment(c: Context): boolean {
  const env = c.env as Record<string, unknown> | undefined
  const host = c.req.header('host') || ''
  // Dev mode only when host is localhost OR NODE_ENV is explicitly 'development'
  // Never on workers.dev — the dev seed would mask production tenants
  return !host.includes('workers.dev') && (env?.NODE_ENV === 'development' || host.startsWith('localhost'))
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Lookup
// ═══════════════════════════════════════════════════════════════════════════

async function attemptLegacyLookup(
  c: Context,
  slug: string,
): Promise<TenantConfig | null> {
  const possibleHost = `${slug}.workers.dev`
  const TENANT_KV = c.env?.TENANT_KV as any
  const ARTIFACT_KV = c.env?.ARTIFACT_KV as any

  if (!TENANT_KV || !ARTIFACT_KV) return null

  const legacyTenant = await TENANT_KV.get(`tenant:${possibleHost}`, 'json')
  if (!legacyTenant) return null

  const tenantId: string = legacyTenant.tenantId || legacyTenant.id
  if (!tenantId) return null

  const oldLayout = await ARTIFACT_KV.get(
    `layout:${tenantId}:production:latest`,
    'json'
  )

  if (oldLayout) {
    await TENANT_KV.put(
      `tenant:${tenantId}:layout:latest`,
      JSON.stringify(oldLayout)
    )
  }

  return {
    tenantId,
    slug,
    name: legacyTenant.name || legacyTenant.displayName || slug,
    createdAt: legacyTenant.createdAt || new Date().toISOString(),
    plan: legacyTenant.plan || 'free',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════════════════

export async function tenantResolver(
  c: Context,
  next: Next,
): Promise<Response | void> {
  // ── Skip tenant resolution for admin and agent endpoints ────────────────
  const path = c.req.path
  if (path.startsWith('/api/v1/agent/') || path.startsWith('/api/v1/admin/') || path.startsWith('/api/tenants/') || path === '/healthz' || path === '/favicon.ico' || path.startsWith('/api/dashboard/')) {
    return next()
  }

  // ── DEV MODE: seed localhost tenant immediately ─────────────────────────
  if (isDevEnvironment(c)) {
    const devTenant: TenantConfig = devSeed as TenantConfig
    Object.freeze(devTenant)
    c.set('tenant', devTenant)
    return next()
  }

  // ── PRODUCTION: resolve tenant ──────────────────────────────────────────
  const host = c.req.header('host') || ''
  const queryTenant = c.req.query('tenant')

  let slug: string | null = null

  // 1. Hostname primary
  const parts = host.split('.')
  if (parts.length > 2) slug = parts[0]

  // 2. Query param fallback (deprecation path)
  if (!slug && queryTenant) {
    slug = queryTenant
    try {
      const TELEMETRY_KV = c.env?.TELEMETRY_KV as any
      if (TELEMETRY_KV && typeof TELEMETRY_KV.put === 'function') {
        await TELEMETRY_KV.put(`deprecated:tenant_query:${Date.now()}`, slug)
      }
    } catch { /* non-blocking */ }
  }

  if (!slug) {
    c.status(404)
    return c.text('Tenant not found', 404)
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RESILIENT RESOLUTION FLOW
  // ═════════════════════════════════════════════════════════════════════════

  let tenant: TenantConfig | null | undefined

  // Step 1: In-memory cache
  tenant = getCachedTenant(slug)
  if (tenant) {
    Object.freeze(tenant)
    c.set('tenant', tenant)
    return next()
  }

  // Step 2: TENANT_KV lookup
  const TENANT_KV = c.env?.TENANT_KV as any
  if (TENANT_KV && typeof TENANT_KV.get === 'function') {
    try {
      const raw = await TENANT_KV.get(`tenant:${slug}`, 'json')
      if (raw) {
        tenant = raw as TenantConfig
        setCachedTenant(slug, tenant)
      } else if (queryTenant && queryTenant !== slug) {
        // Override: hostname slug failed, try query param
        const altRaw = await TENANT_KV.get(`tenant:${queryTenant}`, 'json')
        if (altRaw) {
          slug = queryTenant
          tenant = altRaw as TenantConfig
          setCachedTenant(slug, tenant)
          try {
            const TELEMETRY_KV = c.env?.TELEMETRY_KV as any
            if (TELEMETRY_KV && typeof TELEMETRY_KV.put === 'function') {
              await TELEMETRY_KV.put(`deprecated:tenant_query:${Date.now()}`, slug)
            }
          } catch { /* non-blocking */ }
        }
      }
    } catch {
      // KV failure — fall through to legacy, then stale cache
    }
  }

  // Step 3: Legacy migration (ARTIFACT_KV)
  if (!tenant) {
    try {
      tenant = await attemptLegacyLookup(c, slug)
      if (tenant) setCachedTenant(slug, tenant)
    } catch {
      // Legacy lookup failure — fall through to stale cache
    }
  }

  // Step 4: Stale cache fallback — KV failed but we have stale data
  if (!tenant) {
    const stale = getCachedTenant(slug)
    if (stale) {
      tenant = stale
    }
  }

  // Step 5: Nothing resolved — 404
  if (!tenant) {
    c.status(404)
    return c.text('Tenant not found', 404)
  }

  Object.freeze(tenant)
  c.set('tenant', tenant)
  await next()
}

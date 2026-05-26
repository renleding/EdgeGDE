/**
 * EdgeGDE Runtime — Hostname-based Tenant Resolution Middleware
 * HSAES Phase 20: Multi-tenant platform hardening.
 *
 * Resolves tenant configuration from the request hostname.
 * Production: reads from c.env.TENANT_KV (Workers KV).
 * Local dev: falls back to the shared MemoryKvStore.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono'
import { kv } from '../index'
import type { KvStore } from '../lib/publish'

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Config Type
// ═══════════════════════════════════════════════════════════════════════════

export interface TenantConfig {
  hostname: string
  enabledCalculators: string[]
  enabledPages: string[]
  enabledThemes: string[]
  [key: string]: unknown
}

// ═══════════════════════════════════════════════════════════════════════════
// Default tenant for local dev — enables everything
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TENANT: TenantConfig = {
  hostname: 'localhost',
  enabledCalculators: ['mortgage', 'deposit', 'affordability', 'stamp-duty', 'repayment', 'comparison'],
  enabledPages: ['landing', 'mortgage-detail', 'comparison-page'],
  enabledThemes: ['default', 'dark', 'compact'],
}

const DEFAULT_TENANT_KEY = 'tenant:localhost'

// ═══════════════════════════════════════════════════════════════════════════
// Seed default tenant into MemoryKvStore (idempotent)
// ═══════════════════════════════════════════════════════════════════════════

let seeded = false

function seedDefaultTenant(store: KvStore): void {
  if (seeded) return
  seeded = true
  store.put(DEFAULT_TENANT_KEY, JSON.stringify(DEFAULT_TENANT)).catch(() => {
    /* dev — best-effort seed */
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Resolution Helper
// ═══════════════════════════════════════════════════════════════════════════

async function resolveTenantFromHost(
  hostname: string,
  env: any,
  localStore: KvStore,
): Promise<TenantConfig | null> {
  // Try production Workers KV first
  const productionKv = env?.TENANT_KV
  if (productionKv && typeof productionKv.get === 'function') {
    const raw = await productionKv.get(`tenant:${hostname}`)
    if (raw) {
      try {
        return JSON.parse(raw) as TenantConfig
      } catch {
        /* corrupt entry — fall through */
      }
    }
  }

  // Fall back to local MemoryKvStore
  const raw = await localStore.get(`tenant:${hostname}`)
  if (raw) {
    try {
      return JSON.parse(raw) as TenantConfig
    } catch {
      return null
    }
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Middleware
// ═══════════════════════════════════════════════════════════════════════════

export const tenantMiddleware = async (c: Context, next: Next): Promise<Response | void> => {
  // Skip tenant resolution for public paths
  const url = new URL(c.req.url)
  const path = url.pathname
  if (
    path === '/healthz' ||
    path === '/system-dashboard.html' ||
    path.startsWith('/js/') ||
    path === '/api/dashboard/metrics' ||
    path === '/api/dashboard/kv' ||
    path === '/api/dashboard/runtime' ||
    path === '/api/telemetry' ||
    path === '/api/dev/deploy-staging'
  ) {
    return await next()
  }

  // Ensure default tenant is seeded for local dev
  seedDefaultTenant(kv)

  // Resolve tenant: ?tenant= query param takes priority, fallback to hostname
  const queryTenant = url.searchParams.get('tenant')
  const host = queryTenant || new URL(c.req.url).hostname
  const tenant = await resolveTenantFromHost(host, c.env, kv)

  if (!tenant) {
    return c.json({
      error: 'Tenant registration not found',
      hostname: host,
    }, 404)
  }

  c.set('tenantConfig', tenant)
  await next()
}

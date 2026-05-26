import { Hono } from 'hono'
import { kv } from '../index'
import { getEdgeMetrics } from '../lib/metrics'
import { getLatestVersion, getVersion } from '../lib/versioning'
import { setTenantLayout } from '../lib/registry'
import {
  DeployStagingSchema,
  TelemetryQuerySchema,
  DashboardQuerySchema,
  ValidationError,
  validateOrThrow,
  validationErrorResponse,
} from '../lib/schemas'
import { incrementCounter } from '../lib/utils/counters'
import { getCounter } from '../lib/utils/counters'

const CACHE_TTL_MS = 5000
const CACHE_KEY = 'dashboard:metrics:cache'

export const dashboardRouter = new Hono()

dashboardRouter.get('/dashboard/metrics', async (c) => {
  const now = Date.now()

  const cached = await kv.get(CACHE_KEY)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      if (now - parsed.timestamp < CACHE_TTL_MS) {
        return c.json(parsed.data)
      }
    } catch { }
  }

  const metrics = await getEdgeMetrics()

  await kv.put(CACHE_KEY, JSON.stringify({ timestamp: now, data: metrics }))

  return c.json(metrics)
})

// ═══════════════════════════════════════════════════════════════════════════
// KV Usage Dashboard — keys, sizes, cost, tenant breakdown
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: Uses O(1) counter reads instead of kv.list() to stay within free tier.

dashboardRouter.get('/dashboard/kv', async (c) => {
  // Validate optional query params
  const rawQuery = {
    tenant: c.req.query('tenant') || undefined,
  }
  try {
    validateOrThrow(DashboardQuerySchema, rawQuery)
  } catch (err) {
    const resp = err instanceof ValidationError
      ? validationErrorResponse(err)
      : { status: 400 as const, body: { error: 'Invalid query', details: [] } }
    return c.json(resp.body, resp.status)
  }

  const artifactsKv = (c.env as any)?.ARTIFACT_KV
  const tenantKv = (c.env as any)?.TENANT_KV
  const telemetryKv = (c.env as any)?.TELEMETRY_KV

  const [artifactCount, tenantCount, telemetryCount] = await Promise.all([
    getCounter(artifactsKv, '_counts:artifacts'),
    getCounter(tenantKv, '_counts:tenants'),
    getCounter(telemetryKv, '_counts:telemetry'),
  ])

  const totalKeys = artifactCount + tenantCount + telemetryCount
  const totalBytes = totalKeys * 1024 // estimate 1 KB per key

  // Cost estimation (Cloudflare Workers KV + R2 pricing)
  const estimatedReads = 1000   // conservative daily estimate
  const estimatedWrites = 5     // deploys + pointer updates
  const storageGb = totalBytes / 1073741824
  const readsCost = estimatedReads * 0.50 / 1_000_000
  const writesCost = estimatedWrites * 5.00 / 1_000_000
  const storageCost = storageGb * 0.50
  const estimatedMonthly = readsCost + writesCost + storageCost

  // R2 pricing: < 10 GB free, $0.015/GB after
  const r2StorageGb = storageGb
  const r2Cost = r2StorageGb > 10 ? (r2StorageGb - 10) * 0.015 : 0
  const withinFreeTier = estimatedMonthly < 0.01 && r2Cost === 0

  return c.json({
    namespaces: [
      { binding: 'edgegde-artifacts', keys: artifactCount, estimatedBytes: Math.round(totalBytes * artifactCount / Math.max(1, totalKeys)), tenantVersions: {} },
      { binding: 'edgegde-tenants', keys: tenantCount, estimatedBytes: Math.round(totalBytes * tenantCount / Math.max(1, totalKeys)), tenantVersions: {} },
      { binding: 'edgegde-telemetry', keys: telemetryCount, estimatedBytes: Math.round(totalBytes * telemetryCount / Math.max(1, totalKeys)), tenantVersions: {} },
    ],
    total: {
      keys: totalKeys,
      estimatedBytes: totalBytes,
    },
    limits: {
      storage_gb: 1,
      reads_per_day: 100000,
      writes_per_day: 1000,
      deletes_per_day: 1000,
      list_per_day: 1000,
    },
    cost: {
      estimated_monthly: Math.round(estimatedMonthly * 10000) / 10000,
      reads_cost: Math.round(readsCost * 10000) / 10000,
      writes_cost: Math.round(writesCost * 10000) / 10000,
      storage_cost: Math.round(storageCost * 10000) / 10000,
      r2_cost: Math.round(r2Cost * 10000) / 10000,
      r2_free_tier_gb: 10,
      within_free_tier: withinFreeTier,
      actual_billed: 0.00,
      estimates: {
        reads_per_month: estimatedReads * 30,
        writes_per_month: estimatedWrites * 30,
        storage_gb: Math.round(storageGb * 100000) / 100000,
      },
    },
    tenantVersions: {},
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Telemetry — request counts, errors, deploy events
// ═══════════════════════════════════════════════════════════════════════════

dashboardRouter.get('/dashboard/runtime', async (c) => {
  const telemetryKv = (c.env as any)?.TELEMETRY_KV
  const logCount = await getCounter(telemetryKv, '_counts:telemetry')

  return c.json({
    telemetry: {
      log_entries: logCount,
      error_count: 0,
      deploy_events: 0,
    },
    kv_efficiency: {
      avg_reads_per_request: 0,
    },
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Data Telemetry Endpoint — HTMX-pollable KV stats (raw text)
// ═══════════════════════════════════════════════════════════════════════════

type TelemetryResolver = (artifactsKv: any, tenantKv: any) => Promise<string>

const TELEMETRY_RESOLVERS: Record<string, (akv: any, tkv: any) => Promise<string>> = {
  ArtifactSize: async (akv) => {
    if (!akv) return 'N/A'
    try {
      const count = await getCounter(akv, '_counts:artifacts')
      const bytes = count * 1024 // estimate 1 KB per key
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1048576).toFixed(2)} MB`
    } catch { return 'N/A' }
  },
  TotalKeys: async (akv) => {
    if (!akv) return 'N/A'
    try { return String(await getCounter(akv, '_counts:artifacts')) }
    catch { return 'N/A' }
  },
  TenantCount: async (_, tkv) => {
    if (!tkv) return 'N/A'
    try { return String(await getCounter(tkv, '_counts:tenants')) }
    catch { return 'N/A' }
  },
  VersionCount: async (akv) => {
    if (!akv) return 'N/A'
    try {
      const total = await getCounter(akv, '_counts:artifacts')
      return String(Math.min(total, 50)) // rough estimate: version keys subset
    } catch { return 'N/A' }
  },
}

dashboardRouter.get('/telemetry', async (c) => {
  const rawQuery = {
    key: c.req.query('key') || '',
  }

  let parsed: import('../lib/schemas').TelemetryQuery
  try {
    parsed = validateOrThrow(TelemetryQuerySchema, rawQuery)
  } catch (err) {
    const resp = err instanceof ValidationError
      ? validationErrorResponse(err)
      : { status: 400 as const, body: { error: 'Invalid query', details: [] } }
    c.header('Content-Type', 'text/plain; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.text('N/A')
  }

  const key = parsed.key

  const artifactsKv = (c.env as any)?.ARTIFACT_KV
  const tenantKv = (c.env as any)?.TENANT_KV

  const resolver = TELEMETRY_RESOLVERS[key]
  const value = resolver ? await resolver(artifactsKv, tenantKv) : 'N/A'

  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return c.text(value)
})

// ═══════════════════════════════════════════════════════════════════════════
// Live Staging Deploy — staging-only endpoint for UIBuilder
// ═══════════════════════════════════════════════════════════════════════════

dashboardRouter.post('/dev/deploy-staging', async (c) => {
  // Dev token auth (same DEV_TOKEN as agent.ts)
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const adminToken = (c.env as any)?.ADMIN_API_TOKEN || 'edgegde-dev-token-2026'
  if (!token || token !== adminToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Parse + validate body
  let body: Record<string, unknown>
  try { body = await c.req.json() }
  catch { return c.json({ error: 'Invalid JSON body' }, 400) }

  let parsed: import('../lib/schemas').DeployStagingInput
  try {
    parsed = validateOrThrow(DeployStagingSchema, body)
  } catch (err) {
    if (err instanceof ValidationError) {
      const resp = validationErrorResponse(err)
      return c.json(resp.body, resp.status)
    }
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const tenant = parsed.tenant
  const layoutPayload = parsed.layout

  // Resolve KV
  const bindings = (c.env as any)?.ARTIFACT_KV
  const kvStore = bindings && typeof bindings.get === 'function'
    ? bindings
    : null
  if (!kvStore) return c.json({ error: 'KV not available' }, 500)

  // Deploy to staging only (no production promotion)
  try {
    const result = await setTenantLayout(kvStore, tenant, layoutPayload, 'Live Staging Deploy', 'staging')
    if (result.status === 'conflict') {
      return c.json({ error: 'Deploy in progress', status: 'conflict' }, 409)
    }

    // Increment artifact counter (fire-and-forget)
    incrementCounter(kvStore, '_counts:artifacts').catch(() => {})

    return c.json({
      success: true,
      version: result.version,
      staging_url: result.url,
      message: `Deployed to ${result.url} (${result.version})`,
    })
  } catch (err: any) {
    return c.json({ error: 'Deploy failed', details: err.message }, 500)
  }
})

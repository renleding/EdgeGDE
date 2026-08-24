/**
 * EdgeGDE — KV Metrics Middleware
 * Tracks request counts and error rates per tenant/tool/page.
 * Writes to KV on every request. Reads are instantaneous for the dashboard.
 *
 * @packageDocumentation
 */

export interface MetricsSnapshot {
  tenant: string
  tool: string
  requests: number
  errors: number
  lastSeen: string
}

const METRICS_PREFIX = 'metrics'
const METRICS_FLUSH_INTERVAL_MS = 60_000

function key(tenant: string, tool: string): string {
  return `${METRICS_PREFIX}:${tenant}:${tool}`
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory accumulator — batch writes, flush periodically
// ═══════════════════════════════════════════════════════════════════════════

interface MetricsAccum {
  requests: number
  errors: number
  lastSeen: string
}

const pending = new Map<string, MetricsAccum>()
let flushTimer: ReturnType<typeof setInterval> | null = null

function ensureFlushScheduler(kv: { get: (k: string, t: 'json') => Promise<any>; put: (k: string, v: string) => Promise<void> }): void {
  if (flushTimer) return
  flushTimer = setInterval(() => flushAll(kv), METRICS_FLUSH_INTERVAL_MS)
}

async function flushAll(kv: { get: (k: string, t: 'json') => Promise<any>; put: (k: string, v: string) => Promise<void> }): Promise<void> {
  if (pending.size === 0) return
  const snapshot = Array.from(pending.entries())
  pending.clear()
  for (const [k, acc] of snapshot) {
    try {
      const current = await kv.get(k, 'json') || { requests: 0, errors: 0 }
      await kv.put(k, JSON.stringify({
        requests: (current.requests || 0) + acc.requests,
        errors: (current.errors || 0) + acc.errors,
        lastSeen: acc.lastSeen,
      }))
    } catch { /* non-blocking */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// incrementRequest — fire-and-forget in-memory counter (batched KV write)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fire-and-forget request counter — batches per tenant+tool into an in-memory
 * map flushed to KV on a schedule; never blocks the caller.
 */
export async function incrementRequest(
  kv: { get: (k: string, t: 'json') => Promise<any>; put: (k: string, v: string) => Promise<void> },
  tenant: string,
  tool: string,
  isError: boolean,
): Promise<void> {
  ensureFlushScheduler(kv)
  const k = key(tenant, tool)
  const existing = pending.get(k) || { requests: 0, errors: 0, lastSeen: '' }
  existing.requests++
  if (isError) existing.errors++
  existing.lastSeen = new Date().toISOString()
  pending.set(k, existing)
}

/**
 * Flush pending metrics to KV immediately.
 * Call from the scheduled() handler so cron-triggered metrics persist.
 */
export async function flushMetrics(
  kv: { get: (k: string, t: 'json') => Promise<any>; put: (k: string, v: string) => Promise<void> },
): Promise<void> {
  await flushAll(kv)
}

// ═══════════════════════════════════════════════════════════════════════════
// getMetrics — read directly from KV (dashboard reads are infrequent)
// ═══════════════════════════════════════════════════════════════════════════

export async function getMetrics(
  kv: { get: (k: string, t: 'json') => Promise<any> },
  tenant?: string,
  tool?: string,
): Promise<MetricsSnapshot[]> {
  if (tenant && tool) {
    const data = await kv.get(key(tenant, tool), 'json')
    if (!data) return []
    return [{ tenant, tool, requests: data.requests || 0, errors: data.errors || 0, lastSeen: data.lastSeen || '' }]
  }

  const results: MetricsSnapshot[] = []
  const prefix = tenant ? `${METRICS_PREFIX}:${tenant}:` : `${METRICS_PREFIX}:`
  try {
    // Try direct key lookup for known tenants
    const knownTenants = ['au-mortgage-broker-afirmico']
    const knownTools = ['default', 'gallery', 'budget', 'metrics']
    for (const t of knownTenants) {
      for (const tl of knownTools) {
        try {
          const data: any = await kv.get(key(t, tl), 'json')
          if (data) {
            results.push({
              tenant: t,
              tool: tl,
              requests: data.requests || 0,
              errors: data.errors || 0,
              lastSeen: data.lastSeen || '',
            })
          }
        } catch {
          // Skip missing keys
        }
      }
    }
  } catch {
    // Fallback
  }

  return results.sort((a, b) => b.requests - a.requests)
}

/** @deprecated Use `getMetrics` instead — old 4-arg signature */
export async function getEdgeMetrics(
  _db: any,
  _telemetryKv: any,
  _artifactKv: any,
  tenantKv: any,
): Promise<MetricsSnapshot[]> {
  return getMetrics(tenantKv)
}

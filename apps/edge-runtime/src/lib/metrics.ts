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

function key(tenant: string, tool: string): string {
  return `${METRICS_PREFIX}:${tenant}:${tool}`
}

export async function incrementRequest(
  kv: { get: (k: string, t: 'json') => Promise<any>; put: (k: string, v: string) => Promise<void> },
  tenant: string,
  tool: string,
  isError: boolean,
): Promise<void> {
  const k = key(tenant, tool)
  try {
    const current: any = await kv.get(k, 'json') || { requests: 0, errors: 0, lastSeen: '' }
    current.requests = (current.requests || 0) + 1
    if (isError) current.errors = (current.errors || 0) + 1
    current.lastSeen = new Date().toISOString()
    await kv.put(k, JSON.stringify(current))
  } catch {
    // Fire-and-forget — metrics should never block the request
  }
}

export async function getMetrics(
  kv: { get: (k: string, t: 'json') => Promise<any>; list?: (opts: { prefix: string }) => AsyncIterable<{ name: string }> },
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
    const knownTenants = ['afirmico']
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

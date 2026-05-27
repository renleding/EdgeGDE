/**
 * EdgeGDE Runtime — Counter-Based Edge Metrics
 * Track 4: Replaces KV.list()-based log scanning with D1 queries + counters.
 *
 * KV.list() is forbidden in this architecture.
 * All listing goes through D1 or counter reads.
 */

import { getCounter } from './utils/counters'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface MetricsPayload {
  requests_per_minute: number
  avg_latency_ms: number
  p95_latency_ms: number
  error_rate_percent: number
  total_429_responses: number
  tool_usage_counts: Record<string, number>
  agent_request_ratio: number
  total_submissions: number
  total_tenants: number
  total_artifacts: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Metrics (No KV.list() — D1 + counters only)
// ═══════════════════════════════════════════════════════════════════════════

export async function getEdgeMetrics(
  db?: any,
  telemetryKv?: any,
  artifactsKv?: any,
  tenantKv?: any,
): Promise<MetricsPayload> {
  // ── Counter reads (O(1), no scanning) ─────────────────────────────────
  const totalSubmissions = telemetryKv ? await getCounter(telemetryKv, '_counts:telemetry') : 0
  const totalArtifacts = artifactsKv ? await getCounter(artifactsKv, '_counts:artifacts') : 0
  const totalTenants = tenantKv ? await getCounter(tenantKv, '_counts:tenants') : 0
  const total429 = telemetryKv ? await getCounter(telemetryKv, '_counts:429') : 0

  // ── D1 queries for time-windowed metrics ──────────────────────────────
  let requestsPerMinute = 0
  let errorRate = 0

  if (db && typeof db.prepare === 'function') {
    try {
      const rpmResult = await db.prepare(
        `SELECT COUNT(*) as count FROM form_submissions
         WHERE created_at > datetime('now', '-1 minute')`
      ).first()
      requestsPerMinute = (rpmResult as any)?.count || 0
    } catch {
      // D1 unavailable — use counter fallback
      requestsPerMinute = totalSubmissions
    }

    try {
      const errResult = await db.prepare(
        `SELECT COUNT(*) as count FROM form_submissions
         WHERE created_at > datetime('now', '-1 minute')
         AND json_extract(payload, '$.error') IS NOT NULL`
      ).first()
      const errors = (errResult as any)?.count || 0
      errorRate = requestsPerMinute > 0
        ? Math.round((errors / requestsPerMinute) * 10000) / 100
        : 0
    } catch {
      errorRate = 0
    }
  }

  return {
    requests_per_minute: requestsPerMinute,
    avg_latency_ms: 0,   // No longer tracked per-request — counter-based now
    p95_latency_ms: 0,   // No longer tracked per-request
    error_rate_percent: errorRate,
    total_429_responses: total429,
    tool_usage_counts: {},  // Tracked via counters per tool if needed
    agent_request_ratio: 0, // Tracked via dedicated counter
    total_submissions: totalSubmissions,
    total_tenants: totalTenants,
    total_artifacts: totalArtifacts,
  }
}

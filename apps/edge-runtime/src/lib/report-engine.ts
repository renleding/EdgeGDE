/**
 * EdgeGDE Runtime — Scheduled Report Engine
 * Track 4 Phase 6: Generation, storage, and delivery of periodic reports.
 *
 * v1: waitUntil-based, KV storage, email stub. Queue + R2 + email are upgrade paths.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface WeeklyDigestPayload {
  period: string
  total_leads: number
  score_distribution: { cold: number; warm: number; hot: number }
  top_leads: Array<{ leadId: string; score: number; submissionDate: string }>
  webhook_delivery_rate: number
  generated_at: string
}

export type ReportPayload = WeeklyDigestPayload

// ═══════════════════════════════════════════════════════════════════════════
// Computes next run time from a cron expression (simple v1: interval shorthand)
// ═══════════════════════════════════════════════════════════════════════════

export function computeNextRun(
  cronExpression: string,
  utcOffset: number,
): string {
  const parts = cronExpression.trim().split(/\s+/)
  let intervalMinutes = 60 // default: hourly

  if (parts.length === 2) {
    // "*/5 * * * *" style — pull the interval from first segment
    // Simplified: only supports "*/N" patterns
    const match = parts[0]?.match(/^\*\/(\d+)$/)
    if (match) intervalMinutes = parseInt(match[1], 10)
  }

  const now = new Date()
  const next = new Date(now.getTime() + intervalMinutes * 60 * 1000)
  return next.toISOString()
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Generation (D1 queries, no full table scans)
// ═══════════════════════════════════════════════════════════════════════════

export async function generateWeeklyDigest(
  db: any,
  tenantId: string,
): Promise<WeeklyDigestPayload> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  const dateStr = new Date().toISOString().split('T')[0]

  // Query leads in time window (uses created_at index — no full scan)
  const totalRow: any = await db.prepare(
    `SELECT COUNT(*) as count FROM form_submissions
     WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?`
  ).bind(tenantId, sevenDaysAgo, now).first()
  const totalLeads = totalRow?.count || 0

  // Score distribution (join with lead_scores)
  const scores: any = await db.prepare(
    `SELECT s.score FROM form_submissions f
     JOIN lead_scores s ON s.lead_id = f.id AND s.tenant_id = f.tenant_id
     WHERE f.tenant_id = ? AND f.created_at >= ? AND f.created_at <= ?`
  ).bind(tenantId, sevenDaysAgo, now).all()

  const allScores: number[] = (scores.results || []).map((r: any) => r.score)
  const cold = allScores.filter((s) => s >= 0 && s <= 30).length
  const warm = allScores.filter((s) => s >= 31 && s <= 60).length
  const hot = allScores.filter((s) => s >= 61).length

  // Top leads (sorted by score, limited to 10)
  const top: any[] = (scores.results || [])
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 10)
    .map((r: any) => ({
      leadId: r.lead_id || '',
      score: r.score,
      submissionDate: r.created_at || '',
    }))

  return {
    period: `${sevenDaysAgo.split('T')[0]} to ${dateStr}`,
    total_leads: totalLeads,
    score_distribution: { cold, warm, hot },
    top_leads: top,
    webhook_delivery_rate: 1.0, // Not tracked per-tenant yet
    generated_at: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage (R2 for payloads, KV for pointers)
// ═══════════════════════════════════════════════════════════════════════════

export async function storeReportArtifact(
  R2_BUCKET: any,
  TENANT_KV: any,
  tenantId: string,
  scheduleId: string,
  targetDate: string,
  payload: ReportPayload,
): Promise<string> {
  // R2: immutable payload with UUID versioning
  const uuid = crypto.randomUUID()
  const r2Key = `report/${tenantId}/${scheduleId}/${targetDate}/${uuid}.json`
  const body = JSON.stringify(payload)
  await R2_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { generatedAt: payload.generated_at, tenantId, scheduleId, targetDate },
  })

  // KV pointer: fast lookup to latest report
  const pointerKey = `report_artifact:${tenantId}:${scheduleId}:latest`
  await TENANT_KV.put(pointerKey, r2Key)

  return r2Key
}

// ═══════════════════════════════════════════════════════════════════════════
// Delivery (Stubbed for v1 — logs to console)
// ═══════════════════════════════════════════════════════════════════════════

export async function deliverReport(
  db: any,
  executionId: string,
  recipientsJson: string,
  payload: ReportPayload,
): Promise<{ status: string }> {
  const recipients = JSON.parse(recipientsJson || '[]') as string[]
  const recipientList = recipients.length > 0 ? recipients.join(', ') : 'no-recipients-configured'

  console.log(JSON.stringify({
    event: 'report_delivery',
    executionId,
    recipients: recipientList,
    period: payload.period,
    totalLeads: payload.total_leads,
    generatedAt: payload.generated_at,
    provider: 'stubbed_logger',
    simulatedStatus: 'sent',
    timestamp: Date.now(),
  }))

  return { status: 'sent' }
}

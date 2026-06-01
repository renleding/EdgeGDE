/**
 * EdgeGDE Runtime — Lead Scoring API
 * Track 4 Phase 5: Rubric management, deterministic scoring, enrichment trigger.
 */

import { Hono } from 'hono'
import { scoreLead, type Ruleset, type RulesetRule, type ScoreResult } from '../lib/scoring-engine'
import { addSubscriber, removeSubscriber } from '../lib/sse'
import { validateUiConfig, validateUiConfigSafe } from '../lib/ui-primitives'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface RubricRecord {
  id: string
  tenant_id: string
  name: string
  version: number
  ruleset_json: string
  is_active: boolean
  created_at: string
}

interface ScoreRecord {
  id: string
  tenant_id: string
  lead_id: string
  rubric_id: string
  score: number
  override_score: number | null
  override_rationale: string | null
  created_at: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Router — admin endpoints
// ═══════════════════════════════════════════════════════════════════════════

export const scoringAdminRouter = new Hono()
export const scoringTenantRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/scoring/rubrics — create a rubric
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.post('/scoring/rubrics', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const tenantId = body.tenantId as string
  const name = body.name as string
  const ruleset = body.ruleset as Ruleset

  if (!tenantId) return c.json({ error: 'tenantId required' }, 400)
  if (!name) return c.json({ error: 'name required' }, 400)
  if (!ruleset || !ruleset.rules || !Array.isArray(ruleset.rules)) {
    return c.json({ error: 'ruleset.rules array required' }, 400)
  }

  const rubricId = crypto.randomUUID()
  const rulesetJson = JSON.stringify(ruleset)

  await db.prepare(
    `INSERT INTO scoring_rubrics (id, tenant_id, name, version, ruleset_json)
     VALUES (?, ?, ?, 1, ?)`
  ).bind(rubricId, tenantId, name, rulesetJson).run()

  console.log(JSON.stringify({
    event: 'rubric_created', rubricId, tenantId, name,
    ruleCount: ruleset.rules.length, timestamp: Date.now(),
  }))

  return c.json({ success: true, rubricId, tenantId, name, version: 1 })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/scoring/rubrics — list rubrics for a tenant
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/scoring/rubrics', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenantId')
  if (!tenantId) return c.json({ error: 'tenantId query param required' }, 400)

  const { results } = await db.prepare(
    `SELECT id, name, version, is_active, created_at
     FROM scoring_rubrics WHERE tenant_id = ? ORDER BY created_at DESC`
  ).bind(tenantId).all()

  return c.json({ rubrics: results || [] })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/scoring/rubrics/:id/activate — activate rubric, deactivate others
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.post('/scoring/rubrics/:id/activate', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const rubricId = c.req.param('id')

  // Fetch rubric
  const rubric: any = await db.prepare(
    `SELECT * FROM scoring_rubrics WHERE id = ?`
  ).bind(rubricId).first()

  if (!rubric) return c.json({ error: 'Rubric not found' }, 404)

  // Deactivate all rubrics for this tenant
  await db.prepare(
    `UPDATE scoring_rubrics SET is_active = 0 WHERE tenant_id = ?`
  ).bind(rubric.tenant_id).run()

  // Activate the selected rubric
  await db.prepare(
    `UPDATE scoring_rubrics SET is_active = 1 WHERE id = ?`
  ).bind(rubricId).run()

  console.log(JSON.stringify({
    event: 'rubric_activated',
    rubricId, tenantId: rubric.tenant_id, timestamp: Date.now(),
  }))

  return c.json({ success: true, rubricId, is_active: true })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/scoring/execute — score a lead (deterministic, idempotent)
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.post('/scoring/execute', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const tenantId = body.tenantId as string
  const leadId = body.leadId as string
  const leadFields = body.fields as Record<string, unknown>

  if (!tenantId) return c.json({ error: 'tenantId required' }, 400)
  if (!leadId) return c.json({ error: 'leadId required' }, 400)
  if (!leadFields) return c.json({ error: 'fields required' }, 400)

  // Find active rubric for tenant
  const rubric: any = await db.prepare(
    `SELECT * FROM scoring_rubrics WHERE tenant_id = ? AND is_active = 1 LIMIT 1`
  ).bind(tenantId).first()

  if (!rubric) return c.json({ error: 'No active rubric for tenant' }, 400)

  // Check idempotency
  const existing: any = await db.prepare(
    `SELECT * FROM lead_scores WHERE tenant_id = ? AND lead_id = ? AND rubric_id = ?`
  ).bind(tenantId, leadId, rubric.id).first()

  if (existing) {
    return c.json({
      idempotent: true,
      scoreId: existing.id,
      score: existing.score,
      classification: classifyFromScore(existing.score, rubric.ruleset_json),
    })
  }

  // Execute scoring
  let ruleset: Ruleset
  try { ruleset = JSON.parse(rubric.ruleset_json) } catch {
    return c.json({ error: 'Corrupt ruleset' }, 500)
  }

  const result = scoreLead(leadFields, ruleset)
  const scoreId = crypto.randomUUID()

  // Persist to D1
  await db.prepare(
    `INSERT INTO lead_scores (id, tenant_id, lead_id, rubric_id, score)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(scoreId, tenantId, leadId, rubric.id, result.score).run()

  // Store trace in D1 (replaces TENANT_KV score_trace:{tenant}:{lead}:{rubric})
  const db2 = (c.env as any)?.DB
  if (db2 && typeof db2.prepare === 'function') {
    try {
      await db2.prepare(
        `INSERT INTO score_traces (id, tenant_id, lead_id, rubric_id, score, max_score, classification, rubric_version, matched_rules, score_breakdown, trace)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        tenantId,
        leadId,
        rubric.id,
        result.score,
        100,
        result.classification,
        rubric.version,
        JSON.stringify(result.matchedRules),
        JSON.stringify(result.scoreBreakdown),
        JSON.stringify(result.trace),
      ).run()
    } catch { /* non-fatal */ }
  }
  console.log(JSON.stringify({
    event: 'lead_scored', tenantId, leadId,
    rubricId: rubric.id, score: result.score,
    classification: result.classification, timestamp: Date.now(),
  }))

  return c.json({
    scoreId,
    score: result.score,
    maxScore: 100,
    classification: result.classification,
    rubricVersion: rubric.version,
    matchedRules: result.matchedRules,
    scoreBreakdown: result.scoreBreakdown,
    trace: result.trace,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/scoring/override — set manual override score
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.post('/scoring/override', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const tenantId = body.tenantId as string
  const leadId = body.leadId as string
  const rubricId = body.rubricId as string
  const overrideScore = body.overrideScore as number
  const rationale = (body.rationale as string) || 'Manual override'

  if (!tenantId || !leadId || !rubricId) {
    return c.json({ error: 'tenantId, leadId, rubricId required' }, 400)
  }
  if (typeof overrideScore !== 'number' || overrideScore < 0 || overrideScore > 100) {
    return c.json({ error: 'overrideScore must be 0-100' }, 400)
  }

  await db.prepare(
    `UPDATE lead_scores
     SET override_score = ?, override_rationale = ?
     WHERE tenant_id = ? AND lead_id = ? AND rubric_id = ?`
  ).bind(overrideScore, rationale, tenantId, leadId, rubricId).run()

  console.log(JSON.stringify({
    event: 'score_override', tenantId, leadId, rubricId,
    newScore: overrideScore, rationale, timestamp: Date.now(),
  }))

  return c.json({ success: true, tenantId, leadId, overrideScore, rationale })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /tenant/scoring/scores — read scores for a lead
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

scoringTenantRouter.get('/scoring/scores', async (c) => {
  const tenantId = (c as any).get('authenticatedTenantId') as string
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const leadId = c.req.query('leadId')
  if (!leadId) return c.json({ error: 'leadId query param required' }, 400)

  const { results } = await db.prepare(
    `SELECT ls.id, ls.lead_id, ls.rubric_id, ls.score,
            ls.override_score, ls.override_rationale, ls.created_at,
            sr.name as rubric_name
     FROM lead_scores ls
     JOIN scoring_rubrics sr ON ls.rubric_id = sr.id
     WHERE ls.tenant_id = ? AND ls.lead_id = ?
     ORDER BY ls.created_at DESC`
  ).bind(tenantId, leadId).all()

  return c.json({ scores: results || [] })
})

// ═══════════════════════════════════════════════════════════════════════════
// Hot Lead Alerts — real-time alert stream from KV index
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/hot-alerts', async (c) => {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const tenantId = c.req.query('tenant') // optional: filter by tenant

  let allAlerts: any[] = []

  try {
    if (tenantId) {
      // Single tenant
      const alerts = await fetchAlertsForTenant(TENANT_KV, tenantId)
      allAlerts = alerts
    } else {
      // All tenants — try known tenants from index keys
      // We can't KV.list(), so we scan known tenants via alerts:hot:index key pattern
      // For now, return empty if no tenant specified (caller must filter)
      allAlerts = []
    }

    return c.json({ alerts: allAlerts })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch alerts', details: err.message }, 500)
  }
})

// Helper: fetch all alerts for a tenant from the index pointer
async function fetchAlertsForTenant(kv: any, tenantId: string): Promise<any[]> {
  const indexKey = `tenant:${tenantId}:alerts:hot:index`
  const indexRaw = await kv.get(indexKey)
  if (!indexRaw) return []

  let submissionIds: string[]
  try {
    submissionIds = JSON.parse(indexRaw)
  } catch {
    return []
  }
  if (!Array.isArray(submissionIds) || submissionIds.length === 0) return []

  // Fetch individual alerts in parallel
  const results = await Promise.allSettled(
    submissionIds.map((id: string) =>
      kv.get(`tenant:${tenantId}:alert:hot:${id}`).then((raw: string | null) => {
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return {
          submissionId: id,
          tenantId,
          score: parsed.score ?? 0,
          rationale: parsed.rationale ?? '',
          timestamp: parsed.timestamp ?? null,
        }
      })
    )
  )

  return results
    .map((r: any) => (r.status === 'fulfilled' ? r.value : null))
    .filter((a: any) => a !== null)
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /admin/hot-alerts/:submissionId — dismiss an alert
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.delete('/hot-alerts/:submissionId', async (c) => {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const submissionId = c.req.param('submissionId')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query param required' }, 400)

  try {
    // 1. Delete the individual alert
    await TENANT_KV.delete(`tenant:${tenantId}:alert:hot:${submissionId}`)

    // 2. Remove from index
    const indexKey = `tenant:${tenantId}:alerts:hot:index`
    const indexRaw = await TENANT_KV.get(indexKey)
    if (indexRaw) {
      try {
        const ids: string[] = JSON.parse(indexRaw)
        const updated = ids.filter((id: string) => id !== submissionId)
        await TENANT_KV.put(indexKey, JSON.stringify(updated))
      } catch { /* index corrupt, skip update */ }
    }

    return c.json({ success: true, dismissed: submissionId })
  } catch (err: any) {
    return c.json({ error: 'Failed to dismiss alert', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Lead Dashboard — admin leads list with scoring data
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/leads', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const band = c.req.query('band') // optional: hot, warm, cold
  const tenantId = c.req.query('tenant') // optional: filter by tenant

  let sql = `SELECT id, tenant_id, form_id, created_at,
                    lead_score, score_band, score_rationale,
                    current_stage,
                    payload
             FROM form_submissions WHERE 1=1`
  const binds: any[] = []

  if (band && ['hot', 'warm', 'cold'].includes(band)) {
    sql += ` AND score_band = ?`
    binds.push(band)
  }

  if (tenantId) {
    sql += ` AND tenant_id = ?`
    binds.push(tenantId)
  }

  sql += ` ORDER BY lead_score DESC, created_at DESC LIMIT 100`

  try {
    const { results } = await db.prepare(sql).bind(...binds).all()

    const leads = (results || []).map((r: any) => {
      // Extract name and email from payload JSON if available
      let name = ''
      let email = ''
      try {
        const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
        name = p.fullName || p.name || p.full_name || ''
        email = p.email || p.emailAddress || ''
      } catch {}

      return {
        id: r.id,
        tenantId: r.tenant_id,
        formId: r.form_id,
        name,
        email,
        score: r.lead_score ?? 0,
        band: r.score_band ?? 'cold',
        stage: r.current_stage ?? 'new_lead',
        rationale: r.score_rationale ?? '',
        createdAt: r.created_at,
      }
    })

    return c.json({ leads })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// SSE Stream — real-time hot lead push
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/leads/stream', async (c) => {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query param required' }, 400)

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Add subscriber
  addSubscriber(writer, tenantId)

  // Send initial keepalive
  writer.write(encoder.encode(`event: connected\ndata: {"tenant":"${tenantId}"}\n\n`))

  // Remove subscriber on disconnect
  c.req.raw.signal.addEventListener('abort', () => {
    removeSubscriber(writer)
  })

  // Periodic keepalive ping (every 30s)
  const keepalive = setInterval(() => {
    writer.write(encoder.encode(': keepalive\n\n'))
  }, 30000)

  // Cleanup keepalive on disconnect
  c.req.raw.signal.addEventListener('abort', () => {
    clearInterval(keepalive)
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/replay-deadletters — replay KV deadletters into D1
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.post('/replay-deadletters', async (c) => {
  const db = (c.env as any)?.DB
  const TENANT_KV = (c.env as any)?.TENANT_KV
  const LEAD_SCORING_QUEUE = (c.env as any)?.LEAD_SCORING_QUEUE

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query param required' }, 400)

  const results: { submissionId: string; status: string; error?: string }[] = []

  try {
    // 1. Read index pointer
    const indexKey = `tenant:${tenantId}:deadletter:index`
    const indexRaw = await TENANT_KV.get(indexKey)
    if (!indexRaw) {
      return c.json({ replayed: 0, failed: 0, results: [], message: 'No deadletters found for this tenant.' })
    }

    let submissionIds: string[]
    try {
      submissionIds = JSON.parse(indexRaw)
    } catch {
      return c.json({ replayed: 0, failed: 0, results: [], message: 'Corrupt deadletter index.' }, 500)
    }

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return c.json({ replayed: 0, failed: 0, results: [], message: 'No deadletters found for this tenant.' })
    }

    // Cap to max batch
    const batch = submissionIds.slice(0, 20)

    for (const submissionId of batch) {
      try {
        const dlKey = `tenant:${tenantId}:deadletter:${submissionId}`
        const payload = await TENANT_KV.get(dlKey)
        if (!payload) {
          results.push({ submissionId, status: 'skipped', error: 'payload not found' })
          continue
        }

        // 2. Parse payload to get form_id (first JSON field)
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(payload)
        } catch {
          results.push({ submissionId, status: 'failed', error: 'invalid JSON payload' })
          continue
        }

        const formId = (parsed.formId as string) || 'mortgage'

        // 3. Idempotent D1 insert (ignore duplicate ID errors)
        try {
          await db.prepare(
            'INSERT OR IGNORE INTO form_submissions (id, tenant_id, form_id, payload) VALUES (?, ?, ?, ?)'
          ).bind(submissionId, tenantId, formId, payload).run()
        } catch (insertErr: any) {
          results.push({ submissionId, status: 'failed', error: insertErr.message })
          continue
        }

        // 4. Re-queue for scoring
        if (LEAD_SCORING_QUEUE && typeof LEAD_SCORING_QUEUE.send === 'function') {
          try {
            await LEAD_SCORING_QUEUE.send({
              submissionId,
              tenantId,
              formId,
              payload: parsed,
            })
          } catch { /* non-blocking */ }
        }

        // 5. Delete deadletter key
        await TENANT_KV.delete(dlKey)

        results.push({ submissionId, status: 'replayed' })
      } catch (err: any) {
        results.push({ submissionId, status: 'failed', error: err.message })
      }
    }

    // 6. Update index — remove successfully replayed AND skipped (phantom) entries
    const remaining = submissionIds.filter((id: string) => {
      const result = results.find((r) => r.submissionId === id)
      return result && (result.status === 'failed')
    })
    await TENANT_KV.put(indexKey, JSON.stringify(remaining))

    const replayed = results.filter((r) => r.status === 'replayed').length
    const failed = results.filter((r) => r.status === 'failed').length

    return c.json({ replayed, failed, skipped: batch.length - replayed - failed, results })
  } catch (err: any) {
    return c.json({ error: 'Replay failed', details: err.message, results }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Scoring Insights — aggregation queries for the dashboard
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/insights', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  const where = tenantId ? 'WHERE tenant_id = ?' : ''
  const binds: any[] = tenantId ? [tenantId] : []

  try {
    const [totalResult, avgResult, bandResult] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as total FROM form_submissions ${where}`).bind(...binds).first(),
      db.prepare(
        `SELECT AVG(lead_score) as avg_total, AVG(deterministic_score) as avg_deterministic
         FROM form_submissions ${where}`
      ).bind(...binds).first(),
      db.prepare(
        `SELECT score_band, COUNT(*) as count
         FROM form_submissions ${where}
         GROUP BY score_band ORDER BY count DESC`
      ).bind(...binds).all(),
    ])

    const total = (totalResult as any)?.total ?? 0
    const avg = avgResult as any
    const bands = (bandResult?.results || []) as { score_band: string; count: number }[]

    const bandMap: Record<string, number> = { hot: 0, warm: 0, cold: 0 }
    for (const b of bands) {
      if (b.score_band && b.score_band in bandMap) {
        bandMap[b.score_band] = b.count
      }
    }

    return c.json({
      totalLeads: total,
      averageTotalScore: avg?.avg_total !== null ? Math.round(Number(avg.avg_total) * 10) / 10 : null,
      averageDeterministicScore: avg?.avg_deterministic !== null ? Math.round(Number(avg.avg_deterministic) * 10) / 10 : null,
      averageLlmContribution: avg?.avg_total !== null && avg?.avg_deterministic !== null
        ? Math.round((Number(avg.avg_total) - Number(avg.avg_deterministic)) * 10) / 10
        : null,
      bandDistribution: bandMap,
    })
  } catch (err: any) {
    return c.json({ error: 'Insights query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Telemetry — read LLM metrics from D1 telemetry_daily (was TELEMETRY_KV)
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/telemetry', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantIdQuery = c.req.query('tenant')
  if (!tenantIdQuery) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    // Single D1 query replaces KV index scan + N× KV reads
    const { results } = await db.prepare(
      `SELECT date, llm_calls, llm_success, llm_fail, total_latency_ms, avg_latency_ms,
              red_flag_count, total_agentic_score
       FROM telemetry_daily
       WHERE tenant_id = ?
       ORDER BY date DESC
       LIMIT 30`
    ).bind(tenantIdQuery).all()

    const days = results || []
    const totalCalls = days.reduce((s: number, r: any) => s + (r.llm_calls || 0), 0)
    const totalSuccess = days.reduce((s: number, r: any) => s + (r.llm_success || 0), 0)
    const totalLatency = days.reduce((s: number, r: any) => s + (r.total_latency_ms || 0), 0)

    return c.json({
      days,
      summary: {
        totalCalls,
        totalSuccess,
        totalFail: totalCalls - totalSuccess,
        avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : null,
        successRate: totalCalls > 0 ? Math.round((totalSuccess / totalCalls) * 1000) / 10 : null,
        redFlagCount: days.reduce((s: number, r: any) => s + (r.red_flag_count || 0), 0),
        daysTracked: days.length,
      },
    })
  } catch (err: any) {
    return c.json({ error: 'Telemetry query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Contacts — list contacts for a tenant
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/contacts', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    const { results } = await db.prepare(
      `SELECT c.id, c.name, c.email, c.phone, c.created_at,
              COUNT(s.id) as submission_count,
              MAX(s.lead_score) as max_score
       FROM contacts c
       LEFT JOIN form_submissions s ON s.contact_id = c.id AND s.tenant_id = c.tenant_id
       WHERE c.tenant_id = ?
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT 100`
    ).bind(tenantId).all()

    return c.json({ contacts: results || [] })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Stages — list and manage deal stages per tenant
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/stages', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    const { results } = await db.prepare(
      `SELECT id, name, position FROM pipeline_stages
       WHERE tenant_id = ? ORDER BY position ASC`
    ).bind(tenantId).all()

    return c.json({ stages: results || [] })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /admin/leads/:id/stage — move a lead through the pipeline
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.patch('/leads/:id/stage', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const submissionId = c.req.param('id')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  let body: { stage?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  if (!body.stage) return c.json({ error: 'stage field required' }, 400)

  try {
    // 1. Verify submission exists and belongs to tenant
    const current: any = await db.prepare(
      `SELECT current_stage FROM form_submissions WHERE id = ? AND tenant_id = ? LIMIT 1`
    ).bind(submissionId, tenantId).first()

    if (!current) return c.json({ error: 'Submission not found' }, 404)

    const fromStage = (current.current_stage as string) || 'new_lead'
    const toStage = body.stage

    // 2. Update stage
    await db.prepare(
      `UPDATE form_submissions SET current_stage = ? WHERE id = ? AND tenant_id = ?`
    ).bind(toStage, submissionId, tenantId).run()

    // 3. Audit event
    const auditDo = (c.env as any)?.AUDIT_LEDGER
    if (auditDo && typeof auditDo.idFromName === 'function') {
      c.executionCtx.waitUntil((async () => {
        try {
          const doId = auditDo.idFromName(`tenant:${tenantId}`)
          const stub = auditDo.get(doId)
          await stub.fetch('http://do/append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'stage_change',
              tenantId,
              submissionId,
              file_name: '',
              object_key: '',
              metadata: { from_stage: fromStage, to_stage: toStage },
            }),
          })
        } catch {}
      })())
    }

    return c.json({ success: true, submissionId, fromStage, toStage })
  } catch (err: any) {
    return c.json({ error: 'Stage update failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// UI Config — self-assembling frontend configuration
// ═══════════════════════════════════════════════════════════════════════════

scoringAdminRouter.get('/ui-config', async (c) => {
  const kv = (c.env as any)?.TENANT_KV
  if (!kv) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    const config = await kv.get(`tenant:${tenantId}:ui:config`, 'json')
    return c.json({ config: config || null })
  } catch (err: any) {
    return c.json({ error: 'Failed to read UI config', details: err.message }, 500)
  }
})

scoringAdminRouter.put('/ui-config', async (c) => {
  const kv = (c.env as any)?.TENANT_KV
  if (!kv) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // ═══ JUDGE GATE ═══ — validate before any KV write
  const validation = validateUiConfigSafe(body)
  if (!validation.success) {
    return c.json({
      error: 'UI config validation failed',
      details: validation.error,
      hint: 'The LLM generated an invalid config. Review the schema and regenerate.',
    }, 400)
  }

  try {
    await kv.put(`tenant:${tenantId}:ui:config`, JSON.stringify(validation.data))
    return c.json({ success: true, tenantId, version: '1.0' })
  } catch (err: any) {
    return c.json({ error: 'Failed to save UI config', details: err.message }, 500)
  }
})

scoringAdminRouter.delete('/ui-config', async (c) => {
  const kv = (c.env as any)?.TENANT_KV
  if (!kv) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    await kv.delete(`tenant:${tenantId}:ui:config`)
    return c.json({ success: true, message: 'UI config reset to default' })
  } catch (err: any) {
    return c.json({ error: 'Failed to delete UI config', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════════════

function classifyFromScore(score: number, rulesetJson: string): string {
  try {
    const ruleset: Ruleset = JSON.parse(rulesetJson)
    const cls = (ruleset.scoring_metadata?.classifications || []).find(
      (c) => score >= c.min && score <= c.max,
    )
    return cls?.label || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

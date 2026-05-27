/**
 * EdgeGDE Runtime — Lead Scoring API
 * Track 4 Phase 5: Rubric management, deterministic scoring, enrichment trigger.
 */

import { Hono } from 'hono'
import { scoreLead, type Ruleset, type RulesetRule, type ScoreResult } from '../lib/scoring-engine'

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

  // Store trace in KV
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (TENANT_KV) {
    try {
      await TENANT_KV.put(
        `score_trace:${tenantId}:${leadId}:${rubric.id}`,
        JSON.stringify({
          score: result.score,
          maxScore: 100,
          classification: result.classification,
          rubricVersion: rubric.version,
          matchedRules: result.matchedRules,
          scoreBreakdown: result.scoreBreakdown,
          trace: result.trace,
          timestamp: Date.now(),
        }),
      )
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

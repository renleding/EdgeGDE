/**
 * EdgeGDE Runtime — Scheduled Reports API
 * Track 4 Phase 6: Schedule CRUD, execution listing, cron orchestration.
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import {
  computeNextRun,
  generateWeeklyDigest,
  storeReportArtifact,
  deliverReport,
} from '../lib/report-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const reportAdminRouter = new Hono()
export const reportCronHandler = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/reports/schedules — create a report schedule
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

reportAdminRouter.post('/reports/schedules', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const tenantId = body.tenantId as string
  const type = body.type as string
  const cronExpression = body.cronExpression as string
  const recipients = body.recipients as string[]
  const utcOffset = (body.utcOffset as number) || 0

  if (!tenantId) return c.json({ error: 'tenantId required' }, 400)
  if (!type || !['weekly_digest', 'csv_export', 'monthly_summary'].includes(type)) {
    return c.json({ error: 'type must be one of: weekly_digest, csv_export, monthly_summary' }, 400)
  }
  if (!cronExpression) return c.json({ error: 'cronExpression required' }, 400)

  const scheduleId = crypto.randomUUID()
  const nextRunAt = computeNextRun(cronExpression, utcOffset)

  await db.prepare(
    `INSERT INTO report_schedules (id, tenant_id, type, cron_expression, recipients_json, utc_offset, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    scheduleId, tenantId, type, cronExpression,
    JSON.stringify(recipients || []), utcOffset, nextRunAt,
  ).run()

  console.log(JSON.stringify({
    event: 'report_schedule_created', scheduleId, tenantId, type,
    nextRunAt, timestamp: Date.now(),
  }))

  return c.json({
    success: true, scheduleId, tenantId, type,
    nextRunAt, isActive: true,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/reports/schedules — list schedules for a tenant
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

reportAdminRouter.get('/reports/schedules', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenantId')
  if (!tenantId) return c.json({ error: 'tenantId required' }, 400)

  const { results } = await db.prepare(
    `SELECT id, type, cron_expression, is_active, next_run_at, created_at
     FROM report_schedules WHERE tenant_id = ? ORDER BY next_run_at ASC`
  ).bind(tenantId).all()

  return c.json({ schedules: results || [] })
})

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /admin/reports/schedules/:id — deactivate a schedule
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

reportAdminRouter.delete('/reports/schedules/:id', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const scheduleId = c.req.param('id')
  await db.prepare(
    `UPDATE report_schedules SET is_active = 0 WHERE id = ?`
  ).bind(scheduleId).run()

  return c.json({ success: true, scheduleId, isActive: false })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/reports/executions — list executions for a schedule
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

reportAdminRouter.get('/reports/executions', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const scheduleId = c.req.query('scheduleId')
  if (!scheduleId) return c.json({ error: 'scheduleId required' }, 400)

  const { results } = await db.prepare(
    `SELECT id, target_date, status, delivery_status, artifact_key, created_at, completed_at
     FROM report_executions WHERE schedule_id = ? ORDER BY target_date DESC LIMIT 20`
  ).bind(scheduleId).all()

  return c.json({ executions: results || [] })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /cron/tick — cron trigger (called by Cloudflare Cron, admin, or waitUntil)
// NOT protected by adminAuth — relies on cron-only invocation
// ═══════════════════════════════════════════════════════════════════════════

reportCronHandler.post('/cron/tick', async (c) => {
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV
  const R2_BUCKET = envFromContext(c).VAULT_BUCKET

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV required' }, 500)
  if (!R2_BUCKET) return c.json({ error: 'VAULT_BUCKET required' }, 500)

  const now = new Date().toISOString()
  const results: Record<string, any> = { recovered: 0, triggered: 0, generated: 0 }

  try {
    // ── 1. Recover stale locks ──────────────────────────────────────────────
    const staleResult = await db.prepare(
      `UPDATE report_executions
       SET status = 'pending', updated_at = ?
       WHERE status = 'processing' AND updated_at < datetime('now', '-15 minutes')`
    ).bind(now).run()
    results.recovered = (staleResult.meta?.changes ?? 0)

    // ── 2. Find due schedules ────────────────────────────────────────────────
    const due: any = await db.prepare(
      `SELECT * FROM report_schedules
       WHERE next_run_at <= ? AND is_active = 1`
    ).bind(now).all()

    const schedules = due.results || []
    results.triggered = schedules.length

    for (const schedule of schedules) {
      const s = schedule as any
      const targetDate = now.split('T')[0]

      // ── 3. Create execution record (idempotent via UNIQUE) ─────────────
      const executionId = crypto.randomUUID()
      await db.prepare(
        `INSERT OR IGNORE INTO report_executions
         (id, schedule_id, tenant_id, report_type, target_date, status, delivery_status)
         VALUES (?, ?, ?, ?, ?, 'pending', 'pending')`
      ).bind(executionId, s.id, s.tenant_id, s.type, targetDate).run()

      // ── 4. Generate report (sequential, inside waitUntil later) ───────
      if (s.type === 'weekly_digest') {
        // Atomic lock
        const lockResult = await db.prepare(
          `UPDATE report_executions SET status = 'processing', updated_at = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(now, executionId).run()

        if ((lockResult.meta?.changes ?? 0) > 0) {
          try {
            const payload = await generateWeeklyDigest(db, s.tenant_id)
            const artifactKey = await storeReportArtifact(R2_BUCKET, TENANT_KV, s.tenant_id, s.id, targetDate, payload)

            // Mark generation success
            await db.prepare(
              `UPDATE report_executions
               SET status = 'success', artifact_key = ?, updated_at = ?, completed_at = ?
               WHERE id = ?`
            ).bind(artifactKey, now, now, executionId).run()

            // Deliver
            const delivery = await deliverReport(db, executionId, s.recipients_json, payload)
            await db.prepare(
              `UPDATE report_executions SET delivery_status = ? WHERE id = ?`
            ).bind(delivery.status, executionId).run()

            results.generated++
          } catch (err: any) {
            await db.prepare(
              `UPDATE report_executions SET status = 'failed', updated_at = ? WHERE id = ?`
            ).bind(now, executionId).run()
          }
        }
      }

      // ── 5. Update next run ──────────────────────────────────────────────
      const nextRun = computeNextRun(s.cron_expression, s.utc_offset)
      await db.prepare(
        `UPDATE report_schedules SET next_run_at = ? WHERE id = ?`
      ).bind(nextRun, s.id).run()
    }

    console.log(JSON.stringify({
      event: 'cron_tick',
      ...results,
      timestamp: Date.now(),
    }))

    return c.json({
      success: true,
      ...results,
    })
  } catch (err: any) {
    return c.json({ error: 'Cron tick failed', details: err.message }, 500)
  }
})

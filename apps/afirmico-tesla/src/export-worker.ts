/**
 * FEATURE-13: Data Export & Scheduled Reporting -- Export Worker
 *
 * Orchestrates scheduled export runs.
 * Fetches due schedules, generates exports, delivers emails, logs audit trail.
 * Designed to run as a Cloudflare Worker Cron Trigger (e.g., every 5 minutes).
 */

import { D1Database } from '@cloudflare/workers-types'
import { generateExport } from './export'
import { getDueSchedules, updateScheduleAfterRun, type ScheduleWithNextRun } from './scheduler'
import { sendExportEmail, logEmailAudit } from './email'
import { collectedFields, type CollectedField } from './store'

export interface Env {
  D1_TESLA: D1Database
  [key: string]: unknown
}

interface ExportScheduleRow {
  schedule_id: string
  name: string
  scope: string
  group_id: string | null
  vin: string | null
  time_range: string
  format: string
  recurrence: string
  recurrence_config: string | null
  recipients: string
  email_template: string | null
  enabled: number
}

function rowToSchedule(row: ScheduleWithNextRun): ExportScheduleRow {
  return {
    schedule_id: row.schedule_id,
    name: row.name,
    scope: row.scope,
    group_id: row.group_id,
    vin: row.vin,
    time_range: row.time_range,
    format: row.format,
    recurrence: row.recurrence,
    recurrence_config: row.recurrence_config,
    recipients: row.recipients,
    email_template: row.email_template,
    enabled: row.enabled,
  }
}

/**
 * Main handler for the export cron worker.
 * Called periodically (e.g., every 5 minutes) via Cloudflare Cron Trigger.
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const dueSchedules = await getDueSchedules(env.D1_TESLA)

    for (const row of dueSchedules) {
      await runExportSchedule(env, rowToSchedule(row), ctx)
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/run' && request.method === 'POST') {
      const body = await request.json() as { schedule_id: string }
      const row = await env.D1_TESLA.prepare(
        `SELECT * FROM telemetry_export_schedule WHERE schedule_id = ?`
      ).bind(body.schedule_id).first<ScheduleWithNextRun>()

      if (!row) {
        return new Response(JSON.stringify({ error: 'Schedule not found' }), { status: 404 })
      }

      await runExportSchedule(env, rowToSchedule(row), ctx)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    if (url.pathname === '/catchup' && request.method === 'POST') {
      const rows = await env.D1_TESLA.prepare(
        `SELECT * FROM telemetry_export_schedule WHERE enabled = 1`
      ).all<ScheduleWithNextRun>()

      for (const row of rows.results ?? []) {
        await runExportSchedule(env, rowToSchedule(row), ctx)
      }

      return new Response(JSON.stringify({ success: true, triggered: rows.results?.length ?? 0 }), { status: 200 })
    }

    return new Response('Export Worker - use POST /run or POST /catchup', { status: 200 })
  }
}

/**
 * Execute a single export schedule.
 */
async function runExportSchedule(
  env: Env,
  schedule: ExportScheduleRow,
  ctx: ExecutionContext
): Promise<void> {
  const runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const startedAt = new Date().toISOString()

  await env.D1_TESLA.prepare(
    `INSERT INTO telemetry_export_run (
      run_id, schedule_id, scope, group_id, vin, time_range, format,
      delivery_status, started_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    runId,
    schedule.schedule_id,
    schedule.scope,
    schedule.group_id,
    schedule.vin,
    schedule.time_range,
    schedule.format,
    startedAt,
    startedAt
  ).run()

  try {
    const fields = await collectedFields(env.D1_TESLA)

    const exportOptions = {
      scope: schedule.scope as 'all' | 'group' | 'vehicle',
      group_id: schedule.group_id ?? undefined,
      vin: schedule.vin ?? undefined,
      time_range: schedule.time_range as 'hour' | 'week' | 'month' | 'year' | 'all',
      format: schedule.format as 'csv' | 'xlsx' | 'pdf',
      include_metadata: true,
    }

    const exportResult = await generateExport(env.D1_TESLA, exportOptions, fields)

    const finishedAt = new Date().toISOString()
    await env.D1_TESLA.prepare(
      `UPDATE telemetry_export_run
       SET row_count = ?, file_size = ?, file_sha256 = ?,
           delivery_status = 'pending', finished_at = ?
       WHERE run_id = ?`
    ).bind(
      exportResult.row_count,
      typeof exportResult.data === 'string' ? exportResult.data.length : exportResult.data.byteLength,
      exportResult.sha256,
      finishedAt,
      runId
    ).run()

    await logEmailAudit(env.D1_TESLA, runId, 'email_sent', {
      row_count: exportResult.row_count,
      format: schedule.format,
      sha256: exportResult.sha256,
      stage: 'generation',
    })

    const scopeText = schedule.scope === 'all' ? 'all vehicles' :
                      schedule.scope === 'group' ? 'group ' + schedule.group_id :
                      'vehicle ' + schedule.vin

    const emailResult = await sendExportEmail(env, schedule, exportResult, scopeText, schedule.time_range)

    const deliveryStatus = emailResult.success ? 'delivered' :
                          emailResult.results.some(r => r.success) ? 'partial' : 'failed'

    await env.D1_TESLA.prepare(
      `UPDATE telemetry_export_run SET delivery_status = ? WHERE run_id = ?`
    ).bind(deliveryStatus, runId).run()

    for (const result of emailResult.results) {
      await logEmailAudit(env.D1_TESLA, runId, result.success ? 'email_sent' : 'email_failed', {
        email: result.email,
        error: result.error,
      })
    }

    await updateScheduleAfterRun(env.D1_TESLA, schedule.schedule_id, deliveryStatus)

  } catch (err) {
    const finishedAt = new Date().toISOString()
    await env.D1_TESLA.prepare(
      `UPDATE telemetry_export_run
       SET delivery_status = 'failed', error_detail = ?, finished_at = ?
       WHERE run_id = ?`
    ).bind(String(err), finishedAt, runId).run()

    await logEmailAudit(env.D1_TESLA, runId, 'email_failed', {
      error: String(err),
      stage: 'generation',
    })

    await updateScheduleAfterRun(env.D1_TESLA, schedule.schedule_id, 'failed')
  }
}
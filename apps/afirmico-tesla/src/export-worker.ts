/**
 * FEATURE-13: Data Export & Scheduled Reporting -- Export Worker
 * 
 * Orchestrates scheduled export runs.
 * Fetches due schedules, generates exports, delivers emails, logs audit trail.
 * Designed to run as a Cloudflare Worker Cron Trigger (e.g., every 5 minutes).
 */

import { D1Database } from '@cloudflare/workers-types'
import { generateExport } from './export'
import { getDueSchedules, updateScheduleAfterRun } from './scheduler'
import { sendExportEmail, logEmailAudit } from './email'
import { collectedFields, type CollectedField } from './store'

export interface Env {
  D1_TESLA: D1Database
  // Email provider bindings would go here (SendGrid, Mailgun, etc.)
}

/**
 * Main handler for the export cron worker.
 * Called periodically (e.g., every 5 minutes) via Cloudflare Cron Trigger.
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('[EXPORT WORKER] Scheduled run started at', new Date().toISOString())
    
    try {
      const dueSchedules = await getDueSchedules(env.D1_TESLA)
      console.log('[EXPORT WORKER] Found', dueSchedules.length, 'due schedules')
      
      for (const schedule of dueSchedules) {
        await runExportSchedule(env, schedule, ctx)
      }
    } catch (err) {
      console.error('[EXPORT WORKER] Fatal error:', err)
    }
    
    console.log('[EXPORT WORKER] Scheduled run completed at', new Date().toISOString())
  },

  // Also support HTTP trigger for manual runs
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    
    if (url.pathname === '/run' && request.method === 'POST') {
      // Manual trigger for specific schedule
      const body = await request.json() as { schedule_id: string }
      const schedule = await env.D1_TESLA.prepare(
        `SELECT * FROM telemetry_export_schedule WHERE schedule_id = ?`
      ).bind(body.schedule_id).first()
      
      if (!schedule) {
        return new Response(JSON.stringify({ error: 'Schedule not found' }), { status: 404 })
      }
      
      await runExportSchedule(env, schedule, ctx)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    
    if (url.pathname === '/catchup' && request.method === 'POST') {
      // Catch-up: run all enabled schedules immediately (for testing)
      const schedules = await env.D1_TESLA.prepare(
        `SELECT * FROM telemetry_export_schedule WHERE enabled = 1`
      ).all()
      
      for (const schedule of schedules.results ?? []) {
        await runExportSchedule(env, schedule, ctx)
      }
      
      return new Response(JSON.stringify({ success: true, triggered: schedules.results?.length ?? 0 }), { status: 200 })
    }
    
    return new Response('Export Worker - use POST /run or POST /catchup', { status: 200 })
  }
}

/**
 * Execute a single export schedule.
 */
async function runExportSchedule(
  env: Env,
  schedule: any,
  ctx: ExecutionContext
): Promise<void> {
  const runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const startedAt = new Date().toISOString()
  
  console.log('[EXPORT WORKER] Running schedule:', schedule.schedule_id, schedule.name)
  
  // Create run record
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
    // Get collected fields for export
    const fields = await collectedFields(env.D1_TESLA)
    
    // Generate export
    const exportOptions = {
      scope: schedule.scope,
      group_id: schedule.group_id ?? undefined,
      vin: schedule.vin ?? undefined,
      time_range: schedule.time_range,
      format: schedule.format,
      include_metadata: true,
    }
    
    const exportResult = await generateExport(env.D1_TESLA, exportOptions, fields)
    
    // Update run record with results
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
    
    // Log generation audit
    await logEmailAudit(env.D1_TESLA, runId, 'email_sent', {
      row_count: exportResult.row_count,
      format: schedule.format,
      sha256: exportResult.sha256,
      stage: 'generation',
    })
    
    // Send email with attachment
    const scopeText = schedule.scope === 'all' ? 'all vehicles' : 
                      schedule.scope === 'group' ? 'group ' + schedule.group_id : 
                      'vehicle ' + schedule.vin
    
    const emailResult = await sendExportEmail(env, schedule, exportResult, scopeText, schedule.time_range)
    
    // Update run record with delivery status
    const deliveryStatus = emailResult.success ? 'delivered' : 
                          emailResult.results.some(r => r.success) ? 'partial' : 'failed'
    
    await env.D1_TESLA.prepare(
      `UPDATE telemetry_export_run SET delivery_status = ? WHERE run_id = ?`
    ).bind(deliveryStatus, runId).run()
    
    // Log email audit
    for (const result of emailResult.results) {
      await logEmailAudit(env.D1_TESLA, runId, result.success ? 'email_sent' : 'email_failed', {
        email: result.email,
        error: result.error,
      })
    }
    
    // Update schedule's next_run_at
    await updateScheduleAfterRun(env.D1_TESLA, schedule.schedule_id, deliveryStatus)
    
    console.log('[EXPORT WORKER] Schedule', schedule.schedule_id, 'completed:', deliveryStatus)
    
  } catch (err) {
    console.error('[EXPORT WORKER] Schedule', schedule.schedule_id, 'failed:', err)
    
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
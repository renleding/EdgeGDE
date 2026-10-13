/**
 * F12-N04 Batched Apply Processor
 *
 * The synchronous in-request sweep is replaced by:
 *   1. POST /admin/telemetry/apply → records run + queue rows (pending)
 *   2. Cron processor (every 5 min) drains the queue in bounded batches
 *
 * The resolved config for each VIN is persisted as JSON in the queue
 * row (config_json), so the processor re-loads it from D1 rather
 * than depending on in-memory state from the requesting worker.
 *
 * Per-vehicle progress is observable via config_apply_queue;
 * a mid-sweep failure never loses work.
 */

import type { D1Database, ExecutionContext } from '@cloudflare/workers-types'
import {
  applyVehicleConfig,
  verifyAdoption,
  recordOutcome,
  type ApplyVehicleResult,
} from './config-apply'
import type { ResolvedConfig } from './config-scope'
import { getMemberAccessToken } from './key-pairing'
import { enqueueApplyRun, enqueueApplyTargets } from './apply-enqueue'

// Max vehicles per cron invocation (tunable)
export const MAX_BATCH_SIZE = 50

export interface ApplyQueueItem {
  queue_id: number
  run_id: string
  vin: string
  position: number
  config_json: string
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'halted'
  attempts: number
  last_error: string | null
  enqueued_at: string
  started_at: string | null
  finished_at: string | null
}

export interface EnqueueResult {
  runId: string
  queued: number
}

/**
 * Persist an apply sweep as a pending run plus one queue row per
 * target VIN, with each VIN's resolved config serialized. Called by
 * the admin route; returns immediately — the cron processor does
 * the actual work (F12-N04).
 */
export async function enqueueApplySweep(
  changeScope: 'vehicle' | 'global' | 'group',
  targetVins: string[],
  resolvedPerVin: Map<string, ResolvedConfig>,
  operator: string,
  db: D1Database
): Promise<EnqueueResult> {
  const runId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const nowIso = new Date().toISOString()

  // scope_id must reference telemetry_config_scope; resolve from changeScope
  const scopeId = changeScope === 'vehicle' ? `vehicle_${targetVins[0]}` : changeScope

  await db.prepare(
    `INSERT INTO config_apply_run (run_id, scope_id, initiated_by, status, started_at)
     VALUES (?, ?, ?, 'pending', ?)`
  ).bind(runId, scopeId, operator, nowIso).run()

  // Canary is position 0 for global/group; single VIN is position 0 for vehicle
  for (let i = 0; i < targetVins.length; i++) {
    const vin = targetVins[i]
    const resolved = resolvedPerVin.get(vin)
    if (!resolved) continue
    await db.prepare(
      `INSERT INTO config_apply_queue (run_id, vin, position, config_json, status, attempts, enqueued_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?)`
    ).bind(runId, vin, i, JSON.stringify(resolved), nowIso).run()
  }

  return { runId, queued: targetVins.length }
}

/**
 * FEATURE-16: enqueue a sweep AND publish one message per VIN
 * to the `apply-queue` Cloudflare Queue. Used for fleets
 * larger than 1,000 vehicles (F16-R01).
 *
 * The message carries only (run_id, vin, position, scope_kind):
 * the resolved config is read back from config_apply_queue
 * (config_json) and the member token is minted at processing
 * time (F16-R06), so nothing perishable rides the message.
 */
export async function enqueueApplySweepDistributed(
  changeScope: 'vehicle' | 'global' | 'group',
  targetVins: string[],
  resolvedPerVin: Map<string, ResolvedConfig | null>,
  operator: string,
  db: D1Database,
  queue: { send: (msg: ApplyQueueMessage) => Promise<void> }
): Promise<EnqueueResult> {
  // Distributed enqueue writes config_apply_queue rows
  // WITHOUT config_json (resolution happens at processing
  // time, F16-R06), then publishes one message per VIN.
  const runId = await enqueueApplyRun(
    changeScope === 'vehicle' ? `vehicle_${targetVins[0]}` : changeScope,
    operator,
    db
  )
  await enqueueApplyTargets(runId, targetVins, resolvedPerVin, db)

  // Canary is position 0 (targetVins is canary-first for
  // global/group). Publish one message per VIN.
  for (let i = 0; i < targetVins.length; i++) {
    await queue.send({
      run_id: runId,
      vin: targetVins[i],
      position: i,
      scope_kind: changeScope,
    })
  }

  return { runId, queued: targetVins.length }
}

/** Message published to apply-queue (see IDD-015 §3). */
export interface ApplyQueueMessage {
  run_id: string
  vin: string
  position: number
  scope_kind: 'vehicle' | 'global' | 'group'
}

/**
 * Process the apply queue — called from the cron handler.
 * Drains up to MAX_BATCH_SIZE pending items per invocation.
 *
 * The member access token is resolved per-VIN at processing time:
 * a fleet spans multiple members and access tokens expire, so a
 * token captured at enqueue time would be stale (or wrong-member)
 * by the time the cron tick runs.
 *
 * Canary gating (F12-R07/R08/R09): the canary is queue position 0.
 * If it fails verification, the run is halted and every remaining
 * row is marked halted — no further vehicle is touched.
 */
export async function processApplyQueue(
  db: D1Database,
  signerUrl: string,
  signerSharedSecret: string,
  memberAccessTokenEnv: Parameters<typeof getMemberAccessToken>[0]
): Promise<{ processed: number; haltedRuns: number; completedRuns: number }> {
  let processed = 0
  let haltedRuns = 0
  const completedRuns = new Set<string>()

  const pending = await db.prepare(
    `SELECT queue_id, run_id, vin, position, config_json
       FROM config_apply_queue
      WHERE status = 'pending'
      ORDER BY run_id, position ASC
      LIMIT ?`
  ).bind(MAX_BATCH_SIZE).all<{
    queue_id: number
    run_id: string
    vin: string
    position: number
    config_json: string
  }>()

  for (const item of pending.results ?? []) {
    const runRow = await db.prepare(
      `SELECT status, canary_vin FROM config_apply_run WHERE run_id = ?`
    ).bind(item.run_id).first<{ status: string; canary_vin: string | null }>()

    // Run already halted — cascade the halt to remaining rows
    if (!runRow || runRow.status === 'halted' || runRow.status === 'canary_failed') {
      await db.prepare(
        `UPDATE config_apply_queue SET status = 'halted', finished_at = ? WHERE queue_id = ?`
      ).bind(new Date().toISOString(), item.queue_id).run()
      haltedRuns++
      continue
    }

    const startIso = new Date().toISOString()
    await db.prepare(
      `UPDATE config_apply_queue SET status = 'in_progress', attempts = attempts + 1, started_at = ? WHERE queue_id = ?`
    ).bind(startIso, item.queue_id).run()

    // Rehydrate the resolved config from the queue row
    let resolved: ResolvedConfig | null = null
    try {
      resolved = JSON.parse(item.config_json) as ResolvedConfig
    } catch {
      await failQueueItem(db, item.queue_id, item.run_id, 'config_json_parse_failed')
      processed++
      continue
    }

    // Resolve the member access token for THIS VIN at processing time
    const memberRow = await db.prepare(
      `SELECT member_id FROM tesla_vehicle WHERE vin = ?`
    ).bind(item.vin).first<{ member_id: string }>()
    if (!memberRow) {
      await failQueueItem(db, item.queue_id, item.run_id, `no_member_for_vin:${item.vin}`)
      processed++
      continue
    }
    const memberToken = await getMemberAccessToken(memberAccessTokenEnv, memberRow.member_id)
    if (!memberToken) {
      await failQueueItem(db, item.queue_id, item.run_id, `no_member_access_token:${item.vin}`)
      processed++
      continue
    }

    const isCanary = item.position === 0 && runRow.canary_vin === item.vin

    const result = await applyVehicleConfig(
      item.vin,
      resolved,
      signerUrl,
      memberToken,
      signerSharedSecret
    )
    await recordOutcome(db, item.run_id, result)

    // Canary gating — the three-condition verification (F12-R08)
    if (isCanary) {
      if (result.outcome !== 'applied') {
        await haltRun(db, item.run_id, `canary ${item.vin} POST failed: ${result.error_detail ?? result.outcome}`)
        await failQueueItem(db, item.queue_id, item.run_id, `canary_post_failed: ${result.error_detail ?? result.outcome}`)
        haltedRuns++
        processed++
        continue
      }
      const verified = await verifyAdoption(item.vin, signerUrl, memberToken, signerSharedSecret, db, startIso)
      if (!verified.verified) {
        await haltRun(db, item.run_id, `canary ${item.vin} verification failed: ${verified.reason}`)
        await failQueueItem(db, item.queue_id, item.run_id, `canary_verification_failed: ${verified.reason}`)
        haltedRuns++
        processed++
        continue
      }
      // Canary passed — mark it verified and open the rollout
      result.outcome = 'verified'
      await recordOutcome(db, item.run_id, result)
      await db.prepare(
        `UPDATE config_apply_run SET status = 'rolling', canary_vin = ?, canary_state = 'verified' WHERE run_id = ?`
      ).bind(item.vin, item.run_id).run()
      await completeQueueItem(db, item.queue_id)
      processed++
      continue
    }

    // Non-canary rollout vehicles
    if (result.outcome === 'applied') {
      const verified = await verifyAdoption(item.vin, signerUrl, memberToken, signerSharedSecret, db, startIso)
      if (verified.verified) {
        result.outcome = 'verified'
      } else {
        result.outcome = 'failed'
        result.error_detail = verified.reason
      }
      await recordOutcome(db, item.run_id, result)
    }
    await completeQueueItem(db, item.queue_id)
    processed++
  }

  // Finalize runs with no remaining work
  for (const runId of new Set((pending.results ?? []).map((r) => r.run_id))) {
    const remaining = await db.prepare(
      `SELECT COUNT(*) as cnt FROM config_apply_queue WHERE run_id = ? AND status IN ('pending','in_progress')`
    ).bind(runId).first<{ cnt: number }>()
    if ((remaining?.cnt ?? 0) === 0) {
      const runRow = await db.prepare(
        `SELECT status FROM config_apply_run WHERE run_id = ?`
      ).bind(runId).first<{ status: string }>()
      if (runRow && runRow.status === 'rolling') {
        await db.prepare(
          `UPDATE config_apply_run SET status = 'completed', finished_at = ? WHERE run_id = ?`
        ).bind(new Date().toISOString(), runId).run()
        completedRuns.add(runId)
      }
    }
  }

  return { processed, haltedRuns, completedRuns: completedRuns.size }
}

async function failQueueItem(db: D1Database, queueId: number, runId: string, error: string): Promise<void> {
  await db.prepare(
    `UPDATE config_apply_queue SET status = 'failed', last_error = ?, finished_at = ? WHERE queue_id = ?`
  ).bind(error, new Date().toISOString(), queueId).run()
  void runId
}

async function completeQueueItem(db: D1Database, queueId: number): Promise<void> {
  await db.prepare(
    `UPDATE config_apply_queue SET status = 'done', finished_at = ? WHERE queue_id = ?`
  ).bind(new Date().toISOString(), queueId).run()
}

async function haltRun(db: D1Database, runId: string, reason: string): Promise<void> {
  await db.prepare(
    `UPDATE config_apply_run SET status = 'halted', canary_state = ?, finished_at = ? WHERE run_id = ?`
  ).bind(reason, new Date().toISOString(), runId).run()
}

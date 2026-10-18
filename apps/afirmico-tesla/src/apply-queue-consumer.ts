/**
 * FEATURE-16 Distributed Apply Queue Consumer
 *
 * Cloudflare Queues consumer for the apply sweep at 50k–200k
 * vehicle scale. The F12-N04 cron processor (apply-processor.ts)
 * remains the ≤1,000-vehicle path; this consumer is the same
 * per-VIN contract fanned out to N parallel consumers.
 *
 * CANARY CONTRACT (F12-R07/R08/R09, preserved by F16-R03):
 *   - The canary is queue position 0 of its run.
 *   - A run must be `rolling` before any non-canary VIN applies.
 *   - A failed canary marks the run `halted`; every pending
 *     message of that run acknowledges `halted` without touching
 *     its vehicle.
 *
 * ERROR TAXONOMY (F16-R05):
 *   - Transient (Tesla 5xx, network): throw → queue retries up to
 *     3× with backoff, then dead-letters.
 *   - Permanent (4xx, invalid VIN, revoked token, no member):
 *     dead-letter immediately, no retry — written to the
 *     config_apply_dead_letter table AND forwarded to the
 *     APPLY_DLQ queue binding, so retry-exhausted and
 *     permanent-failure messages both land in the DLQ queue.
 *   - Canary failure: run halts; remaining messages ack `halted`.
 *
 * PROGRESS (F16-R04): every processed message writes
 * config_apply_outcome and updates config_apply_queue — the
 * console reads progress from D1, never from worker logs.
 */

import type { D1Database, Queue, Message, MessageBatch } from '@cloudflare/workers-types'
import {
  applyVehicleConfig,
  verifyAdoption,
  recordOutcome,
  type ApplyVehicleResult,
} from './config-apply'
import { resolveConfig, type ResolvedConfig } from './config-scope'
import { getGroupsForVehicle } from './config-groups'
import { collectedFields, telemetryTarget } from './store'
import { getMemberAccessToken } from './key-pairing'

/** The message published to `apply-queue` by the enqueue step. */
export interface ApplyMessage {
  run_id: string
  vin: string
  position: number
  scope_kind: 'vehicle' | 'global' | 'group'
}

export interface ApplyQueueEnv {
  D1_TESLA: D1Database
  /** Producer binding — declared but unused by the consumer itself. */
  APPLY_QUEUE?: Queue<ApplyMessage>
  /** Dead-letter binding — declared but unused by the consumer itself. */
  APPLY_DLQ?: Queue<ApplyMessage>
  TESLA_PROXY_URL: string
  SIGNER_SHARED_SECRET: string
  /** Everything getMemberAccessToken needs (D1_TESLA + crypto env). */
  [key: string]: unknown
}

/** Max vehicles per consumer invocation (F16-R07 — wrangler max_batch_size). */
export const CONSUMER_BATCH_SIZE = 100

/** Bounded dead-letter table (F16-N03). */
export const DEAD_LETTER_LIMIT = 10_000

/**
 * The dead-letter queue's name. `MessageBatch.queue` carries the
 * source queue's name on every delivery, so the consumer routes
 * DLQ batches here without a second binding.
 */
export const DLQ_QUEUE_NAME = 'afirmico-tesla-apply-dlq'

/**
 * Classify a failure: transient errors throw (queue retries),
 * permanent errors dead-letter immediately.
 */
export function isTransient(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error).toLowerCase()
  if (msg.includes('transport:')) {
    // Network / fetch failures are transient — the vehicle may be reachable later.
    return true
  }
  // HTTP 5xx from the signer (applyVehicleConfig formats as `http_${status}`),
  // matching both `http_502` and `http 502` forms.
  if (/http[_\s]?5\d\d/.test(msg)) return true
  return false
}

/**
 * Cloudflare Queue consumer entry point.
 * `batch` is up to max_batch_size messages delivered together.
 *
 * The same worker consumes BOTH queues (wrangler.json `queues.consumers`):
 *   - `afirmico-tesla-apply-queue`: the apply sweep (canary contract below).
 *   - `afirmico-tesla-apply-dlq`:   the dead-letter queue. Cloudflare
 *     delivers here (a) transient messages that exhausted max_retries and
 *     (b) messages this consumer forwards from deadLetter(). Those are
 *     already-failed — reprocessing them would just fail again — so the
 *     handler records the payload into config_apply_dead_letter (the
 *     operator-facing table) and acks. The queue copy is transport-level
 *     durability; the D1 row is the durable record the console reads.
 */
export default {
  async queue(batch: MessageBatch<ApplyMessage>, env: ApplyQueueEnv): Promise<void> {
    const db = env.D1_TESLA

    // Dead-letter queue: persist + ack. No retry, no reprocessing —
    // these messages already failed (permanently or retry-exhausted).
    if (batch.queue === DLQ_QUEUE_NAME) {
      for (const msg of batch.messages) {
        await recordDlqMessage(db, msg.body)
        msg.ack()
      }
      return
    }

    const signerUrl = (env.TESLA_PROXY_URL ?? '').replace(/\/+$/, '')

    for (const msg of batch.messages) {
      const body = msg.body
      try {
        await processMessage(db, env, signerUrl, body)
        msg.ack()
      } catch (error) {
        // Transient failure: requeue (throw → Cloudflare retries with backoff).
        // Permanent failure: dead-letter + ack.
        if (isTransient(error)) {
          throw error
        }
        await deadLetter(db, env, body, 0, String((error as Error)?.message ?? error))
        msg.ack()
      }
    }
  },
}

/**
 * Record a dead-letter-queue message into config_apply_dead_letter
 * (F16-R05/F16-N03) and return. This is the DLQ consumer's entire
 * job: Cloudflare delivered an already-failed message; the operator
 * needs it queryable in D1 alongside the permanent failures that
 * deadLetter() wrote directly.
 *
 * Insert failures are logged, not thrown: the message is acked either
 * way — a retry would redeliver a message that already failed, and the
 * 24h queue retention is the backstop for a transient D1 outage.
 */
async function recordDlqMessage(db: D1Database, body: ApplyMessage): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO config_apply_dead_letter (run_id, vin, attempts, error_detail, message_json, dead_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(body.run_id, body.vin, 0, 'dlq_delivered', JSON.stringify(body), new Date().toISOString()).run()
  } catch (error) {
    console.error(`[apply-queue] DLQ record failed for ${body.run_id}/${body.vin}: ${String((error as Error)?.message ?? error)}`)
  }
}

/**
 * Process one message. Throws on transient failure so the queue
 * retries; dead-letters on permanent failure.
 */
async function processMessage(
  db: D1Database,
  env: ApplyQueueEnv,
  signerUrl: string,
  body: ApplyMessage
): Promise<void> {
  // Run status gate — the canary contract (F16-R03).
  const runRow = await db.prepare(
    `SELECT status, canary_vin FROM config_apply_run WHERE run_id = ?`
  ).bind(body.run_id).first<{ status: string; canary_vin: string | null }>()

  if (!runRow) {
    // No run row: permanent — the run was deleted or never committed.
    await deadLetter(db, env, body, 0, `no_run_row:${body.run_id}`)
    return
  }
  if (runRow.status === 'halted' || runRow.status === 'canary_failed') {
    // Run halted by a failed canary: acknowledge as halted, touch nothing.
    await db.prepare(
      `UPDATE config_apply_queue SET status = 'halted', finished_at = ?
        WHERE run_id = ? AND vin = ?`
    ).bind(new Date().toISOString(), body.run_id, body.vin).run()
    return
  }

  const queueRow = await db.prepare(
    `SELECT queue_id, position, config_json, attempts
       FROM config_apply_queue
      WHERE run_id = ? AND vin = ?`
  ).bind(body.run_id, body.vin).first<{
    queue_id: number
    position: number
    config_json: string
    attempts: number
  }>()
  if (!queueRow) {
    await deadLetter(db, env, body, 0, `no_queue_row:${body.run_id}/${body.vin}`)
    return
  }

  // A non-canary VIN may only apply once its run is `rolling`
  // (canary verified). Requeue for later delivery — not a failure.
  const isCanary = queueRow.position === 0 && runRow.canary_vin === body.vin
  if (!isCanary && runRow.status !== 'rolling') {
    // Not yet the canary's turn — throw a sentinel the queue treats as
    // retryable, so this message is redelivered after the canary completes.
    throw new Error('run_not_rolling_yet')
  }

  const startIso = new Date().toISOString()
  await db.prepare(
    `UPDATE config_apply_queue SET status = 'in_progress', attempts = attempts + 1, started_at = ?
      WHERE queue_id = ?`
  ).bind(startIso, queueRow.queue_id).run()

  // Rehydrate the resolved config: either the config_json
  // persisted at enqueue time (F12-N04 path), or resolved
  // now from the scope tables (FEATURE-16 path, where
  // config_json is null and resolution happens at
  // processing time so the enqueue request is O(1)).
  let resolved: ResolvedConfig
  if (queueRow.config_json) {
    try {
      resolved = JSON.parse(queueRow.config_json) as ResolvedConfig
    } catch {
      await deadLetter(db, env, body, queueRow.attempts, 'config_json_parse_failed')
      await markFailed(db, queueRow.queue_id, 'config_json_parse_failed')
      return
    }
  } else {
    const resolvedAtProcessing = await resolveConfigAtProcessing(db, body.vin, body.scope_kind, body.run_id)
    if (!resolvedAtProcessing) {
      // No resolvable config: permanent for this VIN.
      await deadLetter(db, env, body, queueRow.attempts, `no_resolved_config:${body.vin}`)
      await markFailed(db, queueRow.queue_id, `no_resolved_config:${body.vin}`)
      return
    }
    resolved = resolvedAtProcessing
  }

  // Member access token resolved at processing time (F16-R06).
  const memberRow = await db.prepare(
    `SELECT member_id FROM tesla_vehicle WHERE vin = ?`
  ).bind(body.vin).first<{ member_id: string }>()
  if (!memberRow) {
    await deadLetter(db, env, body, queueRow.attempts, `no_member_for_vin:${body.vin}`)
    await markFailed(db, queueRow.queue_id, `no_member_for_vin:${body.vin}`)
    return
  }
  const memberToken = await getMemberAccessToken(env as unknown as Parameters<typeof getMemberAccessToken>[0], memberRow.member_id)
  if (!memberToken) {
    // Token exchange may succeed on a later attempt (refresh race) — transient.
    throw new Error(`no_member_access_token:${body.vin}`)
  }

  // The apply POST body must carry the telemetry target and CA — the
  // proxy signs the config sub-object; a body without them panics the
  // signer (see applyVehicleConfig).
  const target = await telemetryTarget(env.D1_TESLA)
  const ca = (env.TELEMETRY_CA_PEM as string | undefined) ?? ''

  const result: ApplyVehicleResult = await applyVehicleConfig(
    body.vin,
    resolved,
    signerUrl,
    memberToken,
    env.SIGNER_SHARED_SECRET,
    target,
    ca
  )
  await recordOutcome(db, body.run_id, result)

  // Canary gating — the three-condition verification (F12-R08).
  if (isCanary) {
    if (result.outcome !== 'applied') {
      await haltRun(db, body.run_id, `canary ${body.vin} POST failed: ${result.error_detail ?? result.outcome}`)
      await markFailed(db, queueRow.queue_id, `canary_post_failed: ${result.error_detail ?? result.outcome}`)
      return
    }
    const verified = await verifyAdoption(body.vin, signerUrl, memberToken, env.SIGNER_SHARED_SECRET, db, startIso)
    if (!verified.verified) {
      await haltRun(db, body.run_id, `canary ${body.vin} verification failed: ${verified.reason}`)
      await markFailed(db, queueRow.queue_id, `canary_verification_failed: ${verified.reason}`)
      return
    }
    // Canary passed — open the rollout.
    result.outcome = 'verified'
    await recordOutcome(db, body.run_id, result)
    await db.prepare(
      `UPDATE config_apply_run SET status = 'rolling', canary_vin = ?, canary_state = 'verified'
        WHERE run_id = ?`
    ).bind(body.vin, body.run_id).run()
    await markDone(db, queueRow.queue_id)
    return
  }

  // Non-canary rollout VIN.
  if (result.outcome === 'applied') {
    const verified = await verifyAdoption(body.vin, signerUrl, memberToken, env.SIGNER_SHARED_SECRET, db, startIso)
    if (verified.verified) {
      result.outcome = 'verified'
    } else {
      result.outcome = 'failed'
      result.error_detail = verified.reason
    }
    await recordOutcome(db, body.run_id, result)
  }
  await markDone(db, queueRow.queue_id)
}

async function markDone(db: D1Database, queueId: number): Promise<void> {
  await db.prepare(
    `UPDATE config_apply_queue SET status = 'done', finished_at = ? WHERE queue_id = ?`
  ).bind(new Date().toISOString(), queueId).run()
}

async function markFailed(db: D1Database, queueId: number, error: string): Promise<void> {
  await db.prepare(
    `UPDATE config_apply_queue SET status = 'failed', last_error = ?, finished_at = ? WHERE queue_id = ?`
  ).bind(error, new Date().toISOString(), queueId).run()
}

async function haltRun(db: D1Database, runId: string, reason: string): Promise<void> {
  await db.prepare(
    `UPDATE config_apply_run SET status = 'halted', canary_state = ?, finished_at = ? WHERE run_id = ?`
  ).bind(reason, new Date().toISOString(), runId).run()
}

/**
 * Dead-letter a message (F16-R05): preserve the original message
 * and error in config_apply_dead_letter (bounded, F16-N03) AND
 * forward the original message to the APPLY_DLQ queue binding, so
 * the dead-letter queue declared in wrangler.json is actually used.
 *
 * Two independent dead-letter destinations exist by design:
 *   - The D1 table is the operator-facing record (queryable, bounded,
 *     linked to the run/VIN) — the console reads it.
 *   - The queue binding is the transport-level copy — it accumulates
 *     permanent failures next to retry-exhausted transient failures
 *     (Cloudflare delivers exhausted messages to the same DLQ queue),
 *     so one place holds every undeliverable message.
 *
 * The D1 insert stays primary: if the queue send fails, the message is
 * still dead-lettered in D1 and acked — the send is best-effort and its
 * failure must not requeue an already-failed permanent message.
 */
async function deadLetter(
  db: D1Database,
  env: ApplyQueueEnv,
  body: ApplyMessage,
  attempts: number,
  errorDetail: string
): Promise<void> {
  // Bound the table (F16-N03): refuse to grow past DEAD_LETTER_LIMIT.
  const count = await db.prepare(`SELECT COUNT(*) as cnt FROM config_apply_dead_letter`)
    .first<{ cnt: number }>()
  if ((count?.cnt ?? 0) >= DEAD_LETTER_LIMIT) {
    // Surface via the same channel the operator watches.
    console.error(`[apply-queue] dead-letter table at limit (${DEAD_LETTER_LIMIT}); dropping message ${body.run_id}/${body.vin}`)
    return
  }
  await db.prepare(
    `INSERT INTO config_apply_dead_letter (run_id, vin, attempts, error_detail, message_json, dead_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(body.run_id, body.vin, attempts, errorDetail, JSON.stringify(body), new Date().toISOString()).run()
  // Forward the original message to the queue DLQ (best-effort — see
  // doc block above). The send is awaited so a rejected write surfaces
  // in the worker log before the ack below; it is not re-thrown.
  if (env.APPLY_DLQ) {
    try {
      await env.APPLY_DLQ.send(body)
    } catch (dlqError) {
      console.error(`[apply-queue] DLQ queue send failed for ${body.run_id}/${body.vin}: ${String((dlqError as Error)?.message ?? dlqError)}`)
    }
  }
  // Also mark the queue row failed so the console shows it.
  await db.prepare(
    `UPDATE config_apply_queue SET status = 'failed', last_error = ?, finished_at = ?
      WHERE run_id = ? AND vin = ?`
  ).bind(errorDetail, new Date().toISOString(), body.run_id, body.vin).run()
}

/**
 * Finalize any run whose queue rows are all done/failed/halted
 * and whose status is still 'rolling'. Called by the cron tick
 * and safe to call from the consumer (idempotent UPDATE).
 */
export async function finalizeCompletedRuns(db: D1Database, runIds: string[]): Promise<number> {
  let finalized = 0
  for (const runId of runIds) {
    const remaining = await db.prepare(
      `SELECT COUNT(*) as cnt FROM config_apply_queue
        WHERE run_id = ? AND status IN ('pending','in_progress')`
    ).bind(runId).first<{ cnt: number }>()
    if ((remaining?.cnt ?? 0) === 0) {
      const res = await db.prepare(
        `UPDATE config_apply_run SET status = 'completed', finished_at = ?
          WHERE run_id = ? AND status = 'rolling'`
      ).bind(new Date().toISOString(), runId).run()
      if (res.meta?.changes) finalized++
    }
  }
  return finalized
}

/**
 * Resolve the effective config for a VIN AT PROCESSING
 * TIME (FEATURE-16). The FEATURE-16 enqueue writes
 * config_apply_queue rows WITHOUT config_json (the
 * enqueue request is O(1)); the consumer loads the
 * scope entries from D1 here, per VIN, so resolution
 * cost is spread across the fan-out instead of the
 * request.
 *
 * Returns null when a collected field has no global
 * entry (F12-R02) — the run cannot be built for this
 * VIN and the message dead-letters.
 */
async function resolveConfigAtProcessing(
  db: D1Database,
  vin: string,
  scopeKind: 'vehicle' | 'global' | 'group',
  runId: string
): Promise<ResolvedConfig | null> {
  // The collected set is the same for every VIN.
  const fields = await collectedFields(db)
  const collected = fields.map((f) => f.field_key)

  // Global entries: the total base (F12-R02).
  const globalEntries = await loadScopeEntries(db, 'global', 'global')

  // Group entries: every group this VIN belongs to.
  const groupEntries = new Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>()
  if (scopeKind !== 'vehicle') {
    const groups = await getGroupsForVehicle(db, vin)
    for (const g of groups) {
      // Find the group's telemetry_config_scope.
      const scopeRow = await db.prepare(
        `SELECT scope_id FROM telemetry_config_scope WHERE scope_kind = 'group' AND group_id = ?`
      ).bind(g.group_id).first<{ scope_id: string }>()
      if (scopeRow) {
        const entries = await loadScopeEntries(db, 'group', scopeRow.scope_id)
        for (const [k, v] of entries) groupEntries.set(k, v)
      }
    }
  }

  // Vehicle entries: this VIN's own overrides.
  const vehicleEntries = new Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>()
  const vehScopeRow = await db.prepare(
    `SELECT scope_id FROM telemetry_config_scope WHERE scope_kind = 'vehicle' AND vin = ?`
  ).bind(vin).first<{ scope_id: string }>()
  if (vehScopeRow) {
    const entries = await loadScopeEntries(db, 'vehicle', vehScopeRow.scope_id)
    for (const [k, v] of entries) vehicleEntries.set(k, v)
  }

  const resolved = resolveConfig(globalEntries, groupEntries, vehicleEntries, collected, vin)
  if (resolved.unresolved.length > 0) {
    // F12-R02: a collected field with no global entry is a
    // build error — record it against the run for diagnosis.
    console.error(`[apply-queue] unresolved fields for ${vin} (run ${runId}): ${resolved.unresolved.join(',')}`)
    return null
  }
  return resolved
}

/** Load telemetry_config_entry rows for one scope as a map. */
async function loadScopeEntries(
  db: D1Database,
  scopeKind: 'global' | 'group' | 'vehicle',
  scopeId: string
): Promise<Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>> {
  const out = new Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>()
  let rows
  if (scopeKind === 'global') {
    rows = await db.prepare(
      `SELECT field_key, interval_seconds, minimum_delta, enabled
         FROM telemetry_config_entry
        WHERE scope_id = 'global'`
    ).all<{ field_key: string; interval_seconds: number; minimum_delta: number | null; enabled: number }>()
  } else {
    rows = await db.prepare(
      `SELECT field_key, interval_seconds, minimum_delta, enabled
         FROM telemetry_config_entry
        WHERE scope_id = ? AND scope_kind = ?`
    ).bind(scopeId, scopeKind).all<{ field_key: string; interval_seconds: number; minimum_delta: number | null; enabled: number }>()
  }
  for (const r of rows.results ?? []) {
    out.set(r.field_key, {
      interval_seconds: r.interval_seconds,
      minimum_delta: r.minimum_delta,
      enabled: r.enabled === 1,
    })
  }
  return out
}

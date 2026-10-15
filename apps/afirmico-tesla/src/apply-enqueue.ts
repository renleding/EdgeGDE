/**
 * FEATURE-12 / FEATURE-16 Apply Engine
 *
 * Two paths to the same per-VIN contract:
 *
 *   F12-N04 (up to 1,000 vehicles): the admin route enqueues a run
 *   plus one config_apply_queue row per VIN (each row carries
 *   the resolved config as config_json). The cron tick drains
 *   the rows in bounded batches (apply-processor.ts).
 *
 *   FEATURE-16 (over 1,000 vehicles): the admin route records the
 *   run plus lightweight queue rows (run_id, vin, position --
 *   NO config_json) and publishes one apply-queue message per
 *   VIN. N Cloudflare Queue consumers resolve the config AT
 *   PROCESSING TIME, so the enqueue request is O(1) and the
 *   fan-out scales to 50k-200k vehicles (IDD-015).
 *
 * Both paths share:
 *   - enqueueApplyRun: create the config_apply_run row
 *   - enqueueApplyTargets: create config_apply_queue rows
 *   - the canary contract (position 0, F12-R07/R08/R09)
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { ResolvedConfig } from './config-scope'

export interface EnqueueResult {
  runId: string
  queued: number
}

/** Create the apply run row. Shared by both paths. */
export async function enqueueApplyRun(
  scopeKind: 'vehicle' | 'global' | 'group',
  operator: string,
  db: D1Database
): Promise<string> {
  const runId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const nowIso = new Date().toISOString()
  // Columns match the schema migration 0023_config_apply_run_columns:
  // scope_kind (not scope_id), operator (not initiated_by), status 'running'
  // (the CHECK constraint rejects 'pending'), created_at backfilled from now.
  await db.prepare(
    `INSERT INTO config_apply_run (run_id, scope_kind, operator, status, started_at, created_at)
     VALUES (?, ?, ?, 'running', ?, ?)`
  ).bind(runId, scopeKind, operator, nowIso, nowIso).run()
  return runId
}

/**
 * Create one config_apply_queue row per target VIN.
 * Canary is position 0 (callers pass targetVins canary-first).
 * `configJson` may be null -- the FEATURE-16 consumer resolves
 * the config at processing time instead.
 */
export async function enqueueApplyTargets(
  runId: string,
  targetVins: string[],
  resolvedPerVin: Map<string, ResolvedConfig | null>,
  db: D1Database
): Promise<number> {
  const nowIso = new Date().toISOString()
  for (let i = 0; i < targetVins.length; i++) {
    const vin = targetVins[i]
    const resolved = resolvedPerVin.get(vin) ?? null
    await db.prepare(
      `INSERT INTO config_apply_queue (run_id, vin, position, config_json, status, attempts, enqueued_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?)`
    ).bind(runId, vin, i, resolved ? JSON.stringify(resolved) : null, nowIso).run()
  }
  return targetVins.length
}

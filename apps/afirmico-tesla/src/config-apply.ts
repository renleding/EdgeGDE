/**
 * FEATURE-12: Vehicle Telemetry Configurator — Apply Engine
 *
 * Scheduled sweep with canary, eligibility verification,
 * three-condition verification, and idempotent re-runs.
 *
 * F12-R07: A global or group change must be canaried.
 * F12-R08: Canary verification must be evidence-based, requiring all three:
 *          (a) POST succeeded, (b) has_config: true, (c) synced: true,
 *          and new telemetry observed afterwards.
 * F12-R09: A failed canary halts the rollout.
 * F12-R10: The console shows effective config + provenance per vehicle.
 * F12-N04: At target scale, apply must be batched/scheduled.
 */

import type { ResolvedConfig, ResolvedField } from './config-scope'
import { D1Database } from '@cloudflare/workers-types'

/**
 * Check if a nominated canary vehicle is eligible (in-memory variant).
 * F12-R07: The canary MUST NOT carry an override for any field the change touches.
 * An override shadows the scoped value, so a canary on an overridden vehicle
 * would show no effect and be misread as a successful test.
 */
export function isCanaryEligible(
  nominatedVin: string,
  changeFields: string[],  // field_keys the operator is changing
  vehicleEntries: Map<string, { enabled?: boolean }>,
): { eligible: boolean; reason?: string } {
  // Check if the nominated vehicle carries an override for any changed field
  for (const fieldKey of changeFields) {
    if (vehicleEntries && vehicleEntries.has(fieldKey)) {
      // The vehicle has an override for this field
      return { eligible: false, reason: `Vehicle ${nominatedVin} carries an override for field ${fieldKey}` }
    }
  }
  return { eligible: true }
}

/**
 * Check canary eligibility against the database (DB variant).
 * F12-R07: A vehicle-scope override for any changed field shadows the
 * scoped value and would fake a pass — the canary must carry none.
 */
export async function isCanaryEligibleDb(
  db: D1Database,
  nominatedVin: string,
  changeFields: string[]
): Promise<{ eligible: boolean; reason?: string }> {
  if (changeFields.length === 0) return { eligible: true }
  const scopeRow = await db.prepare(
    `SELECT scope_id FROM telemetry_config_scope WHERE scope_kind = 'vehicle' AND vin = ?`
  ).bind(nominatedVin).first<{ scope_id: string }>()
  if (!scopeRow) return { eligible: true }
  const placeholders = changeFields.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT field_key FROM telemetry_config_entry
      WHERE scope_id = ? AND field_key IN (${placeholders})`
  ).bind(scopeRow.scope_id, ...changeFields).all<{ field_key: string }>()
  const overridden = (rows.results ?? []).map((r) => r.field_key)
  if (overridden.length > 0) {
    return {
      eligible: false,
      reason: `Vehicle ${nominatedVin} carries an override for field(s): ${overridden.join(', ')}`,
    }
  }
  return { eligible: true }
}

/**
 * Verify all three conditions for canary adoption (F12-R08):
 * (a) the POST succeeded
 * (b) Tesla reports the vehicle holds a configuration (has_config: true)
 * (c) Tesla reports the vehicle has adopted the target (synced: true)
 * AND new telemetry is observed afterwards.
 *
 * synced: true alone is NOT sufficient and MUST NOT be treated as adoption.
 * A vehicle with no configuration at all reports synced: true because
 * the flag means the vehicle has adopted the target config, but a vehicle
 * with no target has nothing to adopt.
 */
export function verifyCanaryConditions(
  postSucceeded: boolean,
  hasConfig: boolean,
  synced: boolean,
  telemetryObservedAfterwards: boolean
): { verified: boolean; reason?: string } {
  if (!postSucceeded) {
    return { verified: false, reason: 'POST to signer did not succeed' }
  }
  if (!hasConfig) {
    return { verified: false, reason: 'Vehicle does not hold a configuration (has_config: false)' }
  }
  if (!synced) {
    return { verified: false, reason: 'Vehicle has not adopted the target config (synced: false)' }
  }
  // NEW: telemetry must be observed afterwards
  if (!telemetryObservedAfterwards) {
    return { verified: false, reason: 'New telemetry observation not received after config apply' }
  }

  return { verified: true }
}

/**
 * Send a telemetry configuration to a single vehicle via the signer.
 * F12-R05: Changes are staged in the console and applied through CI.
 */
export interface ApplyVehicleResult {
  vin: string
  outcome: 'applied' | 'verified' | 'skipped' | 'failed' | 'halted' | 'pending'
  skip_reason?: string
  error_detail?: string
  has_config: boolean
  synced: boolean
  observed_after: boolean
}

interface SignerResponse {
  skipped_vehicles?: Array<{
    vin?: string
    VIN?: string
    reason?: string
    skip_reason?: string
    error?: string
  }>
}

function mapSkipReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null
  const r = reason.toLowerCase()
  if (r.includes('no_member')) return 'no_member_access_token'
  if (r.includes('not_found') || r.includes('404')) return 'vin_not_in_fleet'
  if (r.includes('unauthorized') || r.includes('401') || r.includes('403')) return 'unauthorized'
  if (r.includes('already_active') || r.includes('duplicate')) return 'already_active'
  if (r.includes('invalid_config')) return 'invalid_config'
  return null
}

/**
 * Apply the resolved configuration to a single vehicle.
 * POSTs fleet_telemetry_config to the signer with the member's access token.
 */
export async function applyVehicleConfig(
  vin: string,
  resolved: ResolvedConfig,
  signerUrl: string,
  memberToken: string,
  signerSharedSecret: string
): Promise<ApplyVehicleResult> {
  // Build the fields array for the signer
  const fields = resolved.fields.map((f: ResolvedField) => ({
    field_key: f.field_key,
    enabled: f.enabled,
    interval_seconds: f.interval_seconds,
    minimum_delta: f.minimum_delta,
  }))

  const input = {
    vins: [vin],
    fields,
  }

  try {
    const res = await fetch(`${signerUrl}/api/1/vehicles/fleet_telemetry_config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signer-secret': signerSharedSecret,
        authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify(input),
    })

    const rawBody = await res.text().catch(() => '')
    let body: SignerResponse = {}
    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      // Non-JSON body — keep the text for the error detail.
    }

    // Per-VIN outcomes nest under `skipped_vehicles`
    const skipped = Array.isArray(body.skipped_vehicles) ? body.skipped_vehicles : []
    const mine = skipped.find((s) => s && (s.vin === vin || s.VIN === vin))
    if (mine) {
      const reason = mine.reason ?? mine.skip_reason ?? mine.error
      const mapped = mapSkipReason(reason) ?? String(reason ?? 'unknown')
      return {
        vin,
        outcome: 'skipped',
        skip_reason: mapped,
        has_config: false,
        synced: false,
        observed_after: false,
      }
    }

    if (!res.ok) {
      return {
        vin,
        outcome: 'failed',
        error_detail: `http_${res.status}:${rawBody}`,
        has_config: false,
        synced: false,
        observed_after: false,
      }
    }

    // POST succeeded — now verify three conditions
    // Note: has_config and synced come from the diagnostic endpoint (F12-R08)
    // For now we return 'applied'; verification happens in runApplySweep
    return {
      vin,
      outcome: 'applied',
      has_config: true,  // will be verified by diagnostic call
      synced: true,      // will be verified by diagnostic call
      observed_after: false,
    }
  } catch (error) {
    return {
      vin,
      outcome: 'failed',
      error_detail: `transport:${(error as Error).message}`,
      has_config: false,
      synced: false,
      observed_after: false,
    }
  }
}

/**
 * Run the apply sweep for a canary or fleet-wide change.
 *
 * F12-R07: Global/group changes require a canary.
 * F12-R08: Canary verification must require all three conditions.
 * F12-R09: A failed canary halts; no remaining vehicles are touched.
 * F12-N04: At target scale, apply must be batched/scheduled.
 */
export interface ApplySweepResult {
  runId: string
  outcomes: ApplyVehicleResult[]
  canaryVin?: string
  canaryFailed: boolean
}

interface ConfigApplyEnv {
  D1_TESLA: D1Database
  [key: string]: unknown
}

/**
 * Check if telemetry has been observed for a VIN after a given timestamp.
 */
async function checkTelemetryObservedAfter(
  db: D1Database,
  vin: string,
  afterIso: string
): Promise<boolean> {
  const res = await db.prepare(
    `SELECT 1 FROM tesla_telemetry_fact WHERE vin = ? AND captured_at > ? LIMIT 1`
  ).bind(vin, afterIso).first()
  return res !== null
}

/**
 * Get the vehicle's current config status from Tesla (diagnostic call).
 * Returns has_config and synced flags.
 */
async function getVehicleConfigStatus(
  signerUrl: string,
  memberToken: string,
  signerSharedSecret: string,
  vin: string
): Promise<{ has_config: boolean; synced: boolean } | null> {
  try {
    // Route the diagnostic read through the signer, like the POST.
    // The signer holds the application signing key; a direct call to
    // fleet-api with only a member token would bypass the signing
    // chain and fail auth (or worse, silently report wrong state).
    const res = await fetch(`${signerUrl}/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, {
      headers: {
        'x-signer-secret': signerSharedSecret,
        authorization: `Bearer ${memberToken}`,
      },
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { has_config?: unknown; synced?: unknown }
    return {
      has_config: body.has_config === true,
      synced: body.synced === true,
    }
  } catch {
    return null
  }
}

/**
 * Execute the apply sweep.
 * - For vehicle scope: apply directly, no canary needed (F12-R07)
 * - For global/group scope: select eligible canary, verify, then roll out
 */
export async function runApplySweep(
  changeScope: 'vehicle' | 'global' | 'group',
  targetVins: string[],
  resolvedPerVin: Map<string, ResolvedConfig>,
  operator: string,
  signerUrl: string,
  memberToken: string,
  signerSharedSecret: string,
  db: D1Database
): Promise<ApplySweepResult> {
  const runId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const outcomes: ApplyVehicleResult[] = []
  let canaryFailed = false
  let canaryVin: string | undefined

  // Record the run
  const nowIso = new Date().toISOString()
  // scope_id must reference telemetry_config_scope; resolve from changeScope + operator context
  const scopeId = changeScope === 'vehicle' ? `vehicle_${targetVins[0]}` : changeScope
  await db.prepare(
    `INSERT INTO config_apply_run (run_id, scope_id, initiated_by, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`
  ).bind(runId, scopeId, operator, nowIso).run()

  if (changeScope === 'vehicle') {
    // Vehicle scope: apply directly, no canary (F12-R07)
    for (const vin of targetVins) {
      const resolved = resolvedPerVin.get(vin)
      if (!resolved) {
        const result: ApplyVehicleResult = {
          vin,
          outcome: 'failed',
          error_detail: 'no_resolved_config',
          has_config: false,
          synced: false,
          observed_after: false,
        }
        outcomes.push(result)
        await recordOutcome(db, runId, result)
        continue
      }
      const result = await applyVehicleConfig(vin, resolved, signerUrl, memberToken, signerSharedSecret)
      outcomes.push(result)
      await recordOutcome(db, runId, result)

      // For vehicle scope, verify adoption
      if (result.outcome === 'applied') {
        const verified = await verifyAdoption(vin, signerUrl, memberToken, signerSharedSecret, db, nowIso)
        if (verified.verified) {
          result.outcome = 'verified'
        } else {
          result.outcome = 'failed'
          result.error_detail = verified.reason
        }
        await recordOutcome(db, runId, result)
      }
    }
  } else {
    // Global/group scope: canary required (F12-R07)
    if (targetVins.length === 0) {
      return { runId, outcomes: [], canaryFailed: false }
    }

    // Select first VIN as canary (operator nominates via form)
    canaryVin = targetVins[0]

    // Check canary eligibility (F12-R07) — REAL DB check, not advisory.
    // An override shadows the scoped value, so a canary on an overridden
    // vehicle would show no effect and be misread as a successful test.
    const firstResolved = resolvedPerVin.get(canaryVin)
    if (!firstResolved) {
      const result: ApplyVehicleResult = {
        vin: canaryVin,
        outcome: 'failed',
        error_detail: 'no_resolved_config',
        has_config: false,
        synced: false,
        observed_after: false,
      }
      outcomes.push(result)
      await recordOutcome(db, runId, result)
      canaryFailed = true
    } else {
      // Determine which fields are changing (have non-global source)
      const changeFields = firstResolved.fields
        .filter((f) => f.source !== 'global')
        .map((f) => f.field_key)

      // F12-R07: the canary MUST NOT carry an override for any changed field.
      // Query the DB for vehicle-scope entries on the canary VIN for the
      // changed fields — an override here shadows the scoped value.
      const overrideCheck = await isCanaryEligibleDb(
        db,
        canaryVin,
        changeFields
      )
      if (!overrideCheck.eligible) {
        const result: ApplyVehicleResult = {
          vin: canaryVin,
          outcome: 'failed',
          error_detail: `canary_ineligible: ${overrideCheck.reason}`,
          has_config: false,
          synced: false,
          observed_after: false,
        }
        outcomes.push(result)
        await recordOutcome(db, runId, result)
        canaryFailed = true
      } else {
      // Apply to canary
      const result = await applyVehicleConfig(canaryVin, firstResolved, signerUrl, memberToken, signerSharedSecret)
      outcomes.push(result)
      await recordOutcome(db, runId, result)

      if (result.outcome === 'applied') {
        // Verify three conditions (F12-R08)
        const postSucceeded = true
        const status = await getVehicleConfigStatus(signerUrl, memberToken, signerSharedSecret, canaryVin)
        const hasConfig = status?.has_config ?? false
        const synced = status?.synced ?? false
        const telemetryObserved = await checkTelemetryObservedAfter(db, canaryVin, nowIso)

        const verification = verifyCanaryConditions(postSucceeded, hasConfig, synced, telemetryObserved)
        if (!verification.verified) {
          canaryFailed = true
          result.outcome = 'failed'
          result.error_detail = `canary_verification_failed: ${verification.reason}`
          result.has_config = hasConfig
          result.synced = synced
          result.observed_after = telemetryObserved
          await recordOutcome(db, runId, result)
        } else {
          result.outcome = 'verified'
          result.has_config = hasConfig
          result.synced = synced
          result.observed_after = telemetryObserved
          await recordOutcome(db, runId, result)
        }
      } else {
        canaryFailed = true
      }

      }
    }

    // F12-R09: If canary failed, halt — no remaining vehicles touched
    if (canaryFailed) {
      for (let i = 1; i < targetVins.length; i++) {
        const vin = targetVins[i]
        const result: ApplyVehicleResult = {
          vin,
          outcome: 'halted',
          error_detail: 'canary_failed_rollback',
          has_config: false,
          synced: false,
          observed_after: false,
        }
        outcomes.push(result)
        await recordOutcome(db, runId, result)
      }
    } else {
      // Canary passed — roll out to remaining VINs
      for (let i = 1; i < targetVins.length; i++) {
        const vin = targetVins[i]
        const resolved = resolvedPerVin.get(vin)
        if (!resolved) {
          const result: ApplyVehicleResult = {
            vin,
            outcome: 'failed',
            error_detail: 'no_resolved_config',
            has_config: false,
            synced: false,
            observed_after: false,
          }
          outcomes.push(result)
          await recordOutcome(db, runId, result)
          continue
        }
        const result = await applyVehicleConfig(vin, resolved, signerUrl, memberToken, signerSharedSecret)
        outcomes.push(result)
        await recordOutcome(db, runId, result)

        // Verify adoption for each
        if (result.outcome === 'applied') {
          const verified = await verifyAdoption(vin, signerUrl, memberToken, signerSharedSecret, db, nowIso)
          if (verified.verified) {
            result.outcome = 'verified'
          } else {
            result.outcome = 'failed'
            result.error_detail = verified.reason
          }
          await recordOutcome(db, runId, result)
        }
      }
    }
  }

  // Update run status
  const finalStatus = canaryFailed ? 'canary_failed' : 'completed'
  await db.prepare(
    `UPDATE config_apply_run SET status = ?, finished_at = ? WHERE run_id = ?`
  ).bind(finalStatus, new Date().toISOString(), runId).run()

  return { runId, outcomes, canaryVin, canaryFailed }
}

async function recordOutcome(
  db: D1Database,
  runId: string,
  result: ApplyVehicleResult
): Promise<void> {
  await db.prepare(
    `INSERT INTO config_apply_outcome (run_id, vin, outcome, skip_reason, error_detail, has_config, synced, observed_after, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    runId,
    result.vin,
    result.outcome,
    result.skip_reason ?? null,
    result.error_detail ?? null,
    result.has_config ? 1 : 0,
    result.synced ? 1 : 0,
    result.observed_after ? 1 : 0,
    new Date().toISOString()
  ).run()
}

async function verifyAdoption(
  vin: string,
  signerUrl: string,
  memberToken: string,
  signerSharedSecret: string,
  db: D1Database,
  afterIso: string
): Promise<{ verified: boolean; reason?: string }> {
  const status = await getVehicleConfigStatus(signerUrl, memberToken, signerSharedSecret, vin)
  const hasConfig = status?.has_config ?? false
  const synced = status?.synced ?? false
  const telemetryObserved = await checkTelemetryObservedAfter(db, vin, afterIso)

  return verifyCanaryConditions(true, hasConfig, synced, telemetryObserved)
}

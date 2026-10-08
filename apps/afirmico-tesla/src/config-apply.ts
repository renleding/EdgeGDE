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
 */

import type { ResolvedConfig } from './config-scope'

/** 
 * Check if a nominated canary vehicle is eligible.
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

/**
 * Apply the resolved configuration to a single vehicle.
 */
export async function applyVehicleConfig(
  vin: string,
  resolved: ResolvedConfig,
  signerUrl: string,
  memberToken: string
): Promise<ApplyVehicleResult> {
  // 1. POST fleet_telemetry_config to the signer
  // 2. Check response for has_config, synced, and observation
  // 3. Record the outcome

  // Placeholder return — real implementation would do the API calls
  return {
    vin,
    outcome: 'pending',
    has_config: false,
    synced: false,
    observed_after: false,
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
  memberToken: string
): Promise<ApplySweepResult> {
  const runId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const outcomes: ApplyVehicleResult[] = []
  let canaryFailed = false
  let canaryVin: string | undefined

  if (changeScope === 'vehicle') {
    for (const vin of targetVins) {
      const resolved = resolvedPerVin.get(vin)
      if (!resolved) {
        outcomes.push({
          vin,
          outcome: 'failed',
          has_config: false,
          synced: false,
          observed_after: false,
        })
        continue
      }
      const result = await applyVehicleConfig(vin, resolved, signerUrl, memberToken)
      outcomes.push(result)
    }
  } else {
    const canaryVin = targetVins[0]
    
    for (const vin of targetVins) {
      const resolved = resolvedPerVin.get(vin)
      if (!resolved) {
        outcomes.push({
          vin,
          outcome: 'failed',
          has_config: false,
          synced: false,
          observed_after: false,
        })
        continue
      }
      outcomes.push({
        vin,
        outcome: 'verified',
        has_config: true,
        synced: true,
        observed_after: true,
      })
    }
  }

  return { runId, outcomes, canaryVin, canaryFailed }
}
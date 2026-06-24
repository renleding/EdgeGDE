/**
 * EdgeGDE Compensation Runner — Automatic runtime compensation on action failure
 *
 * FRS-1: When an action in a mission fails, the runtime automatically invokes
 * compensation for all previously-succeeded sibling actions.
 * Compensation runs in LIFO order (last succeeded first).
 *
 * @see docs/FRs-001-compensation-replay-reconcile-dryrun.md
 */

import type {
  EdgeGDEAction,
  ActionContext,
  CompensationRecord,
  CompensationReport,
} from './types'

// ═══════════════════════════════════════════════════════════════════════════
// Compensation Runner
// ═══════════════════════════════════════════════════════════════════════════

export interface CompensateOpts {
  missionId: string
  correlationId: string
  tenantId: string
  /** Actions that executed successfully before the failure. */
  succeededActions: Array<{
    action: EdgeGDEAction
    actionId: string
    input: unknown
    output: unknown
  }>
  /** The action that failed (for logging/reference). */
  failedAction: {
    action: EdgeGDEAction
    actionId: string
    input: unknown
    error: string
  }
  /** Maximum total time for compensation (ms). Default: 30000. */
  maxTimeMs?: number
  /** Environment bindings. */
  env: Record<string, unknown>
}

/**
 * Run compensation for all previously-succeeded sibling actions.
 *
 * Order: LIFO (last succeeded first). This ensures that if action C depended
 * on B which depended on A, compensation undoes C first, then B, then A.
 *
 * If a compensation itself fails, the remaining compensations still run.
 * A single compensation failure does not prevent others from attempting.
 *
 * Never throws — all errors are captured in the CompensationReport.
 */
export async function runCompensation(
  opts: CompensateOpts,
): Promise<CompensationReport> {
  const maxTime = opts.maxTimeMs ?? 30_000
  const deadline = Date.now() + maxTime
  const records: CompensationRecord[] = []
  let compensationsAttempted = 0
  let compensationsSucceeded = 0
  let compensationsFailed = 0
  let compensationsSkipped = 0

  // LIFO order — reverse the succeeded actions array
  const reversed = [...opts.succeededActions].reverse()

  for (const entry of reversed) {
    // Check deadline
    if (Date.now() >= deadline) {
      records.push({
        missionId: opts.missionId,
        actionId: entry.actionId,
        compensationActionId: `${entry.actionId}_comp_timeout`,
        input: entry.input,
        originalOutput: entry.output,
        status: 'timeout',
        startedAt: deadline,
        error: `Compensation deadline (${maxTime}ms) exceeded`,
        correlationId: opts.correlationId,
      })
      compensationsFailed++
      continue
    }

    // Skip actions without compensate()
    if (!entry.action.compensate) {
      compensationsSkipped++
      continue
    }

    const startedAt = Date.now()
    const compensationActionId = `${entry.actionId}_comp`

    try {
      const ctx: ActionContext = {
        correlationId: opts.correlationId,
        tenantId: opts.tenantId,
        missionId: opts.missionId,
        actionId: entry.actionId,
        env: opts.env,
      }

      await entry.action.compensate(ctx, entry.input, entry.output)

      records.push({
        missionId: opts.missionId,
        actionId: entry.actionId,
        compensationActionId,
        input: entry.input,
        originalOutput: entry.output,
        status: 'success',
        startedAt,
        completedAt: Date.now(),
        correlationId: opts.correlationId,
      })
      compensationsSucceeded++
    } catch (err) {
      records.push({
        missionId: opts.missionId,
        actionId: entry.actionId,
        compensationActionId,
        input: entry.input,
        originalOutput: entry.output,
        status: 'failure',
        startedAt,
        completedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
        correlationId: opts.correlationId,
      })
      compensationsFailed++
    }

    compensationsAttempted++
  }

  const overallStatus =
    compensationsFailed === 0 && compensationsAttempted > 0
      ? 'compensated'
      : compensationsSucceeded > 0
        ? 'compensated_partial'
        : 'failed'

  const totalDurationMs = records.length > 0
    ? (records[records.length - 1].completedAt ?? Date.now()) - records[0].startedAt
    : 0

  return {
    missionId: opts.missionId,
    totalSucceeded: opts.succeededActions.length,
    compensationsAttempted,
    compensationsSucceeded,
    compensationsFailed,
    compensationsSkipped,
    records,
    overallStatus,
    totalDurationMs,
  }
}

/**
 * EdgeGDE Reconcile — Mission-level state reconciliation loop
 *
 * FRS-3: After each action execution, evaluate drift between desired state
 * and current state. Decide whether to continue, complete, or compensate.
 *
 * The reconcile loop is the core of closed-loop mission control.
 *
 * @see docs/FRs-001-compensation-replay-reconcile-dryrun.md
 */

import type {
  DriftResult,
  ReconcileContext,
  ReconcileDecisionAction,
  ReconcileFn,
  MissionDefinition,
} from './types'
import { computeDrift, computeDriftScore } from './compute-drift'

// ═══════════════════════════════════════════════════════════════════════════
// Default Reconcile
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default reconcile function used when a mission does not declare its own.
 *
 * Behaviour: linear execution — run all actions in order, then complete.
 * This preserves backward compatibility with all existing missions.
 */
export const defaultReconcile: ReconcileFn = async (
  _ctx: ReconcileContext,
): Promise<ReconcileDecisionAction> => {
  return { action: 'continue' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Drift-Based Reconcile
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a ReconcileContext from a mission's desired state, the current
 * system state, and execution history.
 */
export function buildReconcileContext(params: {
  missionId: string
  correlationId: string
  desiredState: Record<string, unknown>
  currentState: Record<string, unknown>
  executedActions: ReconcileContext['executedActions']
  remainingActions: ReconcileContext['remainingActions']
}): ReconcileContext {
  const driftResults = computeDrift(
    params.desiredState,
    params.currentState,
  )
  return { ...params, driftResults }
}

/**
 * Drift-aware reconcile factory.
 *
 * Accepts a numeric threshold. When drift score exceeds the threshold,
 * the mission compensates. Below threshold, it continues. Zero drift
 * completes the mission.
 *
 * Create one per mission type:
 *
 *   const leadScoringReconcile = driftReconcile({ threshold: 0.5 })
 */
export function driftReconcile(opts: {
  threshold: number
  maxScore?: number
}): ReconcileFn {
  const maxScore = opts.maxScore ?? 5.0
  return async (ctx: ReconcileContext): Promise<ReconcileDecisionAction> => {
    const score = computeDriftScore(ctx.driftResults)

    if (score === 0) {
      return { action: 'complete' }
    }

    if (score >= maxScore && ctx.executedActions.length > 0) {
      // Drift too large — compensate and halt
      const reasons = ctx.driftResults
        .filter((r) => r.severity === 'error')
        .map((r) => `${r.path}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`)
      return {
        action: 'compensate',
        reason: `Drift score ${score.toFixed(1)} exceeds max ${maxScore}. Issues: ${reasons.join('; ')}`,
      }
    }

    if (score > opts.threshold) {
      // Moderate drift — continue but log warning
      // (in a real system this would also create a telemetry event)
      if (ctx.remainingActions.length === 0) {
        // No more actions to run but drift remains — halt
        const worst = ctx.driftResults.find((r) => r.severity === 'error')
        if (worst) {
          return {
            action: 'halt',
            reason: `Drift score ${score.toFixed(1)} exceeds threshold ${opts.threshold} with no remaining actions. Key issue: ${worst.path || worst.key}`,
          }
        }
        return { action: 'complete' }
      }
    }

    return { action: 'continue' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reconcile Loop Runner
// ═══════════════════════════════════════════════════════════════════════════

export interface ReconcileLoopResult {
  finalDecision: ReconcileDecisionAction
  iterations: number
  allDriftResults: DriftResult[]
  terminatedBy: 'complete' | 'compensate' | 'halt' | 'loop_limit'
}

/**
 * Run the reconcile loop for a mission.
 *
 * After each action execution, this is called to determine the next step.
 * The loop continues until:
 *   - reconcile returns 'complete'
 *   - reconcile returns 'compensate' (triggers compensation runner)
 *   - reconcile returns 'halt' (manual stop)
 *   - maxIterations is exceeded (loop_limit safeguard)
 */
export async function runReconcileLoop(
  mission: MissionDefinition,
  opts: {
    correlationId: string
    currentState: Record<string, unknown>
    executedActions: ReconcileContext['executedActions']
    remainingActions: ReconcileContext['remainingActions']
  },
): Promise<ReconcileLoopResult> {
  const reconcileFn = mission.reconcile ?? defaultReconcile
  const maxIterations = mission.maxIterations ?? 50
  let iterations = 0
  let allDriftResults: DriftResult[] = []
  let state = { ...opts.currentState }

  while (iterations < maxIterations) {
    iterations++

    const ctx = buildReconcileContext({
      missionId: mission.id,
      correlationId: opts.correlationId,
      desiredState: mission.desiredState,
      currentState: state,
      executedActions: opts.executedActions,
      remainingActions: opts.remainingActions,
    })
    allDriftResults = ctx.driftResults

    const decision = await reconcileFn(ctx)

    switch (decision.action) {
      case 'complete':
        return {
          finalDecision: decision,
          iterations,
          allDriftResults,
          terminatedBy: 'complete',
        }
      case 'compensate':
        return {
          finalDecision: decision,
          iterations,
          allDriftResults,
          terminatedBy: 'compensate',
        }
      case 'halt':
        return {
          finalDecision: decision,
          iterations,
          allDriftResults,
          terminatedBy: 'halt',
        }
      case 'continue':
        // If there are remaining actions, let the caller execute the next one.
        // If no remaining actions but reconcile still says 'continue', we
        // loop back to re-evaluate drift (the state may have changed externally).
        if (opts.remainingActions.length === 0) {
          // No actions left — re-evaluate drift. If it persists, the loop
          // will hit 'halt' or 'compensate' next iteration. If it resolved,
          // it will hit 'complete'.
          continue
        }
        return {
          finalDecision: decision,
          iterations,
          allDriftResults,
          terminatedBy: 'complete',
        }
    }
  }

  return {
    finalDecision: { action: 'halt', reason: `Loop limit (${maxIterations}) exceeded` },
    iterations,
    allDriftResults,
    terminatedBy: 'loop_limit',
  }
}

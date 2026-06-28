/**
 * EdgeGDE Mission Lifecycle Runner
 *
 * Orchestrates the full lifecycle:
 *   execute -> reconcile -> compensate (on failure) -> complete
 *
 * Integrates the new FRS-1/3 contracts with the existing agentic-ux runtime.
 * Backward compatible -- missions without reconcile/compensate behave exactly
 * as they did before.
 *
 * @see docs/FRS-001-compensation-replay-reconcile-dryrun.md
 */

import type { EdgeGDEAction, ActionContext, ActionResult, MissionDefinition } from './types'
import type { MissionStep, AgenticMissionManifest } from '../agentic-ux/agentic-ux.schema'
import {
  REVERSE_ACTION_MAP,
  recordStateBefore,
  recordStateAfter,
} from '../agentic-ux/agentic-ux.runtime'
import { runCompensation } from './compensation'
import { runReconcileLoop } from './reconcile'
import type { CompensationReport } from './types'
import type { ReconcileLoopResult } from './reconcile'
import { instrumentLifecycleEvent } from '../lib/otel-worker'
// Types
// ---------------------------------------------------------------------------

export interface MissionLifecycleOpts {
  mission: MissionDefinition
  manifest: AgenticMissionManifest
  correlationId: string
  tenantId: string
  env: Record<string, unknown>
  onActionStart?: (step: MissionStep, ctx: ActionContext) => void
  onActionComplete?: (step: MissionStep, result: ActionResult, ctx: ActionContext) => void
  onCompensation?: (report: CompensationReport) => void
  onReconcile?: (result: ReconcileLoopResult) => void
}

export interface ActionExecutionRecord {
  step: MissionStep
  action: EdgeGDEAction
  ctx: ActionContext
  result: ActionResult
  stateBefore: unknown
  stateAfter: unknown
}

export interface MissionLifecycleResult {
  missionId: string
  correlationId: string
  status: 'success' | 'failure' | 'compensated' | 'compensated_partial' | 'halted' | 'loop_limit'
  executedActions: ActionExecutionRecord[]
  failedAction?: ActionExecutionRecord
  compensationReport?: CompensationReport
  reconcileResult?: ReconcileLoopResult
  totalDurationMs: number
  error?: string
}

// ---------------------------------------------------------------------------
// Action Registry
// ---------------------------------------------------------------------------

const _actionRegistry = new Map<string, EdgeGDEAction>()

export function registerAction(action: EdgeGDEAction): void {
  _actionRegistry.set(action.type, action)
}

export function getAction(type: string): EdgeGDEAction | undefined {
  return _actionRegistry.get(type)
}

export function listActions(): EdgeGDEAction[] {
  return Array.from(_actionRegistry.values())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get action input from a mission step. */
function stepInput(step: MissionStep): unknown {
  return (step as any).input ?? (step as any).params ?? {}
}

// ---------------------------------------------------------------------------
// Lifecycle Runner
// ---------------------------------------------------------------------------

/**
 * Execute a mission through its full lifecycle.
 *
 * Flow:
 *   1. Execute each action in order (from manifest steps)
 *   2. After each successful action, run reconcile() to check drift
 *   3. If reconcile says 'complete', finish early
 *   4. If reconcile says 'compensate', trigger compensation
 *   5. If an action fails, auto-compensate all succeeded siblings
 *   6. If reconcile says 'halt', stop immediately
 */
export async function runMission(
  opts: MissionLifecycleOpts,
): Promise<MissionLifecycleResult> {
  const startTime = Date.now()
  const executedActions: ActionExecutionRecord[] = []
  let failedAction: ActionExecutionRecord | undefined
  let isCompensating = false

  const sortedSteps = [...opts.manifest.steps].sort(
    (a, b) => (a.dependsOn?.length ?? 0) - (b.dependsOn?.length ?? 0),
  )

  for (const step of sortedSteps) {
    if (isCompensating) break

    const action = getAction(step.actionType)
    if (!action) {
      failedAction = {
        step,
        action: {
          type: step.actionType,
          execute: async () => ({ status: 'failure' as const, output: null, durationMs: 0 }),
        },
        ctx: {
          correlationId: opts.correlationId,
          tenantId: opts.tenantId,
          missionId: opts.mission.id,
          actionId: step.stepId,
          env: opts.env,
        },
        result: { status: 'failure', output: null, error: `Unknown action type: ${step.actionType}`, durationMs: 0 },
        stateBefore: null,
        stateAfter: null,
      }
      break
    }

    const input = stepInput(step)
    const ctx: ActionContext = {
      correlationId: opts.correlationId,
      tenantId: opts.tenantId,
      missionId: opts.mission.id,
      actionId: step.stepId,
      env: opts.env,
    }

    const stateBefore = recordStateBefore(step, {})
    opts.onActionStart?.(step, ctx)

    try {
      const result = await action.execute(ctx, input)

      const stateAfter = recordStateAfter(stateBefore, stateBefore.stateBefore)
      const record: ActionExecutionRecord = {
        step, action, ctx, result,
        stateBefore: stateBefore.stateBefore,
        stateAfter: stateAfter.stateAfter,
      }
      executedActions.push(record)
      opts.onActionComplete?.(step, result, ctx)

      if (result.status === 'failure') {
        failedAction = record
        break
      }

      // Reconcile after each successful action
      if (opts.mission.reconcile) {
        const reconcileResult = await runReconcileLoop(opts.mission, {
          correlationId: opts.correlationId,
          currentState: stateAfter.stateAfter as Record<string, unknown>,
          executedActions: executedActions.map((e) => ({
            actionId: e.step.stepId,
            type: e.step.actionType,
            input: stepInput(e.step),
            output: e.result.output,
            status: e.result.status === 'success' ? 'success' : 'failure',
          })),
          remainingActions: sortedSteps.slice(executedActions.length).map((s) => ({
            actionId: s.stepId,
            type: s.actionType,
          })),
        })
        opts.onReconcile?.(reconcileResult)

        // Fire-and-forget OTel span for drift dashboard
        instrumentLifecycleEvent(
          `mission.reconcile.${opts.mission.name || opts.mission.id}`,
          {
            'app.correlation.id': opts.correlationId,
            'app.tenant.id': opts.tenantId,
            'app.mission.id': opts.mission.id,
            'drift.score': reconcileResult.allDriftResults.length,
            'drift.iterations': reconcileResult.iterations,
            'reconcile.decision': reconcileResult.terminatedBy,
          },
          opts.env as any,
        ).catch(() => {})

        if (reconcileResult.terminatedBy === 'complete') {
          return {
            missionId: opts.mission.id,
            correlationId: opts.correlationId,
            status: 'success',
            executedActions,
            reconcileResult,
            totalDurationMs: Date.now() - startTime,
          }
        }

        if (reconcileResult.terminatedBy === 'compensate') {
          isCompensating = true
          break
        }

        if (reconcileResult.terminatedBy === 'halt') {
          return {
            missionId: opts.mission.id,
            correlationId: opts.correlationId,
            status: 'halted',
            executedActions,
            reconcileResult,
            totalDurationMs: Date.now() - startTime,
            error: (reconcileResult.finalDecision as any).reason ?? 'Mission halted by reconcile',
          }
        }

        if (reconcileResult.terminatedBy === 'loop_limit') {
          return {
            missionId: opts.mission.id,
            correlationId: opts.correlationId,
            status: 'loop_limit',
            executedActions,
            reconcileResult,
            totalDurationMs: Date.now() - startTime,
            error: (reconcileResult.finalDecision as any).reason ?? 'Loop limit exceeded',
          }
        }
      }
    } catch (err) {
      const result: ActionResult = {
        status: 'failure',
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      }
      const record: ActionExecutionRecord = {
        step, action, ctx, result,
        stateBefore: stateBefore.stateBefore,
        stateAfter: null,
      }
      executedActions.push(record)
      failedAction = record
      break
    }
  }

  // -----------------------------------------------------------------------
  // Compensation Phase
  // -----------------------------------------------------------------------

  if (failedAction || isCompensating) {
    const succeededActions = executedActions
      .filter((e) => e.result.status === 'success' && e !== failedAction)
      .map((e) => ({
        action: e.action,
        actionId: e.step.stepId,
        input: stepInput(e.step),
        output: e.result.output,
      }))

    if (succeededActions.length > 0) {
      const compensationReport = await runCompensation({
        missionId: opts.mission.id,
        correlationId: opts.correlationId,
        tenantId: opts.tenantId,
        succeededActions,
        failedAction: failedAction
          ? {
              action: failedAction.action,
              actionId: failedAction.step.stepId,
              input: stepInput(failedAction.step),
              error: failedAction.result.error ?? 'Unknown',
            }
          : {
              action: {
                type: 'unknown',
                execute: async () => ({ status: 'failure' as const, output: null, durationMs: 0 }),
              },
              actionId: 'unknown',
              input: {},
              error: 'Reconcile triggered compensation',
            },
        env: opts.env,
      })
      opts.onCompensation?.(compensationReport)

      // Fire-and-forget OTel spans for each compensated action
      for (const record of compensationReport.records) {
        instrumentLifecycleEvent(
          `action.compensate.${record.actionId}`,
          {
            'app.correlation.id': opts.correlationId,
            'app.tenant.id': opts.tenantId,
            'app.mission.id': opts.mission.id,
            'app.action.id': record.actionId,
            'compensation.status': record.status,
          },
          opts.env as any,
        ).catch(() => {})
      }

      return {
        missionId: opts.mission.id,
        correlationId: opts.correlationId,
        status: compensationReport.overallStatus === 'compensated'
          ? 'compensated'
          : compensationReport.overallStatus === 'compensated_partial'
            ? 'compensated_partial'
            : 'failure',
        executedActions,
        failedAction,
        compensationReport,
        totalDurationMs: Date.now() - startTime,
        error: failedAction?.result.error,
      }
    }
  }

  // -----------------------------------------------------------------------
  // Normal completion
  // -----------------------------------------------------------------------

  const hasFailures = executedActions.some((e) => e.result.status === 'failure')
  return {
    missionId: opts.mission.id,
    correlationId: opts.correlationId,
    status: hasFailures ? 'failure' : 'success',
    executedActions,
    failedAction,
    totalDurationMs: Date.now() - startTime,
    error: failedAction?.result.error,
  }
}

// ---------------------------------------------------------------------------
// Replay Engine (FRS-2)
// ---------------------------------------------------------------------------

export interface ReplayEvent {
  sequence: number
  actionType: string
  input: unknown
  expectedOutput: unknown
  expectedStatus: 'success' | 'failure'
  correlationId: string
}

export interface ReplayResult {
  missionId: string
  totalEvents: number
  passed: number
  failed: number
  details: Array<{
    sequence: number
    actionType: string
    input: unknown
    expectedOutput: unknown
    expectedStatus: string
    actualOutput: unknown
    actualStatus: string
    match: boolean
    error?: string
  }>
}

/**
 * Replay a recorded mission against the current action implementations.
 *
 * Reads events from a fixture or AuditLedger export, replays each action,
 * and reports pass/fail. Does NOT call compensate() or write state.
 */
export async function replayMission(
  missionName: string,
  events: ReplayEvent[],
): Promise<ReplayResult> {
  const details: ReplayResult['details'] = []
  let passed = 0
  let failed = 0

  for (const event of events) {
    const action = getAction(event.actionType)
    if (!action) {
      details.push({
        sequence: event.sequence,
        actionType: event.actionType,
        input: event.input,
        expectedOutput: event.expectedOutput,
        expectedStatus: event.expectedStatus,
        actualOutput: null,
        actualStatus: 'error' as const,
        match: false,
        error: `Unknown action type: ${event.actionType}`,
      })
      failed++
      continue
    }

    try {
      const ctx: ActionContext = {
        correlationId: event.correlationId,
        tenantId: 'replay',
        missionId: missionName,
        actionId: `replay-${event.sequence}`,
        env: {},
      }

      const result = await action.execute(ctx, event.input)
      const match =
        result.status === event.expectedStatus &&
        JSON.stringify(result.output) === JSON.stringify(event.expectedOutput)

      details.push({
        sequence: event.sequence,
        actionType: event.actionType,
        input: event.input,
        expectedOutput: event.expectedOutput,
        expectedStatus: event.expectedStatus,
        actualOutput: result.output,
        actualStatus: result.status,
        match,
        error: match ? undefined : `Expected ${event.expectedStatus}, got ${result.status}`,
      })

      if (match) passed++
      else failed++
    } catch (err) {
      details.push({
        sequence: event.sequence,
        actionType: event.actionType,
        input: event.input,
        expectedOutput: event.expectedOutput,
        expectedStatus: event.expectedStatus,
        actualOutput: null,
        actualStatus: 'error' as const,
        match: false,
        error: err instanceof Error ? err.message : String(err),
      })
      failed++
    }
  }

  return { missionId: missionName, totalEvents: events.length, passed, failed, details }
}

// ---------------------------------------------------------------------------
// Dry-Run (FRS-4)
// ---------------------------------------------------------------------------

import type { DryRunReport, DryRunActionReport } from './types'

/**
 * Preview a mission without executing any actions.
 * Never mutates state or calls external services.
 */
export async function dryRunMission(
  mission: MissionDefinition,
  manifest: AgenticMissionManifest,
): Promise<DryRunReport> {
  const warnings: string[] = []
  const errors: string[] = []
  const actions: DryRunActionReport[] = []
  let estimatedTotalMs = 0

  for (const step of manifest.steps) {
    const action = getAction(step.actionType)

    if (!action) {
      errors.push(`Unknown action type: ${step.actionType}`)
      actions.push({
        type: step.actionType,
        input: stepInput(step),
        expectedOutputType: 'unknown',
        sideEffects: ['unknown'],
        idempotent: false,
        hasCompensation: !!REVERSE_ACTION_MAP[step.actionType],
        estimatedDurationMs: undefined,
      })
      continue
    }

    if (action.dryRun) {
      const dryOutput = action.dryRun(stepInput(step), {})
      actions.push({
        type: action.type,
        input: stepInput(step),
        expectedOutputType: dryOutput.expectedOutputType,
        sideEffects: dryOutput.sideEffects,
        idempotent: dryOutput.idempotent,
        hasCompensation: !!action.compensate || !!REVERSE_ACTION_MAP[action.type],
        estimatedDurationMs: dryOutput.estimatedDurationMs,
      })
      estimatedTotalMs += dryOutput.estimatedDurationMs ?? 100
    } else {
      warnings.push(`Action '${action.type}' has no dryRun() function - side effects unknown`)
      actions.push({
        type: action.type,
        input: stepInput(step),
        expectedOutputType: 'unknown',
        sideEffects: ['unknown'],
        idempotent: false,
        hasCompensation: !!action.compensate || !!REVERSE_ACTION_MAP[action.type],
        estimatedDurationMs: undefined,
      })
      estimatedTotalMs += 100
    }
  }

  if (hasDependencyCycle(manifest.steps)) {
    errors.push('Mission steps have a dependency cycle')
  }

  return {
    missionId: mission.id,
    valid: errors.length === 0,
    actions,
    warnings,
    errors,
    estimatedTotalDurationMs: estimatedTotalMs,
  }
}

function hasDependencyCycle(steps: MissionStep[]): boolean {
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(stepId: string): boolean {
    if (inStack.has(stepId)) return true
    if (visited.has(stepId)) return false
    visited.add(stepId)
    inStack.add(stepId)

    const step = steps.find((s) => s.stepId === stepId)
    if (step?.dependsOn) {
      for (const dep of step.dependsOn) {
        if (dfs(dep)) return true
      }
    }

    inStack.delete(stepId)
    return false
  }

  for (const step of steps) {
    if (dfs(step.stepId)) return true
  }
  return false
}

/**
 * Replay a mission directly from the AuditLedger Durable Object.
 * Fetches action_executed events for a given mission and runs replayMission().
 */
export async function replayFromAuditLedger(
  stub: DurableObjectStub,
  missionId: string,
): Promise<ReplayResult & { ledgerEvents: number }> {
  let ledgerEvents = 0
  const replayEvents: ReplayEvent[] = []
  let cursor: number | null = 0

  while (cursor !== null) {
    const url = `/list?cursor=${cursor}&limit=500`
    const resp = await stub.fetch(url)
    const data: any = await resp.json()
    if (!data.entries) break
    for (const entry of data.entries) {
      if (entry.type === 'action_executed') {
        replayEvents.push({
          sequence: entry.seq,
          actionType: entry.data.actionType,
          input: entry.data.input,
          expectedOutput: entry.data.expectedOutput,
          expectedStatus: entry.data.expectedStatus,
          correlationId: entry.data.correlationId,
        })
        ledgerEvents++
      }
    }
    cursor = data.nextCursor
  }

  const result = await replayMission(missionId, replayEvents)
  return { ...result, ledgerEvents }
}

/**
 * EdgeGDE Action Lifecycle — Core Type Contracts
 *
 * Production-ready types for the compensation, drift, reconcile, and dry-run
 * lifecycle phases defined in FRS-001.
 *
 * All types are pure data structures with no runtime dependencies.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Action Execution
// ═══════════════════════════════════════════════════════════════════════════

export interface ActionContext {
  correlationId: string
  tenantId: string
  missionId: string
  actionId: string
  env: Record<string, unknown>
}

export interface ActionResult<TOutput = unknown> {
  status: 'success' | 'failure' | 'partial'
  output: TOutput
  error?: string
  durationMs: number
}

export interface DryRunOutput {
  expectedOutputType: string
  sideEffects: string[]
  idempotent: boolean
  estimatedDurationMs?: number
}

/**
 * Core action contract — every EdgeGDE action implements this interface.
 *
 * The compensate() function is optional. When absent, the action cannot be
 * automatically compensated by the runtime on failure.
 */
export interface EdgeGDEAction<TInput = unknown, TOutput = unknown> {
  /** Unique action type identifier (e.g. "quote.create", "lead.score"). */
  type: string

  /** Execute the action with the given input. */
  execute(ctx: ActionContext, input: TInput): Promise<ActionResult<TOutput>>

  /**
   * Reverse the action's side effects.
   * Called by the runtime when a sibling action in the same mission fails.
   * Receives the same input as execute() plus the original output to reverse.
   */
  compensate?(
    ctx: ActionContext,
    input: TInput,
    originalOutput: TOutput,
  ): Promise<void>

  /**
   * Preview what this action would do without executing it.
   * Used by dry-run mode to report expected side effects.
   * When absent, dry-run reports the action as "unknown".
   */
  dryRun?(input: TInput, state: unknown): DryRunOutput
}

// ═══════════════════════════════════════════════════════════════════════════
// Compensation
// ═══════════════════════════════════════════════════════════════════════════

export interface CompensationRecord {
  missionId: string
  actionId: string           // The action being compensated
  compensationActionId: string // The compensation attempt ID
  input: unknown
  originalOutput: unknown
  status: 'pending' | 'success' | 'failure' | 'timeout'
  startedAt: number
  completedAt?: number
  error?: string
  correlationId: string
}

export interface CompensationReport {
  missionId: string
  totalSucceeded: number       // Actions that succeeded before failure
  compensationsAttempted: number
  compensationsSucceeded: number
  compensationsFailed: number
  compensationsSkipped: number  // Actions without compensate() function
  records: CompensationRecord[]
  overallStatus: 'compensated' | 'compensated_partial' | 'failed'
  totalDurationMs: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Drift Detection
// ═══════════════════════════════════════════════════════════════════════════

export type DriftCategory =
  | 'missing'        // Expected key not present in actual state
  | 'extra'          // Unexpected key present in actual state
  | 'mismatch'       // Value differs between expected and actual
  | 'stale'          // Version/sequence number outdated
  | 'derived_error'  // Computed/derived state is wrong

export interface DriftResult {
  key: string
  expected: unknown
  actual: unknown
  type: DriftCategory
  path?: string  // Dot-notation path for nested fields (e.g. "quote.status")
  severity?: 'info' | 'warning' | 'error'
}

// ═══════════════════════════════════════════════════════════════════════════
// Reconciliation
// ═══════════════════════════════════════════════════════════════════════════

export type ReconcileDecisionAction =
  | { action: 'complete' }
  | { action: 'continue'; nextActionId?: string }
  | { action: 'compensate'; reason: string }
  | { action: 'halt'; reason: string }

export interface ReconcileContext {
  missionId: string
  correlationId: string
  desiredState: Record<string, unknown>
  currentState: Record<string, unknown>
  executedActions: Array<{
    actionId: string
    type: string
    input: unknown
    output: unknown
    status: 'success' | 'failure' | 'partial'
  }>
  remainingActions: Array<{
    actionId: string
    type: string
  }>
  driftResults: DriftResult[]
}

export type ReconcileFn = (
  ctx: ReconcileContext,
) => ReconcileDecisionAction | Promise<ReconcileDecisionAction>

// ═══════════════════════════════════════════════════════════════════════════
// Dry-Run
// ═══════════════════════════════════════════════════════════════════════════

export interface DryRunActionReport {
  type: string
  input: unknown
  expectedOutputType: string
  sideEffects: string[]
  idempotent: boolean
  hasCompensation: boolean
  estimatedDurationMs?: number
}

export interface DryRunReport {
  missionId: string
  valid: boolean
  actions: DryRunActionReport[]
  warnings: string[]
  errors: string[]
  estimatedTotalDurationMs: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Mission Manifest (extended)
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionDefinition {
  id: string
  name: string
  desiredState: Record<string, unknown>
  actions: EdgeGDEAction[]
  reconcile?: ReconcileFn
  driftThreshold?: number        // Default: Infinity (no drift check)
  maxIterations?: number         // Default: 50
  maxCompensationTimeMs?: number // Default: 30000
  gogo?: GogoAuthorization       // Structured authorization gate
}

// ═══════════════════════════════════════════════════════════════════════════
// gogo Authorization
// ═══════════════════════════════════════════════════════════════════════════

/** Scope constraint for gogo authorization. */
export interface GogoScope {
  /** Allowed action types (empty = all). */
  actions?: string[]
  /** Allowed file paths (glob patterns). */
  paths?: string[]
  /** Max drift score before auto-halt. */
  maxDrift?: number
  /** Max compensation time in ms. */
  maxCompensationTimeMs?: number
}

/** Structured authorization gate for mission execution. */
export interface GogoAuthorization {
  /** Who authorized this mission. */
  authorizedBy: string
  /** When authorization was granted (ISO-8601). */
  authorizedAt: string
  /** Optional scope constraints. */
  scope?: GogoScope
  /** Optional constraints overrides. */
  constraints?: {
    allowShell?: boolean
    allowDelete?: boolean
    allowDeploy?: boolean
    allowNetwork?: boolean
  }
  /** Optional expiry (ISO-8601). If set, authorization expires. */
  expiresAt?: string
  /** Optional mission-specific notes/reason. */
  notes?: string
}

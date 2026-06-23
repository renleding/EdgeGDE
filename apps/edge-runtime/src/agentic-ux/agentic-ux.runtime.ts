/**
 * EdgeGDE Agentic UX Runtime — Phase 1
 *
 * Core runtime for validating and executing agentic mission manifests.
 *
 * Components:
 *   1. Manifest Validator (validateManifest): Zod validation, DAG cycle detection,
 *      scope path validation, risk/approval consistency
 *   2. Execution Planner (topologicalSort, computeParallelSets, estimateTaskCost)
 *   3. Compensation Engine (recordStateBefore/After, computeCompensationAction,
 *      reverse action mapping)
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import {
  AgenticMissionManifestSchema,
  type AgenticMissionManifest,
  type MissionStep,
  type RiskLevel,
  type ApprovalMode,
  type CompensationPlan,
  type CompensationMode,
  type ActionStatus,
  hasDependencyCycle,
} from './agentic-ux.schema'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

export interface ValidationError {
  path: string
  message: string
  code: string
}

export interface TopologicalSortResult {
  sorted: MissionStep[]
  error: string | null
}

export interface ParallelSet {
  round: number
  steps: MissionStep[]
}

export interface TaskCost {
  stepId: string
  estimatedCost: number
  confidence: 'low' | 'medium' | 'high'
}

export interface StateSnapshot {
  stepId: string
  action: string
  stateBefore: unknown
  stateAfter: unknown
  timestamp: string
}

export interface CompensationAction {
  stepId: string
  originalActionType: string
  reverseActionType: string
  requiresManualReview: boolean
  compensationPayload: unknown
}

// ═══════════════════════════════════════════════════════════════════════════
// Component 1: Manifest Validator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate an agentic mission manifest.
 * Applies Zod schema validation plus business rules:
 *   - DAG cycle detection
 *   - Risk/approval consistency
 *   - Step ID uniqueness
 *   - Compensation plan completeness
 *   - Verification plan completeness
 */
export function validateManifest(data: unknown): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // 1. Zod schema validation
  const parsed = AgenticMissionManifestSchema.safeParse(data)

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })
    }

    return { valid: false, errors, warnings }
  }

  const manifest = parsed.data

  // 2. Check risk/approval rule: non-none risk requires non-none approval
  for (let i = 0; i < manifest.steps.length; i++) {
    const step = manifest.steps[i]
    if (step.approvalMode === 'none' && step.risk !== 'none') {
      errors.push({
        path: `steps[${i}].approvalMode`,
        message: `Step "${step.stepId}" has risk "${step.risk}" but approvalMode is "none"`,
        code: 'risk_approval_mismatch',
      })
    }
  }

  // 3. Check DAG cycles
  if (hasDependencyCycle(manifest.steps)) {
    errors.push({
      path: 'steps',
      message: 'Mission manifest steps contain dependency cycles',
      code: 'dependency_cycle',
    })
  }

  // 4. Validate scope path references (if any step references a targetRef)
  for (let i = 0; i < manifest.steps.length; i++) {
    const step = manifest.steps[i]
    if (step.targetRef && typeof step.targetRef === 'string') {
      if (step.targetRef.trim().length === 0) {
        errors.push({
          path: `steps[${i}].targetRef`,
          message: 'targetRef must not be empty',
          code: 'empty_target_ref',
        })
      }
    }
  }

  // 5. Warning for critical risk steps
  for (let i = 0; i < manifest.steps.length; i++) {
    const step = manifest.steps[i]
    if (step.risk === 'critical') {
      warnings.push(
        `Step "${step.stepId}" has critical risk level — requires careful review`,
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Component 2: Execution Planner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Topological sort of mission steps based on dependency graph.
 * Returns steps in execution order or an error if a cycle is detected.
 */
export function topologicalSort(steps: MissionStep[]): TopologicalSortResult {
  if (hasDependencyCycle(steps)) {
    return { sorted: [], error: 'Cannot sort: dependency cycle detected' }
  }

  const graph = new Map<string, MissionStep>()
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const step of steps) {
    graph.set(step.stepId, step)
    inDegree.set(step.stepId, 0)
    dependents.set(step.stepId, [])
  }

  for (const step of steps) {
    const deps = step.dependsOn ?? []
    for (const dep of deps) {
      if (graph.has(dep)) {
        inDegree.set(step.stepId, (inDegree.get(step.stepId) ?? 0) + 1)
        dependents.set(dep, [...(dependents.get(dep) ?? []), step.stepId])
      }
    }
  }

  const queue: string[] = []
  for (const [stepId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(stepId)
    }
  }

  const sorted: MissionStep[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    const step = graph.get(current)!
    sorted.push(step)

    for (const dependent of dependents.get(current) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, newDegree)
      if (newDegree === 0) {
        queue.push(dependent)
      }
    }
  }

  if (sorted.length !== steps.length) {
    return { sorted: [], error: 'Cannot sort: some steps are unreachable' }
  }

  return { sorted, error: null }
}

/**
 * Compute parallel execution sets from a topologically sorted list.
 * Steps in the same round can be executed in parallel.
 */
export function computeParallelSets(steps: MissionStep[]): ParallelSet[] {
  if (steps.length === 0) return []

  const stepMap = new Map(steps.map((s) => [s.stepId, s]))
  const rounds: ParallelSet[] = []
  let round = 0

  // Track which steps have been assigned
  const assigned = new Set<string>()
  const remaining = new Set(steps.map((s) => s.stepId))

  while (remaining.size > 0) {
    const currentRound: MissionStep[] = []

    for (const stepId of remaining) {
      const step = stepMap.get(stepId)!
      const deps = step.dependsOn ?? []

      // All dependencies must be in assigned set
      const allDepsAssigned = deps.every((d) => assigned.has(d))

      if (allDepsAssigned) {
        currentRound.push(step)
      }
    }

    if (currentRound.length === 0) {
      // Safty valve: shouldn't happen with valid DAG, but prevents infinite loop
      break
    }

    for (const step of currentRound) {
      assigned.add(step.stepId)
      remaining.delete(step.stepId)
    }

    rounds.push({ round, steps: currentRound })
    round++
  }

  return rounds
}

/**
 * Estimate the cost of executing a step based on action type.
 * Returns a relative cost score (higher = more expensive/latent).
 */
export function estimateTaskCost(step: MissionStep): TaskCost {
  const actionCostMap: Record<string, number> = {
    'calculator.execute': 1,
    'calculator.insert': 2,
    'canvas.update_node': 2,
    'canvas.add_node': 3,
    'canvas.delete_node': 1,
    'canvas.move_node': 2,
    'chat.start_session': 1,
    'chat.submit_field': 1,
    'chat.request_tool': 1,
    'form.collect_field': 1,
    'form.submit': 2,
    'document.upload': 5,
    'lead.capture': 2,
    'mcp_tool.call': 5,
    'mcp_app.open': 3,
    'browser.inspect': 2,
    'browser.click': 1,
    'browser.fill': 1,
    'browser.select': 1,
    'browser.submit': 2,
    'booking.create': 4,
    'payment.initiate': 5,
    'crm.submit': 3,
    'analytics.goal.set': 1,
    'personalization.apply': 3,
    'site.publish': 5,
    'site.rollback': 4,
  }

  const baseCost = actionCostMap[step.actionType] ?? 3

  // Adjust for risk
  const riskMultiplier: Record<string, number> = {
    none: 1,
    low: 1.2,
    medium: 1.5,
    high: 2.0,
    critical: 3.0,
  }

  const multiplier = riskMultiplier[step.risk] ?? 1.5
  const estimatedCost = Math.round(baseCost * multiplier * 100) / 100

  return {
    stepId: step.stepId,
    estimatedCost,
    confidence: step.risk === 'none' || step.risk === 'low' ? 'high' : 'medium',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Component 3: Compensation Engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map of action types to their reverse (compensation) action types.
 */
export const REVERSE_ACTION_MAP: Record<string, string> = {
  'canvas.add_node': 'canvas.delete_node',
  'canvas.update_node': 'canvas.update_node', // reverse is another update
  'canvas.delete_node': 'canvas.add_node',
  'canvas.move_node': 'canvas.move_node', // reverse is another move
  'calculator.execute': 'calculator.execute', // idempotent, re-execute with different params
  'calculator.insert': 'calculator.insert', // depends on implementation
  'chat.start_session': 'chat.start_session',
  'chat.submit_field': 'chat.submit_field',
  'chat.request_tool': 'chat.request_tool',
  'form.collect_field': 'form.collect_field',
  'form.submit': 'form.submit',
  'document.upload': 'document.upload', // cannot undelete — return metadata
  'lead.capture': 'lead.capture',
  'mcp_tool.call': 'mcp_tool.call',
  'mcp_app.open': 'mcp_app.open',
  'browser.inspect': 'browser.inspect',
  'browser.click': 'browser.click',
  'browser.fill': 'browser.fill',
  'browser.select': 'browser.select',
  'browser.submit': 'browser.submit',
  'booking.create': 'booking.create',
  'payment.initiate': 'payment.initiate',
  'crm.submit': 'crm.submit',
  'analytics.goal.set': 'analytics.goal.set',
  'personalization.apply': 'personalization.apply',
  'site.publish': 'site.rollback',
  'site.rollback': 'site.publish',
}

/**
 * Record state before executing an action.
 */
export function recordStateBefore(step: MissionStep, contextState: unknown): StateSnapshot {
  return {
    stepId: step.stepId,
    action: step.actionType,
    stateBefore: structuredClone(contextState ?? {}),
    stateAfter: null as unknown as unknown,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Record state after executing an action.
 */
export function recordStateAfter(snapshot: StateSnapshot, contextState: unknown): StateSnapshot {
  return {
    ...snapshot,
    stateAfter: structuredClone(contextState ?? {}),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Compute the compensation action needed to reverse a step.
 * Uses the reverse action mapping to determine the appropriate reverse action.
 */
export function computeCompensationAction(
  step: MissionStep,
  snapshot: StateSnapshot,
  compensationPlan: CompensationPlan | undefined,
): CompensationAction {
  const reverseActionType = REVERSE_ACTION_MAP[step.actionType] ?? step.actionType

  const requiresManualReview =
    step.risk === 'critical' ||
    step.actionType === 'payment.initiate' ||
    step.actionType === 'document.upload' ||
    step.actionType === 'site.publish' ||
    compensationPlan?.mode === 'manual'

  return {
    stepId: step.stepId,
    originalActionType: step.actionType,
    reverseActionType,
    requiresManualReview,
    compensationPayload: {
      originalStepId: step.stepId,
      originalActionType: step.actionType,
      stateBefore: snapshot.stateBefore,
      stateAfter: snapshot.stateAfter,
      reason: compensationPlan?.reason ?? 'Automatic compensation for failed step',
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience: Validate and Plan
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidateAndPlanResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
  sortedSteps: MissionStep[]
  parallelSets: ParallelSet[]
  taskCosts: TaskCost[]
  sortError: string | null
}

/**
 * One-shot validation and planning pipeline: validate, sort, parallelize, cost.
 */
export function validateAndPlan(data: unknown): ValidateAndPlanResult {
  const validation = validateManifest(data)

  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings,
      sortedSteps: [],
      parallelSets: [],
      taskCosts: [],
      sortError: null,
    }
  }

  const manifest = data as AgenticMissionManifest
  const sortResult = topologicalSort(manifest.steps)
  const parallelSets = sortResult.error
    ? []
    : computeParallelSets(sortResult.sorted)
  const taskCosts = sortResult.error
    ? []
    : sortResult.sorted.map(estimateTaskCost)

  return {
    valid: true,
    errors: [],
    warnings: validation.warnings,
    sortedSteps: sortResult.sorted,
    parallelSets,
    taskCosts,
    sortError: sortResult.error,
  }
}

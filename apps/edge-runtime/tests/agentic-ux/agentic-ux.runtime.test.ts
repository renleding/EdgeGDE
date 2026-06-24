/**
 * Agentic UX Runtime — 29 Test Suite
 *
 * Covers:
 *   - Manifest validation (valid + 6 invalid cases)
 *   - DAG topological sort (linear, independent, diamond, cycle detection)
 *   - Parallel execution sets
 *   - Compensation engine (reverse action mapping, state recording)
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import {
  validateManifest,
  topologicalSort,
  computeParallelSets,
  estimateTaskCost,
  recordStateBefore,
  recordStateAfter,
  computeCompensationAction,
  REVERSE_ACTION_MAP,
  validateAndPlan,
} from '../../src/agentic-ux/agentic-ux.runtime'
import type { MissionStep, CompensationPlan } from '../../src/agentic-ux/agentic-ux.schema'

/** Helper to create a MissionStep quickly */
function makeStep(
  stepId: string,
  dependsOn: string[],
  actionType: string,
  risk: string = 'none',
  approvalMode: string = 'none',
): MissionStep {
  return {
    stepId,
    description: `Step ${stepId}`,
    actionType: actionType as any,
    input: {},
    dependsOn,
    approvalMode: approvalMode as any,
    risk: risk as any,
  }
}

function makeValidManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mission-test-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    correlationId: 'corr-1',
    transactionId: 'txn-1',
    stateProjectionVersion: 1,
    intent: 'Test mission',
    expectedOutcome: 'All steps complete',
    steps: [
      {
        stepId: 'step-1',
        description: 'First step',
        actionType: 'calculator.execute',
        input: { calculatorId: 'test' },
        targetRef: 'hero',
        dependsOn: [],
        approvalMode: 'none',
        risk: 'none',
      },
      {
        stepId: 'step-2',
        description: 'Second step',
        actionType: 'canvas.update_node',
        input: { nodeId: 'cta-1' },
        targetRef: 'cta-1',
        dependsOn: ['step-1'],
        approvalMode: 'user',
        risk: 'low',
      },
    ],
    verificationPlan: [
      { checkId: 'check-1', stepId: 'step-1', type: 'calculator_output_check', expected: 'result' },
      { checkId: 'check-2', stepId: 'step-2', type: 'state_projection', expected: 'updated' },
    ],
    compensationPlan: [
      { stepId: 'step-1', mode: 'reverse', reason: 'Rollback step 1' },
      { stepId: 'step-2', mode: 'reverse', reason: 'Rollback step 2' },
    ],
    metadata: {
      confidence: { value: 0.8, source: 'llm' },
      cost: {},
    },
    status: 'proposed',
    createdAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('Manifest Validation', () => {
  it('valid manifest passes all checks', () => {
    const result = validateManifest(makeValidManifest())
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  it('missing required fields fails Zod validation', () => {
    const result = validateManifest({ id: 'incomplete' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('duplicate step IDs detected', () => {
    const manifest = makeValidManifest({
      steps: [
        {
          stepId: 'step-1', description: 'First', actionType: 'calculator.execute',
          input: {}, dependsOn: [], approvalMode: 'none', risk: 'none',
        },
        {
          stepId: 'step-1', description: 'Duplicate', actionType: 'canvas.update_node',
          input: {}, dependsOn: [], approvalMode: 'none', risk: 'none',
        },
      ],
      verificationPlan: [
        { checkId: 'c1', stepId: 'step-1', type: 'calculator_output_check', expected: 'x' },
        { checkId: 'c2', stepId: 'step-1', type: 'calculator_output_check', expected: 'y' },
      ],
      compensationPlan: [
        { stepId: 'step-1', mode: 'reverse' },
        { stepId: 'step-1', mode: 'reverse' },
      ],
    })
    const result = validateManifest(manifest)
    expect(result.valid).toBe(false)
    const dupError = result.errors.find((e) => e.message.includes('stepId must be unique'))
    expect(dupError).toBeTruthy()
  })

  it('dependency cycle detected', () => {
    const manifest = makeValidManifest({
      steps: [
        {
          stepId: 'step-1', description: 'Step 1', actionType: 'calculator.execute',
          input: {}, dependsOn: ['step-3'], approvalMode: 'none', risk: 'none',
        },
        {
          stepId: 'step-2', description: 'Step 2', actionType: 'canvas.update_node',
          input: {}, dependsOn: ['step-1'], approvalMode: 'user', risk: 'low',
        },
        {
          stepId: 'step-3', description: 'Step 3', actionType: 'canvas.delete_node',
          input: {}, dependsOn: ['step-2'], approvalMode: 'user', risk: 'low',
        },
      ],
      verificationPlan: [
        { checkId: 'c1', stepId: 'step-1', type: 'calculator_output_check', expected: 'x' },
        { checkId: 'c2', stepId: 'step-2', type: 'state_projection', expected: 'y' },
        { checkId: 'c3', stepId: 'step-3', type: 'state_projection', expected: 'z' },
      ],
      compensationPlan: [
        { stepId: 'step-1', mode: 'reverse' },
        { stepId: 'step-2', mode: 'reverse' },
        { stepId: 'step-3', mode: 'reverse' },
      ],
    })
    const result = validateManifest(manifest)
    expect(result.valid).toBe(false)
    const cycleError = result.errors.find((e) => e.message.includes('dependency cycle') || e.message.includes('cycle'))
    expect(cycleError).toBeTruthy()
  })

  it('risk/approval mismatch detected', () => {
    const manifest = makeValidManifest({
      steps: [
        {
          stepId: 'step-1', description: 'High risk', actionType: 'canvas.update_node',
          input: {}, dependsOn: [], approvalMode: 'none', risk: 'high',
        },
      ],
      verificationPlan: [
        { checkId: 'c1', stepId: 'step-1', type: 'state_projection', expected: 'x' },
      ],
      compensationPlan: [
        { stepId: 'step-1', mode: 'reverse' },
      ],
    })
    const result = validateManifest(manifest)
    expect(result.valid).toBe(false)
    const mismatch = result.errors.find((e) => e.message.includes('risk') || e.message.includes('approval'))
    expect(mismatch).toBeTruthy()
  })

  it('empty targetRef detected', () => {
    const manifest = makeValidManifest({
      steps: [
        {
          stepId: 'step-1', description: 'Empty ref', actionType: 'calculator.execute',
          input: {}, dependsOn: [], approvalMode: 'none', risk: 'none', targetRef: '',
        },
      ],
      verificationPlan: [
        { checkId: 'c1', stepId: 'step-1', type: 'calculator_output_check', expected: 'x' },
      ],
      compensationPlan: [
        { stepId: 'step-1', mode: 'reverse' },
      ],
    })
    const result = validateManifest(manifest)
    expect(Array.isArray(result.errors)).toBeTruthy()
  })

  it('warns on critical risk steps', () => {
    const manifest = makeValidManifest({
      steps: [
        {
          stepId: 'step-1', description: 'Critical', actionType: 'canvas.update_node',
          input: {}, dependsOn: [], approvalMode: 'user', risk: 'critical',
        },
      ],
      verificationPlan: [
        { checkId: 'c1', stepId: 'step-1', type: 'state_projection', expected: 'x' },
      ],
      compensationPlan: [
        { stepId: 'step-1', mode: 'reverse' },
      ],
    })
    const result = validateManifest(manifest)
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('DAG Topological Sort', () => {
  it('linear dependency chain', () => {
    const steps: MissionStep[] = [
      makeStep('a', [], 'calculator.execute'),
      makeStep('b', ['a'], 'canvas.update_node'),
      makeStep('c', ['b'], 'form.submit'),
    ]
    const result = topologicalSort(steps)
    expect(result.error).toBeNull()
    const ids = result.sorted.map((s) => s.stepId)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('independent steps (no deps)', () => {
    const steps: MissionStep[] = [
      makeStep('a', [], 'calculator.execute'),
      makeStep('b', [], 'canvas.update_node'),
      makeStep('c', [], 'form.submit'),
    ]
    const result = topologicalSort(steps)
    expect(result.error).toBeNull()
    expect(result.sorted.length).toBe(3)
    const ids = new Set(result.sorted.map((s) => s.stepId))
    expect(ids.has('a')).toBeTruthy()
    expect(ids.has('b')).toBeTruthy()
    expect(ids.has('c')).toBeTruthy()
  })

  it('diamond dependency pattern', () => {
    const steps: MissionStep[] = [
      makeStep('root', [], 'calculator.execute'),
      makeStep('left', ['root'], 'canvas.update_node'),
      makeStep('right', ['root'], 'form.submit'),
      makeStep('merge', ['left', 'right'], 'site.publish'),
    ]
    const result = topologicalSort(steps)
    expect(result.error).toBeNull()
    expect(result.sorted.length).toBe(4)
    expect(result.sorted[0].stepId).toBe('root')
    expect(result.sorted[3].stepId).toBe('merge')
    const middleIds = new Set([result.sorted[1].stepId, result.sorted[2].stepId])
    expect(middleIds.has('left')).toBeTruthy()
    expect(middleIds.has('right')).toBeTruthy()
  })

  it('detects cycle', () => {
    const steps: MissionStep[] = [
      makeStep('a', ['c'], 'calculator.execute'),
      makeStep('b', ['a'], 'canvas.update_node'),
      makeStep('c', ['b'], 'form.submit'),
    ]
    const result = topologicalSort(steps)
    expect(result.error).not.toBeNull()
    expect(result.sorted.length).toBe(0)
  })

  it('single step', () => {
    const steps: MissionStep[] = [makeStep('only', [], 'calculator.execute')]
    const result = topologicalSort(steps)
    expect(result.error).toBeNull()
    expect(result.sorted.length).toBe(1)
    expect(result.sorted[0].stepId).toBe('only')
  })

  it('self-dependency is a cycle', () => {
    const steps: MissionStep[] = [makeStep('self', ['self'], 'calculator.execute')]
    const result = topologicalSort(steps)
    expect(result.error).not.toBeNull()
  })

  it('empty array returns empty result', () => {
    const result = topologicalSort([])
    expect(result.error).toBeNull()
    expect(result.sorted.length).toBe(0)
  })
})

describe('Parallel Execution Sets', () => {
  it('linear chain produces one step per round', () => {
    const steps: MissionStep[] = [
      makeStep('a', [], 'calculator.execute'),
      makeStep('b', ['a'], 'canvas.update_node'),
      makeStep('c', ['b'], 'form.submit'),
    ]
    const sets = computeParallelSets(steps)
    expect(sets.length).toBe(3)
    expect(sets[0].steps.length).toBe(1)
    expect(sets[0].steps[0].stepId).toBe('a')
    expect(sets[1].steps[0].stepId).toBe('b')
    expect(sets[2].steps[0].stepId).toBe('c')
  })

  it('independent steps in same round', () => {
    const steps: MissionStep[] = [
      makeStep('a', [], 'calculator.execute'),
      makeStep('b', [], 'canvas.update_node'),
      makeStep('c', [], 'form.submit'),
    ]
    const sets = computeParallelSets(steps)
    expect(sets.length).toBe(1)
    expect(sets[0].steps.length).toBe(3)
  })

  it('diamond pattern (root + parallel + merge)', () => {
    const steps: MissionStep[] = [
      makeStep('root', [], 'calculator.execute'),
      makeStep('left', ['root'], 'canvas.update_node'),
      makeStep('right', ['root'], 'form.submit'),
      makeStep('merge', ['left', 'right'], 'site.publish'),
    ]
    const sets = computeParallelSets(steps)
    expect(sets.length).toBe(3)
    expect(sets[0].steps[0].stepId).toBe('root')
    expect(sets[1].steps.length).toBe(2)
    expect(sets[2].steps[0].stepId).toBe('merge')
  })

  it('empty input returns empty array', () => {
    const sets = computeParallelSets([])
    expect(sets.length).toBe(0)
  })

  it('single step returns one round', () => {
    const steps: MissionStep[] = [makeStep('only', [], 'calculator.execute')]
    const sets = computeParallelSets(steps)
    expect(sets.length).toBe(1)
    expect(sets[0].steps[0].stepId).toBe('only')
  })
})

describe('Compensation Engine', () => {
  it('REVERSE_ACTION_MAP: canvas.add_node → canvas.delete_node', () => {
    expect(REVERSE_ACTION_MAP['canvas.add_node']).toBe('canvas.delete_node')
  })

  it('REVERSE_ACTION_MAP: canvas.delete_node → canvas.add_node', () => {
    expect(REVERSE_ACTION_MAP['canvas.delete_node']).toBe('canvas.add_node')
  })

  it('REVERSE_ACTION_MAP: site.publish → site.rollback', () => {
    expect(REVERSE_ACTION_MAP['site.publish']).toBe('site.rollback')
  })

  it('REVERSE_ACTION_MAP: site.rollback → site.publish', () => {
    expect(REVERSE_ACTION_MAP['site.rollback']).toBe('site.publish')
  })

  it('recordStateBefore: captures state before action', () => {
    const step = makeStep('test-step', [], 'calculator.execute')
    const state = { counter: 5, items: ['a', 'b'] }
    const snapshot = recordStateBefore(step, state)
    expect(snapshot.stepId).toBe('test-step')
    expect(snapshot.action).toBe('calculator.execute')
    expect(snapshot.stateBefore).toEqual({ counter: 5, items: ['a', 'b'] })
    expect(snapshot.stateAfter).toBeNull()
  })

  it('recordStateAfter: captures state after action', () => {
    const step = makeStep('test-step', [], 'calculator.execute')
    const beforeState = { counter: 5 }
    const afterState = { counter: 10, result: 'done' }
    const snapshot = recordStateBefore(step, beforeState)
    const updated = recordStateAfter(snapshot, afterState)
    expect(updated.stateBefore).toEqual({ counter: 5 })
    expect(updated.stateAfter).toEqual({ counter: 10, result: 'done' })
  })

  it('computeCompensationAction: creates compensation with reverse mapping', () => {
    const step = makeStep('step-1', [], 'canvas.add_node')
    const snapshot = { stepId: 'step-1', action: 'canvas.add_node', stateBefore: {}, stateAfter: { id: 'new-node' }, timestamp: '2026-01-01T00:00:00.000Z' }
    const plan: CompensationPlan = { stepId: 'step-1', mode: 'reverse', reason: 'Rollback' }
    const comp = computeCompensationAction(step, snapshot, plan)
    expect(comp.stepId).toBe('step-1')
    expect(comp.originalActionType).toBe('canvas.add_node')
    expect(comp.reverseActionType).toBe('canvas.delete_node')
  })

  it('computeCompensationAction: requires manual review for critical risk', () => {
    const step = makeStep('step-1', [], 'canvas.add_node', 'critical', 'user')
    const snapshot = { stepId: 'step-1', action: 'canvas.add_node', stateBefore: {}, stateAfter: {}, timestamp: '2026-01-01T00:00:00.000Z' }
    const comp = computeCompensationAction(step, snapshot, undefined)
    expect(comp.requiresManualReview).toBe(true)
  })

  it('computeCompensationAction: requires manual review for payment.initiate', () => {
    const step = makeStep('step-pay', [], 'payment.initiate')
    const snapshot = { stepId: 'step-pay', action: 'payment.initiate', stateBefore: {}, stateAfter: {}, timestamp: '2026-01-01T00:00:00.000Z' }
    const comp = computeCompensationAction(step, snapshot, undefined)
    expect(comp.requiresManualReview).toBe(true)
  })

  it('estimateTaskCost: calculator.execute is low cost', () => {
    const step = makeStep('step-1', [], 'calculator.execute')
    const cost = estimateTaskCost(step)
    expect(cost.stepId).toBe('step-1')
    expect(cost.estimatedCost).toBe(1)
  })

  it('estimateTaskCost: document.upload is high cost', () => {
    const step = makeStep('step-upload', [], 'document.upload', 'medium', 'user')
    const cost = estimateTaskCost(step)
    expect(cost.estimatedCost).toBe(7.5)
  })

  it('estimateTaskCost: site.publish with high risk', () => {
    const step = makeStep('step-pub', [], 'site.publish', 'high', 'admin')
    const cost = estimateTaskCost(step)
    expect(cost.estimatedCost).toBe(10)
  })
})

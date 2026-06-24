/**
 * Tests for Mission Lifecycle -- dry-run + replay
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerAction, dryRunMission, replayMission } from '../../src/actions/lifecycle'
import type { MissionDefinition } from '../../src/actions/types'
import fixtures from '../fixtures/lead-scoring-v1.json'

// Register shared test actions
const testCaptureAction = {
  type: 'lead.capture',
  async execute(_ctx: any, input: any) {
    return { status: 'success' as const, output: { leadId: input.leadId, captured: true }, durationMs: 10 }
  },
  dryRun(_input: any) {
    return { expectedOutputType: '{ leadId, captured }', sideEffects: ['creates record in D1'], idempotent: true, estimatedDurationMs: 50 }
  },
}

const testScoreAction = {
  type: 'lead.score',
  async execute(_ctx: any, input: any) {
    const score = typeof input.score === 'number' ? input.score : 50
    return { status: 'success' as const, output: { leadId: input.leadId, score, bucket: score >= 80 ? 'hot' : 'warm' }, durationMs: 20 }
  },
  compensate(_ctx: any, _input: any, _output: any) { return Promise.resolve() },
  dryRun(_input: any) {
    return { expectedOutputType: '{ leadId, score, bucket }', sideEffects: ['updates record in D1'], idempotent: true, estimatedDurationMs: 100 }
  },
}

beforeAll(() => {
  registerAction(testCaptureAction)
  registerAction(testScoreAction)
})

describe('dryRunMission (FRS-4)', () => {
  it('returns valid report for valid manifest', async () => {
    const manifest: any = {
      id: 'test-mission', sessionId: 'sess-t', tenantId: 'test',
      correlationId: 'corr-t', stateProjectionVersion: 0,
      intent: 'Test', expectedOutcome: 'Verify',
      status: 'proposed',
      steps: [{ stepId: 's1', description: 'Test', actionType: 'lead.capture', input: {}, risk: 'low', approvalMode: 'auto' }],
      compensationPlan: [{ stepId: 's1', mode: 'reverse' }],
      verificationPlan: [{ stepId: 's1' }],
      createdAt: new Date().toISOString(),
    }
    const mission: MissionDefinition = { id: 'test-mission', name: 'Test', desiredState: {}, actions: [testCaptureAction] }
    const report = await dryRunMission(mission, manifest)
    expect(report.valid).toBe(true)
    expect(report.actions).toHaveLength(1)
    expect(report.actions[0].sideEffects).toEqual(['creates record in D1'])
  })

  it('returns warnings for actions without dryRun', async () => {
    const noDryRunAction: any = {
      type: 'canvas.add_node',
      async execute() { return { status: 'success', output: null, durationMs: 0 } },
    }
    registerAction(noDryRunAction)
    const manifest: any = {
      id: 't', sessionId: 's', tenantId: 't', correlationId: 'c', stateProjectionVersion: 0,
      intent: 'T', expectedOutcome: 'T', status: 'proposed',
      steps: [{ stepId: 's1', description: 'Test', actionType: 'canvas.add_node', input: {}, risk: 'low', approvalMode: 'auto' }],
      compensationPlan: [{ stepId: 's1', mode: 'reverse' }],
      verificationPlan: [{ stepId: 's1' }],
      createdAt: new Date().toISOString(),
    }
    const mission: MissionDefinition = { id: 'test', name: 'T', desiredState: {}, actions: [] }
    const report = await dryRunMission(mission, manifest)
    expect(report.warnings.length).toBeGreaterThan(0)
    expect(report.warnings[0]).toContain('no dryRun() function')
  })

  it('returns errors for unknown action types', async () => {
    const manifest: any = {
      id: 't', sessionId: 's', tenantId: 't', correlationId: 'c', stateProjectionVersion: 0,
      intent: 'T', expectedOutcome: 'T', status: 'proposed',
      steps: [{ stepId: 's1', description: 'Test', actionType: 'unknown.action', input: {}, risk: 'low', approvalMode: 'auto' }],
      compensationPlan: [{ stepId: 's1', mode: 'reverse' }],
      verificationPlan: [{ stepId: 's1' }],
      createdAt: new Date().toISOString(),
    }
    const mission: MissionDefinition = { id: 'test', name: 'T', desiredState: {}, actions: [] }
    const report = await dryRunMission(mission, manifest)
    expect(report.valid).toBe(false)
    expect(report.errors.length).toBeGreaterThan(0)
  })
})

describe('replayMission (FRS-2)', () => {
  it('replays recorded events and reports passes', async () => {
    const events = fixtures.events as any as Array<{ sequence: number; actionType: string; input: unknown; expectedOutput: unknown; expectedStatus: 'success' | 'failure'; correlationId: string }>
    const result = await replayMission(fixtures.missionId, events)
    expect(result.totalEvents).toBe(3)
    expect(result.passed).toBe(3)
    expect(result.failed).toBe(0)
  })

  it('reports failures when actions mismatch', async () => {
    const result = await replayMission('test', [
      { sequence: 1, actionType: 'lead.capture', input: { leadId: 'L1' }, expectedOutput: { leadId: 'L1', captured: false }, expectedStatus: 'success' as const, correlationId: 'test' },
    ])
    expect(result.passed).toBe(0)
    expect(result.failed).toBe(1)
  })
})

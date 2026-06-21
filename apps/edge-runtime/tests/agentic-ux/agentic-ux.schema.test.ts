import assert from 'node:assert'
import {
  AgenticMissionManifestSchema,
  CompensationActionSchema,
  DryRunResultSchema,
  EdgeGDEActionSchema,
  EdgeGDEActionResultSchema,
  LLMProposalSchema,
  StateProjectionSchema,
  TransactionGroupSchema,
  UXEventSchema,
  assertLlmProposalIsNotExecutable,
  canonicalStableStringify,
  findDuplicateIdempotencyKeys,
  validateActionTransactionGroup,
  validateEventOrdering,
  validateExecutionOrder,
} from '../../src/agentic-ux/agentic-ux.schema'

let passed = 0
let failed = 0

const now = '2026-06-20T00:00:00.000Z'
const idempotencyKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const idempotencyKeyTwo = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: unknown) {
    failed++
    console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`)
  }
}

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mission-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    correlationId: 'corr-1',
    transactionId: 'txn-1',
    stateProjectionVersion: 7,
    intent: 'Add mortgage calculator and CTA',
    expectedOutcome: 'Calculator and CTA are present below the hero',
    steps: [
      {
        stepId: 'step-1',
        description: 'Insert mortgage calculator below hero',
        actionType: 'calculator.insert',
        input: { calculatorId: 'mortgage-repayment', targetRef: 'hero' },
        targetRef: 'hero',
        dependsOn: [],
        approvalMode: 'user',
        risk: 'medium',
      },
      {
        stepId: 'step-2',
        description: 'Update hero CTA copy',
        actionType: 'canvas.update_node',
        input: { nodeId: 'cta-1', props: { text: 'Book a free consultation' } },
        targetRef: 'cta-1',
        dependsOn: ['step-1'],
        approvalMode: 'user',
        risk: 'low',
      },
    ],
    verificationPlan: [
      {
        checkId: 'check-1',
        stepId: 'step-1',
        type: 'html_render_preview',
        expected: 'compiled HTML contains calculator form',
      },
      {
        checkId: 'check-2',
        stepId: 'step-2',
        type: 'state_projection',
        expected: 'CTA text equals Book a free consultation',
      },
    ],
    compensationPlan: [
      {
        stepId: 'step-1',
        mode: 'reverse',
        reason: 'Remove inserted calculator on failure',
      },
      {
        stepId: 'step-2',
        mode: 'reverse',
        reason: 'Restore previous CTA text',
      },
    ],
    metadata: {
      confidence: {
        value: 0.86,
        source: 'llm',
      },
      cost: {
        estimatedTokens: 1200,
        estimatedLatencyMs: 500,
        externalCalls: 0,
      },
    },
    status: 'validated',
    createdAt: now,
    ...overrides,
  }
}

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    idempotencyKey,
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    correlationId: 'corr-1',
    missionId: 'mission-1',
    transactionId: 'txn-1',
    stepId: 'step-1',
    type: 'calculator.insert',
    intent: 'Insert mortgage calculator below hero',
    input: { calculatorId: 'mortgage-repayment', targetRef: 'hero' },
    targetRef: 'hero',
    stateProjectionVersion: 7,
    expectedVersion: 7,
    executionMode: 'execute',
    risk: 'medium',
    approvalRequired: true,
    approvalMode: 'user',
    compensation: {
      stepId: 'step-1',
      mode: 'reverse',
      reason: 'Remove inserted calculator on failure',
    },
    metadata: {
      confidence: {
        value: 0.86,
        source: 'llm',
      },
      cost: {
        estimatedTokens: 1200,
        actualTokens: 1180,
        estimatedLatencyMs: 500,
        actualLatencyMs: 480,
        externalCalls: 0,
      },
    },
    status: 'validated',
    createdAt: now,
    ...overrides,
  }
}

function makeActionResult(overrides: Record<string, unknown> = {}) {
  return {
    actionId: 'action-1',
    idempotencyKey,
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    missionId: 'mission-1',
    transactionId: 'txn-1',
    stepId: 'step-1',
    executionMode: 'execute',
    status: 'success',
    verification: {
      passed: true,
      checks: [
        {
          name: 'calculator inserted',
          passed: true,
          evidence: { nodeId: 'calculator-node' },
        },
      ],
    },
    compensation: {
      required: false,
      status: 'not_required',
    },
    auditEventIds: ['audit-1'],
    metadata: {
      cost: {
        actualTokens: 1180,
        actualLatencyMs: 480,
        externalCalls: 0,
      },
    },
    createdAt: now,
    completedAt: now,
    ...overrides,
  }
}

run('AgenticMissionManifestSchema accepts valid typed mission', () => {
  const result = AgenticMissionManifestSchema.safeParse(makeMission())

  assert.strictEqual(result.success, true, JSON.stringify(result.error?.issues))
})

run('AgenticMissionManifestSchema rejects dependency cycles', () => {
  const result = AgenticMissionManifestSchema.safeParse(
    makeMission({
      steps: [
        {
          stepId: 'step-1',
          description: 'A depends on B',
          actionType: 'canvas.update_node',
          input: {},
          approvalMode: 'none',
          risk: 'low',
          dependsOn: ['step-2'],
        },
        {
          stepId: 'step-2',
          description: 'B depends on A',
          actionType: 'canvas.update_node',
          input: {},
          approvalMode: 'none',
          risk: 'low',
          dependsOn: ['step-1'],
        },
      ],
    }),
  )

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('dependency cycles'))
})

run('AgenticMissionManifestSchema requires compensation and verification per step', () => {
  const result = AgenticMissionManifestSchema.safeParse(
    makeMission({
      compensationPlan: [],
    }),
  )

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('compensationPlan'))
})

run('LLMProposalSchema accepts non-executable proposal', () => {
  const result = LLMProposalSchema.safeParse({
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    intent: 'Add calculator',
    missionManifestDraft: makeMission(),
    explanation: 'The user wants a calculator below the hero.',
    confidence: 0.86,
  })

  assert.strictEqual(result.success, true, JSON.stringify(result.error?.issues))
})

run('LLMProposalSchema rejects executable action fields', () => {
  const result = LLMProposalSchema.safeParse({
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    intent: 'Add calculator',
    idempotencyKey,
  })

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('executable action fields'))
})

run('LLM proposal is not executable as EdgeGDEAction', () => {
  const proposal = LLMProposalSchema.parse({
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    intent: 'Add calculator',
    missionManifestDraft: makeMission(),
  })

  assert.strictEqual(assertLlmProposalIsNotExecutable(proposal), true)
})

run('EdgeGDEActionSchema requires idempotencyKey', () => {
  const result = EdgeGDEActionSchema.safeParse(makeAction({ idempotencyKey: undefined }))

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('idempotencyKey'))
})

run('EdgeGDEActionSchema rejects non-sha256 idempotencyKey', () => {
  const result = EdgeGDEActionSchema.safeParse(makeAction({ idempotencyKey: 'not-a-sha256' }))

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('sha256'))
})

run('EdgeGDEActionSchema rejects execute action requiring approval without approvalMode', () => {
  const result = EdgeGDEActionSchema.safeParse(
    makeAction({
      approvalRequired: true,
      approvalMode: undefined,
      executionMode: 'execute',
    }),
  )

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('approvalMode'))
})

run('EdgeGDEActionResultSchema accepts normal execution result', () => {
  const result = EdgeGDEActionResultSchema.safeParse(makeActionResult())

  assert.strictEqual(result.success, true, JSON.stringify(result.error?.issues))
})

run('DryRunResultSchema rejects state-mutating dry run', () => {
  const result = DryRunResultSchema.safeParse(
    makeActionResult({
      executionMode: 'preview',
      wouldMutate: true,
    }),
  )

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('wouldMutate'))
})

run('DryRunResultSchema rejects execute-mode dry run', () => {
  const result = DryRunResultSchema.safeParse(
    makeActionResult({
      executionMode: 'execute',
      wouldMutate: false,
    }),
  )

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('executionMode'))
})

run('CompensationActionSchema requires typed, idempotent compensation action', () => {
  const result = CompensationActionSchema.safeParse({
    id: 'comp-1',
    idempotencyKey,
    originalActionId: 'action-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    missionId: 'mission-1',
    transactionId: 'txn-1',
    compensateActionType: 'canvas.delete_node',
    input: { nodeId: 'calculator-node' },
    mode: 'reverse',
    reason: 'Remove inserted calculator after failure',
    status: 'validated',
    auditEventIds: ['audit-comp-1'],
    createdAt: now,
  })

  assert.strictEqual(result.success, true, JSON.stringify(result.error?.issues))
})

run('CompensationActionSchema rejects non-idempotent compensation action', () => {
  const result = CompensationActionSchema.safeParse({
    id: 'comp-1',
    originalActionId: 'action-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    missionId: 'mission-1',
    compensateActionType: 'canvas.delete_node',
    input: { nodeId: 'calculator-node' },
    mode: 'reverse',
    status: 'validated',
    createdAt: now,
  })

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('idempotencyKey'))
})

run('Execution order invariant rejects skipped dry-run', () => {
  const result = validateExecutionOrder([
    { transition: 'validate', sequence: 0, auditEventId: 'audit-1', occurredAt: now },
    { transition: 'idempotency_check', sequence: 1, auditEventId: 'audit-2', occurredAt: now },
    { transition: 'approval_check', sequence: 2, auditEventId: 'audit-3', occurredAt: now },
    { transition: 'execute', sequence: 3, auditEventId: 'audit-4', occurredAt: now },
    { transition: 'verify', sequence: 4, auditEventId: 'audit-5', occurredAt: now },
    { transition: 'compensate_if_needed', sequence: 5, auditEventId: 'audit-6', occurredAt: now },
    { transition: 'audit_append', sequence: 6, auditEventId: 'audit-7', occurredAt: now },
  ])

  assert.strictEqual(result.passed, false)
  assert.ok(result.errors.some((error) => error.includes('dry_run')))
})

run('Execution order invariant accepts mandatory order', () => {
  const transitions = [
    { transition: 'validate', sequence: 0, auditEventId: 'audit-1', occurredAt: now },
    { transition: 'idempotency_check', sequence: 1, auditEventId: 'audit-2', occurredAt: now },
    { transition: 'dry_run', sequence: 2, auditEventId: 'audit-3', occurredAt: now },
    { transition: 'approval_check', sequence: 3, auditEventId: 'audit-4', occurredAt: now },
    { transition: 'execute', sequence: 4, auditEventId: 'audit-5', occurredAt: now },
    { transition: 'verify', sequence: 5, auditEventId: 'audit-6', occurredAt: now },
    { transition: 'compensate_if_needed', sequence: 6, auditEventId: 'audit-7', occurredAt: now },
    { transition: 'audit_append', sequence: 7, auditEventId: 'audit-8', occurredAt: now },
  ] as const

  const result = validateExecutionOrder(transitions)

  assert.strictEqual(result.passed, true, JSON.stringify(result.errors))
})

run('UXEvent ordering must be strictly increasing', () => {
  const events = [
    UXEventSchema.parse({
      id: 'event-1',
      type: 'ux.action.proposed',
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      sequence: 2,
      timestamp: now,
      data: {},
    }),
    UXEventSchema.parse({
      id: 'event-2',
      type: 'ux.action.validated',
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      sequence: 1,
      timestamp: now,
      data: {},
    }),
  ]

  const result = validateEventOrdering(events)

  assert.strictEqual(result.passed, false)
  assert.ok(result.errors.some((error) => error.includes('strictly increasing')))
})

run('UXEvent ordering accepts strict sequence', () => {
  const events = [
    UXEventSchema.parse({
      id: 'event-1',
      type: 'ux.action.proposed',
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      sequence: 1,
      timestamp: now,
      data: {},
    }),
    UXEventSchema.parse({
      id: 'event-2',
      type: 'ux.action.validated',
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      sequence: 2,
      timestamp: now,
      data: {},
    }),
  ]

  const result = validateEventOrdering(events)

  assert.strictEqual(result.passed, true, JSON.stringify(result.errors))
})

run('StateProjection rejects stale lastVerifiedVersion', () => {
  const result = StateProjectionSchema.safeParse({
    tenantId: 'tenant-1',
    siteId: 'site-1',
    version: 7,
    lastVerifiedVersion: 8,
    availableActions: ['calculator.insert'],
    tools: [],
    calculators: [],
    policySummary: {
      policyVersion: 'policy-1',
      approvalRulesVersion: 'rules-1',
    },
    generatedAt: now,
  })

  assert.strictEqual(result.success, false)
  assert.ok(JSON.stringify(result.error?.issues).includes('lastVerifiedVersion'))
})

run('StateProjection accepts consistent projection', () => {
  const result = StateProjectionSchema.safeParse({
    tenantId: 'tenant-1',
    siteId: 'site-1',
    version: 7,
    lastVerifiedVersion: 7,
    availableActions: ['calculator.insert'],
    tools: [],
    calculators: [],
    policySummary: {
      policyVersion: 'policy-1',
      approvalRulesVersion: 'rules-1',
    },
    generatedAt: now,
  })

  assert.strictEqual(result.success, true, JSON.stringify(result.error?.issues))
})

run('Transaction grouping rejects cross-mission grouping', () => {
  const result = validateActionTransactionGroup([
    EdgeGDEActionSchema.parse(makeAction({ transactionId: 'txn-1' })),
    EdgeGDEActionSchema.parse(makeAction({ id: 'action-2', idempotencyKey: idempotencyKeyTwo, missionId: 'mission-2', transactionId: 'txn-1' })),
  ])

  assert.strictEqual(result.passed, false)
  assert.ok(result.errors.some((error) => error.includes('different tenant/session/mission')))
})

run('TransactionGroupSchema accepts grouped transaction', () => {
  const result = TransactionGroupSchema.safeParse({
    transactionId: 'txn-1',
    missionId: 'mission-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    actionIds: ['action-1', 'action-2'],
    status: 'planned',
  })

  assert.strictEqual(result.success, true, JSON.stringify(result.error?.issues))
})

run('Duplicate idempotency keys are detectable', () => {
  const duplicates = findDuplicateIdempotencyKeys([
    EdgeGDEActionSchema.parse(makeAction()),
    EdgeGDEActionSchema.parse(makeAction({ id: 'action-2' })),
  ])

  assert.deepStrictEqual(duplicates, [idempotencyKey])
})

run('Canonical stable stringify sorts object keys', () => {
  const a = canonicalStableStringify({ b: 2, a: 1 })
  const b = canonicalStableStringify({ a: 1, b: 2 })

  assert.strictEqual(a, b)
  assert.strictEqual(a, '{"a":1,"b":2}')
})

if (failed === 0) {
  console.log(`✅ ${passed} agentic UX schema tests passed`)
  process.exit(0)
}

console.error(`❌ ${failed}/${passed + failed} agentic UX schema tests failed`)
process.exit(1)

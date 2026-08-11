/**
 * EdgeGDE Agentic UX Runtime — Phase 0 Protocol Schemas
 *
 * This module defines the typed contract boundary for agentic website UX:
 *
 * LLMProposal → validate → AgenticMissionManifest → compile → EdgeGDEAction[]
 *
 * LLM proposals are non-authoritative and non-executable.
 * Only validated EdgeGDEAction records may transition EdgeGDE system state.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Primitive Enums
// ═══════════════════════════════════════════════════════════════════════════

/** Risk level for an action or mission. */
export const RiskLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'critical'])
export type RiskLevel = z.output<typeof RiskLevelSchema>

/** Approval mode for an action requiring authorization. */
export const ApprovalModeSchema = z.enum(['none', 'user', 'tenant_policy', 'admin', 'external'])
export type ApprovalMode = z.output<typeof ApprovalModeSchema>

/** ExecutionModeSchema. */
export const ExecutionModeSchema = z.enum(['preview', 'execute'])
export type ExecutionMode = z.output<typeof ExecutionModeSchema>

/** MissionStatusSchema. */
export const MissionStatusSchema = z.enum([
  'proposed',
  'validated',
  'rejected',
  'approved',
  'executing',
  'completed',
  'compensating',
  'compensated',
  'failed',
])
export type MissionStatus = z.output<typeof MissionStatusSchema>

/** ActionStatusSchema. */
export const ActionStatusSchema = z.enum([
  'proposed',
  'validated',
  'approval_pending',
  'approved',
  'denied',
  'executing',
  'verified',
  'compensating',
  'compensated',
  'failed',
])
export type ActionStatus = z.output<typeof ActionStatusSchema>

/** ActionResultStatusSchema. */
export const ActionResultStatusSchema = z.enum(['success', 'partial', 'failed'])
export type ActionResultStatus = z.output<typeof ActionResultStatusSchema>

/** CompensationModeSchema. */
export const CompensationModeSchema = z.enum(['none', 'reverse', 'soft_reverse', 'manual'])
export type CompensationMode = z.output<typeof CompensationModeSchema>

/** CompensationStatusSchema. */
export const CompensationStatusSchema = z.enum([
  'not_required',
  'pending',
  'validated',
  'executing',
  'completed',
  'failed',
  'manual_required',
])
export type CompensationStatus = z.output<typeof CompensationStatusSchema>

/** VerificationCheckTypeSchema. */
export const VerificationCheckTypeSchema = z.enum([
  'schema_validation',
  'state_projection',
  'html_render_preview',
  'accessibility_snapshot',
  'form_schema_check',
  'calculator_output_check',
  'audit_event_check',
  'expected_version_check',
  'screenshot_diff',
  'dom_state_check',
])
export type VerificationCheckType = z.output<typeof VerificationCheckTypeSchema>

/** EdgeGDEActionTypeSchema. */
export const EdgeGDEActionTypeSchema = z.enum([
  'canvas.add_node',
  'canvas.update_node',
  'canvas.delete_node',
  'canvas.move_node',
  'calculator.execute',
  'calculator.insert',
  'chat.start_session',
  'chat.submit_field',
  'chat.request_tool',
  'form.collect_field',
  'form.submit',
  'document.upload',
  'lead.capture',
  'mcp_tool.call',
  'mcp_app.open',
  'browser.inspect',
  'browser.click',
  'browser.fill',
  'browser.select',
  'browser.submit',
  'booking.create',
  'payment.initiate',
  'crm.submit',
  'analytics.goal.set',
  'personalization.apply',
  'site.publish',
  'site.rollback',
])
export type EdgeGDEActionType = z.output<typeof EdgeGDEActionTypeSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Shared Schemas
// ═══════════════════════════════════════════════════════════════════════════

/** SHA-256 hex digest idempotency key. */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'idempotencyKey must be a sha256 hex digest')

export type IdempotencyKey = z.output<typeof IdempotencyKeySchema>

/** CorrelationIdSchema. */
export const CorrelationIdSchema = z.string().min(1)
/** TenantIdSchema. */
export const TenantIdSchema = z.string().min(1)
/** SessionIdSchema. */
export const SessionIdSchema = z.string().min(1)
/** SiteIdSchema. */
export const SiteIdSchema = z.string().min(1)
/** MissionIdSchema. */
export const MissionIdSchema = z.string().min(1)
/** ActionIdSchema. */
export const ActionIdSchema = z.string().min(1)
/** StepIdSchema. */
export const StepIdSchema = z.string().min(1)
/** TransactionIdSchema. */
export const TransactionIdSchema = z.string().min(1)

/** DateTimeSchema. */
export const DateTimeSchema = z.iso.datetime()

/** MetadataSchema. */
export const MetadataSchema = z.record(z.string(), z.unknown()).default({})

/** ConfidenceMetadataSchema. */
export const ConfidenceMetadataSchema = z
  .object({
    value: z.number().min(0).max(1),
    source: z.literal('llm'),
    explanation: z.string().optional(),
  })
  .strict()

export type ConfidenceMetadata = z.output<typeof ConfidenceMetadataSchema>

/** CostMetadataSchema. */
export const CostMetadataSchema = z
  .object({
    estimatedTokens: z.number().int().nonnegative().optional(),
    actualTokens: z.number().int().nonnegative().optional(),
    estimatedLatencyMs: z.number().int().nonnegative().optional(),
    actualLatencyMs: z.number().int().nonnegative().optional(),
    externalCalls: z.number().int().nonnegative().optional(),
  })
  .strict()
  .optional()

export type CostMetadata = z.output<typeof CostMetadataSchema>

/** ActionMetadataSchema. */
export const ActionMetadataSchema = z
  .object({
    confidence: ConfidenceMetadataSchema.optional(),
    cost: CostMetadataSchema,
  })
  .strict()
  .optional()

export type ActionMetadata = z.output<typeof ActionMetadataSchema>

/** VerificationPlanSchema. */
export const VerificationPlanSchema = z
  .object({
    checkId: z.string().min(1),
    stepId: StepIdSchema,
    type: VerificationCheckTypeSchema,
    expected: z.string().min(1),
  })
  .strict()

export type VerificationPlan = z.output<typeof VerificationPlanSchema>

/** CompensationPlanSchema. */
export const CompensationPlanSchema = z
  .object({
    stepId: StepIdSchema,
    compensateStepId: StepIdSchema.optional(),
    mode: CompensationModeSchema,
    reason: z.string().optional(),
    requiresUserApproval: z.boolean().optional(),
  })
  .strict()

export type CompensationPlan = z.output<typeof CompensationPlanSchema>

/** MissionStepSchema. */
export const MissionStepSchema = z
  .object({
    stepId: StepIdSchema,
    description: z.string().min(1),
    actionType: EdgeGDEActionTypeSchema,
    input: z.unknown(),
    targetRef: z.string().optional(),
    dependsOn: z.array(StepIdSchema).optional(),
    approvalMode: ApprovalModeSchema,
    risk: RiskLevelSchema,
  })
  .strict()

export type MissionStep = z.output<typeof MissionStepSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Mission Manifest
// ═══════════════════════════════════════════════════════════════════════════

/** Schema for a complete agentic mission manifest. */
export const AgenticMissionManifestSchema = z
  .object({
    id: MissionIdSchema,
    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    siteId: SiteIdSchema.optional(),
    correlationId: CorrelationIdSchema,
    transactionId: TransactionIdSchema.optional(),
    stateProjectionVersion: z.number().int().min(0),

    intent: z.string().min(1),
    expectedOutcome: z.string().min(1),

    steps: z.array(MissionStepSchema).min(1),

    verificationPlan: z.array(VerificationPlanSchema).min(1),

    compensationPlan: z.array(CompensationPlanSchema).min(1),

    gogo: z
      .object({
        authorizedBy: z.string().min(1),
        authorizedAt: z.string().min(1),
        scope: z
          .object({
            actions: z.array(z.string()).optional(),
            paths: z.array(z.string()).optional(),
            maxDrift: z.number().min(0).optional(),
            maxCompensationTimeMs: z.number().min(0).optional(),
          })
          .optional(),
        constraints: z
          .object({
            allowShell: z.boolean().optional(),
            allowDelete: z.boolean().optional(),
            allowDeploy: z.boolean().optional(),
            allowNetwork: z.boolean().optional(),
          })
          .optional(),
        expiresAt: z.string().optional(),
        notes: z.string().optional(),
      })
      .optional(),

    metadata: ActionMetadataSchema,

    status: MissionStatusSchema,

    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const stepIds = new Set<string>()

    for (const step of manifest.steps) {
      if (stepIds.has(step.stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', manifest.steps.indexOf(step), 'stepId'],
          message: 'stepId must be unique within the mission manifest',
        })
      }
      stepIds.add(step.stepId)
    }

    for (const step of manifest.steps) {
      const dependsOn = step.dependsOn ?? []

      for (const dependency of dependsOn) {
        if (!stepIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', manifest.steps.indexOf(step), 'dependsOn'],
            message: `step dependsOn unknown stepId: ${dependency}`,
          })
        }
      }
    }

    if (hasDependencyCycle(manifest.steps)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: 'mission manifest steps must not contain dependency cycles',
      })
    }

    if (manifest.compensationPlan.length !== manifest.steps.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compensationPlan'],
        message: 'compensationPlan must declare one entry per mission step',
      })
    }

    const compensationStepIds = new Set(manifest.compensationPlan.map((entry) => entry.stepId))
    for (const stepId of stepIds) {
      if (!compensationStepIds.has(stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['compensationPlan'],
          message: `missing compensation declaration for stepId: ${stepId}`,
        })
      }
    }

    const verificationStepIds = new Set(manifest.verificationPlan.map((entry) => entry.stepId))
    for (const stepId of stepIds) {
      if (!verificationStepIds.has(stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['verificationPlan'],
          message: `missing verification declaration for stepId: ${stepId}`,
        })
      }
    }

    manifest.steps.forEach((step, index) => {
      if (step.approvalMode === 'none' && step.risk !== 'none') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'approvalMode'],
          message: 'non-none risk actions must declare an approval mode',
        })
      }
    })
  })

export type AgenticMissionManifest = z.output<typeof AgenticMissionManifestSchema>
export type RawAgenticMissionManifest = z.input<typeof AgenticMissionManifestSchema>

/** Detect cycles in mission step dependency graph. */
export function hasDependencyCycle(steps: MissionStep[]): boolean {
  const graph = new Map<string, string[]>()

  for (const step of steps) {
    graph.set(step.stepId, step.dependsOn ?? [])
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(stepId: string): boolean {
    if (visiting.has(stepId)) {
      return true
    }

    if (visited.has(stepId)) {
      return false
    }

    visiting.add(stepId)

    for (const dependency of graph.get(stepId) ?? []) {
      if (visit(dependency)) {
        return true
      }
    }

    visiting.delete(stepId)
    visited.add(stepId)
    return false
  }

  for (const step of steps) {
    if (visit(step.stepId)) {
      return true
    }
  }

  return false
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Boundary
// ═══════════════════════════════════════════════════════════════════════════

/** Schema for LLM proposals, restricted to non-executable fields. */
export const LLMProposalSchema = z
  .object({
    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    intent: z.string().min(1).optional(),
    missionManifestDraft: z.unknown().optional(),
    explanation: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough()
  .superRefine((proposal, ctx) => {
    const allowedFields = new Set(['sessionId', 'tenantId', 'intent', 'missionManifestDraft', 'explanation', 'confidence'])
    const executableFields = ['idempotencyKey', 'expectedVersion', 'executionMode', 'stateProjectionVersion']

    for (const field of Object.keys(proposal)) {
      if (!allowedFields.has(field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'LLM proposal contains an unknown field',
        })
      }
    }

    for (const field of executableFields) {
      if (field in proposal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'LLM proposals must not include executable action fields',
        })
      }
    }
  })

export type LLMProposal = z.output<typeof LLMProposalSchema>
export type RawLLMProposal = z.input<typeof LLMProposalSchema>

/** Assert that an LLM proposal does not satisfy an executable action schema. */
export function assertLlmProposalIsNotExecutable(proposal: LLMProposal): true {
  if (EdgeGDEActionSchema.safeParse(proposal).success) {
    throw new Error('LLM proposal incorrectly satisfies EdgeGDEAction schema')
  }

  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// State Projection
// ═══════════════════════════════════════════════════════════════════════════

/** Summary of applicable policies for a state projection. */
export const PolicySummarySchema = z
  .object({
    policyVersion: z.string().min(1),
    approvalRulesVersion: z.string().min(1).optional(),
    forbiddenActions: z.array(EdgeGDEActionTypeSchema).optional(),
    allowedDomains: z.array(z.string().min(1)).optional(),
  })
  .strict()

export type PolicySummary = z.output<typeof PolicySummarySchema>

/** ToolManifestSchema. */
export const ToolManifestSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.unknown(),
    outputSchema: z.unknown().optional(),
    risk: RiskLevelSchema,
    approvalRequired: z.boolean(),
    approvalMode: ApprovalModeSchema.optional(),
    dryRunSupported: z.boolean().default(true),
    compensation: CompensationPlanSchema.optional(),
  })
  .strict()

export type ToolManifest = z.output<typeof ToolManifestSchema>

/** CalculatorManifestSchema. */
export const CalculatorManifestSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('calculator'),
    description: z.string().min(1),
    inputSchema: z.unknown(),
    outputSchema: z.unknown().optional(),
    risk: RiskLevelSchema,
    approvalRequired: z.boolean(),
    approvalMode: ApprovalModeSchema.optional(),
    dryRunSupported: z.boolean().default(true),
    compensation: CompensationPlanSchema.optional(),
  })
  .strict()

export type CalculatorManifest = z.output<typeof CalculatorManifestSchema>

/** EdgeGDEAgentManifestSchema. */
export const EdgeGDEAgentManifestSchema = z
  .object({
    schemaVersion: z.string().min(1),
    tenantId: TenantIdSchema,
    siteSlug: z.string().min(1),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    tools: z.array(ToolManifestSchema).optional(),
    policy: z
      .object({
        approvalRules: z.array(z.unknown()).optional(),
        allowedDomains: z.array(z.string().min(1)).optional(),
        forbiddenActions: z.array(EdgeGDEActionTypeSchema).optional(),
      })
      .strict()
      .optional(),
    audit: z
      .object({
        required: z.boolean(),
        events: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type EdgeGDEAgentManifest = z.output<typeof EdgeGDEAgentManifestSchema>

/** StateProjectionSchema. */
export const StateProjectionSchema = z
  .object({
    tenantId: TenantIdSchema,
    siteId: SiteIdSchema.optional(),
    version: z.number().int().min(0),
    lastVerifiedVersion: z.number().int().min(0),

    canvasSnapshot: z.unknown().optional(),
    uiStructure: z.unknown().optional(),

    availableActions: z.array(EdgeGDEActionTypeSchema),
    tools: z.array(ToolManifestSchema),
    calculators: z.array(CalculatorManifestSchema),

    chatContext: z.unknown().optional(),
    agentManifest: EdgeGDEAgentManifestSchema.optional(),

    policySummary: PolicySummarySchema,

    generatedAt: DateTimeSchema,
  })
  .strict()
  .superRefine((projection, ctx) => {
    if (projection.lastVerifiedVersion > projection.version) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lastVerifiedVersion'],
        message: 'lastVerifiedVersion cannot exceed state projection version',
      })
    }
  })

export type StateProjection = z.output<typeof StateProjectionSchema>

// ═══════════════════════════════════════════════════════════════════════════
// EdgeGDEAction
// ═══════════════════════════════════════════════════════════════════════════

/** Schema for a complete EdgeGDE action with all required fields. */
export const EdgeGDEActionSchema = z
  .object({
    id: ActionIdSchema,
    idempotencyKey: IdempotencyKeySchema,

    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    siteId: SiteIdSchema.optional(),
    correlationId: CorrelationIdSchema,
    missionId: MissionIdSchema,
    transactionId: TransactionIdSchema.optional(),
    stepId: StepIdSchema,

    type: EdgeGDEActionTypeSchema,
    intent: z.string().min(1),
    input: z.unknown(),
    targetRef: z.string().optional(),

    stateProjectionVersion: z.number().int().min(0),
    expectedVersion: z.number().int().min(0),
    executionMode: ExecutionModeSchema,

    risk: RiskLevelSchema,
    approvalRequired: z.boolean(),
    approvalMode: ApprovalModeSchema.optional(),

    compensation: CompensationPlanSchema.optional(),

    metadata: ActionMetadataSchema,

    status: ActionStatusSchema,

    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema.optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (action.approvalRequired && action.approvalMode === 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvalMode'],
        message: 'approvalRequired=true requires an approval mode other than none',
      })
    }

    if (action.executionMode === 'execute' && action.approvalRequired && action.approvalMode === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvalMode'],
        message: 'execute actions that require approval must declare approvalMode',
      })
    }
  })

export type EdgeGDEAction = z.output<typeof EdgeGDEActionSchema>
export type RawEdgeGDEAction = z.input<typeof EdgeGDEActionSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Action Result + Dry Run
// ═══════════════════════════════════════════════════════════════════════════

/** Schema for action verification results. */
export const VerificationResultSchema = z
  .object({
    passed: z.boolean(),
    checks: z
      .array(
        z
          .object({
            name: z.string().min(1),
            passed: z.boolean(),
            evidence: z.unknown().optional(),
            message: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .optional()

export type VerificationResult = z.output<typeof VerificationResultSchema>

/** CompensationActionResultSchema. */
export const CompensationActionResultSchema = z
  .object({
    required: z.boolean(),
    status: CompensationStatusSchema.optional(),
    compensatedActionIds: z.array(ActionIdSchema).optional(),
  })
  .strict()
  .optional()

export type CompensationActionResult = z.output<typeof CompensationActionResultSchema>

/** EdgeGDEActionResultSchema. */
export const EdgeGDEActionResultSchema = z
  .object({
    actionId: ActionIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    correlationId: CorrelationIdSchema,
    missionId: MissionIdSchema,
    transactionId: TransactionIdSchema.optional(),
    stepId: StepIdSchema,

    executionMode: ExecutionModeSchema,
    status: ActionResultStatusSchema,

    output: z.unknown().optional(),
    verification: VerificationResultSchema,

    compensation: CompensationActionResultSchema,

    auditEventIds: z.array(z.string().min(1)).optional(),

    metadata: ActionMetadataSchema,

    createdAt: DateTimeSchema,
    completedAt: DateTimeSchema.optional(),
  })
  .strict()

export type EdgeGDEActionResult = z.output<typeof EdgeGDEActionResultSchema>
export type RawEdgeGDEActionResult = z.input<typeof EdgeGDEActionResultSchema>

/** DryRunResultSchema. */
export const DryRunResultSchema = EdgeGDEActionResultSchema.extend({
  executionMode: z.literal('preview'),
  wouldExecute: z.boolean(),
  wouldMutate: z.literal(false),
  projectedDiff: z.unknown().optional(),
  validation: z
    .object({
      passed: z.boolean(),
      errors: z.array(z.unknown()).optional(),
    })
    .strict()
    .optional(),
  policy: z
    .object({
      passed: z.boolean(),
      approvalRequired: z.boolean(),
      approvalMode: ApprovalModeSchema.optional(),
      deniedReason: z.string().optional(),
    })
    .strict()
    .optional(),
  expectedVersion: z
    .object({
      passed: z.boolean(),
      expected: z.number().int().min(0),
      actual: z.number().int().min(0),
    })
    .strict()
    .optional(),
  verificationPlan: VerificationPlanSchema.array().optional(),
  compensationPlan: CompensationPlanSchema.optional(),
})

export type DryRunResult = z.output<typeof DryRunResultSchema>
export type RawDryRunResult = z.input<typeof DryRunResultSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Compensation Action
// ═══════════════════════════════════════════════════════════════════════════

export const CompensationActionSchema = z
  .object({
    id: ActionIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    originalActionId: ActionIdSchema,
    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    correlationId: CorrelationIdSchema,
    missionId: MissionIdSchema,
    transactionId: TransactionIdSchema.optional(),

    compensateActionType: EdgeGDEActionTypeSchema,
    input: z.unknown(),

    mode: z.enum(['reverse', 'soft_reverse', 'manual']),
    reason: z.string().optional(),

    status: CompensationStatusSchema,

    auditEventIds: z.array(z.string().min(1)).optional(),

    createdAt: DateTimeSchema,
    completedAt: DateTimeSchema.optional(),
  })
  .strict()

export type CompensationAction = z.output<typeof CompensationActionSchema>
export type RawCompensationAction = z.input<typeof CompensationActionSchema>

// ═══════════════════════════════════════════════════════════════════════════
// UX Events + Execution Transitions
// ═══════════════════════════════════════════════════════════════════════════

export const UXEventTypeSchema = z.enum([
  'ux.session.started',
  'ux.session.context_loaded',
  'ux.mission.proposed',
  'ux.mission.validated',
  'ux.mission.rejected',
  'ux.action.proposed',
  'ux.action.validated',
  'ux.action.dry_run_started',
  'ux.action.dry_run_completed',
  'ux.action.approval_required',
  'ux.action.approved',
  'ux.action.denied',
  'ux.action.executing',
  'ux.action.completed',
  'ux.action.failed',
  'ux.action.compensating',
  'ux.action.compensated',
  'ux.ui.fragment.generated',
  'ux.ui.fragment.rendered',
  'ux.artifact.created',
  'ux.verification.started',
  'ux.verification.passed',
  'ux.verification.failed',
  'ux.workflow.compensation_started',
  'ux.workflow.compensation_completed',
  'ux.workflow.compensation_failed',
  'ux.audit.appended',
  'ux.session.completed',
  'ux.error',
])

/** UXEventSchema. */
export const UXEventSchema = z
  .object({
    id: z.string().min(1),
    type: UXEventTypeSchema,

    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    siteId: SiteIdSchema.optional(),
    correlationId: CorrelationIdSchema,

    missionId: MissionIdSchema.optional(),
    actionId: ActionIdSchema.optional(),
    auditEventId: z.string().min(1).optional(),

    sequence: z.number().int().min(0),

    timestamp: DateTimeSchema,
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type UXEvent = z.output<typeof UXEventSchema>
export type RawUXEvent = z.input<typeof UXEventSchema>

/** ExecutionTransitionNameSchema. */
export const ExecutionTransitionNameSchema = z.enum([
  'validate',
  'idempotency_check',
  'dry_run',
  'approval_check',
  'execute',
  'verify',
  'compensate_if_needed',
  'audit_append',
])

export const AGENTIC_UX_EXECUTION_ORDER = [
  'validate',
  'idempotency_check',
  'dry_run',
  'approval_check',
  'execute',
  'verify',
  'compensate_if_needed',
  'audit_append',
] as const

export type ExecutionTransitionName = z.output<typeof ExecutionTransitionNameSchema>

/** ExecutionTransitionSchema. */
export const ExecutionTransitionSchema = z
  .object({
    transition: ExecutionTransitionNameSchema,
    sequence: z.number().int().min(0),
    auditEventId: z.string().min(1),
    occurredAt: DateTimeSchema,
  })
  .strict()

export type ExecutionTransition = z.output<typeof ExecutionTransitionSchema>

export function validateExecutionOrder(transitions: readonly ExecutionTransition[]): {
  passed: boolean
  errors: string[]
} {
  const expected = [...AGENTIC_UX_EXECUTION_ORDER]
  const actual = transitions.map((transition) => transition.transition)
  const errors: string[] = []

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`execution order must be exactly ${expected.join(' → ')}`)
  }

  for (let index = 1; index < transitions.length; index += 1) {
    if (transitions[index]!.sequence <= transitions[index - 1]!.sequence) {
      errors.push('transition sequence must be strictly increasing')
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  }
}

export function validateEventOrdering(events: readonly UXEvent[]): {
  passed: boolean
  errors: string[]
} {
  const errors: string[] = []

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!
    const current = events[index]!

    if (current.sequence <= previous.sequence) {
      errors.push(`event sequence must be strictly increasing at index ${index}`)
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Transaction Grouping
// ═══════════════════════════════════════════════════════════════════════════

export const TransactionGroupStatusSchema = z.enum(['planned', 'approved', 'executing', 'completed', 'compensating', 'failed'])
export type TransactionGroupStatus = z.output<typeof TransactionGroupStatusSchema>

export const TransactionGroupSchema = z
  .object({
    transactionId: TransactionIdSchema,
    missionId: MissionIdSchema,
    sessionId: SessionIdSchema,
    tenantId: TenantIdSchema,
    actionIds: z.array(ActionIdSchema).min(1),
    status: TransactionGroupStatusSchema,
  })
  .strict()

export type TransactionGroup = z.output<typeof TransactionGroupSchema>

export function validateActionTransactionGroup(actions: readonly EdgeGDEAction[]): {
  passed: boolean
  errors: string[]
} {
  const errors: string[] = []
  const grouped = new Map<string, EdgeGDEAction[]>()

  for (const action of actions) {
    if (action.transactionId) {
      const group = grouped.get(action.transactionId) ?? []
      group.push(action)
      grouped.set(action.transactionId, group)
    }
  }

  for (const [transactionId, group] of grouped.entries()) {
    const first = group[0]

    if (!first) {
      continue
    }

    for (const action of group.slice(1)) {
      if (action.tenantId !== first.tenantId || action.sessionId !== first.sessionId || action.missionId !== first.missionId) {
        errors.push(`transactionId ${transactionId} groups actions from different tenant/session/mission`)
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  }
}

export function findDuplicateIdempotencyKeys(actions: readonly EdgeGDEAction[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const action of actions) {
    if (seen.has(action.idempotencyKey)) {
      duplicates.add(action.idempotencyKey)
    }
    seen.add(action.idempotencyKey)
  }

  return [...duplicates]
}

export function canonicalStableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStableStringify(entry)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalStableStringify(record[key])}`)
    .join(',')}}`
}

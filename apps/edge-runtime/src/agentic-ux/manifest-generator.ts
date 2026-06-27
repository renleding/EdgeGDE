/**
 * EdgeGDE — Agentic UX: Manifest Generator
 *
 * Builds a valid AgenticMissionManifest from a high-level goal.
 * Bridges the gap between simple API requests and the full manifest format
 * by populating sensible defaults for risk, approval, compensation, and
 * verification plans.
 *
 * @packageDocumentation
 */

import { AgenticMissionManifestSchema, type AgenticMissionManifest } from './agentic-ux.schema'

// ═══════════════════════════════════════════════════════════════════════════
// Simple Input — lighter than the full manifest
// ═══════════════════════════════════════════════════════════════════════════

export interface SimpleMissionGoal {
  /** A human-readable intent (e.g. "Calculate loan repayment for $500k at 6% over 30 years") */
  intent: string

  /** The action type to execute (e.g. "calculator.execute") */
  actionType: string

  /** The input payload for the action */
  input: unknown

  /** Tenant / correlation IDs */
  tenantId: string
  correlationId: string
  sessionId?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Default risk/approval mappings
// ═══════════════════════════════════════════════════════════════════════════

function defaultRisk(actionType: string): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (actionType.startsWith('calculator.')) return 'none'
  if (actionType.startsWith('browser.')) return 'low'
  if (actionType.startsWith('canvas.')) return 'low'
  if (actionType.startsWith('chat.')) return 'none'
  if (actionType.startsWith('form.')) return 'low'
  if (actionType === 'lead.capture') return 'medium'
  if (actionType === 'payment.initiate') return 'critical'
  if (actionType === 'site.publish') return 'high'
  if (actionType === 'site.rollback') return 'high'
  return 'low'
}

function defaultApproval(actionType: string): 'none' | 'user' | 'tenant_policy' | 'admin' | 'external' {
  if (actionType.startsWith('calculator.')) return 'none'
  if (actionType.startsWith('browser.')) return 'user'
  if (actionType.startsWith('canvas.')) return 'user'
  if (actionType === 'payment.initiate') return 'admin'
  if (actionType === 'site.publish') return 'admin'
  if (actionType === 'site.rollback') return 'admin'
  return 'none'
}

function defaultCompensationMode(actionType: string): 'none' | 'reverse' | 'soft_reverse' | 'manual' {
  if (actionType === 'canvas.add_node') return 'reverse'
  if (actionType === 'canvas.delete_node') return 'reverse'
  if (actionType === 'lead.capture') return 'reverse'
  if (actionType === 'site.publish') return 'manual'
  if (actionType.startsWith('calculator.')) return 'none'
  return 'none'
}

function defaultVerificationCheckType(actionType: string): 'schema_validation' | 'calculator_output_check' | 'state_projection' | 'audit_event_check' {
  if (actionType.startsWith('calculator.')) return 'calculator_output_check'
  if (actionType.startsWith('canvas.')) return 'state_projection'
  if (actionType === 'site.publish') return 'audit_event_check'
  return 'schema_validation'
}

// ═══════════════════════════════════════════════════════════════════════════
// Generator
// ═══════════════════════════════════════════════════════════════════════════

let missionCounter = 0

/**
 * Generate a valid AgenticMissionManifest from a simple goal.
 *
 * Populates all required fields with sensible defaults so the manifest
 * passes AgenticMissionManifestSchema validation.
 */
export function generateManifestFromGoal(goal: SimpleMissionGoal): AgenticMissionManifest {
  missionCounter++
  const now = new Date().toISOString()
  const stepId = `step-${missionCounter}`

  const risk = defaultRisk(goal.actionType)
  const approvalMode = defaultApproval(goal.actionType)
  const compMode = defaultCompensationMode(goal.actionType)
  const verifyType = defaultVerificationCheckType(goal.actionType)

  const manifest = {
    id: `mission-${missionCounter}`,
    sessionId: goal.sessionId ?? `session-${missionCounter}`,
    tenantId: goal.tenantId,
    correlationId: goal.correlationId,
    stateProjectionVersion: 1,
    intent: goal.intent,
    expectedOutcome: `Successfully executed "${goal.actionType}" with provided input`,
    steps: [
      {
        stepId,
        description: goal.intent,
        actionType: goal.actionType,
        input: goal.input,
        dependsOn: [],
        approvalMode,
        risk,
      },
    ],
    verificationPlan: [
      {
        checkId: `check-${missionCounter}`,
        stepId,
        type: verifyType,
        expected: 'Action completed without error',
      },
    ],
    compensationPlan: [
      {
        stepId,
        mode: compMode,
      },
    ],
    metadata: {
      cost: {
        estimatedTokens: 0,
        actualTokens: 0,
      },
    },
    status: 'proposed' as const,
    createdAt: now,
  }

  const parsed = AgenticMissionManifestSchema.parse(manifest)
  return parsed
}

/**
 * EdgeGDE — Audit Ledger Writer
 *
 * Sends structured events to the AuditLedger Durable Object.
 * Called from the lifecycle runner to record action_executed,
 * mission_executed, and compensation_executed events.
 *
 * @packageDocumentation
 */

import type { ActionExecutionRecord, MissionLifecycleResult } from './lifecycle'

const ALLOWED_TYPES = new Set([
  'action_executed',
  'mission_executed',
  'compensation_executed',
])

/**
 * Send an event to the AuditLedger DO.
 * Fire-and-forget — failures are logged but never thrown.
 */
export async function appendToAuditLedger(
  env: Record<string, unknown>,
  event: {
    type: string
    tenantId: string
    actor: string
    sessionId?: string
    data: Record<string, unknown>
    idempotency_key?: string
  },
): Promise<void> {
  if (!ALLOWED_TYPES.has(event.type)) return

  const doNamespace = env.AUDIT_LEDGER as DurableObjectNamespace | undefined
  if (!doNamespace || typeof doNamespace.idFromName !== 'function') return

  try {
    const id = doNamespace.idFromName(`tenant:${event.tenantId}`)
    const stub = doNamespace.get(id)
    const resp = await stub.fetch('http://do/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: event.tenantId,
        sessionId: event.sessionId,
        type: event.type,
        actor: event.actor,
        data: event.data,
        idempotency_key: event.idempotency_key,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      console.warn(JSON.stringify({ event: 'audit_append_failed', type: event.type, status: resp.status, body }))
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ event: 'audit_append_error', type: event.type, error: err.message }))
  }
}

/**
 * Record an action execution to the AuditLedger.
 */
export async function auditActionExecuted(
  env: Record<string, unknown>,
  record: ActionExecutionRecord,
): Promise<void> {
  await appendToAuditLedger(env, {
    type: 'action_executed',
    tenantId: record.ctx.tenantId,
    actor: 'system',
    sessionId: record.ctx.correlationId,
    data: {
      actionType: record.step.actionType,
      input: record.step.input,
      output: record.result.output,
      status: record.result.status,
      stepId: record.step.stepId,
      missionId: record.ctx.missionId,
      correlationId: record.ctx.correlationId,
    },
    idempotency_key: `${record.ctx.missionId}:${record.step.stepId}:action`,
  })
}

/**
 * Record a mission completion to the AuditLedger.
 */
export async function auditMissionExecuted(
  env: Record<string, unknown>,
  result: MissionLifecycleResult,
): Promise<void> {
  await appendToAuditLedger(env, {
    type: 'mission_executed',
    tenantId: result.correlationId, // correlationId is used as tenantId context
    actor: 'system',
    sessionId: result.correlationId,
    data: {
      missionId: result.missionId,
      status: result.status,
      correlationId: result.correlationId,
      actionCount: result.executedActions.length,
    },
    idempotency_key: `${result.missionId}:complete`,
  })
}

/**
 * Record a compensation event to the AuditLedger.
 */
export async function auditCompensationExecuted(
  env: Record<string, unknown>,
  tenantId: string,
  missionId: string,
  correlationId: string,
  compensationType: string,
): Promise<void> {
  await appendToAuditLedger(env, {
    type: 'compensation_executed',
    tenantId,
    actor: 'system',
    sessionId: correlationId,
    data: {
      missionId,
      correlationId,
      compensationType,
    },
    idempotency_key: `${missionId}:compensate:${compensationType}`,
  })
}

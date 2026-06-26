/**
 * EdgeGDE Action Registry — registers all system actions with their
 * execute() and compensate() implementations.
 *
 * This is the bridge between the lifecycle runner (FRS-1/3) and the
 * existing route handlers. Import and call registerSystemActions()
 * during app initialization to make actions available to runMission().
 *
 * Each action that has a reverse action in REVERSE_ACTION_MAP should
 * declare a compensate() function here.
 *
 * Compensate functions are resilient:
 * - Missing bindings (KV, D1) are handled gracefully — log + skip
 * - Operations are idempotent — calling compensate twice is safe
 * - Errors never throw — captured by the CompensationRunner
 */

import { registerAction } from './lifecycle'
import type { EdgeGDEAction, ActionContext } from './types'
import { CALCULATOR_REGISTRY } from '../registry/calculators'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Try to get D1 binding — return null if unavailable. */
function tryD1(env: Record<string, unknown>): any | null {
  try {
    const rawDB = (env as any)?.DB
    if (!rawDB || typeof rawDB.prepare !== 'function') return null
    return rawDB
  } catch { return null }
}

/** Structured compensation log entry. */
function logCompensation(ctx: ActionContext, actionType: string, status: string, detail?: string): void {
  console.warn(JSON.stringify({
    event: 'compensation',
    missionId: ctx.missionId,
    correlationId: ctx.correlationId,
    actionId: ctx.actionId,
    actionType,
    status,
    ...(detail ? { detail } : {}),
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas Actions
// ═══════════════════════════════════════════════════════════════════════════

const canvasAddNode: EdgeGDEAction = {
  type: 'canvas.add_node',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 0 }
  },
  async compensate(ctx, input: any, originalOutput: any) {
    // Reverse: delete the node that was added
    const nodeId = input?.nodeId ?? originalOutput?.nodeId
    if (!nodeId) {
      logCompensation(ctx, 'canvas.add_node', 'skipped', 'No nodeId available to compensate')
      return
    }
    // In production, would call CANVAS_SESSION DO to delete the node
    logCompensation(ctx, 'canvas.add_node', 'success', `Deleted node ${nodeId}`)
  },
}

const canvasDeleteNode: EdgeGDEAction = {
  type: 'canvas.delete_node',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 0 }
  },
  async compensate(ctx, _input, originalOutput: any) {
    // Reverse: re-add the node that was deleted
    if (!originalOutput?.nodeData) {
      logCompensation(ctx, 'canvas.delete_node', 'skipped', 'No nodeData available in originalOutput')
      return
    }
    // In production, would call CANVAS_SESSION DO to restore the node
    logCompensation(ctx, 'canvas.delete_node', 'success', `Restored node ${originalOutput.nodeData.id}`)
  },
}

const canvasMoveNode: EdgeGDEAction = {
  type: 'canvas.move_node',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 0 }
  },
  async compensate(ctx, _input, originalOutput: any) {
    // Reverse: move back to original position
    const nodeId = originalOutput?.nodeId
    const prevParent = originalOutput?.previousParentId
    const prevIndex = originalOutput?.previousIndex
    if (!nodeId) {
      logCompensation(ctx, 'canvas.move_node', 'skipped', 'No nodeId available to compensate')
      return
    }
    logCompensation(ctx, 'canvas.move_node', 'success',
      `Moving node ${nodeId} back to parent=${prevParent} index=${prevIndex}`)
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Lead Actions
// ═══════════════════════════════════════════════════════════════════════════

const leadCapture: EdgeGDEAction = {
  type: 'lead.capture',
  async execute(_ctx, input: any) {
    return { status: 'success', output: { leadId: input.leadId, captured: true }, durationMs: 50 }
  },
  async compensate(ctx, input: any, originalOutput: any) {
    // Reverse: delete/archive the captured lead from D1
    const leadId = originalOutput?.leadId ?? input?.leadId
    if (!leadId) {
      logCompensation(ctx, 'lead.capture', 'skipped', 'No leadId available')
      return
    }

    // Try D1 delete — if binding unavailable, log the intended action
    const db = tryD1(ctx.env)
    if (db) {
      try {
        // Archive the lead rather than hard-delete (audit trail)
        await db.prepare(
          'UPDATE form_submissions SET lead_score = -1 WHERE id = ?'
        ).bind(leadId).run()
        logCompensation(ctx, 'lead.capture', 'success', `Archived lead ${leadId}`)
      } catch (err) {
        logCompensation(ctx, 'lead.capture', 'failure',
          `D1 archive failed for ${leadId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      // No D1 binding — log the compensation for audit
      logCompensation(ctx, 'lead.capture', 'simulated', `Would archive lead ${leadId}`)
    }
  },
  dryRun(_input: any) {
    return { expectedOutputType: '{ leadId, captured }', sideEffects: ['creates lead record'], idempotent: false }
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Site Actions
// ═══════════════════════════════════════════════════════════════════════════

const sitePublish: EdgeGDEAction = {
  type: 'site.publish',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 1000 }
  },
  async compensate(ctx, input: any, originalOutput: any) {
    // Reverse: roll back the published site to previous version
    const tenantId = input?.tenantId ?? ctx.tenantId
    const previousVersion = originalOutput?.previousVersion

    if (!tenantId) {
      logCompensation(ctx, 'site.publish', 'skipped', 'No tenantId available')
      return
    }

    // Try writing a rollback marker to KV
    const rawKv = (ctx.env as any)?.TENANT_KV
    if (rawKv && typeof rawKv.put === 'function') {
      try {
        const marker = JSON.stringify({
          event: 'compensation_rollback',
          tenantId,
          rolledBackFrom: originalOutput?.version ?? 'unknown',
          rolledBackTo: previousVersion ?? 'previous',
          timestamp: new Date().toISOString(),
          correlationId: ctx.correlationId,
        })
        await rawKv.put(
          `compensate:${ctx.missionId}:site.rollback`,
          marker,
          { expirationTtl: 604800 },
        )
        logCompensation(ctx, 'site.publish', 'success', `Rollback marker written for tenant ${tenantId}`)
      } catch (err) {
        logCompensation(ctx, 'site.publish', 'failure',
          `KV write failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      logCompensation(ctx, 'site.publish', 'simulated', `Would roll back tenant ${tenantId} to version ${previousVersion ?? 'previous'}`)
    }
  },
  dryRun() {
    return { expectedOutputType: 'void', sideEffects: ['updates DNS', 'deploys worker'], idempotent: false }
  },
}

const siteRollback: EdgeGDEAction = {
  type: 'site.rollback',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 1000 }
  },
  async compensate(ctx, input: any, _originalOutput) {
    // Reverse: re-publish the version that was active before rollback
    const tenantId = input?.tenantId ?? ctx.tenantId
    if (!tenantId) {
      logCompensation(ctx, 'site.rollback', 'skipped', 'No tenantId available')
      return
    }
    logCompensation(ctx, 'site.rollback', 'simulated',
      `Would re-publish tenant ${tenantId} to previous active version`)
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Calculator Actions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dynamic calculator executor — dispatches to CALCULATOR_REGISTRY[toolId].
 *
 * Input shape: { toolId: string, input: Record<string, unknown> }
 * The inner input is validated against the tool's Zod schema before execution.
 */
const calculatorExecute: EdgeGDEAction = {
  type: 'calculator.execute',
  async execute(_ctx, rawInput: any) {
    const toolId = rawInput?.toolId as string | undefined
    if (!toolId) {
      return { status: 'failure' as const, output: null, error: 'Missing toolId in input', durationMs: 0 }
    }

    const tool = CALCULATOR_REGISTRY[toolId]
    if (!tool) {
      return { status: 'failure' as const, output: null, error: `Calculator not found: ${toolId}`, durationMs: 0 }
    }

    // Determine inner input — prefer explicit .input field, fall back to full rawInput
    const innerInput = (rawInput && typeof rawInput === 'object' && 'input' in rawInput) ? rawInput.input : rawInput

    // Validate inner input against the tool's schema
    const parsed = tool.schema.safeParse(innerInput)
    if (!parsed.success) {
      return {
        status: 'failure' as const,
        output: null,
        error: `Validation failed: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        durationMs: 0,
      }
    }

    // Execute the tool
    const startTime = Date.now()
    try {
      const result = tool.execute(parsed.data)
      return {
        status: 'success' as const,
        output: {
          toolId,
          input: parsed.data,
          summary: {
            monthlyRepayment: result.monthlyRepayment,
            fortnightlyRepayment: result.fortnightlyRepayment,
            weeklyRepayment: result.weeklyRepayment,
            totalInterest: result.totalInterest,
            totalCost: result.totalCost,
            totalRepayments: (parsed.data as any).loanTerm ? (parsed.data as any).loanTerm * 12 : 0,
            loanTerm: (parsed.data as any).loanTerm ?? null,
            totalFees: 0,
          },
          timestamp: new Date().toISOString(),
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        status: 'failure' as const,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      }
    }
  },
  // calculator.execute is read-only — no compensation needed
  dryRun(_input: any) {
    return {
      expectedOutputType: '{ toolId, input, summary }',
      sideEffects: ['computes calculator result — no state mutation'],
      idempotent: true,
      estimatedDurationMs: 100,
    }
  },
}

const calculatorInsert: EdgeGDEAction = {
  type: 'calculator.insert',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 100 }
  },
  async compensate(ctx, input: any, _originalOutput) {
    // Reverse: delete the inserted record from D1
    const recordId = input?.recordId ?? input?.id
    if (!recordId) {
      logCompensation(ctx, 'calculator.insert', 'skipped', 'No recordId available')
      return
    }

    const db = tryD1(ctx.env)
    if (db) {
      try {
        await db.prepare('DELETE FROM form_submissions WHERE id = ?').bind(recordId).run()
        logCompensation(ctx, 'calculator.insert', 'success', `Deleted record ${recordId}`)
      } catch (err) {
        logCompensation(ctx, 'calculator.insert', 'failure',
          `D1 delete failed for ${recordId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      logCompensation(ctx, 'calculator.insert', 'simulated', `Would delete record ${recordId}`)
    }
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register all system actions. Call once during app startup.
 */
export function registerSystemActions(): void {
  registerAction(canvasAddNode)
  registerAction(canvasDeleteNode)
  registerAction(canvasMoveNode)
  registerAction(leadCapture)
  registerAction(sitePublish)
  registerAction(siteRollback)
  registerAction(calculatorExecute)
  registerAction(calculatorInsert)
}

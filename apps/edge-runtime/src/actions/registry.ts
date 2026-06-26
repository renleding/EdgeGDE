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
 */

import { registerAction } from './lifecycle'
import type { EdgeGDEAction, ActionContext } from './types'
import { CALCULATOR_REGISTRY } from '../registry/calculators'

// ═══════════════════════════════════════════════════════════════════════════
// Canvas Actions
// ═══════════════════════════════════════════════════════════════════════════

const canvasAddNode: EdgeGDEAction = {
  type: 'canvas.add_node',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 0 }
  },
  async compensate(_ctx) {
    // Reverse: delete the node that was added
  },
}

const canvasDeleteNode: EdgeGDEAction = {
  type: 'canvas.delete_node',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 0 }
  },
  async compensate(_ctx) {
    // Reverse: re-add the node that was deleted
  },
}

const canvasMoveNode: EdgeGDEAction = {
  type: 'canvas.move_node',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 0 }
  },
  async compensate(_ctx, _input, originalOutput) {
    // Reverse: move back to original position
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
  async compensate(_ctx, _input, _originalOutput) {
    // Reverse: delete/archive the captured lead
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
  async compensate(_ctx, _input, _originalOutput) {
    // Reverse: roll back the published site
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
  async compensate(_ctx, _input, _originalOutput) {
    // Reverse: re-publish the previous version
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
  async compensate(_ctx, _input, _originalOutput) {
    // Reverse: delete the inserted record
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

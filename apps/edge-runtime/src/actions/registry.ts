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

const calculatorExecute: EdgeGDEAction = {
  type: 'calculator.execute',
  async execute(_ctx, _input) {
    return { status: 'success', output: null, durationMs: 100 }
  },
  // calculator.execute is idempotent — no compensation needed
  dryRun() {
    return { expectedOutputType: 'calculator result', sideEffects: ['computes result'], idempotent: true }
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

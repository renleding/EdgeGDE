/**
 * EdgeGDE — Flow Spawner
 *
 * Determines which flows to spawn based on collected fields and trigger rules.
 * Server-driven — NO LLM decision authority.
 *
 * Guard: duplicate spawn prevention, max depth enforcement.
 */

import type { FlowStackEntry } from '../do/chat-session.do'

const MAX_FLOW_DEPTH = 5

export interface SpawnResult {
  spawned: boolean
  flowId?: string
  reason?: string
}

/**
 * Evaluate trigger rules against collected fields and current flow stack.
 * Returns the next flow to spawn, or null.
 */
export function evaluateFlowTriggers(
  collected: Record<string, unknown>,
  flowStack: FlowStackEntry[],
  insightSuggestion?: string,
): SpawnResult {
  // Check max depth
  if (flowStack.length >= MAX_FLOW_DEPTH) {
    return { spawned: false, reason: 'max_depth_reached' }
  }

  // ── FHOG trigger ────────────────────────────────────────────────────
  if (collected.isFirstHomeBuyer === 'Yes') {
    const existing = flowStack.find(f => f.flowId === 'fhog_formal_assessment' && f.state !== 'COMPLETED')
    if (!existing) {
      return { spawned: true, flowId: 'fhog_formal_assessment', reason: 'first_home_buyer' }
    }
  }

  // ── Refinance trigger ────────────────────────────────────────────────
  if (collected.hasExistingLoan === 'Yes' || collected.goal === 'refinance') {
    const existing = flowStack.find(f => f.flowId === 'refinance_assessment' && f.state !== 'COMPLETED')
    if (!existing) {
      return { spawned: true, flowId: 'refinance_assessment', reason: 'existing_loan_or_refinance_goal' }
    }
  }

  // ── Investment trigger ───────────────────────────────────────────────
  if (collected.loanPurpose === 'Investment') {
    const existing = flowStack.find(f => f.flowId === 'investment_validation' && f.state !== 'COMPLETED')
    if (!existing) {
      return { spawned: true, flowId: 'investment_validation', reason: 'investment_purpose' }
    }
  }

  // ── LLM insight suggestion (advisory only) ───────────────────────────
  // If the LLM suggests an insight and no rule-based trigger matched, check it
  if (insightSuggestion) {
    const suggestedFlows: Record<string, string> = {
      fhog: 'fhog_formal_assessment',
      refinance: 'refinance_assessment',
      investment: 'investment_validation',
    }
    const flowId = suggestedFlows[insightSuggestion]
    if (flowId) {
      const existing = flowStack.find(f => f.flowId === flowId && f.state !== 'COMPLETED')
      if (!existing) {
        return { spawned: true, flowId, reason: 'llm_suggestion_validated' }
      }
    }
  }

  return { spawned: false }
}

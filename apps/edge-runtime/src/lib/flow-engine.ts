/**
 * EdgeGDE — Unified Flow Engine
 *
 * Orchestrates the flow lifecycle: rule evaluation → compliance →
 * next action → insight detection → spawn → progress computation.
 *
 * Operates on ChatSession_DO state via the active flow index.
 */

import type { FlowStackEntry, ChatSessionState } from '../do/chat-session.do'

export interface FlowAction {
  type: 'field_prompt' | 'doc_request' | 'auth_gate' | 'flow_spawn' | 'flow_complete' | 'next_flow'
  detail?: string
}

export interface FlowContext {
  state: ChatSessionState
  activeFlow: FlowStackEntry
}

export function resolveActiveFlow(state: ChatSessionState): FlowContext | null {
  const activeFlow = state.flowStack?.[state.activeFlowIndex ?? 0]
  if (!activeFlow || activeFlow.state === 'COMPLETED') return null
  return { state, activeFlow }
}

export function computeProgress(flow: FlowStackEntry, totalFields: number, totalDocs: number): number {
  const total = flow.totalWeight.fields + flow.totalWeight.docs + flow.totalWeight.compliance
  if (total === 0) return 0

  const fieldProgress = totalFields > 0 ? (flow.completedFields.length / totalFields) * flow.totalWeight.fields : 0
  const docProgress = totalDocs > 0 ? (flow.completedDocs.length / totalDocs) * flow.totalWeight.docs : 0
  const complianceComplete = flow.state === 'COMPLETED' || (flow.state === 'ACTIVE' && flow.completedFields.length > 0)
  const complianceProgress = complianceComplete ? flow.totalWeight.compliance : 0

  return Math.round((fieldProgress + docProgress + complianceProgress) / total * 100)
}

export function determineAction(ctx: FlowContext): FlowAction {
  const { state, activeFlow } = ctx

  // Auth gate: if flow requires auth and not verified
  if (activeFlow.requiresAuth && activeFlow.authState !== 'VERIFIED') {
    return { type: 'auth_gate', detail: 'AUTH_REQUIRED' }
  }

  // Blocked flow — return reason
  if (activeFlow.state === 'BLOCKED') {
    return { type: activeFlow.blockReason === 'AUTH_REQUIRED' ? 'auth_gate' : 'next_flow', detail: activeFlow.blockReason }
  }

  // Default: continue field collection
  return { type: 'field_prompt', detail: 'continue_collection' }
}

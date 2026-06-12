/**
 * EdgeGDE Chat — Shared Context Types
 *
 * ChatContext is the shared state object that all split chat modules
 * depend on. It replaces implicit dependencies (env, db, session, etc.)
 * with an explicit interface, making modules testable and decoupled.
 *
 * @packageDocumentation
 */

import type { ChatConfig } from './chat-config'
import type { ChatFieldDef } from './chat-constraint'

// ═══════════════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ChatSessionState {
  sessionId: string
  tenantId: string
  collected: Record<string, unknown>
  currentField: string
  status: 'active' | 'complete' | 'abandoned'
  stepCount: number
  createdAt: number
  updatedAt: number
}

export interface ChatContext {
  /** Cloudflare env bindings */
  env: Record<string, any>
  /** D1 database binding */
  db: any
  /** Current session state */
  session: ChatSessionState
  /** Chat configuration */
  config: ChatConfig
  /** Field definitions for this flow */
  fields: ChatFieldDef[]
  /** Execution context for waitUntil */
  execCtx?: ExecutionContext
}

// ═══════════════════════════════════════════════════════════════════════════
// Module Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chat initialization — creates session, returns initial state.
 */
export interface ChatInitModule {
  createSession(ctx: ChatContext): Promise<Response>
}

/**
 * Tool dispatch — handles LLM response, field extraction, state transitions.
 */
export interface ChatToolModule {
  handleToolCall(ctx: ChatContext, tool: string, payload: any): Promise<Response>
}

/**
 * Field extraction — parses LLM response, validates fields, updates state.
 */
export interface ChatFieldModule {
  extractFields(ctx: ChatContext, llmResponse: string): Promise<{
    validFields: string[]
    errors: string[]
    updatedCollected: Record<string, unknown>
  }>
}

/**
 * Session completion — finalizes session, triggers scoring, returns result.
 */
export interface ChatCompleteModule {
  completeSession(ctx: ChatContext): Promise<Response>
}

/**
 * Audit logging — immutable event log for the chat pipeline.
 */
export interface ChatAuditModule {
  logEvent(
    ctx: ChatContext,
    action: string,
    submissionId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>
}

/**
 * Scoring trigger — launches background scoring pipeline.
 */
export interface ChatScoringModule {
  triggerScoring(ctx: ChatContext, collected: Record<string, unknown>): Promise<void>
}

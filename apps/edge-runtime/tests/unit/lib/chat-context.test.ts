/**
 * EdgeGDE — Chat Context Types (src/lib/chat-context.ts) Test Suite
 *
 * chat-context.ts is a types-only module (interfaces + type imports only, no
 * runtime code). Tests exercise the exported contracts at compile time via
 * `satisfies` fixtures and assert the module loads with the expected exports.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import type {
  ChatSessionState,
  ChatContext,
  ChatInitModule,
  ChatToolModule,
  ChatFieldModule,
  ChatCompleteModule,
  ChatAuditModule,
  ChatScoringModule,
} from '../../../src/lib/chat-context'
import * as chatContextModule from '../../../src/lib/chat-context'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sessionState = (overrides: Partial<ChatSessionState> = {}): ChatSessionState => ({
  sessionId: 'sess-1',
  tenantId: 'tenant-1',
  collected: { name: 'Alice', income: 5000 },
  currentField: 'name',
  status: 'active',
  stepCount: 3,
  createdAt: 1000,
  updatedAt: 1005,
  ...overrides,
})

const ctx = (overrides: Partial<ChatContext> = {}): ChatContext => ({
  env: { DB: {}, KV: {}, MASTER_WRAP_KEY: 'x' },
  db: { prepare: () => {} },
  session: sessionState(),
  config: {
    objective: 'Customer intake',
    // ChatConfig schema uses fieldType 'text'
    fields: [{ fieldName: 'name', label: 'Full name', fieldType: 'text', validation: { required: true } }],
    priorityOrder: ['name'],
    rules: [],
    knowledgeBase: { topics: [] },
    ui: { title: 'Chat', greeting: 'Hi', colorAccent: '#58a6ff' },
    llmFallback: true,
  },
  // ChatFieldDef uses fieldType 'string'
  fields: [{ fieldName: 'name', label: 'Full name', fieldType: 'string', validation: { required: true } }],
  ...overrides,
})

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('chat-context module', () => {
  it('loads as a module with type-only exports (no runtime values)', () => {
    // The module exports only interfaces — nothing but the namespace object itself
    expect(typeof chatContextModule).toBe('object')
    expect(Object.keys(chatContextModule)).toHaveLength(0)
  })

  it('is importable alongside sibling chat modules it type-references', async () => {
    // Compile-time check: the type-only imports from ./chat-config and ./chat-constraint
    // must resolve. Re-importing the module in a dynamic context exercises resolution.
    const mod = await import('../../../src/lib/chat-context')
    expect(mod).toBeDefined()
  })
})

describe('ChatSessionState', () => {
  it('accepts active / complete / abandoned status values', () => {
    const active = sessionState() satisfies ChatSessionState
    const complete = sessionState({ status: 'complete' }) satisfies ChatSessionState
    const abandoned = sessionState({ status: 'abandoned' }) satisfies ChatSessionState
    expect(active.status).toBe('active')
    expect(complete.status).toBe('complete')
    expect(abandoned.status).toBe('abandoned')
  })

  it('carries session identity, collected data and counters', () => {
    const s = sessionState({ collected: { email: 'a@b.c' }, stepCount: 7, currentField: 'email' })
    expect(s.sessionId).toBe('sess-1')
    expect(s.tenantId).toBe('tenant-1')
    expect(s.collected).toEqual({ email: 'a@b.c' })
    expect(s.currentField).toBe('email')
    expect(s.stepCount).toBe(7)
    expect(s.createdAt).toBeLessThanOrEqual(s.updatedAt)
  })
})

describe('ChatContext', () => {
  it('shapes env, db, session, config, fields and optional execCtx', () => {
    const c = ctx({ execCtx: { waitUntil: () => {} } as unknown as ExecutionContext }) satisfies ChatContext
    expect(c.env.MASTER_WRAP_KEY).toBe('x')
    expect(typeof c.db.prepare).toBe('function')
    expect(c.session.sessionId).toBe('sess-1')
    expect(c.config.objective).toBe('Customer intake')
    expect(c.config.fields).toHaveLength(1)
    expect(c.execCtx).toBeDefined()
  })

  it('works without execCtx (optional)', () => {
    const c = ctx() satisfies ChatContext
    expect(c.execCtx).toBeUndefined()
  })
})

describe('module interfaces (structural contract)', () => {
  it('ChatInitModule.createSession returns a Response', () => {
    const mod: ChatInitModule = {
      createSession: async (c: ChatContext) => new Response('ok', { status: 200 }),
    }
    expect(mod.createSession).toBeDefined()
    return expect(mod.createSession(ctx())).resolves.toBeInstanceOf(Response)
  })

  it('ChatToolModule.handleToolCall dispatches on tool name', async () => {
    const mod: ChatToolModule = {
      handleToolCall: async (c: ChatContext, tool: string, payload: any) =>
        new Response(`tool:${tool}`, { status: 200 }),
    }
    const res = await mod.handleToolCall(ctx(), 'extract', { text: 'x' })
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('tool:extract')
  })

  it('ChatFieldModule.extractFields returns validFields, errors and updatedCollected', async () => {
    const mod: ChatFieldModule = {
      extractFields: async (_c: ChatContext, llmResponse: string) => ({
        validFields: ['name'],
        errors: llmResponse.includes('bad') ? ['invalid value'] : [],
        updatedCollected: { name: llmResponse.trim() },
      }),
    }
    const good = await mod.extractFields(ctx(), ' Alice ')
    expect(good).toEqual({ validFields: ['name'], errors: [], updatedCollected: { name: 'Alice' } })
    const bad = await mod.extractFields(ctx(), 'bad')
    expect(bad.errors).toEqual(['invalid value'])
  })

  it('ChatCompleteModule.completeSession finalizes and returns a Response', async () => {
    const mod: ChatCompleteModule = {
      completeSession: async (c: ChatContext) => new Response(JSON.stringify({ done: c.session.sessionId }), { status: 200 }),
    }
    const res = await mod.completeSession(ctx())
    await expect(res.json()).resolves.toEqual({ done: 'sess-1' })
  })

  it('ChatAuditModule.logEvent accepts action, submissionId and metadata', async () => {
    const calls: any[] = []
    const mod: ChatAuditModule = {
      logEvent: async (c: ChatContext, action: string, submissionId: string, metadata?: Record<string, unknown>) => {
        calls.push({ tenantId: c.session.tenantId, action, submissionId, metadata })
      },
    }
    await mod.logEvent(ctx(), 'field_collected', 'sub-9', { field: 'name' })
    expect(calls[0]).toEqual({ tenantId: 'tenant-1', action: 'field_collected', submissionId: 'sub-9', metadata: { field: 'name' } })
    // metadata optional
    await mod.logEvent(ctx(), 'session_started', 'sub-9')
    expect(calls[1].metadata).toBeUndefined()
  })

  it('ChatScoringModule.triggerScoring receives the full collected payload', async () => {
    const seen: Record<string, unknown>[] = []
    const mod: ChatScoringModule = {
      triggerScoring: async (c: ChatContext, collected: Record<string, unknown>) => {
        seen.push({ tenantId: c.session.tenantId, collected })
      },
    }
    await mod.triggerScoring(ctx(), { income: 5000, loan: 250000 })
    expect(seen[0]).toEqual({ tenantId: 'tenant-1', collected: { income: 5000, loan: 250000 } })
  })

  it('a single object can satisfy multiple module interfaces simultaneously', () => {
    const multi = {
      createSession: async (c: ChatContext) => new Response(c.session.sessionId),
      handleToolCall: async (c: ChatContext, tool: string) => new Response(tool),
      extractFields: async (_c: ChatContext, llmResponse: string) => ({
        validFields: ['name'], errors: [], updatedCollected: { name: llmResponse },
      }),
      completeSession: async (c: ChatContext) => new Response(c.session.sessionId),
      logEvent: async () => {},
      triggerScoring: async () => {},
    } satisfies ChatInitModule & ChatToolModule & ChatFieldModule & ChatCompleteModule & ChatAuditModule & ChatScoringModule

    expect(multi.createSession).toBeDefined()
    expect(multi.handleToolCall).toBeDefined()
    expect(multi.extractFields).toBeDefined()
    expect(multi.completeSession).toBeDefined()
    expect(multi.logEvent).toBeDefined()
    expect(multi.triggerScoring).toBeDefined()
  })
})

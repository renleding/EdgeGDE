/**
 * EdgeGDE — Conversational Chat Engine API
 * Phase 10: Tool dispatch, session management, constraint engine integration.
 *
 * Thin orchestrator — routes are imported from focused modules.
 *
 * Security model:
 *   - LLM is a parser only — never controls state
 *   - All mutations validated by constraint engine
 *   - All mutations audited
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { findNextField, applyFieldUpdate, validateField, type ChatFieldDef, type ChatSessionState } from '../lib/chat-constraint'
import { buildParsePrompt, parseLlmResponse } from '../lib/chat-llm'
import { loadChatConfig, type ChatConfig } from '../lib/chat-config'
import { guardDB } from '../lib/db'
import { guardKV } from '../lib/kv'
import { computeFieldState, applyRules, type FieldDef } from '../lib/field-engine'
import { loadKnowledgeBase, formatKbContext } from '../lib/knowledge-base'
import { initRouter } from './chat-init'
import { logAuditEvent } from './chat-audit'
import { triggerScoring } from './chat-scoring'

// ═════════════════════════════════════════════════════════════════════════════
// Router — compose sub-routers
// ═════════════════════════════════════════════════════════════════════════════

export const chatRouter = new Hono()
chatRouter.route('/', initRouter)

// ═════════════════════════════════════════════════════════════════════════════
// POST /chat/tool — secure tool dispatch endpoint
// Security: whitelist only, validated by constraint engine
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.post('/chat/tool', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  let body: { tool?: string; session_id?: string; payload?: any; text?: string }
  try {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      body = await c.req.json()
    } else {
      const fd = await c.req.formData()
      body = { tool: fd.get('tool') as string || '', session_id: fd.get('session_id') as string || '', text: fd.get('text') as string || '' }
    }
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const tool = body.tool
  const sessionId = body.session_id
  if (!sessionId) return c.json({ error: 'session_id required' }, 400)

  if (!tool) {
    // ── LLM-powered response ──────────────────────────────────────────
    const userText = (body.text || '').trim()
    if (!userText) return c.json({ error: 'Either tool or text is required' }, 400)

    try {
      const sessionRow: any = await db.prepare(
        `SELECT objective, state_json, collected_fields_json FROM chat_sessions WHERE id = ? AND tenant_id = ?`
      ).bind(sessionId, tenantId).first()

      if (!sessionRow) return c.json({ error: 'Session not found' }, 404)

      const storedState = JSON.parse(sessionRow.state_json || '{}')
      const collected = JSON.parse(sessionRow.collected_fields_json || '{}')
      const env = c.env as any
      const tenantKv = env['TENANT_KV']
      const config: ChatConfig = await loadChatConfig(tenantKv, tenantId)
      const fields: ChatFieldDef[] = normalizeChatFields(config.fields || [])

      const kbEntries = await loadKnowledgeBase(tenantKv, tenantId, config.knowledgeBase?.topics || [])
      const kbContext = formatKbContext(kbEntries)
      const next = findNextField(fields, collected)
      const parsePrompt = buildParsePrompt({ sessionId, tenantId, text: userText, currentField: next.state.currentField, fieldDef: next.field || undefined, collectedFields: next.state.completedFields }, kbContext)
      const llmResponse = parseLlmResponse(userText)
      const parsedFields = applyParsedFields(fields, collected, llmResponse)
      const { validFields, errors, updatedCollected, state: fieldState } = parsedFields

      // Compute derived state
      const finalState = { state: fieldState }

      // Single atomic D1 write
      const now = Date.now()
      await db.prepare(
        `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, last_tool = ?, updated_at = ? WHERE id = ?`
      ).bind(
        JSON.stringify(updatedCollected),
        JSON.stringify(finalState.state),
        JSON.stringify({ tool, fields: validFields, errors: errors.length > 0 ? errors : undefined }),
        now,
        sessionId,
      ).run()

      // Audit per valid field
      for (const f of validFields) {
        c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'field_updated', '', sessionId, { field: f, value: updatedCollected[f] }))
      }

      if (finalState.state.phase === 'complete') {
        c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, updatedCollected))
        return c.json({
          success: true,
          complete: true,
          fields: validFields,
          errors,
          state: finalState.state,
        })
      }

      return c.json({
        success: true,
        fields: validFields,
        errors,
        state: finalState.state,
      })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  }

  // ── Tool dispatch mode (whitelisted) ─────────────────────────────────
  const allowedTools = new Set(['submit', 'skip', 'save', 'document_upload', 'manual'])
  if (!allowedTools.has(tool)) return c.json({ error: `Unknown tool: ${tool}` }, 400)

  try {
    const sessionRow: any = await db.prepare(
      `SELECT state_json, collected_fields_json, objective FROM chat_sessions WHERE id = ? AND tenant_id = ?`
    ).bind(sessionId, tenantId).first()

    if (!sessionRow) return c.json({ error: 'Session not found' }, 404)

    const state = JSON.parse(sessionRow.state_json || '{}')
    const collected = JSON.parse(sessionRow.collected_fields_json || '{}')
    const config: ChatConfig = await loadChatConfig(db, tenantId)
    const fields: ChatFieldDef[] = normalizeChatFields(config.fields || [])

    // Process tool-specific logic
    const now = Date.now()
    if (tool === 'submit') {
      // Final submission
      await db.prepare(
        `UPDATE chat_sessions SET status = 'complete', updated_at = ? WHERE id = ?`
      ).bind(now, sessionId).run()
      c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, collected))
      return c.json({ success: true, complete: true })
    }

    if (tool === 'skip') {
      const nextState = findNextField(fields, collected)
      const skippedField = state.currentField
      await db.prepare(
        `UPDATE chat_sessions SET state_json = ?, updated_at = ? WHERE id = ?`
      ).bind(JSON.stringify(nextState.state), now, sessionId).run()
      return c.json({
        success: true,
        skipped: skippedField || undefined,
        state: nextState.state,
      })
    }

    if (tool === 'save') {
      return c.json({ success: true, saved: true })
    }

    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /chat/stream/:sessionId — SSE event stream
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.get('/chat/stream/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  const tenantId = c.req.query('tenant')

  let lastStatus: string | null = null
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat every 5s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch { clearInterval(heartbeat) }
      }, 5000)

      const poll = async () => {
        try {
          const row: any = await db.prepare(
            `SELECT status, last_tool, updated_at FROM chat_sessions WHERE id = ? AND tenant_id = ?`
          ).bind(sessionId, tenantId).first()

          if (row && row.status !== lastStatus) {
            lastStatus = row.status
            const data = JSON.stringify({ status: row.status, tool: row.last_tool ? JSON.parse(row.last_tool) : null, updatedAt: row.updated_at })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
        } catch {}
      }

      await poll()
      const interval = setInterval(poll, 3000)

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(interval)
        clearInterval(heartbeat)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /timeline/stream/:sessionId — timeline event stream
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.get('/timeline/stream/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  const tenantId = c.req.query('tenant')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const poll = async () => {
        try {
          const row: any = await db.prepare(
            `SELECT created_at, updated_at, status, collected_fields_json FROM chat_sessions WHERE id = ? AND tenant_id = ?`
          ).bind(sessionId, tenantId).first()

          if (row) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ createdAt: row.created_at, updatedAt: row.updated_at, status: row.status, collected: JSON.parse(row.collected_fields_json || '{}') })}\n\n`))
          }
        } catch {}
      }

      await poll()
      const interval = setInterval(poll, 5000)

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /chat/stream — stream LLM response token by token, then process
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.post('/chat/stream', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const body = c.req.header('content-type')?.includes('json')
    ? await c.req.json()
    : Object.fromEntries(new URLSearchParams(await c.req.text()))
  const sessionId = body.session_id || ''
  const userText = (body.text || '').trim()
  if (!userText || !sessionId) return c.json({ error: 'Missing text or session_id' }, 400)

  const env = c.env as any
  const db = guardDB(env?.['DB'])
  const tenantKv = guardKV(env?.['TENANT_KV'])
  const LLM_API_KEY = env?.LLM_API_KEY || ''

  // Load session + config
  const sessionRow: any = await db.prepare(
    `SELECT objective, state_json, collected_fields_json FROM chat_sessions WHERE id = ?`
  ).bind(sessionId).first()
  if (!sessionRow) return c.json({ error: 'Session not found' }, 404)

  const state = JSON.parse(sessionRow.state_json || '{}')
  const collected = JSON.parse(sessionRow.collected_fields_json || '{}')
  const config: ChatConfig = await loadChatConfig(tenantKv, tenantId)
  const fields: ChatFieldDef[] = normalizeChatFields(config.fields || [])

  const kbEntries = await loadKnowledgeBase(tenantKv, tenantId, config.knowledgeBase?.topics || [])
  const kbContext = formatKbContext(kbEntries)
  const next = findNextField(fields, collected)
  const parsePrompt = buildParsePrompt({ sessionId, tenantId, text: userText, currentField: next.state.currentField, fieldDef: next.field || undefined, collectedFields: next.state.completedFields }, kbContext)
  const llmResponse = parseLlmResponse(userText)
  const parsedFields = applyParsedFields(fields, collected, llmResponse)
  const { validFields, errors, updatedCollected, state: fieldState } = parsedFields

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Deterministic field extraction is authoritative. The stream returns
        // immediately so chat health cannot hang on an external LLM provider.
        const inference = inferFieldUpdate(fields, collected, userText)
        const finalState = { state: inference.state }
        const now = Date.now()

        await db.prepare(
          `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, updated_at = ? WHERE id = ?`
        ).bind(
          JSON.stringify(inference.updatedCollected),
          JSON.stringify(finalState.state),
          now,
          sessionId,
        ).run()

        for (const f of inference.validFields) {
          c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'field_updated', '', sessionId, { field: f, value: inference.updatedCollected[f] }))
        }

        if (finalState.state.phase === 'complete') {
          c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, inference.updatedCollected))
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          done: true,
          message: buildChatDoneMessage(inference),
          fields: inference.validFields,
          errors: inference.errors,
          state: finalState.state,
          complete: finalState.state.phase === 'complete',
          llmFallback: true,
        })}\n\n`))
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Normalization helpers
// ═════════════════════════════════════════════════════════════════════════════

function inferFieldUpdate(
  fields: ChatFieldDef[],
  collected: Record<string, unknown>,
  text: string,
): { updatedCollected: Record<string, unknown>; validFields: string[]; errors: string[]; state: ChatSessionState } {
  const next = findNextField(fields, collected)
  const field = next.field

  if (!field) {
    const knownFieldError = validateKnownFieldValue(fields, collected, text)
    return {
      updatedCollected: collected,
      validFields: [],
      errors: knownFieldError ? [knownFieldError] : [],
      state: next.state,
    }
  }

  const value = coerceFieldValue(field, text)
  if (value === null) {
    return {
      updatedCollected: collected,
      validFields: [],
      errors: [],
      state: next.state,
    }
  }

  const result = applyFieldUpdate(fields, collected, field.fieldName, value)
  if (result.error) {
    return {
      updatedCollected: collected,
      validFields: [],
      errors: [result.error],
      state: result.state,
    }
  }

  return {
    updatedCollected: result.collected,
    validFields: [field.fieldName],
    errors: [],
    state: result.state,
  }
}

function coerceFieldValue(field: ChatFieldDef, text: string): unknown | null {
  const raw = text.trim()
  if (!raw) return null

  if (field.fieldType === 'select') {
    const match = (field.options || []).find(option => raw.toLowerCase().includes(option.toLowerCase()))
    return match ?? raw
  }

  if (field.fieldType === 'number') {
    const cleaned = raw.replace(/[,/$]/g, '').trim()
    return cleaned
  }

  return raw
}

function validateKnownFieldValue(
  fields: ChatFieldDef[],
  collected: Record<string, unknown>,
  text: string,
): string | null {
  const raw = text.trim()
  if (!raw) return null

  const phoneField = fields.find(field => field.fieldName.toLowerCase().includes('phone'))
  if (phoneField && /^\d+$/.test(raw) && raw.length < 10) return `${phoneField.label}: Phone number must be exactly 10 digits`

  for (const field of fields) {
    if (collected[field.fieldName] !== undefined && collected[field.fieldName] !== null && collected[field.fieldName] !== '') continue
    const value = coerceFieldValue(field, raw)
    if (value === null) continue
    const err = validateField(field, value)
    if (err) return `${field.label}: ${err}`
  }

  return null
}

function buildChatDoneMessage(inference: {
  validFields: string[]
  errors: string[]
  state: ChatSessionState
}): string {
  if (inference.errors.length) return inference.errors[0]
  if (inference.validFields.length && inference.state.currentField) return `Thanks, I've captured that. Please provide ${inference.state.currentField}.`
  if (inference.validFields.length) return "Thanks, I've captured that. All details are collected."
  if (inference.state.currentField) return `Thanks for that. Please provide ${inference.state.currentField}.`
  return "Thanks, I've captured that."
}

function normalizeChatFields(fields: any[]): ChatFieldDef[] {
  return fields.map((f: any) => ({
    fieldName: f.fieldName || f.name || '',
    label: f.label || f.fieldName || f.name || '',
    fieldType: f.fieldType === 'number' ? 'number' : f.fieldType === 'select' ? 'select' : 'string',
    options: Array.isArray(f.options) ? f.options.map(String) : undefined,
    prompt: f.prompt,
    placeholder: f.placeholder,
    validation: {
      required: f.validation?.required ?? true,
      min: f.validation?.min ?? f.min,
      max: f.validation?.max ?? f.max,
      minLength: f.validation?.minLength ?? f.minLength,
      maxLength: f.validation?.maxLength ?? f.maxLength,
    },
  }))
}

function applyParsedFields(
  fields: ChatFieldDef[],
  collected: Record<string, unknown>,
  parsed: { raw?: string; extracted_fields?: Record<string, unknown> },
) {
  const updated = { ...collected }
  const validFields: string[] = []
  const errors: string[] = []

  for (const [fieldName, value] of Object.entries(parsed.extracted_fields || {})) {
    const result = applyFieldUpdate(fields, updated, fieldName, value)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    Object.assign(updated, result.collected)
    validFields.push(fieldName)
  }

  const state = findNextField(fields, updated).state
  return { validFields, errors, updatedCollected: updated, state }
}

function normalizeNameFields(collected: Record<string, unknown>): void {
  if (typeof collected.fullName !== 'string') return
  const name = (collected.fullName as string).trim()
  const parts = name.split(/\s+/)
  if (parts.length >= 2 && /^[A-Z][a-z]/.test(name)) {
    if (!collected.firstName) collected.firstName = parts[0]
    if (!collected.lastName) collected.lastName = parts.slice(1).join(' ')
  }
}

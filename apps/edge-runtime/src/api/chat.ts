/**
 * EdgeGDE — Conversational Chat Engine API
 * Phase 10: Tool dispatch, session management, constraint engine integration.
 *
 * Security model:
 *   - LLM is a parser only — never controls state
 *   - All mutations validated by constraint engine
 *   - All mutations audited
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { findNextField, applyFieldUpdate, type ChatFieldDef } from '../lib/chat-constraint'
import { buildParsePrompt, parseLlmResponse } from '../lib/chat-llm'

// ═════════════════════════════════════════════════════════════════════════════
// Router
// ═════════════════════════════════════════════════════════════════════════════

export const chatRouter = new Hono()

// ═════════════════════════════════════════════════════════════════════════════
// POST /chat/init — start a new chat session
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.post('/chat/init', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  let body: { objective?: string; contactId?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const sessionId = crypto.randomUUID()
  const now = Date.now()

  try {
    await db.prepare(
      `INSERT INTO chat_sessions (id, tenant_id, objective, state_json, collected_fields_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      sessionId,
      tenantId,
      body.objective || 'mortgage_application',
      JSON.stringify({ currentField: '', completedFields: [], errors: [], phase: 'collecting' }),
      '{}',
      now,
      now,
    ).run()

    return c.json({
      sessionId,
      tenantId,
      status: 'active',
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to create session', details: err.message }, 500)
  }
})

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
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const tool = body.tool
  const sessionId = body.session_id
  if (!sessionId) return c.json({ error: 'session_id required' }, 400)

  // ═══ LOAD FORM SCHEMA ═══
  // For now, use the hardcoded mortgage form fields.
  // Future: load from form registry by objective.
  const fields: ChatFieldDef[] = [
    { fieldName: 'fullName', label: 'Full Name', fieldType: 'string', validation: { required: true, minLength: 2 }, placeholder: 'e.g. John Smith' },
    { fieldName: 'email', label: 'Email Address', fieldType: 'string', validation: { required: true }, placeholder: 'e.g. john@example.com' },
    { fieldName: 'phone', label: 'Phone Number', fieldType: 'string', validation: { required: true }, placeholder: 'e.g. 0412 345 678' },
    { fieldName: 'propertyValue', label: 'Property Value', fieldType: 'number', validation: { required: true, min: 10000, max: 100_000_000 }, placeholder: 'e.g. 750000' },
    { fieldName: 'loanAmount', label: 'Loan Amount', fieldType: 'number', validation: { required: true, min: 1000, max: 100_000_000 }, placeholder: 'e.g. 500000' },
    { fieldName: 'deposit', label: 'Deposit Amount', fieldType: 'number', validation: { required: true, min: 0 }, placeholder: 'e.g. 250000' },
    { fieldName: 'employmentType', label: 'Employment Type', fieldType: 'select', validation: { required: true }, options: ['PAYG', 'Self-Employed'], placeholder: 'PAYG or Self-Employed' },
  ]

  try {
    // Load session
    const session: any = await db.prepare(
      `SELECT * FROM chat_sessions WHERE id = ? AND tenant_id = ?`
    ).bind(sessionId, tenantId).first()

    if (!session) return c.json({ error: 'Session not found' }, 404)
    if (session.status !== 'active') return c.json({ error: 'Session is not active' }, 400)

    const collected = JSON.parse(session.collected_fields_json || '{}')
    const now = Date.now()

    switch (tool) {
      // ══════════════════════════════════════════════════════════════════════
      // submit_field_value — validate and store (single or batch)
      // ══════════════════════════════════════════════════════════════════════
      case 'submit_field_value': {
        const payload = body.payload || {}
        const fieldEntries: { field: string; value: unknown }[] = []

        // Accept single {field, value} or batch {fields: [...]}
        if (payload.field !== undefined) {
          fieldEntries.push({ field: payload.field, value: payload.value })
        } else if (Array.isArray(payload.fields)) {
          fieldEntries.push(...payload.fields)
        } else {
          return c.json({ error: 'payload must contain field+value or fields array' }, 400)
        }

        if (fieldEntries.length === 0) {
          return c.json({ error: 'No fields provided' }, 400)
        }

        // Validate each field — skip invalid, collect valid
        let updatedCollected = { ...collected }
        const errors: string[] = []
        const validFields: string[] = []

        for (const entry of fieldEntries) {
          const result = applyFieldUpdate(fields, updatedCollected, entry.field, entry.value)
          if (result.error) {
            errors.push(result.error)
          } else {
            updatedCollected = result.collected
            validFields.push(entry.field)
          }
        }

        if (validFields.length === 0) {
          return c.json({
            success: false,
            errors,
            state: { currentField: '', completedFields: [], errors, phase: 'collecting' },
          })
        }

        // Compute derived state from final collected fields
        const finalState = findNextField(fields, updatedCollected)

        // Single atomic D1 write
        await db.prepare(
          `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, last_tool = ?, updated_at = ? WHERE id = ?`
        ).bind(
          JSON.stringify(updatedCollected),
          JSON.stringify(finalState.state),
          JSON.stringify({ tool, fields: validFields, errors: errors.length > 0 ? errors : undefined }),
          now,
          sessionId,
        ).run()

        // If complete, trigger scoring
        if (finalState.state.phase === 'complete') {
          c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, updatedCollected))
          return c.json({
            success: true,
            complete: true,
            state: finalState.state,
            errors: errors.length > 0 ? errors : undefined,
            message: 'Thank you! Your application has been submitted for review.',
          })
        }

        return c.json({
          success: true,
          state: finalState.state,
          nextField: finalState.field?.fieldName || null,
          errors: errors.length > 0 ? errors : undefined,
        })
      }

      // ══════════════════════════════════════════════════════════════════════
      // request_next_question — get the next question from the constraint engine
      // ══════════════════════════════════════════════════════════════════════
      case 'request_next_question': {
        const fieldInfo = findNextField(fields, collected)
        const currentField = fieldInfo.field

        if (!currentField) {
          // All complete — trigger scoring
          c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, collected))
          await db.prepare(
            `UPDATE chat_sessions SET status = 'complete', state_json = ?, updated_at = ? WHERE id = ?`
          ).bind(JSON.stringify(fieldInfo.state), now, sessionId).run()

          return c.json({
            success: true,
            complete: true,
            state: fieldInfo.state,
            message: 'Thank you! Your application has been submitted for review.',
          })
        }

        return c.json({
          success: true,
          field: currentField.fieldName,
          label: currentField.label,
          fieldType: currentField.fieldType,
          options: currentField.options,
          placeholder: currentField.placeholder,
          state: fieldInfo.state,
        })
      }

      // ══════════════════════════════════════════════════════════════════════
      // chat — process a natural language message via LLM
      // ══════════════════════════════════════════════════════════════════════
      case 'chat': {
        const userText = body.text || ''
        if (!userText) return c.json({ error: 'text field required for chat tool' }, 400)

        // Get current field context
        const stateJson = JSON.parse(session.state_json || '{}')
        const currentField = stateJson.currentField || ''
        const fieldDef = currentField ? fields.find(f => f.fieldName === currentField) : undefined

        // Build LLM prompt
        const prompt = buildParsePrompt({
          sessionId,
          tenantId,
          text: userText,
          currentField,
          fieldDef: fieldDef ? { label: fieldDef.label, options: fieldDef.options, fieldType: fieldDef.fieldType } : undefined,
        })

        // Call LLM (DeepSeek V4 Flash via OpenRouter)
        const llmApiKey = (c.env as any)?.LLM_API_KEY as string | undefined
        let parsed: { field?: string; value?: unknown; intent: string; raw: string }

        if (llmApiKey) {
          try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${llmApiKey}`,
              },
              body: JSON.stringify({
                model: 'deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
                max_tokens: 150,
              }),
            })

            const llmBody: any = await res.json()
            const rawContent = llmBody?.choices?.[0]?.message?.content || '{}'
            parsed = parseLlmResponse(rawContent)
          } catch {
            parsed = { intent: 'unknown', raw: userText }
          }
        } else {
          parsed = { intent: 'unknown', raw: userText }
        }

        // Handle parsed intent
        if (parsed.intent === 'cancel') {
          await db.prepare(`UPDATE chat_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?`).bind(now, sessionId).run()
          return c.json({ success: true, status: 'abandoned', message: 'Session cancelled.' })
        }

        if (parsed.intent === 'start') {
          return c.json({ success: true, intent: 'start', message: 'Let\'s start your mortgage application. What\'s your full name?' })
        }

        if (parsed.intent === 'field_value' && parsed.field) {
          // ═══ JUDGE GATE ═══ — constraint engine validates LLM output
          const result = applyFieldUpdate(fields, collected, parsed.field, parsed.value)
          if (result.error) {
            const nextState = findNextField(fields, result.collected)
            return c.json({
              success: false,
              error: result.error,
              state: result.state,
              nextField: nextState.field?.fieldName || null,
              nextLabel: nextState.field?.label || null,
            })
          }

          await db.prepare(
            `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, last_tool = ?, updated_at = ? WHERE id = ?`
          ).bind(
            JSON.stringify(result.collected),
            JSON.stringify(result.state),
            JSON.stringify({ tool: 'chat', field: parsed.field, valid: true }),
            now,
            sessionId,
          ).run()

          if (result.state.phase === 'complete') {
            c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, result.collected))
            return c.json({
              success: true,
              complete: true,
              state: result.state,
              message: 'Thank you! Your application has been submitted for review.',
            })
          }

          // Return next question
          const nextState = findNextField(fields, result.collected)
          const nextField = nextState.field
          return c.json({
            success: true,
            state: result.state,
            nextField: nextField?.fieldName || null,
            nextLabel: nextField?.label || null,
            nextType: nextField?.fieldType || null,
            nextOptions: nextField?.options || null,
            nextPlaceholder: nextField?.placeholder || null,
          })
        }

        // Unknown intent — return current question
        const nextState = findNextField(fields, collected)
        return c.json({
          success: true,
          intent: 'unknown',
          state: nextState.state,
          message: `I didn't quite catch that. ${nextState.field ? `Could you provide your ${nextState.field.label.toLowerCase()}?` : ''}`,
          nextField: nextState.field?.fieldName || null,
          nextLabel: nextState.field?.label || null,
        })
      }

      default:
        return c.json({ error: `Unknown tool: ${tool}. Allowed: submit_field_value, request_next_question, chat` }, 400)
    }
  } catch (err: any) {
    return c.json({ error: 'Tool execution failed', details: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /chat/stream/:sessionId — per-session SSE stream
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.get('/chat/stream/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  // Verify session exists
  const session: any = await db.prepare(
    `SELECT id, status FROM chat_sessions WHERE id = ?`
  ).bind(sessionId).first()

  if (!session) return c.json({ error: 'Session not found' }, 404)

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Send initial state
  writer.write(encoder.encode(`event: connected\ndata: {"sessionId":"${sessionId}"}\n\n`))

  // Remove on disconnect
  c.req.raw.signal.addEventListener('abort', () => {
    writer.close().catch(() => {})
  })

  // Periodic keepalive
  const keepalive = setInterval(() => {
    writer.write(encoder.encode(': keepalive\n\n')).catch(() => clearInterval(keepalive))
  }, 30000)

  c.req.raw.signal.addEventListener('abort', () => {
    clearInterval(keepalive)
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Helper — trigger scoring when collection is complete
// ═════════════════════════════════════════════════════════════════════════════

async function triggerScoring(db: any, env: any, sessionId: string, tenantId: string, collected: Record<string, unknown>): Promise<void> {
  try {
    // Create form submission record
    const submissionId = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO form_submissions (id, tenant_id, form_id, payload)
       VALUES (?, ?, 'mortgage_chat', ?)`
    ).bind(submissionId, tenantId, JSON.stringify(collected)).run()

    // Link session to submission
    await db.prepare(
      `UPDATE chat_sessions SET submission_id = ?, status = 'complete', updated_at = ? WHERE id = ?`
    ).bind(submissionId, Date.now(), sessionId).run()

    // Enqueue for scoring
    const queue = (env as any)?.LEAD_SCORING_QUEUE
    if (queue && typeof queue.send === 'function') {
      await queue.send({
        submissionId,
        tenantId,
        formId: 'mortgage_chat',
        payload: collected,
        contactInfo: {
          name: String(collected.fullName || ''),
          email: String(collected.email || ''),
          phone: String(collected.phone || ''),
        },
      })
    }
  } catch (err) {
    console.error('[chat] triggerScoring failed:', err)
  }
}

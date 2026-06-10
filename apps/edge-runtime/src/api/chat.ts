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
import { loadChatConfig, type ChatConfig } from '../lib/chat-config'
import { computeFieldState, applyRules } from '../lib/field-engine'
import { loadKnowledgeBase, formatKbContext } from '../lib/knowledge-base'
import { logAuditEvent as logAuditD1 } from '../lib/audit'

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

    // Audit — session created
    c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'chat_message', '', sessionId, { text: `Session started: ${body.objective || 'mortgage_application'}` }))
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

  // ═══ LOAD CHAT CONFIG FROM KV ═══
  const kv = (c.env as any)?.TENANT_KV
  const chatConfig: ChatConfig = kv ? await loadChatConfig(kv, tenantId) : null as any
  if (!chatConfig) return c.json({ error: 'Chat configuration not available' }, 500)

  // Map config fields to internal ChatFieldDef format
  const fields: ChatFieldDef[] = chatConfig.fields.map(f => ({
    fieldName: f.fieldName,
    label: f.label,
    fieldType: f.fieldType === 'number' ? 'number' : 'string',
    validation: f.validation,
    options: f.options,
    placeholder: f.placeholder,
  }))

  // Load knowledge base topics in parallel
  const kb = kv ? await loadKnowledgeBase(kv, tenantId, chatConfig.knowledgeBase.topics) : {}
  const kbContext = formatKbContext(kb)

/**
 * Normalize name fields extracted by the LLM.
 * Guards against edge cases: single names, titles, hyphenated names, ordering ambiguity.
 */
function normalizeNameFields(collected: Record<string, unknown>): void {
  if (!collected.firstName && !collected.lastName) return

  // Trim and clean
  if (collected.firstName) collected.firstName = String(collected.firstName).trim()
  if (collected.middleName) collected.middleName = String(collected.middleName).trim()
  if (collected.lastName) collected.lastName = String(collected.lastName).trim()

  // Strip titles (Dr., Mr., Mrs., Ms., etc.)
  const titleRe = /^(Dr|Mr|Mrs|Ms|Miss|Prof|Rev)\.?\s+/i
  if (collected.firstName) collected.firstName = String(collected.firstName).replace(titleRe, '')
  if (collected.lastName) collected.lastName = String(collected.lastName).replace(titleRe, '')

  // Fallback: if only one name field is present and no last name, the single token is firstName
  if (collected.firstName && !collected.lastName && !collected.fullName) {
    collected.lastName = null
  }

  // Clean up empty strings to null
  for (const key of ['firstName', 'middleName', 'lastName']) {
    if (collected[key] === '' || collected[key] === null) delete collected[key]
  }
}

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

        // Audit — field_updated event per valid field
        for (const f of validFields) {
          c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'field_updated', '', sessionId, { field: f, value: updatedCollected[f] }))
        }

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

        // Get current field context using field engine
        const stateJson = JSON.parse(session.state_json || '{}')
        let currentField = stateJson.currentField || ''
        if (!currentField) {
          // Use field engine to determine first field
          const collected = JSON.parse(session.collected_fields_json || '{}')
          const feResult = computeFieldState(
            fields.map(f => ({
              fieldName: f.fieldName,
              label: f.label,
              fieldType: (f.fieldType === 'string' ? 'text' : f.fieldType) as 'text' | 'number' | 'select' | 'email' | 'phone',
              validation: { required: f.validation?.required ?? true, min: f.validation?.min, max: f.validation?.max },
              options: f.options,
              placeholder: f.placeholder,
            })),
            chatConfig.priorityOrder,
            collected,
          )
          if (feResult.nextField) {
            currentField = feResult.nextField.fieldName
          }
        }


        // ═══ RULE ENGINE ═══ evaluate policy rules against collected fields

        let ruleOutputs: import('../lib/rule-engine').RuleOutput = { flags: [], required_disclosures: [], required_fields: [] }
        try {

        const { results: ruleRows } = await (c.env as any).DB.prepare('SELECT * FROM rules WHERE tenant_id = ? AND active = 1 ORDER BY priority DESC, created_at DESC').bind(tenantId).all()
        const { evaluateRules } = await import('../lib/rule-engine')
        ruleOutputs = evaluateRules(ruleRows || [], collected)
        if (ruleOutputs.stage || ruleOutputs.flags.length || ruleOutputs.required_disclosures.length) {
          c.executionCtx.waitUntil(logAuditD1((c.env as any)?.DB, tenantId, sessionId, 'rule_evaluated', { stage: ruleOutputs.stage, flags: ruleOutputs.flags, required_disclosures: ruleOutputs.required_disclosures }))
        }
        } catch {}

        // ═══ LLM CONTEXT ═══ include rules outputs if any
        let ruleContext = ''
        if (ruleOutputs.stage) ruleContext += `\nCurrent stage: ${ruleOutputs.stage}`
        if (ruleOutputs.flags.length) ruleContext += `\nFlags: ${ruleOutputs.flags.join(', ')}`
        if (ruleOutputs.required_disclosures.length) ruleContext += `\nRequired disclosures: ${ruleOutputs.required_disclosures.join(', ')}`
        const fieldDef = currentField ? fields.find((f: any) => f.fieldName === currentField) : undefined
        // Build LLM prompt with KB context
        const prompt = buildParsePrompt({
          sessionId,
          tenantId,
          text: userText,
          currentField,
          fieldDef: fieldDef ? { label: fieldDef.label, options: fieldDef.options, fieldType: fieldDef.fieldType } : undefined,
        }, kbContext + ruleContext)

        // ═══ COMPLIANCE ENFORCEMENT ═══ resolve disclosure text from KV
        let disclosureTexts: string[] = []
        if (ruleOutputs.required_disclosures.length > 0) {
          try {
            const kv = (c.env as any)?.TENANT_KV
            const raw = await kv.get(`tenant:${tenantId}:kb:compliance`, 'json')
            if (raw && Array.isArray(raw.entries)) {
              const idSet = new Set(ruleOutputs.required_disclosures)
              disclosureTexts = raw.entries
                .filter((e: any) => idSet.has(e.id))
                .map((e: any) => e.value || '')
                .filter(Boolean)
            }
          } catch {}
        }

        // Add disclosures to prompt
        let compliancePrompt = prompt
        if (disclosureTexts.length > 0) {
          compliancePrompt += `\n\nYou MUST include the following disclosures in your response:\n${disclosureTexts.map(t => '- ' + t).join('\n')}\nFailure to include them is not allowed.`
        }

        // ═══ LLM CALL WITH RETRY + VALIDATION ═══
        const llmApiKey = (c.env as any)?.LLM_API_KEY as string | undefined
        let parsed: import('../lib/chat-llm').ParsedIntent = { intent: 'unknown', raw: userText }

        if (llmApiKey) {
          let attempts = 0
          let valid = false

          while (attempts < 2 && !valid) {
            try {
              const activePrompt = attempts === 0
                ? compliancePrompt
                : compliancePrompt + '\n\nYou FAILED to include all required disclosures. You MUST include them this time. Do not skip any.'

              const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${llmApiKey}`,
                },
                body: JSON.stringify({
                  model: 'deepseek/deepseek-v4-flash',
                  messages: [{ role: 'user', content: activePrompt }],
                  response_format: { type: 'json_object' },
                  max_tokens: 150,
                }),
              })

              const llmBody: any = await res.json()
              const rawContent = llmBody?.choices?.[0]?.message?.content || '{}'
              parsed = parseLlmResponse(rawContent)

              // Validate disclosures in response
              if (disclosureTexts.length > 0 && parsed.response) {
                valid = disclosureTexts.every(d => parsed.response!.includes(d.substring(0, 20)))
              } else {
                valid = true
              }
            } catch {
              valid = true  // don't retry on network error
            }
            attempts++
          }

          // Fallback: append disclosures if still missing
          if (!valid && parsed.response && disclosureTexts.length > 0) {
            parsed.response += '\n\n\u26a0 Important:\n' + disclosureTexts.join('\n\n')
          }
        } else {
          parsed = { intent: 'unknown', raw: userText }
        }

        // ═══ UPDATE STATE ═══ track shown_disclosures
        if (disclosureTexts.length > 0) {
          try {
            const stateJson = JSON.parse(session.state_json || '{}')
            const shown = stateJson.shown_disclosures || []
            for (const id of ruleOutputs.required_disclosures) {
              if (!shown.includes(id)) shown.push(id)
            c.executionCtx.waitUntil(logAuditD1((c.env as any)?.DB, tenantId, sessionId, 'disclosure_shown', { disclosure_id: id }))
            }
            stateJson.shown_disclosures = shown
            await (c.env as any).DB.prepare(
              'UPDATE chat_sessions SET state_json = ?, updated_at = ? WHERE id = ?'
            ).bind(JSON.stringify(stateJson), now, sessionId).run()
          } catch {}
        }

        // Handle parsed intent
        if (parsed.intent === 'cancel') {
          await db.prepare(`UPDATE chat_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?`).bind(now, sessionId).run()
          return c.json({ success: true, status: 'abandoned', message: 'Session cancelled.' })
        }

        if (parsed.intent === 'start') {
          const greeting = chatConfig.ui?.greeting || `Welcome! Let's start your application.`
          return c.json({ success: true, intent: 'start', message: greeting })
        }

        // Handle KB question
        if (parsed.intent === 'question') {
          return c.json({ success: true, intent: 'question', message: parsed.response || 'Let me check on that for you.' })
        }

        if (parsed.intent === 'field_value') {
          // ═══ JUDGE GATE ═══ — constraint engine validates LLM output
          // Support extracted_fields (multiple fields) and single field (legacy)
          const extractFields = parsed.extracted_fields && Object.keys(parsed.extracted_fields).length > 0
          let result: ReturnType<typeof applyFieldUpdate>

          if (extractFields) {
            // Apply each extracted field individually, collecting results
            let currentCollected = { ...collected }
            let currentState = { ...JSON.parse(session.state_json || '{}') }
            let lastError: string | null = null
            // Normalize name fields before applying
            normalizeNameFields(parsed.extracted_fields!)
            for (const [f, v] of Object.entries(parsed.extracted_fields!)) {
              const r = applyFieldUpdate(fields, currentCollected, f, v)
              if (r.error) {
                lastError = r.error
              } else {
                currentCollected = r.collected
                currentState = r.state
              }
            }
            result = {
              collected: currentCollected,
              state: currentState,
              error: lastError,
            }
          } else if (parsed.field) {
            result = applyFieldUpdate(fields, collected, parsed.field, parsed.value)
          } else {
            return c.json({ success: true, intent: 'unknown', message: "I didn't quite catch that. Could you provide your full name?" })
          }
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

          // Audit — chat_message + field_updated
          c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'chat_message', '', sessionId, { text: userText }))
          const auditField: string = parsed.field || (parsed.extracted_fields ? Object.keys(parsed.extracted_fields)[0] : 'unknown')
          c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'field_updated', '', sessionId, { field: auditField, value: result.collected[auditField] }))

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
// GET /timeline/stream/:sessionId — unified timeline SSE (replaces chat stream)
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.get('/timeline/stream/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  const auditDo = (c.env as any)?.AUDIT_LEDGER
  if (!auditDo || typeof auditDo.idFromName !== 'function') {
    return c.json({ error: 'AUDIT_LEDGER binding required' }, 500)
  }

  try {
    const doId = auditDo.idFromName(`tenant:${tenantId}`)
    const stub = auditDo.get(doId)

    // Proxy to DO's SSE stream handler
    const doResponse = await stub.fetch(
      `http://do/stream?tenantId=${encodeURIComponent(tenantId)}&sessionId=${encodeURIComponent(sessionId)}`
    )

    return doResponse
  } catch (err: any) {
    return c.json({ error: 'Timeline stream failed', details: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Helper — append event to AuditLedger DO (async, non-blocking)
// ═════════════════════════════════════════════════════════════════════════════

async function logAuditEvent(env: any, tenantId: string | undefined, action: string, submissionId: string, sessionId: string | undefined, metadata?: Record<string, unknown>): Promise<void> {
  try {
    const auditDo = (env as any)?.AUDIT_LEDGER
    if (!auditDo || typeof auditDo.idFromName !== 'function') return
    if (!tenantId) return

    const doId = auditDo.idFromName(`tenant:${tenantId}`)
    const stub = auditDo.get(doId)
    await stub.fetch('http://do/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: action,
        actor: 'system',
        tenantId,
        sessionId,
        submissionId: submissionId || '',
        data: metadata || {},
      }),
    })
  } catch (err) {
    console.warn('[audit] append failed:', err)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Helper — trigger scoring when collection is complete
// ═════════════════════════════════════════════════════════════════════════════

async function triggerScoring(db: any, env: any, sessionId: string, tenantId: string, collected: Record<string, unknown>): Promise<void> {
  try {
    const submissionId = crypto.randomUUID()
    console.log('[triggerScoring] starting', { sessionId, tenantId, submissionId })

    // Check D1 binding
    if (!db || typeof db.prepare !== 'function') {
      console.error('[triggerScoring] D1 binding not available')
      return
    }

    // 1. Insert form submission
    const payloadStr = JSON.stringify(collected)
    if (payloadStr.length > 50000) {
      console.error('[triggerScoring] payload too large', { bytes: payloadStr.length })
      return
    }

    const insertResult = await db.prepare(
      `INSERT INTO form_submissions (id, tenant_id, form_id, payload)
       VALUES (?, ?, 'mortgage_chat', ?)`
    ).bind(submissionId, tenantId, payloadStr).run()
    console.log('[triggerScoring] D1 insert complete', { submissionId, success: !!insertResult })

    // 2. Link session to submission
    await db.prepare(
      `UPDATE chat_sessions SET submission_id = ?, status = 'complete', updated_at = ? WHERE id = ?`
    ).bind(submissionId, Date.now(), sessionId).run()
    console.log('[triggerScoring] session linked', { sessionId, submissionId })

    // ═══ BRIDGE ═══ — link this submission to applications table via email lookup
    // Resolves contact from the completed chat session, then links the application.
    // Idempotent: AND submission_id IS NULL prevents overwrite or duplicate links.
    try {
      const sessionRow: any = await db.prepare(`SELECT collected_fields_json FROM chat_sessions WHERE id = ?`).bind(sessionId).first()
      if (sessionRow?.collected_fields_json) {
        const fields: any = JSON.parse(sessionRow.collected_fields_json)
        const email: string | undefined = fields.email
        if (email) {
          const contact: any = await db.prepare(`SELECT id FROM contacts WHERE email = ? ORDER BY last_updated_ts DESC LIMIT 1`).bind(email.toLowerCase().trim()).first()
          if (contact?.id) {
            const result = await db.prepare(`UPDATE applications SET submission_id = ? WHERE contact_id = ? AND submission_id IS NULL`).bind(submissionId, contact.id).run()
            if ((result as any)?.meta?.changes === 0) {
              console.warn('[bridge] link failed — no matching application', { sessionId, email, submissionId })
            } else {
              console.log('[bridge] linked submission to application', { submissionId, contactId: contact.id })
            }
          }
        }
      }
    } catch (e) {
      console.warn('[bridge] lookup failed:', e)
    }

    // 3. Enqueue for scoring
    const queue = (env as any)?.LEAD_SCORING_QUEUE
    if (queue && typeof queue.send === 'function') {
      const msg = {
        submissionId,
        tenantId,
        formId: 'mortgage_chat',
        payload: collected,
        contactInfo: {
          name: String(collected.fullName || ''),
          email: String(collected.email || ''),
          phone: String(collected.phone || ''),
        },
      }
      await queue.send(msg)
      console.log('[triggerScoring] queued for scoring', { submissionId })
    } else {
      console.warn('[triggerScoring] LEAD_SCORING_QUEUE binding not available')
    }
  } catch (err) {
    console.error('[triggerScoring] FAILED:', err)
    // Attempt to store failure diagnostic in TELEMETRY_KV
    try {
      const kv = (env as any)?.TELEMETRY_KV
      if (kv && typeof kv.put === 'function') {
        await kv.put(
          `diagnostic:chat:failed:${sessionId}`,
          JSON.stringify({ sessionId, err: String(err), ts: Date.now() }),
          { expirationTtl: 86400 }
        )
      }
    } catch {}
  }
}

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

  const db = (c.env as any)?.DB
  const kv = (c.env as any)?.TENANT_KV
  const LLM_API_KEY = (c.env as any)?.LLM_API_KEY || ''

  // Load session + config
  const session: any = await db?.prepare(
    `SELECT collected_fields_json, state_json, objective FROM chat_sessions WHERE id = ? AND tenant_id = ?`
  ).bind(sessionId, tenantId).first()
  if (!session) return c.json({ error: 'Session not found' }, 400)

  // Route through ChatSession_DO for state consistency
  const doId = (c.env as any)?.CHAT_SESSION?.idFromName(sessionId)
  const doStub = doId ? (c.env as any)?.CHAT_SESSION?.get(doId) : null
  let collected: Record<string, unknown> = {}
  if (doStub) {
    try {
      // Hydrate DO from D1 if this is a cold start
      await doStub.fetch('http://do/hydrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      // Read state from DO (source of truth) — always fresh
      const doResp = await doStub.fetch('http://do/state')
      if (doResp.ok) {
        const doState = await doResp.json()
        collected = doState.globalCollected || doState.collected || {}
      }
    } catch { /* non-blocking — fall through to D1 */ }
  }
  // Fallback only if DO unavailable AND D1 has data
  if (Object.keys(collected).length === 0 && session.collected_fields_json) {
    collected = JSON.parse(session.collected_fields_json as string)
  }

  const { loadChatConfig } = await import('../lib/chat-config')
  const chatConfig = await loadChatConfig(kv, tenantId)
  const fields = chatConfig.fields.map((f: any) => ({
    fieldName: f.fieldName, label: f.label,
    fieldType: (f.fieldType === 'number' ? 'number' : 'string') as 'string' | 'number' | 'select',
    validation: f.validation, options: f.options, placeholder: f.placeholder, prompt: f.prompt,
  }))

  const { computeFieldState } = await import('../lib/field-engine')
  const feResult = computeFieldState(
    fields.map((f: any) => ({
      fieldName: f.fieldName, label: f.label,
      fieldType: f.fieldType === 'string' ? 'text' : 'number',
      placeholder: f.placeholder, prompt: f.prompt,
      validation: f.validation,
    })),
    chatConfig.priorityOrder,
    collected,
  )
  const currentField = feResult.nextField?.fieldName || ''
  const fieldDef = currentField ? fields.find((f: any) => f.fieldName === currentField) : undefined

  // ═══ RULE EVALUATION (pre-stream) ═══
  let ruleContext = ''
  let disclosureTexts: string[] = []
  const ruleOutputs: any = { stage: '', flags: [], required_disclosures: [], required_fields: [] }
  if (Object.keys(collected).length > 0) {
    try {
      const ruleRows: any[] = await db?.prepare(
        'SELECT * FROM rules WHERE tenant_id = ? AND active = 1 ORDER BY priority DESC'
      ).bind(tenantId).all() || []
      if (ruleRows?.length) {
        const { evaluateRules } = await import('../lib/rule-engine')
        const ruleResult = evaluateRules(ruleRows, collected)
        if (ruleResult) {
          Object.assign(ruleOutputs, ruleResult)
          if (ruleResult.stage || ruleResult.flags.length) {
            ruleContext = '\n[Rules Active:'
            if (ruleResult.stage) ruleContext += ` stage=${ruleResult.stage}`
            if (ruleResult.flags.length) ruleContext += ` flags=${ruleResult.flags.join(',')}`
            if (ruleResult.required_disclosures.length) ruleContext += ` disclosures=${ruleResult.required_disclosures.join(',')}`
            ruleContext += ']'
          }
        }
      }
    } catch { /* rules are non-blocking for streaming */ }

    // ═══ COMPLIANCE CONTEXT ═══
    if (ruleOutputs.required_disclosures.length > 0) {
      try {
        const complianceRaw = await kv?.get(`tenant:${tenantId}:kb:compliance`, 'json')
        if (complianceRaw) {
          const complianceEntries = Array.isArray(complianceRaw) ? complianceRaw :
            typeof complianceRaw === 'object' ? (complianceRaw as any).entries || [] : []
          for (const discId of ruleOutputs.required_disclosures) {
            const entry = complianceEntries.find((e: any) => e.id === discId || e.name === discId)
            if (entry?.value) disclosureTexts.push(entry.value)
          }
        }
      } catch { /* non-blocking */ }
    }

    // ═══ AUDIT LOGGING (shared with non-streaming path) ═══
    try {
      const { logAuditEvent } = await import('../lib/audit')
      c.executionCtx.waitUntil(logAuditEvent(db, tenantId, sessionId, 'rule_evaluated', {
        stage: ruleOutputs.stage,
        flags: ruleOutputs.flags,
        required_disclosures: ruleOutputs.required_disclosures,
      }))
      if (disclosureTexts.length > 0) {
        for (const d of ruleOutputs.required_disclosures) {
          c.executionCtx.waitUntil(logAuditEvent(db, tenantId, sessionId, 'disclosure_shown', { disclosure_id: d }))
        }
      }
    } catch { /* audit is non-blocking */ }
  }

  // ═══ DETERMINISTIC FIELD PARSING (SAVE BEFORE LLM) ═══
  const { parseField } = await import('../lib/field-parser')
  let parsedField = null
  let fieldContext = ''
  let promptCollected = { ...collected }
  let promptCurrentField = currentField
  let promptFieldDef = fieldDef
  
  if (currentField && userText) {
    parsedField = parseField(currentField, userText, fieldDef?.options)
    if (parsedField.status === 'ok') {
      fieldContext = `\nThe field "${currentField}" has been collected. Value: ${JSON.stringify(parsedField.value)}.`
      // Always update local state immediately (guaranteed)
      promptCollected[currentField] = parsedField.value
      if (doStub) {
        try {
          await doStub.fetch('http://do/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collected: { [currentField]: parsedField.value }, nextField: '' }),
          })
          const doResp = await doStub.fetch('http://do/state')
          if (doResp.ok) {
            const doState = await doResp.json()
            promptCollected = doState.globalCollected || doState.collected || {}
          }
        } catch {}
      }
      // Recompute next field with updated state
      const feResult = computeFieldState(
        fields.map((f2) => ({ fieldName: f2.fieldName, label: f2.label, fieldType: f2.fieldType === 'string' ? 'text' : 'number', validation: f2.validation, options: f2.options, prompt: f2.prompt })),
        chatConfig.priorityOrder,
        promptCollected,
      )
      promptCurrentField = feResult.nextField?.fieldName || ''
      promptFieldDef = promptCurrentField ? fields.find((f3) => f3.fieldName === promptCurrentField) : undefined
    } else if (parsedField.status === 'unknown') {
      if (doStub) {
        try {
          await doStub.fetch('http://do/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collected: { [currentField]: '__UNKNOWN__' }, nextField: '' }),
          })
        } catch {}
      }
      promptCollected[currentField] = '__UNKNOWN__'
      fieldContext = `\nThe user could not provide "${currentField}". Do NOT ask again.`
      // Recompute next field
      const feResult = computeFieldState(
        fields.map((f2) => ({ fieldName: f2.fieldName, label: f2.label, fieldType: f2.fieldType === 'string' ? 'text' : 'number', validation: f2.validation, options: f2.options, prompt: f2.prompt })),
        chatConfig.priorityOrder,
        promptCollected,
      )
      promptCurrentField = feResult.nextField?.fieldName || ''
      promptFieldDef = promptCurrentField ? fields.find((f3) => f3.fieldName === promptCurrentField) : undefined
    }
  }
  
  if (parsedField && parsedField.status === 'error') {
    const errStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(JSON.stringify({ token: '***' }) + String.fromCharCode(10)))
        controller.enqueue(encoder.encode(JSON.stringify({ done: true, message: parsedField.error + ' Please try again.', firstName: null, fullName: null }) + String.fromCharCode(10)))
        controller.close()
      },
    })
    return new Response(errStream, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' },
    })
  }

  // ═══ BUILD LLM PROMPT (with UPDATED state) ═══
  const { loadKnowledgeBase, formatKbContext } = await import('../lib/knowledge-base')
  const { buildParsePrompt, parseLlmResponse } = await import('../lib/chat-llm')
  const kb = kv ? await loadKnowledgeBase(kv, tenantId, chatConfig.knowledgeBase?.topics || []) : {}
  const kbContext = formatKbContext(kb)

  // Append compliance instructions to prompt
  let compliancePrompt = kbContext + ruleContext
  if (disclosureTexts.length > 0) {
    compliancePrompt += '\n\nYou MUST include the following disclosures in your response:\n' +
      disclosureTexts.map((d: string) => '- ' + d).join('\n')
  }

  const prompt = buildParsePrompt({
    sessionId, tenantId, text: userText, currentField: promptCurrentField,
    fieldDef: promptFieldDef ? { label: promptFieldDef.label, options: promptFieldDef.options, fieldType: promptFieldDef.fieldType } : undefined,
    collectedFields: Object.keys(promptCollected),
  }, compliancePrompt + fieldContext)

  // ── PRE-LLM VALIDATION (handled by field-parser above) ──────────────

  // Call LLM with streaming
  const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'HTTP-Referer': 'https://edgegde-calculator.renleding.workers.dev',
      'X-Title': 'EdgeGDE',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      stream: true,
    }),
  })

  if (!llmRes.ok) {
    const errText = await llmRes.text()
    return c.json({ error: 'LLM call failed', details: errText }, 502)
  }

  // Stream the LLM response back to the client as ndjson tokens
  const encoder = new TextEncoder()
  let fullResponse = ''
  let nextFieldOptions: string[] | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const reader = llmRes.body?.getReader()
      if (!reader) { controller.close(); return }
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              const token = parsed.choices?.[0]?.delta?.content || ''
              if (token) {
                fullResponse += token
              }
            } catch {}
          }
        }
      }

      // Full response collected — parse and extract response_text
      let responseText = fullResponse
      let currentCollected = { ...collected }
      try {
        // Strip markdown code block markers that might wrap the JSON
      const cleanJson = fullResponse.replace(/^```(?:json)?\n?|\n?```$/g, '').trim()
      const parsed = parseLlmResponse(cleanJson)
        responseText = parsed.response || fullResponse

        // Process field update if applicable
        let extractedFields = parsed.extracted_fields
        if (!extractedFields || Object.keys(extractedFields).length === 0) {
          // Fallback: extract fields from LLM response text (it often says "Thanks [Name]!")
          // Only extract fullName when currentField is specifically fullName
          if (currentField && userText) {
            if (currentField === 'fullName') {
              // Check if LLM response thanks the user by name — means field was accepted
              // Match: "Thanks Warren!", "Thank you, Warren.", "Thank you Warren"
              const thanksMatch = responseText.match(/(?:Thanks|Thank you,?)\s+(\w+)[!.]?/i)
              if (thanksMatch && thanksMatch[1].length > 1) {
                extractedFields = { fullName: userText }
              }
            } else if (userText.length > 2) {
              // Non-name field — save the user's input directly
              extractedFields = { [currentField]: userText }
              console.log('[FALLBACK] saved', currentField, '=', userText)
            }
          }
        }
        if (extractedFields && Object.keys(extractedFields).length > 0) {
          const { applyFieldUpdate } = await import('../lib/chat-constraint')
          for (const [f, v] of Object.entries(extractedFields)) {
            const r = applyFieldUpdate(fields, currentCollected, f, v)
            if (!r.error) { currentCollected = r.collected; }
          }
        }
        // Always persist, whether LLM extracted fields or fallback was used
        if (Object.keys(currentCollected).length > 0) {
          const now = Date.now()
          const stmt = db?.prepare(
            `UPDATE chat_sessions SET collected_fields_json = ?, updated_at = ? WHERE id = ?`
          )
          if (stmt) {
            // Retry D1 write up to 3 times on failure
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                await stmt.bind(JSON.stringify(currentCollected), now, sessionId).run()
                // Also persist to DO (source of truth) — after D1 succeeds
                if (doStub) {
                  await doStub.fetch('http://do/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ collected: currentCollected, nextField: '' }),
                  }).catch(() => {})
                }
                break  // success
              } catch (e) {
                if (attempt === 2) console.error('D1 write failed after 3 attempts:', e)
              }
            }
          }
        }
      } catch {}

      // ═══ DETERMINISTIC RESPONSE WITH PROMPTS ═══
      if (Object.keys(collected).length > 0 || Object.keys(currentCollected).length > 0) {
        try {
          const { computeFieldState } = await import('../lib/field-engine')
          const feResult = computeFieldState(
            fields.map((f: any) => ({
              fieldName: f.fieldName, label: f.label,
              fieldType: f.fieldType === 'string' ? 'text' : 'number',
              validation: f.validation, options: f.options, prompt: f.prompt,
            })),
            chatConfig.priorityOrder,
            currentCollected,
          )
          if (feResult.nextField?.prompt) {
            const raw = currentCollected
            const firstName = typeof raw?.fullName === 'string' ? raw.fullName.split(' ')[0] : ''
            const prefix = firstName ? `Thanks ${firstName}! ` : 'Thank you! '
            const base = feResult.nextField.prompt
            const options = feResult.nextField.options
            nextFieldOptions = options?.length ? options.slice() : undefined
            const suffix = options?.length ? ` Options: ${options.join(', ')}.` : ''
            responseText = `${prefix}${base}${suffix}`
          }
        } catch { /* non-blocking */ }
      }

      // ═══ POST-STREAM COMPLIANCE VALIDATION ═══
      if (disclosureTexts.length > 0) {
        const missing = disclosureTexts.filter((d: string) => !responseText.includes(d.substring(0, 30)))
        if (missing.length > 0) {
          responseText += '\n\n---\n' + missing.join('\n')
        }
      }

      // Stream the response text word by word for a smooth typing effect
      const words = responseText.split(' ')
      for (let i = 0; i < words.length; i++) {
        controller.enqueue(encoder.encode(JSON.stringify({ token: words[i] + (i < words.length - 1 ? ' ' : '') }) + '\n'))
      }

      // Send done event
      const computedFirstName = (() => {
        const raw = (currentCollected as any)
        if (raw?.firstName && typeof raw.firstName === 'string') return raw.firstName
        if (raw?.fullName && typeof raw.fullName === 'string') return raw.fullName.split(' ')[0]
        return null
      })()
      controller.enqueue(encoder.encode(JSON.stringify({ done: true, message: responseText, firstName: computedFirstName, fullName: (currentCollected as any)?.fullName || null, options: nextFieldOptions }) + '\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Access-Control-Allow-Origin': '*',
    },
  })
})

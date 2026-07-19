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
import { envFromContext } from '../lib/env'
import { computeFieldState, applyRules, type FieldDef } from '../lib/field-engine'
import { loadKnowledgeBase, formatKbContext } from '../lib/knowledge-base'
import { initRouter } from './chat-init'
import { logAuditEvent } from './chat-audit'
import { triggerScoring } from './chat-scoring'
import { chatViewsRouter } from './chat-views'

// ═════════════════════════════════════════════════════════════════════════════
// Router — compose sub-routers
// ═════════════════════════════════════════════════════════════════════════════

export const chatRouter = new Hono()
chatRouter.route('/', initRouter)
chatRouter.route('/', chatViewsRouter)

// ═════════════════════════════════════════════════════════════════════════════
// POST /chat/tool — secure tool dispatch endpoint
// Security: whitelist only, validated by constraint engine
// ═════════════════════════════════════════════════════════════════════════════

chatRouter.post('/chat/tool', async (c) => {
  const db = envFromContext(c).DB
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
      const env = envFromContext(c)
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
        const stateJson = JSON.parse(sessionRow.state_json || '{}')
        let currentField = stateJson.currentField || ''
        if (!currentField) {
          // Use field engine to determine first field
          const feResult = computeFieldState(
            fields.map(f => ({
              fieldName: f.fieldName,
              label: f.label,
              fieldType: (f.fieldType === 'string' ? 'text' : f.fieldType) as 'text' | 'number' | 'select' | 'email' | 'phone',
              validation: { required: f.validation?.required ?? true, min: f.validation?.min, max: f.validation?.max },
              options: f.options,
              placeholder: f.placeholder,
            })),
            config.priorityOrder,
            collected,
          )
          if (feResult.nextField) {
            currentField = feResult.nextField.fieldName
          }
        }


        // ═══ RULE ENGINE ═══ evaluate policy rules against collected fields

        let ruleOutputs: import('../lib/rule-engine').RuleOutput = { flags: [], required_disclosures: [], required_fields: [] }
        try {

        const { results: ruleRows } = await envFromContext(c).DB.prepare('SELECT * FROM rules WHERE tenant_id = ? AND active = 1 ORDER BY priority DESC, created_at DESC').bind(tenantId).all()
        const { evaluateRules } = await import('../lib/rule-engine')
        ruleOutputs = evaluateRules((ruleRows || []) as unknown as import('../lib/rule-engine').Rule[], collected)
        if (ruleOutputs.stage || ruleOutputs.flags.length || ruleOutputs.required_disclosures.length) {
          c.executionCtx.waitUntil(logAuditEvent(envFromContext(c).DB, tenantId, 'rule_evaluated', '', sessionId, { stage: ruleOutputs.stage, flags: ruleOutputs.flags, required_disclosures: ruleOutputs.required_disclosures }))
        }
        } catch {}

        // ═══ LLM CONTEXT ═══ include rules outputs if any
        let ruleContext = ''
        if (ruleOutputs.stage) ruleContext += `\nCurrent stage: ${ruleOutputs.stage}`
        if (ruleOutputs.flags.length) ruleContext += `\nFlags: ${ruleOutputs.flags.join(', ')}`
        if (ruleOutputs.required_disclosures.length) ruleContext += `\nRequired disclosures: ${ruleOutputs.required_disclosures.join(', ')}`
        const fieldDef = currentField ? fields.find((f: any) => f.fieldName === currentField) : undefined
        // Compute remaining fields for LLM constraint
        const feForPrompt = computeFieldState(
          fields.map((f: any) => ({ fieldName: f.fieldName, label: f.label, fieldType: f.fieldType || 'text', validation: { required: true } })),
          config.priorityOrder,
          collected,
        )
        const remainingFieldNames = feForPrompt.missingFields.map((f: any) => f.fieldName)
        // Build LLM prompt with KB context + remaining fields constraint
        const kbEntries = await loadKnowledgeBase(envFromContext(c).TENANT_KV, tenantId, config.knowledgeBase?.topics || [])
        const kbContext = formatKbContext(kbEntries)
        const prompt = buildParsePrompt({
          sessionId,
          tenantId,
          text: userText,
          currentField,
          fieldDef: fieldDef ? { label: fieldDef.label, options: fieldDef.options, fieldType: fieldDef.fieldType } : undefined,
        }, undefined, kbContext + ruleContext, remainingFieldNames)

        // ═══ COMPLIANCE ENFORCEMENT ═══ resolve disclosure text from KV
        let disclosureTexts: string[] = []
        if (ruleOutputs.required_disclosures.length > 0) {
          try {
            const kv = envFromContext(c).TENANT_KV
            const raw: { entries?: Array<{ id: string; value?: string }> } | null = await kv.get(`tenant:${tenantId}:kb:compliance`, 'json')
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
        const llmApiKey = envFromContext(c).LLM_API_KEY
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
            const stateJson = JSON.parse(sessionRow.state_json || '{}')
            const shown = stateJson.shown_disclosures || []
            for (const id of ruleOutputs.required_disclosures) {
              if (!shown.includes(id)) shown.push(id)
            c.executionCtx.waitUntil(logAuditEvent(envFromContext(c).DB, tenantId, 'disclosure_shown', '', sessionId, { disclosure_id: id }))
            }
            stateJson.shown_disclosures = shown
            await envFromContext(c).DB.prepare(
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
          const greeting = config.ui?.greeting || `Welcome! Let's start your application.`
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
            let currentState = { ...JSON.parse(sessionRow.state_json || '{}') }
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
  const db = envFromContext(c).DB
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
  const db = envFromContext(c).DB
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

  const env = envFromContext(c)
  const tenantKv = guardKV(env?.['TENANT_KV'])
  const config: ChatConfig = await loadChatConfig(tenantKv, tenantId)
  const fields: ChatFieldDef[] = normalizeChatFields(config.fields || [])
  const db = guardDB(env?.['DB'])

  // ── Load session state via DO (single source of truth) ──────────
  let collected: Record<string, unknown> = {}
  let state: any = {}
  let sessionFound = false
  const doId = env.CHAT_SESSION?.idFromName ? env.CHAT_SESSION.idFromName(sessionId) : null
  const stub = doId ? env.CHAT_SESSION.get(doId) : null

  if (stub) {
    try {
      // Read from DO
      const stateRes = await stub.fetch('http://internal/state')
      if (stateRes.ok) {
        const doState: { collected?: Record<string, unknown>; currentField?: string } = await stateRes.json()
        collected = doState.collected || {}
        state = { currentField: doState.currentField || '' }
        sessionFound = true
      }
    } catch { /* DO cold — fall through to D1 */ }
  }

  if (!sessionFound) {
    // Fallback: hydrate from D1
    const sessionRow: any = await db.prepare(
      `SELECT objective, state_json, collected_fields_json FROM chat_sessions WHERE id = ?`
    ).bind(sessionId).first()
    if (!sessionRow) return c.json({ error: 'Session not found' }, 404)
    state = JSON.parse(sessionRow.state_json || '{}')
    collected = JSON.parse(sessionRow.collected_fields_json || '{}')
    // Hydrate DO for future reads
    if (stub) {
      c.executionCtx.waitUntil(
        stub.fetch('http://internal/hydrate', {
          method: 'POST',
          body: JSON.stringify({ tenantId }),
        }).catch(() => {})
      )
    }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Deterministic field extraction is authoritative. The stream returns
        // immediately so chat health cannot hang on an external LLM provider.
        const inference = inferFieldUpdate(fields, collected, userText)
        const finalState = { state: inference.state }
        const now = Date.now()
        // Write through DO (single source of truth)
        if (stub) {
          await stub.fetch('http://internal/update', {
            method: 'POST',
            body: JSON.stringify({ collected: inference.updatedCollected, nextField: inference.state.currentField }),
          }).catch(() => {})
        }
        // Also persist to D1 for cold-start recovery
        if (db) {
          await db.prepare(
            `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, updated_at = ? WHERE id = ?`
          ).bind(
            JSON.stringify(inference.updatedCollected),
            JSON.stringify(finalState.state),
            now,
            sessionId,
          ).run().catch(() => {})
        }

        for (const f of inference.validFields) {
          c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'field_updated', '', sessionId, { field: f, value: inference.updatedCollected[f] }))
        }

        if (finalState.state.phase === 'complete') {
          c.executionCtx.waitUntil(triggerScoring(db, c.env, sessionId, tenantId, inference.updatedCollected))
        }

        // Compute firstName from collected fields for widget label update
        const computedFirstName = (() => {
          const raw = inference.updatedCollected
          if (raw?.firstName && typeof raw.firstName === 'string') return raw.firstName
          if (raw?.fullName && typeof raw.fullName === 'string') {
            const parts = raw.fullName.trim().split(/\s+/)
            return parts[0].length > 1 ? parts[0] : null
          }
          return null
        })()

        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({
          done: true,
          message: buildChatDoneMessage({ ...inference, collected: inference.updatedCollected }),
          fields: inference.validFields,
          errors: inference.errors,
          state: finalState.state,
          complete: finalState.state.phase === 'complete',
          llmFallback: config.llmFallback !== false,
          firstName: computedFirstName,
          fullName: inference.updatedCollected?.fullName || null,
          ...(finalState.state.phase === 'complete' ? {
            summary: {
              sessionRef: 'APP-' + Date.now().toString(36).toUpperCase().slice(-6),
              completedAt: new Date().toISOString(),
              fieldsCollected: finalState.state.completedFields.length,
              totalFields: fields.length,
              completionPercentage: fields.length > 0 ? Math.round(finalState.state.completedFields.length / fields.length * 100) : 100,
              firstName: computedFirstName,
            },
          } : {}),
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
  collected?: Record<string, unknown>
}): string {
  if (inference.errors.length) return inference.errors[0]
  if (inference.validFields.length && inference.state.currentField) {
    const fieldName = inference.state.currentField
    // Collect-friendly label
    const friendly: Record<string, string> = {
      fullName: 'your full name',
      email: 'your email address',
      phone: 'your phone number',
      employmentStatus: 'your employment status',
      annualIncome: 'your annual income',
      loanAmount: 'your desired loan amount',
      propertyValue: 'the property value',
      propertyType: 'the property type',
      dependants: 'the number of dependants',
      existingMortgage: 'whether you have an existing mortgage',
    }
    return `Thanks, I've captured that. Please provide ${friendly[fieldName] || fieldName}.`
  }
  if (inference.validFields.length && !inference.state.currentField) {
    // Completion message with next steps
    const collected = (inference.collected || {}) as Record<string, string | undefined>
    const firstName = collected.firstName || collected.fullName?.split(' ')[0] || ''
    const email = collected.email || ''
    const phone = collected.phone || ''
    const ref = 'APP-' + Date.now().toString(36).toUpperCase().slice(-6)
    let msg = 'Thank you'
    if (firstName) msg += `, ${firstName}`
    msg += `. Your application has been submitted.\n\nWhat happens next:\n1. A broker will review your details within 24 hours`
    if (email) msg += `\n2. You'll receive a confirmation at ${email}`
    if (phone) msg += `\n3. We may call you at ${phone} if we need more information`
    msg += `\n\nReference: ${ref}`
    return msg
  }
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

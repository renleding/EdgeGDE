/**
 * EdgeGDE — Shared Chat Processor
 * Core chat logic used by both the streaming and non-streaming endpoints.
 * Handles: field engine, rule eval, LLM call, field extraction, compliance, audit.
 */
import type { Context } from 'hono'

export interface ChatInput {
  tenantId: string
  sessionId: string
  userText: string
  fields: any[]
  chatConfig: any
  collected: Record<string, unknown>
  currentField: string
  fieldDef: any
  session: any
}

export interface ChatResult {
  responseText: string
  updatedCollected?: Record<string, unknown>
  ruleOutputs?: any
  disclosures?: string[]
}

export async function processChatMessage(
  env: any,
  input: ChatInput
): Promise<ChatResult> {
  const { tenantId, sessionId, userText } = input
  const { loadKnowledgeBase, formatKbContext } = await import('./knowledge-base')
  const { buildParsePrompt, parseLlmResponse } = await import('./chat-llm')
  const { evaluateRules, flattenProjection } = await import('./rule-engine')
  const { guardKV } = await import('./kv')
  const { guardDB } = await import('./db')
  let kv: any = null
  let db: any = null
  try { kv = guardKV(env?.['TENANT_KV']) } catch {}
  try { db = guardDB(env?.['DB']) } catch {}

  // Load KB context
  const kb = kv ? await loadKnowledgeBase(kv, tenantId, input.chatConfig?.knowledgeBase?.topics || []) : {}
  const kbContext = formatKbContext(kb)

  // Evaluate rules
  let ruleOutputs: any = { flags: [], required_disclosures: [], required_fields: [], stage: undefined }
  try {
    const { results: ruleRows } = await db.prepare(
      'SELECT * FROM rules WHERE tenant_id = ? AND active = 1 ORDER BY priority DESC, created_at DESC'
    ).bind(tenantId).all()
    if (ruleRows?.length) {
      const flat = flattenProjection(input.collected)
      ruleOutputs = evaluateRules(ruleRows, flat) || ruleOutputs
    }
  } catch {}

  // Build prompt with KB + rule context
  let ruleContext = ''
  if (ruleOutputs.stage) ruleContext += `\nCurrent stage: ${ruleOutputs.stage}`
  if (ruleOutputs.flags?.length) ruleContext += `\nFlags: ${ruleOutputs.flags.join(', ')}`
  if (ruleOutputs.required_disclosures?.length) ruleContext += `\nRequired disclosures: ${ruleOutputs.required_disclosures.join(', ')}`

  const prompt = buildParsePrompt({
    sessionId, tenantId, text: userText,
    currentField: input.currentField,
    fieldDef: input.fieldDef ? { label: input.fieldDef.label, options: input.fieldDef.options, fieldType: input.fieldDef.fieldType } : undefined,
    collectedFields: Object.keys(input.collected),
  }, kbContext + ruleContext)

  // Resolve disclosure texts
  let disclosureTexts: string[] = []
  if (ruleOutputs.required_disclosures?.length && kv) {
    try {
      const complianceEntry = await kv.get(`tenant:${tenantId}:kb:compliance`, 'json')
      if (complianceEntry && typeof complianceEntry === 'object') {
        disclosureTexts = ruleOutputs.required_disclosures
          .map((id: string) => (complianceEntry as any)[id]?.value)
          .filter(Boolean) as string[]
      }
    } catch {}
  }

  // Call LLM
  const LLM_API_KEY = env?.LLM_API_KEY || ''
  let fullResponse = ''
  let maxAttempts = 2

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const enhancedPrompt = attempt > 0
      ? prompt + '\n\nYOU MUST include ALL required disclosures. Do not omit them.'
      : (disclosureTexts.length ? prompt + `\n\nYou MUST include the following disclosures:\n- ${disclosureTexts.join('\n- ')}\nFailure to include them is not allowed.` : prompt)

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
        messages: [{ role: 'user', content: enhancedPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    })

    if (!llmRes.ok) {
      fullResponse = `{"response_text": "I'm having trouble processing that. Could you try again?"}`
      break
    }

    fullResponse = await llmRes.text()

    // Parse response
    const cleanJson = fullResponse.replace(/^```(?:json)?\n?|\n?```$/g, '').trim()
    let parsed: any
    try {
      parsed = JSON.parse(cleanJson)
    } catch {
      parsed = { response_text: fullResponse.trim() }
    }

    const responseText = parsed.response_text || parsed.response || fullResponse

    // Validate disclosures (post-LLM compliance check)
    if (disclosureTexts.length && attempt < maxAttempts - 1) {
      const valid = disclosureTexts.every((d: string) =>
        responseText.includes(d.substring(0, 20))
      )
      if (valid) {
        // Field extraction
        let currentCollected = { ...input.collected }
        let hadFieldExtraction = false
        if (parsed.extracted_fields && Object.keys(parsed.extracted_fields).length > 0) {
          hadFieldExtraction = true
          const { applyFieldUpdate } = await import('./chat-constraint')
          for (const [f, v] of Object.entries(parsed.extracted_fields)) {
            const r = applyFieldUpdate(input.fields, currentCollected, f, v)
            if (!r.error) currentCollected = r.collected
          }
        }

        // Deterministic response: override LLM's response_text for field collection
        // to prevent hallucinated field names (e.g. "date of birth")
        let finalResponseText = responseText
        if (hadFieldExtraction) {
          const { computeFieldState } = await import('./field-engine')
          const feResult = computeFieldState(
            input.fields.map((f: any) => ({ fieldName: f.fieldName, label: f.label, fieldType: f.fieldType || 'text', validation: { required: true }, prompt: f.prompt })),
            input.chatConfig.priorityOrder,
            currentCollected,
          )
          if (feResult.phase === 'complete') {
            finalResponseText = 'Thank you! Your application has been submitted for review.'
          } else if (feResult.nextField) {
            const next = feResult.nextField
            // Use previous field value to personalize the response
            const prevFieldValue = currentCollected[input.currentField]
            const prevValue = typeof prevFieldValue === 'string' ? prevFieldValue.trim() : ''
            // Extract first name from fullName for a natural greeting
            const fullName = currentCollected['fullName']
            const firstName = typeof fullName === 'string' ? fullName.split(' ')[0] : ''
            // Build response: use field prompt if available, else default template
            const baseQuestion = next.prompt || `Could you please provide your ${next.label.toLowerCase()}?`
            const prefix = firstName ? `Thanks ${firstName}! ` : `Thank you! `
            const optionsSuffix = next.options?.length ? ` Options: ${next.options.join(', ')}.` : ''
            if (prevValue && next.fieldType !== 'password') {
              const ack = prevValue.length > 30 ? prevValue.substring(0, 27) + '...' : prevValue
              finalResponseText = `${prefix}Got ${ack}. ${baseQuestion}${optionsSuffix}`
            } else {
              finalResponseText = `${prefix}${baseQuestion}${optionsSuffix}`
            }
          }
        }

        // Update session
        const now = Date.now()
        const stateJson = JSON.parse(input.session.state_json || '{}')
        const shown = stateJson.shown_disclosures || []
        stateJson.shown_disclosures = [...new Set([...shown, ...ruleOutputs.required_disclosures])]

        await db.prepare(
          `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, updated_at = ? WHERE id = ?`
        ).bind(JSON.stringify(currentCollected), JSON.stringify(stateJson), now, sessionId).run()

        // Audit log
        try {
          const { logAuditEvent } = await import('./audit')
          await logAuditEvent(db, tenantId, sessionId, 'rule_evaluated', ruleOutputs)
          for (const d of ruleOutputs.required_disclosures || []) {
            await logAuditEvent(db, tenantId, sessionId, 'disclosure_shown', { disclosure_id: d })
          }
        } catch {}

        return {
          responseText: finalResponseText + (disclosureTexts.length ? '\n\n⚠ Important:\n' + disclosureTexts.join('\n') : ''),
          updatedCollected: currentCollected,
          ruleOutputs,
          disclosures: disclosureTexts,
        }
      }
      // Retry with stronger instruction
      continue
    }

    // Last attempt: append disclosures as fallback
    if (disclosureTexts.length) {
      const info = '⚠ Important:\n' + disclosureTexts.join('\n')
      return {
        responseText: responseText + '\n\n' + info,
        disclosures: disclosureTexts,
      }
    }

    // No disclosures required — just return
    let currentCollected = { ...input.collected }
    let finalResponseText = responseText
    if (parsed.extracted_fields && Object.keys(parsed.extracted_fields).length > 0) {
      const { applyFieldUpdate } = await import('./chat-constraint')
      for (const [f, v] of Object.entries(parsed.extracted_fields)) {
        const r = applyFieldUpdate(input.fields, currentCollected, f, v)
        if (!r.error) currentCollected = r.collected
      }
      // Deterministic response: override LLM's response_text for field collection
      // to prevent hallucinated field names (e.g. "date of birth")
      const { computeFieldState } = await import('./field-engine')
      const feResult = computeFieldState(
        input.fields.map((f: any) => ({ fieldName: f.fieldName, label: f.label, fieldType: f.fieldType || 'text', validation: { required: true }, prompt: f.prompt })),
        input.chatConfig.priorityOrder,
        currentCollected,
      )
      if (feResult.phase === 'complete') {
        finalResponseText = 'Thank you! Your application has been submitted for review.'
      } else if (feResult.nextField) {
        const next = feResult.nextField
        // Use previous field value to personalize the response
        const prevFieldValue = currentCollected[input.currentField]
        const prevValue = typeof prevFieldValue === 'string' ? prevFieldValue.trim() : ''
        const fullName = currentCollected['fullName']
        const firstName = typeof fullName === 'string' ? fullName.split(' ')[0] : ''
        // Build response: use field prompt if available, else default template
        const baseQuestion = next.prompt || `Could you please provide your ${next.label.toLowerCase()}?`
        const prefix = firstName ? `Thanks ${firstName}! ` : `Thank you! `
        const optionsSuffix = next.options?.length ? ` Options: ${next.options.join(', ')}.` : ''
        if (prevValue && next.fieldType !== 'password') {
          const ack = prevValue.length > 30 ? prevValue.substring(0, 27) + '...' : prevValue
          finalResponseText = `${prefix}Got ${ack}. ${baseQuestion}${optionsSuffix}`
        } else {
          finalResponseText = `${prefix}${baseQuestion}${optionsSuffix}`
        }
      }
    }
    const now = Date.now()
    await db.prepare(
      `UPDATE chat_sessions SET collected_fields_json = ?, updated_at = ? WHERE id = ?`
    ).bind(JSON.stringify(currentCollected), now, sessionId).run()

    return { responseText: finalResponseText, updatedCollected: currentCollected }
  }

  return { responseText: fullResponse }
}

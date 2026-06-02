/**
 * EdgeGDE — Conversational LLM Parser
 * Phase 10, Phase 3: The LLM is a parser only.
 * It extracts intent and values from user messages.
 * It has NO authority — the constraint engine validates everything.
 *
 * @packageDocumentation
 */

export interface UserMessage {
  sessionId: string
  tenantId: string
  text: string
  currentField?: string // the field the system is currently asking about
  fieldDef?: { label: string; options?: string[]; fieldType: string }
}

export interface ParsedIntent {
  field?: string      // which field the user is answering
  value?: unknown     // the extracted value
  extracted_fields?: Record<string, unknown>  // new: multiple fields from one message
  intent: 'field_value' | 'start' | 'cancel' | 'unknown' | 'question'
  raw: string
  response?: string   // KB answer for question intent
}

/**
 * Build the LLM prompt for intent extraction.
 * The LLM sees ONLY: user message, current field context, and strict JSON schema.
 */
export function buildParsePrompt(msg: UserMessage, kbContext?: string): string {
  const ctx = msg.currentField
    ? `The system is currently asking about "${msg.currentField}" (label: "${msg.fieldDef?.label || msg.currentField}"). Use the field name "${msg.currentField}" in your response.`
    : 'The user is starting a new conversation.'

  const optionsHint = msg.fieldDef?.options?.length
    ? ` Valid options: ${msg.fieldDef.options.join(', ')}. If the user's answer matches one of these, set "field" to "${msg.currentField}" and "value" to the option.`
    : ''

  const kbSection = kbContext
    ? `\n\nHere is the current knowledge base information:\n${kbContext}`
    : '\n\nNo knowledge base available.'

  return `You are a conversational mortgage assistant. Your ONLY job is to answer questions from the knowledge base and collect application fields.

${kbSection}

Conversation context: ${ctx}${optionsHint}

Instructions:
- If the user gives their name, you MUST set ALL these in extracted_fields at once: fullName, firstName, middleName (if present), lastName. Example: "Warren G" → {"fullName":"Warren G","firstName":"Warren","lastName":"G"}. "John Michael Smith" → {"fullName":"John Michael Smith","firstName":"John","middleName":"Michael","lastName":"Smith"}
- If the user asks a question → answer it from the knowledge base and set intent "question"
- If the user provides data → set ALL related fields in extracted_fields
- Always end by asking for: "${msg.fieldDef?.label || msg.currentField || 'your full name'}"
- If unclear → intent "unknown"

User: "${msg.text}"

Output JSON only:
{"response_text": "...", "extracted_fields": {}, "intent": "question|field_value|start|cancel|unknown"}`
}

/**
 * Parse the LLM response into a structured intent.
 * Returns a safe default if parsing fails — the LLM can't crash the system.
 */
export function parseLlmResponse(raw: string): ParsedIntent {
  try {
    const parsed = JSON.parse(raw)
    // Support new format (extracted_fields) and old format (field/value) for backward compat
    const fields = parsed.extracted_fields || {}
    const fieldKeys = Object.keys(fields)
    return {
      field: typeof parsed.field === 'string' ? parsed.field : (fieldKeys[0] || undefined),
      value: parsed.value ?? (fieldKeys.length > 0 ? fields[fieldKeys[0]] : undefined),
      extracted_fields: fields,
      intent: ['field_value', 'start', 'cancel', 'unknown', 'question'].includes(parsed.intent) ? parsed.intent : 'unknown',
      raw: parsed.raw || raw,
      response: parsed.response_text || parsed.response || undefined,
    }
  } catch {
    return { intent: 'unknown', raw }
  }
}

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
  currentField?: string
  fieldDef?: { label: string; options?: string[]; fieldType: string }
  collectedFields?: string[]  // fields already collected, for LLM context
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
  const collectedSummary = msg.collectedFields?.length
    ? `\nAlready collected fields: ${msg.collectedFields.join(', ')}.`
    : ''
  const nextFieldHint = msg.currentField
    ? ` The NEXT field to ask for is "${msg.currentField}" (label: "${msg.fieldDef?.label || msg.currentField}"). If the user provides a value for this field, set extracted_fields["${msg.currentField}"] = the value.`
    : ' Collect any fields the user provides.'

  const optionsHint = msg.fieldDef?.options?.length
    ? ` Valid options for "${msg.currentField}": ${msg.fieldDef.options.join(', ')}. Match case-insensitively — "refinance" = "Refinance". Set the value to the EXACT option text.`
    : ''

  const kbSection = kbContext
    ? `\n\nHere is the current knowledge base information:\n${kbContext}`
    : '\n\nNo knowledge base available.'

  return `You are a conversational mortgage assistant. Your ONLY job is to answer questions from the knowledge base and collect application fields.

${kbSection}

Collection status:${collectedSummary}${nextFieldHint}${optionsHint}

Instructions:
- If the user gives their name, set fullName accordingly (the firstName is derived for personalization, not a separate field). Example: "Warren G" → {"fullName":"Warren G"}. "John Michael Smith" → {"fullName":"John Michael Smith"}
- Match options case-insensitively — user's "refinance" matches option "Refinance"
- If the user asks a question → answer it from the knowledge base and set intent "question"
- If the user provides data → set ALL related fields in extracted_fields
- If the user provided the requested field, thank them and ask for the NEXT field that hasn't been collected yet.
- If the user DID NOT provide the requested field, ask for it naturally: "${msg.fieldDef?.label || msg.currentField || 'your full name'}"
- NEVER just say the field name (e.g. "Full Name") — always ask a natural question like "Could you please provide your full name?"
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

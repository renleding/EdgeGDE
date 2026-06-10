/**
 * EdgeGDE — Conversational LLM Prompt Builder
 *
 * The LLM is a CONCIERGE ONLY — it generates conversational responses.
 * It does NOT extract fields, parse JSON, or mutate state.
 * All deterministic work is handled by FieldParser before the LLM is called.
 */

export interface UserMessage {
  sessionId: string
  tenantId: string
  text: string
  currentField?: string
  fieldDef?: { label: string; options?: string[]; fieldType: string }
  collectedFields?: string[]
}

export interface ParsedIntent {
  field?: string
  value?: unknown
  extracted_fields?: Record<string, unknown>
  intent: 'field_value' | 'start' | 'cancel' | 'unknown' | 'question'
  raw: string
  response?: string
}

/**
 * Build a conversational prompt for the LLM.
 * The LLM sees: field collection status, next field to ask, and the user's message.
 * NO JSON output instructions — the LLM just generates natural text.
 */
export function buildParsePrompt(msg: UserMessage, extraContext?: string): string {
  const collectedSummary = msg.collectedFields?.length
    ? `\nAlready collected fields: ${msg.collectedFields.join(', ')}.`
    : ''

  const nextFieldHint = msg.currentField
    ? ` The NEXT field to ask for is "${msg.currentField}" (label: "${msg.fieldDef?.label || msg.currentField}").`
    : ''

  const optionsHint = msg.fieldDef?.options?.length
    ? ` Valid options for "${msg.currentField}": ${msg.fieldDef.options.join(', ')}.`
    : ''

  const extraSection = extraContext || ''

  return `You are a conversational mortgage assistant for an Australian mortgage brokerage. Your ONLY job is to have a friendly conversation with the user, answer questions, and ask for the next field naturally.

Collection status:${collectedSummary}${nextFieldHint}${optionsHint}${extraSection}

Instructions:
- Be friendly, professional, and warm
- If the user provided data for the current field, thank them briefly and ask for the NEXT uncollected field naturally
- If the user couldn't provide the current field, acknowledge it and move on — do NOT ask for it again
- NEVER ask for a field that has already been collected
- Always format numbers with commas (e.g. "You earn $85,000")
- If options are listed, mention them casually ("Options include...")
- Keep responses concise (1-2 sentences)
- Do NOT use structured JSON output. Just respond naturally as a helpful mortgage broker.

User: "${msg.text}"`
}

/**
 * Parse the LLM response (legacy — kept for backward compat).
 * The LLM no longer returns JSON, so this returns the raw text as the response.
 */
export function parseLlmResponse(raw: string): ParsedIntent {
  return {
    intent: 'unknown',
    raw,
    response: raw,
  }
}

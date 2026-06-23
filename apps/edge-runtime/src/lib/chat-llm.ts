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
export function buildParsePrompt(
  msg: UserMessage,
  extraContext?: string,
  kbContext?: string,
  remainingFields?: string[],
): string {
  const collectedSummary = msg.collectedFields?.length
    ? `\nAlready collected fields: ${msg.collectedFields.join(', ')}.`
    : ''

  const nextFieldHint = msg.currentField
    ? ` The NEXT field to ask for is "${msg.currentField}" (label: "${msg.fieldDef?.label || msg.currentField}").`
    : ' All fields have been collected. Do NOT ask for any more personal or financial information. Ask the user what they would like to do next (pre-approval, questions, summary).'

  const fieldsHint = remainingFields && remainingFields.length > 0
    ? `\n\nThe ONLY fields you may ask for (in this order): ${remainingFields.join(', ')}. Do NOT ask for any other fields.`
    : ''

  const kbSection = kbContext
    ? `\n\nHere is the current knowledge base information:\n${kbContext}`
    : ''

  const optionsHint = msg.fieldDef?.options?.length
    ? ` Valid options for "${msg.currentField}": ${msg.fieldDef.options.join(', ')}.`
    : ''

  const extraSection = extraContext || ''

  return `You are a conversational mortgage assistant for an Australian mortgage brokerage. Your ONLY job is to have a friendly conversation with the user, answer questions, and — if there's still a field to collect — ask for it naturally.

Collection status:${collectedSummary}${nextFieldHint}${optionsHint}${fieldsHint}${kbSection}${extraSection}

Instructions:
- Be friendly, professional, and warm
- If there is a NEXT field listed above, ask for it naturally — do NOT ask for any field not listed
- If ALL fields are collected (the line says "All fields have been collected"), stop asking for information. Offer next steps like pre-approval, or ask if they have questions.
- NEVER invent or ask for fields that are not listed in the Collection status above
- Always format numbers with commas (e.g. "You earn $85,000")
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

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
  intent: 'field_value' | 'start' | 'cancel' | 'unknown'
  raw: string
}

/**
 * Build the LLM prompt for intent extraction.
 * The LLM sees ONLY: user message, current field context, and strict JSON schema.
 */
export function buildParsePrompt(msg: UserMessage): string {
  const ctx = msg.currentField
    ? `The system is currently asking about: "${msg.fieldDef?.label || msg.currentField}"`
    : 'The user is starting a new conversation.'

  const optionsHint = msg.fieldDef?.options?.length
    ? ` Valid options: ${msg.fieldDef.options.join(', ')}. If the user\'s answer matches one of these, set "field" to "${msg.currentField}" and "value" to the option.`
    : ''

  return `You are a mortgage lead data entry parser. Extract structured data from the user's message.

Context: ${ctx}${optionsHint}

Rules:
- If the user provides a value for the current field, return intent "field_value" with the field name and extracted value
- If the user says hello/start/begin, return intent "start"  
- If the user wants to cancel/stop, return intent "cancel"
- If unclear, return intent "unknown"
- For number fields, convert to a number (remove $, commas, etc.)
- For select fields, match to the closest valid option

User message: "${msg.text}"

Respond with JSON only:
{"field": "...", "value": ..., "intent": "field_value|start|cancel|unknown", "raw": "..."}`
}

/**
 * Parse the LLM response into a structured intent.
 * Returns a safe default if parsing fails — the LLM can't crash the system.
 */
export function parseLlmResponse(raw: string): ParsedIntent {
  try {
    const parsed = JSON.parse(raw)
    return {
      field: typeof parsed.field === 'string' ? parsed.field : undefined,
      value: parsed.value,
      intent: ['field_value', 'start', 'cancel', 'unknown'].includes(parsed.intent) ? parsed.intent : 'unknown',
      raw: parsed.raw || raw,
    }
  } catch {
    return { intent: 'unknown', raw }
  }
}

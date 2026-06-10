/**
 * EdgeGDE — Field Parser
 *
 * Deterministic parsing of user input per field type.
 * NO LLM involvement — pure server-side logic.
 *
 * Returns a ParseResult with:
 *   - value: parsed value (or null for unknown/skipped)
 *   - status: 'ok' | 'unknown' | 'skipped' | 'error'
 *   - completed: true if the field should be marked done
 *   - confidence: 0-1 confidence score
 *   - raw: original user input
 *   - error: error message (if status === 'error')
 */

export interface ParseResult {
  fieldName: string
  value: unknown
  raw: string
  status: 'ok' | 'unknown' | 'skipped' | 'error'
  completed: boolean
  confidence: number
  error?: string
}

// Patterns that indicate the user doesn't know / wants to skip
const UNKNOWN_PATTERNS = [
  /^don'?t\s*know$/i,
  /^not\s*sure$/i,
  /^unsure$/i,
  /^idk$/i,
  /^n\/?a$/i,
  /^skip$/i,
  /^pass$/i,
  /^unknown$/i,
  /^\?$/i,
  /^i\s*don'?t\s*know$/i,
  /^i'm\s*not\s*sure$/i,
  /^i\s*haven'?t\s*decided$/i,
  /^can'?t\s*say$/i,
  /^rather\s*not\s*say$/i,
]

// Greeting/small-talk patterns that aren't field values
const GREETING_PATTERNS = [
  /^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening|day)|howdy|greetings)$/i,
  /^how\s*(are|r)\s*you/i,
  /^what'?s\s*up/i,
  /^nice\s*to\s*meet/i,
]

const UNKNOWN_RESULT = (field: string, raw: string): ParseResult => ({
  fieldName: field,
  value: null,
  raw,
  status: 'unknown',
  completed: true,
  confidence: 1,
})

const ERROR_RESULT = (field: string, raw: string, error: string): ParseResult => ({
  fieldName: field,
  value: null,
  raw,
  status: 'error',
  completed: false,
  confidence: 1,
  error,
})

const OK_RESULT = (field: string, value: unknown, raw: string): ParseResult => ({
  fieldName: field,
  value,
  raw,
  status: 'ok',
  completed: true,
  confidence: field === 'fullName' ? 0.95 : 1,
})

/**
 * Normalize boolean-like responses to canonical 'Yes'/'No'.
 */
function normalizeBoolean(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (['yes', 'yep', 'yeah', 'y', 'correct', 'true', 'sure', 'definitely', 'absolutely'].includes(v)) return 'Yes'
  if (['no', 'nope', 'nah', 'n', 'false', 'not really', 'never'].includes(v)) return 'No'
  return raw.trim()
}

/**
 * Normalize select option values (case-insensitive match against canonical options).
 */
function normalizeSelect(raw: string, options: string[]): string | null {
  const v = raw.trim().toLowerCase()
  for (const opt of options) {
    if (opt.toLowerCase() === v) return opt
  }
  // Try prefix match (e.g. "self" → "Self-Employed")
  for (const opt of options) {
    if (opt.toLowerCase().startsWith(v)) return opt
  }
  return null
}

/**
 * Parse text/number from a string, handling common formats.
 */
function parseNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/[,/$%\s]/g, '')
    .replace(/^about/i, '')
    .replace(/^around/i, '')
    .replace(/^approximately/i, '')
    .replace(/^roughly/i, '')
    .trim()
  // Handle "120k" → 120000
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*k$/i)
  if (kMatch) return parseFloat(kMatch[1]) * 1000
  const mMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*m$/i)
  if (mMatch) return parseFloat(mMatch[1]) * 1000000
  const num = Number(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Main parse function — dispatches by field name.
 */
export function parseField(
  fieldName: string,
  userText: string,
  options?: string[],
): ParseResult {
  const raw = userText.trim()

  if (!raw) return ERROR_RESULT(fieldName, raw, 'Please provide a value')

  // Check unknown patterns first
  for (const p of UNKNOWN_PATTERNS) {
    if (p.test(raw)) return UNKNOWN_RESULT(fieldName, raw)
  }

  switch (fieldName) {
    case 'fullName': {
      // Greetings are not valid names
      for (const p of GREETING_PATTERNS) {
        if (p.test(raw)) return UNKNOWN_RESULT(fieldName, raw)
      }
      if (raw.length < 2) return ERROR_RESULT(fieldName, raw, 'Name must be at least 2 characters')
      return OK_RESULT(fieldName, raw, raw)
    }

    case 'email':
    case 'emailAddress': {
      if (!raw.includes('@')) return ERROR_RESULT(fieldName, raw, 'Please provide a valid email address')
      const parts = raw.split('@')
      if (parts.length !== 2 || !parts[0] || !parts[1].includes('.')) {
        return ERROR_RESULT(fieldName, raw, 'Please provide a valid email address')
      }
      return OK_RESULT(fieldName, raw.toLowerCase().trim(), raw)
    }

    case 'phone': {
      const digits = raw.replace(/\D/g, '')
      if (digits.length !== 10) {
        return ERROR_RESULT(fieldName, raw, 'Phone number must be exactly 10 digits')
      }
      if (!digits.startsWith('04')) {
        return ERROR_RESULT(fieldName, raw, 'Phone number must start with 04')
      }
      return OK_RESULT(fieldName, digits, raw)
    }

    case 'employmentType': {
      const canonical = normalizeSelect(raw, options || [])
      if (!canonical) {
        return ERROR_RESULT(fieldName, raw, `Employment type must be one of: ${(options || []).join(', ')}`)
      }
      return OK_RESULT(fieldName, canonical, raw)
    }

    case 'annualIncome':
    case 'loanAmount':
    case 'propertyValue': {
      const num = parseNumber(raw)
      if (num === null) {
        return ERROR_RESULT(fieldName, raw, 'Please enter a valid number')
      }
      if (num <= 0) {
        return ERROR_RESULT(fieldName, raw, 'Please enter a positive number')
      }
      return OK_RESULT(fieldName, num, raw)
    }

    case 'loanPurpose': {
      const canonical = normalizeSelect(raw, options || [])
      if (!canonical) {
        return ERROR_RESULT(fieldName, raw, `Loan purpose must be one of: ${(options || []).join(', ')}`)
      }
      return OK_RESULT(fieldName, canonical, raw)
    }

    case 'isFirstHomeBuyer':
    case 'hasExistingLoan':
    case 'isFirstHomeBuyerBool': {
      const normalized = normalizeBoolean(raw)
      if (normalized !== 'Yes' && normalized !== 'No') {
        return ERROR_RESULT(fieldName, raw, 'Please answer Yes or No')
      }
      return OK_RESULT(fieldName, normalized, raw)
    }

    default:
      // Unknown field — accept as-is
      return OK_RESULT(fieldName, raw, raw)
  }
}

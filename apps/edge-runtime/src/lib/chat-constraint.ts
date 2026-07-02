/**
 * EdgeGDE — Conversational Constraint Engine
 * Takes form schema + collected fields → next question.
 */
export interface ChatFieldDef {
  fieldName: string
  label: string
  fieldType: 'string' | 'number' | 'select'
  options?: string[]
  prompt?: string
  validation?: { required?: boolean; min?: number; max?: number; minLength?: number; maxLength?: number }
  placeholder?: string
}

export interface ChatSessionState {
  currentField: string
  completedFields: string[]
  errors: string[]
  phase: 'collecting' | 'complete'
}

/**
 * Fuzzy-match a user input against a list of options.
 * Priority: exact → prefix → contains → Levenshtein ≤ 2
 */
export function fuzzyMatchOption(input: string, options: string[]): string | null {
  const norm = input.toLowerCase().trim()
  // Exact match
  const exact = options.find(o => o.toLowerCase() === norm)
  if (exact) return exact
  // Prefix match (user types "owner" → "Owner-occupied")
  const prefix = options.find(o => o.toLowerCase().startsWith(norm))
  if (prefix) return prefix
  // Contains match
  const contains = options.find(o => o.toLowerCase().includes(norm))
  if (contains) return contains
  // Levenshtein within 2 edits
  for (const opt of options) {
    const d = levenshtein(norm, opt.toLowerCase())
    if (d <= 2) return opt
  }
  return null
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function findNextField(fields: ChatFieldDef[], collected: Record<string, unknown>): { field: ChatFieldDef | null; state: ChatSessionState } {
  const completedFields: string[] = []
  const errors: string[] = []
  for (const field of fields) {
    const value = collected[field.fieldName]
    if (value !== undefined && value !== null && value !== '') {
      const err = validateField(field, value)
      if (err) errors.push(`${field.fieldName}: ${err}`)
      else completedFields.push(field.fieldName)
    }
  }
  for (const field of fields) {
    if (!completedFields.includes(field.fieldName)) {
      if (field.validation?.required !== false) {
        return { field, state: { currentField: field.fieldName, completedFields, errors, phase: 'collecting' } }
      }
    }
  }
  return { field: null, state: { currentField: '', completedFields, errors, phase: 'complete' } }
}

export function validateField(field: ChatFieldDef, value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    if (field.validation?.required !== false) return `${field.label} is required`
    return null
  }
  let cleanedValue = value
  if (field.fieldType === 'number' && typeof value === 'string') cleanedValue = value.replace(/[,/$]/g, '').trim()
  const v = field.fieldType === 'number' ? Number(cleanedValue) : String(cleanedValue).trim()

  if (field.fieldType === 'number') {
    if (isNaN(v as number)) return `${field.label} must be a number`
    const num = v as number
    if (field.validation?.min !== undefined && num < field.validation.min) return `${field.label} must be at least ${field.validation.min}`
    if (field.validation?.max !== undefined && num > field.validation.max) return `${field.label} must be at most ${field.validation.max}`
  }

  if (field.fieldType === 'string') {
    const str = v as string
    if (field.validation?.minLength !== undefined && str.length < field.validation.minLength) return `${field.label} must be at least ${field.validation.minLength} characters`
    if (field.validation?.maxLength !== undefined && str.length > field.validation.maxLength) return `${field.label} must be at most ${field.validation.maxLength} characters`
  }

  if (field.fieldType === 'select' && field.options && field.options.length > 0) {
    const str = String(value).toLowerCase().trim()
    const valid = field.options.map(o => o.toLowerCase())
    if (!valid.includes(str)) return `${field.label} must be one of: ${field.options.join(', ')}`
  }

  // Email validation
  const fn = field.fieldName?.toLowerCase()
  if (fn === 'email' || fn === 'emailaddress') {
    const str = String(value).trim()
    if (!str.includes('@')) return 'Email address is missing the @ symbol. Please include @domain.com'
    if (!str.includes('.')) return 'Email domain appears incomplete. Please use a format like name@domain.com'
    const parts = str.split('@')
    if (parts.length !== 2 || !parts[0]) return 'Email address is missing the local part before @'
    if (!parts[1].includes('.')) return `Email domain "${parts[1]}" appears incomplete. Did you mean ${parts[1]}.com?`
  }

  // Australian mobile validation
  const fname = field.fieldName?.toLowerCase()
  if (fname === 'phone' || fname?.includes('phone')) {
    const digits = String(value).replace(/\D/g, '')
    if (digits.length !== 10) return 'Phone number must be exactly 10 digits'
    if (!digits.startsWith('04')) return 'Phone number must start with 04'
  }

  return null
}

export function applyFieldUpdate(fields: ChatFieldDef[], collected: Record<string, unknown>, fieldName: string, value: unknown): { collected: Record<string, unknown>; error: string | null; state: ChatSessionState } {
  const field = fields.find(f => f.fieldName === fieldName)
  if (!field) return { collected, error: `Unknown field: ${fieldName}`, state: { currentField: '', completedFields: Object.keys(collected), errors: [`Unknown field: ${fieldName}`], phase: 'collecting' } }

  // Fuzzy match for select fields
  let correctedValue = value
  if (field.fieldType === 'select' && field.options && field.options.length > 0) {
    const fuzzy = fuzzyMatchOption(String(value), field.options)
    if (fuzzy) correctedValue = fuzzy
  }

  const err = validateField(field, correctedValue)
  if (err) return { collected, error: err, state: { currentField: fieldName, completedFields: Object.keys(collected), errors: [err], phase: 'collecting' } }

  const storeValue = field.fieldType === 'number' && typeof correctedValue === 'string'
    ? Number(String(correctedValue).replace(/[,/$]/g, '').trim())
    : field.fieldType === 'number' ? Number(correctedValue) : correctedValue
  const updated = { ...collected, [fieldName]: storeValue }
  const next = findNextField(fields, updated)
  return { collected: updated, error: null, state: next.state }
}

export function normalizeChatFields(fields: any[]): ChatFieldDef[] {
  return fields.map(f => ({
    fieldName: f.fieldName || '',
    label: f.label || f.fieldName || '',
    fieldType: f.fieldType || 'string',
    options: f.options,
    prompt: f.prompt,
    validation: f.validation,
    placeholder: f.placeholder,
  }))
}

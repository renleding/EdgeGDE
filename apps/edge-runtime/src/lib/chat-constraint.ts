/**
 * EdgeGDE — Conversational Constraint Engine
 * Phase 10, Phase 2: Deterministic field resolution.
 * No workflows, no state machine, no LLM authority.
 *
 * Takes form schema + collected fields → next question.
 *
 * @packageDocumentation
 */

export interface ChatFieldDef {
  fieldName: string
  label: string
  fieldType: 'string' | 'number' | 'select'
  options?: string[]
  prompt?: string
  validation?: {
    required?: boolean
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
  }
  placeholder?: string
}

export interface ChatSessionState {
  currentField: string
  completedFields: string[]
  errors: string[]
  phase: 'collecting' | 'complete'
}

/**
 * Find the next incomplete required field.
 * Deterministic — always returns the same result for the same inputs.
 */
export function findNextField(
  fields: ChatFieldDef[],
  collected: Record<string, unknown>,
): { field: ChatFieldDef | null; state: ChatSessionState } {
  const completedFields: string[] = []
  const errors: string[] = []

  for (const field of fields) {
    const value = collected[field.fieldName]

    if (value !== undefined && value !== null && value !== '') {
      // Validate collected value
      const err = validateField(field, value)
      if (err) {
        errors.push(`${field.fieldName}: ${err}`)
      } else {
        completedFields.push(field.fieldName)
      }
    }
  }

  // Find first missing required field
  for (const field of fields) {
    if (!completedFields.includes(field.fieldName)) {
      if (field.validation?.required !== false) {
        return {
          field,
          state: {
            currentField: field.fieldName,
            completedFields,
            errors,
            phase: 'collecting',
          },
        }
      }
    }
  }

  // All fields complete
  return {
    field: null,
    state: {
      currentField: '',
      completedFields,
      errors,
      phase: 'complete',
    },
  }
}

/**
 * Validate a single field value against its definition.
 * Returns error string or null if valid.
 */
export function validateField(field: ChatFieldDef, value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    if (field.validation?.required !== false) {
      return `${field.label} is required`
    }
    return null
  }

  // Strip commas and currency symbols from number values
  let cleanedValue = value
  if (field.fieldType === 'number' && typeof value === 'string') {
    cleanedValue = value.replace(/[,/$]/g, '').trim()
  }

  const v = field.fieldType === 'number' ? Number(cleanedValue) : String(cleanedValue).trim()

  if (field.fieldType === 'number') {
    if (isNaN(v as number)) return `${field.label} must be a number`
    const num = v as number
    if (field.validation?.min !== undefined && num < field.validation.min) {
      return `${field.label} must be at least ${field.validation.min}`
    }
    if (field.validation?.max !== undefined && num > field.validation.max) {
      return `${field.label} must be at most ${field.validation.max}`
    }
  }

  if (field.fieldType === 'string') {
    const str = v as string
    if (field.validation?.minLength !== undefined && str.length < field.validation.minLength) {
      return `${field.label} must be at least ${field.validation.minLength} characters`
    }
    if (field.validation?.maxLength !== undefined && str.length > field.validation.maxLength) {
      return `${field.label} must be at most ${field.validation.maxLength} characters`
    }
  }

  if (field.fieldType === 'select' && field.options && field.options.length > 0) {
    const str = String(value).toLowerCase()
    const valid = field.options.map(o => o.toLowerCase())
    if (!valid.includes(str)) {
      return `${field.label} must be one of: ${field.options.join(', ')}`
    }
  }

  // ── Email validation ──────────────────────────────────────────────────
  const fn = field.fieldName?.toLowerCase()
  if (fn === 'email' || fn === 'emailaddress') {
    const str = String(value).trim()
    if (!str.includes('@') || !str.includes('.')) {
      return 'Please provide a valid email address'
    }
    const parts = str.split('@')
    if (parts.length !== 2 || !parts[0] || !parts[1].includes('.')) {
      return 'Please provide a valid email address'
    }
  }

  // ── Australian mobile validation ──────────────────────────────────────
  const fieldName = field.fieldName?.toLowerCase()
  if (fieldName === 'phone' || fieldName?.includes('phone')) {
    const digits = String(value).replace(/\D/g, '')
    if (digits.length !== 10) {
      return 'Phone number must be exactly 10 digits'
    }
    if (!digits.startsWith('04')) {
      return 'Phone number must start with 04'
    }
  }

  return null
}

/**
 * Apply a field value update to the collected fields and return new state.
 */
export function applyFieldUpdate(
  fields: ChatFieldDef[],
  collected: Record<string, unknown>,
  fieldName: string,
  value: unknown,
): { collected: Record<string, unknown>; error: string | null; state: ChatSessionState } {
  const field = fields.find(f => f.fieldName === fieldName)
  if (!field) {
    return { collected, error: `Unknown field: ${fieldName}`, state: { currentField: '', completedFields: Object.keys(collected), errors: [`Unknown field: ${fieldName}`], phase: 'collecting' } }
  }

  const err = validateField(field, value)
  if (err) {
    return { collected, error: err, state: { currentField: fieldName, completedFields: Object.keys(collected), errors: [err], phase: 'collecting' } }
  }

  // Strip commas and currency symbols from number values before storage
  const storeValue = field.fieldType === 'number' && typeof value === 'string'
    ? Number(value.replace(/[,/$]/g, '').trim())
    : field.fieldType === 'number' ? Number(value) : value
  const updated = { ...collected, [fieldName]: storeValue }
  const next = findNextField(fields, updated)

  return { collected: updated, error: null, state: next.state }
}

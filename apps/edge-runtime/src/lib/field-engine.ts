/**
 * EdgeGDE — Field Engine
 * Deterministic: computes missing_fields and next_field from config priority.
 * No LLM influence. Replay-safe.
 */

export interface FieldDef {
  fieldName: string
  label: string
  fieldType: 'text' | 'number' | 'select' | 'email' | 'phone'
  options?: string[]
  prompt?: string
  validation: { required: boolean; min?: number; max?: number }
  placeholder?: string
}

export interface FieldEngineResult {
  missingFields: FieldDef[]
  nextField: FieldDef | null
  phase: 'collecting' | 'complete'
}

export function computeFieldState(
  fields: FieldDef[],
  priorityOrder: string[],
  collected: Record<string, unknown>,
): FieldEngineResult {
  const collectedNames = new Set(Object.keys(collected))
  const missing: FieldDef[] = []

  // Determine missing fields based on priority order
  for (const name of priorityOrder) {
    if (!collectedNames.has(name)) {
      const def = fields.find(f => f.fieldName === name)
      if (def) missing.push(def)
    }
  }

  const nextField = missing.length > 0 ? missing[0] : null
  const phase = missing.length === 0 ? 'complete' : 'collecting'

  return { missingFields: missing, nextField, phase }
}

/**
 * Apply deterministic rules from config.
 * Each rule: { if: "fieldName <op> value", set: { field: "stage", value: "blocked" } }
 */
export function applyRules(
  rules: Array<{ if: string; set: { field: string; value: string | number | boolean } }>,
  collected: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const updates: Record<string, string | number | boolean> = {}

  for (const rule of rules) {
    const match = rule.if.match(/^(\w+)\s*(<|>|<=|>=|==|!=)\s*(.+)$/)
    if (!match) continue
    const [, fieldName, op, rawValue] = match
    const actual = collected[fieldName]
    if (actual === undefined || actual === null) continue

    const expected: number | string = isNaN(Number(rawValue)) ? rawValue.trim() : Number(rawValue)
    let matched = false

    switch (op) {
      case '<': matched = Number(actual) < Number(expected); break
      case '>': matched = Number(actual) > Number(expected); break
      case '<=': matched = Number(actual) <= Number(expected); break
      case '>=': matched = Number(actual) >= Number(expected); break
      case '==': matched = String(actual) === String(expected); break
      case '!=': matched = String(actual) !== String(expected); break
    }

    if (matched) {
      updates[rule.set.field] = rule.set.value
    }
  }

  return updates
}

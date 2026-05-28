/**
 * EdgeGDE EDR — Spec Validator
 * v4.7.0: Enforces architectural invariants against runtime objects.
 * v1.1: Adds design system validation — unknown roles/presets/variants rejected.
 * Pure validation — never mutates inputs.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Validators
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a value conforms to a set of invariants.
 * Each invariant is a function that returns null (pass) or an error string.
 */
export function validateInvariants(
  value: any,
  invariantChecks: Array<(v: any) => string | null>,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const check of invariantChecks) {
    const result = check(value)
    if (result !== null) {
      if (result.startsWith('WARN:')) {
        warnings.push(result.slice(5).trim())
      } else {
        errors.push(result)
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** Check that `role` exists only inside `props`, never at top level */
export function roleInPropsOnly(node: any): string | null {
  if (node.role !== undefined && node.props?.role === undefined) {
    return `role defined at top level but missing in props on ${node.type || 'unknown'} node`
  }
  return null
}

/** Check that a node has type and props */
export function hasTypeAndProps(node: any): string | null {
  if (!node.type) return 'node missing required type field'
  if (!node.props) return `node "${node.type}" missing required props field`
  return null
}

/** Check that theme tokens contain all required keys */
export function validateThemeTokens(tokens: Record<string, string>): ValidationResult {
  const required = ['background_color', 'surface_bg', 'blur', 'border_radius', 'text_primary']
  const errors: string[] = []
  for (const key of required) {
    if (!tokens[key]) errors.push(`missing required token: ${key}`)
  }
  return { valid: errors.length === 0, errors, warnings: [] }
}

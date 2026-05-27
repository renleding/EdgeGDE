/**
 * EdgeGDE Runtime — DESIGN.md Validation
 * Phase 35: Stateless validation for AI-generated design tokens.
 *
 * Checks:
 * - Must be a non-empty string
 * - Must contain a ## Colors section
 * - Must define at least a primary color
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DesignValidationResult {
  valid: boolean
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a DESIGN.md string meets the minimum requirements.
 * Returns structured errors, never throws.
 */
export function validateDesign(design: unknown): DesignValidationResult {
  const errors: string[] = []

  // 1. Must be a string
  if (typeof design !== 'string') {
    errors.push('Design must be a string')
    return { valid: false, errors }
  }

  if (design.trim().length === 0) {
    errors.push('Design must not be empty')
    return { valid: false, errors }
  }

  // 2. Must contain ## Colors section
  if (!/^## Colors/im.test(design)) {
    errors.push('Design must contain a "## Colors" section')
  }

  // 3. Must define a primary color (hex format)
  const primaryMatch = design.match(/primary\s*:\s*#[0-9a-fA-F]{6}/i)
  if (!primaryMatch) {
    errors.push('Design must define a primary color (e.g. "primary: #1a73e8")')
  }

  // 4. Warn about valid hex colors (non-blocking)
  const allColors = design.match(/#[0-9a-fA-F]{6,8}/g) || []
  for (const hex of allColors) {
    if (hex.length !== 7) {
      // 8-char hex with alpha — acceptable but note it
      errors.push(`Note: color "${hex}" includes alpha channel — ensure runtime compatibility`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

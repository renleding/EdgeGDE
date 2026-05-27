/**
 * EdgeGDE EDR — Canonical Hash Utility
 * EDR Architecture Spec v3.9.0-hyperscale-immutable:
 *   - Numeric values serialized without rounding variance
 *   - Boolean values serialized as true/false lowercase
 *   - Undefined/null serialized as null to maintain position
 *   - Array positional integrity preserved
 *   - Object keys sorted deterministically
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// canonicalNumber
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Serialize a number to its canonical string form without rounding variance.
 *
 * - Non-finite values (NaN, ±Infinity) become "null"
 * - Integers and non-scientific notation values pass through unchanged
 * - Scientific notation is expanded deterministically to full decimal
 */
export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return 'null'
  const s = n.toString()
  if (!s.includes('e') && !s.includes('E')) return s

  const [coeff, exp] = s.toLowerCase().split('e')
  const e = parseInt(exp, 10)
  let [intPart, fracPart = ''] = coeff.split('.')

  if (e > 0) {
    fracPart = fracPart.padEnd(e, '0')
    const shifted = intPart + fracPart.slice(0, e)
    const remainder = fracPart.slice(e)
    return remainder ? `${shifted}.${remainder}` : shifted
  } else {
    const zeros = Math.abs(e) - 1
    return `0.${'0'.repeat(zeros)}${intPart}${fracPart ? '.' + fracPart : ''}`
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// stableStringify
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deterministic JSON serialization that guarantees byte-identical output
 * for the same input across all environments.
 *
 * - undefined / null → "null"
 * - boolean → "true" / "false"
 * - number → canonicalNumber (no rounding variance)
 * - string → JSON.stringify (double quotes)
 * - Array → positional integrity preserved
 * - Object → keys sorted alphabetically
 */
export function stableStringify(obj: unknown): string {
  if (obj === undefined || obj === null) return 'null'
  if (typeof obj === 'boolean') return obj ? 'true' : 'false'
  if (typeof obj === 'number') return canonicalNumber(obj)
  if (typeof obj === 'string') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    const items = obj.map(stableStringify).join(',')
    return `[${items}]`
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort()
  const pairs = sortedKeys
    .map(k => `"${k}":${stableStringify((obj as Record<string, unknown>)[k])}`)
    .join(',')
  return `{${pairs}}`
}

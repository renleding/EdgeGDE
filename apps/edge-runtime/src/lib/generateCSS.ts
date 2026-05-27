/**
 * EdgeGDE EDR — Deterministic CSS Generator
 * EDR Architecture Spec v4.4.0-hyperscale-immutable-final:
 *   - Global tokens → :root CSS custom properties
 *   - Sorted iteration of component classes
 *   - All property names normalized to kebab-case
 *   - CSS output finalized within function
 *   - Atomic trim()
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** The EDR (EdgeGDE Design Renderer) definition */
export interface EDR {
  /** Named component definitions with style properties */
  components: Record<string, Record<string, any>>
  /** Global CSS custom property tokens (→ :root variables) */
  global?: Record<string, string>
}

// ═══════════════════════════════════════════════════════════════════════════
// CSS Generator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate deterministic CSS for an EDR definition.
 *
 * Produces:
 *   1. `:root { --token-name: value; }` from edr.global (sorted keys)
 *   2. `.edr-HASH-role { prop: value; }` from edr.components (sorted roles + props)
 *
 * All property names normalized to kebab-case. Output trimmed.
 *
 * @param edr - The EDR definition with component styles and global tokens
 * @param EDR_HASH - The canonical EDR hash identifier
 * @returns Deterministic CSS string, always trimmed. Empty string if no rules.
 */
export function generateCSS(edr: EDR, EDR_HASH: string): string {
  let css = ''

  // ── 1. Global tokens → :root ──────────────────────────────────────────
  const globalKeys = Object.keys(edr.global || {}).sort()
  if (globalKeys.length > 0) {
    css += ':root{'
    for (const k of globalKeys) {
      const varName = `--${k.replace(/_/g, '-')}`
      css += `${varName}:${edr.global![k]};`
    }
    css += '}'
  }

  // ── 2. Component classes (deterministic sorted order) ─────────────────
  const componentKeys = Object.keys(edr.components || {}).sort()
  for (const role of componentKeys) {
    const styles = edr.components[role]
    if (!styles || typeof styles !== 'object') continue

    const styleKeys = Object.keys(styles).sort()
    if (styleKeys.length === 0) continue

    css += `.edr-${EDR_HASH}-${role}{`
    for (const prop of styleKeys) {
      const cssProp = prop.replace(/_/g, '-')
      const val = styles[prop]
      css += `${cssProp}:${String(val)};`
    }
    css += '}'
  }

  // Atomic trim — finalized inside function
  return css.trim()
}

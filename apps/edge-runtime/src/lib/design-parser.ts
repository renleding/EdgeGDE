/**
 * EdgeGDE — DESIGN.md Parser
 * Phase 33: Parse Google DESIGN.md spec into structured runtime tokens.
 * Section-based parsing — only reads ## Colors, ## Typography, ## Spacing.
 * Safe, deterministic, never throws.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DesignTokens {
  colors: {
    primary?: string
    secondary?: string
    background?: string
    text?: string
  }
  typography: {
    fontFamily?: string
    headingFont?: string
    headingTracking?: string
  }
  spacing: {
    sectionPadding?: string
    gap?: string
  }
  /** Field-level styling tokens for form inputs, labels, and containers */
  field?: {
    /** Background color/alpha for input fields (e.g. "rgba(255,255,255,0.1)") */
    background?: string
    /** Text color for input values */
    textColor?: string
    /** Label text color */
    labelColor?: string
    /** Border radius for fields (e.g. "1.5rem") */
    borderRadius?: string
    /** Border color for fields */
    borderColor?: string
    /** Backdrop blur amount (e.g. "20px") */
    backdropBlur?: string
    /** Padding inside fields (e.g. "20px") */
    padding?: string
    /** Input height (e.g. "48px") */
    height?: string
    /** Placeholder text color */
    placeholderColor?: string
    /** Focus ring color */
    focusColor?: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const normalizeHex = (hex: string): string =>
  hex.startsWith('#') ? hex.toLowerCase() : `#${hex.toLowerCase()}`

// ═══════════════════════════════════════════════════════════════════════════
// Parser
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse a DESIGN.md string into structured DesignTokens.
 * Returns empty tokens on any error — non-blocking by design.
 * Uses section-based extraction to avoid false matches in code blocks.
 */
export function parseDesignMd(md: string): DesignTokens {
  const tokens: DesignTokens = { colors: {}, typography: {}, spacing: {} }
  if (!md) return tokens

  try {
    // ── Colors section ──────────────────────────────────────────────
    const colorsSec = md.match(/## Colors\n([\s\S]*?)(?=\n##|$)/)
    if (colorsSec) {
      const body = colorsSec[1]
      const p = body.match(/primary[^#]*#([0-9a-fA-F]{6})/i)
      if (p) tokens.colors.primary = normalizeHex(p[1])
      const s = body.match(/secondary[^#]*#([0-9a-fA-F]{6})/i)
      if (s) tokens.colors.secondary = normalizeHex(s[1])
      const b = body.match(/background[^#]*#([0-9a-fA-F]{6})/i)
      if (b) tokens.colors.background = normalizeHex(b[1])
      const t = body.match(/text[^#]*#([0-9a-fA-F]{6})/i)
      if (t) tokens.colors.text = normalizeHex(t[1])
    }

    // ── Typography section ──────────────────────────────────────────
    const typeSec = md.match(/## Typography\s*\n([\s\S]*?)(?=\n##|$)/)
    if (typeSec) {
      const body = typeSec[1]
      // Match fontFamily: Value or font-family: Value
      const ff = body.match(/font[-]?family\s*:\s*([a-zA-Z][a-zA-Z\s-]+[a-zA-Z])/i)
      if (ff) tokens.typography.fontFamily = ff[1].trim()
      const hf = body.match(/heading[-]?font\s*:\s*([a-zA-Z][a-zA-Z\s-]+[a-zA-Z])/i)
      if (hf) tokens.typography.headingFont = hf[1].trim()
      const ht = body.match(/heading[-]?tracking\s*:\s*([^\s]+)/i)
      if (ht) tokens.typography.headingTracking = ht[1].trim()
    }

    // ── Spacing section ─────────────────────────────────────────────
    const spaceSec = md.match(/## Spacing\s*\n([\s\S]*?)(?=\n##|$)/)
    if (spaceSec) {
      const body = spaceSec[1]
      const gap = body.match(/(gap|padding)[\s:]+(\d+px)/i)
      if (gap) tokens.spacing.gap = gap[2]
    }

    // ── Fields section (field-level styling tokens) ──────────────────
    const fieldSec = md.match(/## Fields\s*\n([\s\S]*?)(?=\n##|$)/)
    if (fieldSec) {
      const body = fieldSec[1]
      tokens.field = {}
      const fb = body.match(/(?:field)?[-]?background\s*:\s*(.+)/i)
      if (fb) tokens.field.background = fb[1].trim()
      const ft = body.match(/(?:field)?[-]?text[-]?color\s*:\s*(.+)/i)
      if (ft) tokens.field.textColor = ft[1].trim()
      const fl = body.match(/(?:field)?[-]?label[-]?color\s*:\s*(.+)/i)
      if (fl) tokens.field.labelColor = fl[1].trim()
      const fr = body.match(/(?:field)?[-]?border[-]?radius\s*:\s*(.+)/i)
      if (fr) tokens.field.borderRadius = fr[1].trim()
      const fc = body.match(/(?:field)?[-]?border[-]?color\s*:\s*(.+)/i)
      if (fc) tokens.field.borderColor = fc[1].trim()
      const fbl = body.match(/(?:field)?[-]?backdrop[-]?blur\s*:\s*(.+)/i)
      if (fbl) tokens.field.backdropBlur = fbl[1].trim()
      const fp = body.match(/(?:field)?[-]?padding\s*:\s*(.+)/i)
      if (fp) tokens.field.padding = fp[1].trim()
      const fh = body.match(/(?:field)?[-]?height\s*:\s*(.+)/i)
      if (fh) tokens.field.height = fh[1].trim()
      const fph = body.match(/(?:field)?[-]?placeholder[-]?color\s*:\s*(.+)/i)
      if (fph) tokens.field.placeholderColor = fph[1].trim()
      const ffo = body.match(/(?:field)?[-]?focus[-]?color\s*:\s*(.+)/i)
      if (ffo) tokens.field.focusColor = ffo[1].trim()
    }
  } catch {
    // Silent — design tokens must never break rendering
  }

  return tokens
}

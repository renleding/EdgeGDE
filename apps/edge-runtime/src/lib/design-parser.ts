/**
 * EdgeGDE — DESIGN.md Parser
 * Phase 33: Parse Google DESIGN.md spec into structured runtime tokens.
 * v2.1: Extended with surface, border, muted colors, fontSize/fontWeight typography,
 * cardPadding, borderRadius spacing.
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
    surface?: string
    border?: string
    muted?: string
  }
  typography: {
    fontFamily?: string
    headingFont?: string
    headingTracking?: string
    fontSize?: {
      h1?: string
      h2?: string
      h3?: string
      body?: string
      small?: string
    }
    fontWeight?: {
      h1?: number
      h2?: number
      h3?: number
      body?: number
    }
    lineHeight?: number
  }
  spacing: {
    sectionPadding?: string
    gap?: string
    cardPadding?: string
    borderRadius?: string
  }
  /** Field-level styling tokens for form inputs, labels, and containers */
  field?: {
    background?: string
    textColor?: string
    labelColor?: string
    borderRadius?: string
    borderColor?: string
    backdropBlur?: string
    padding?: string
    height?: string
    placeholderColor?: string
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
      const sf = body.match(/surface[^#]*#([0-9a-fA-F]{6})/i)
      if (sf) tokens.colors.surface = normalizeHex(sf[1])
      const bd = body.match(/border[^#]*#([0-9a-fA-F]{6})/i)
      if (bd) tokens.colors.border = normalizeHex(bd[1])
      const m = body.match(/muted[^#]*#([0-9a-fA-F]{6})/i)
      if (m) tokens.colors.muted = normalizeHex(m[1])
    }

    // ── Typography section ──────────────────────────────────────────
    const typeSec = md.match(/## Typography\s*\n([\s\S]*?)(?=\n##|$)/)
    if (typeSec) {
      const body = typeSec[1]
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

    // ── Fields section ──────────────────────────────────────────────
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
    // Silent
  }

  return tokens
}

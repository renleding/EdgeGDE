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
    const typeSec = md.match(/## Typography\n([\s\S]*?)(?=\n##|$)/)
    if (typeSec) {
      const body = typeSec[1]
      const ff = body.match(/font[^#\n]*?([a-zA-Z][a-zA-Z\s-]+[a-zA-Z])/i)
      if (ff) tokens.typography.fontFamily = ff[1].trim()
      const hf = body.match(/heading[^#\n]*?([a-zA-Z][a-zA-Z\s-]+[a-zA-Z])/i)
      if (hf) tokens.typography.headingFont = hf[1].trim()
    }

    // ── Spacing section ─────────────────────────────────────────────
    const spaceSec = md.match(/## Spacing\n([\s\S]*?)(?=\n##|$)/)
    if (spaceSec) {
      const body = spaceSec[1]
      const gap = body.match(/(gap|padding)[\s:]+(\d+px)/i)
      if (gap) tokens.spacing.gap = gap[2]
    }
  } catch {
    // Silent — design tokens must never break rendering
  }

  return tokens
}

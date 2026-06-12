/**
 * EdgeGDE Canvas — Design Token Extractor
 * v2.1: Automatically extract design tokens from cloned HTML.
 *
 * Analyzes inline styles from parsed HTML to infer a coherent design system:
 * - Colors: clusters by frequency → background, text, primary, surface, muted, border
 * - Typography: font families, sizes, weights by heading/body role
 * - Spacing: common padding, gap, border-radius values
 *
 * Missing tokens are filled from EdgeGDE defaults.
 *
 * @packageDocumentation
 */

import type { DesignTokens } from '../lib/design-parser'

// ═══════════════════════════════════════════════════════════════════════════
// EdgeGDE Default Tokens (fallback for missing values)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULTS: DesignTokens = {
  colors: {
    background: '#0d1117',
    text: '#e1e4e8',
    primary: '#58a6ff',
    surface: '#1c2128',
    border: '#2d3140',
    muted: '#8b949e',
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: { h1: '36px', h2: '24px', h3: '20px', body: '16px', small: '13px' },
    fontWeight: { h1: 700, h2: 600, h3: 600, body: 400 },
    lineHeight: 1.5,
  },
  spacing: {
    sectionPadding: '60px 40px',
    cardPadding: '20px',
    gap: '16px',
    borderRadius: '8px',
  },
}

const LIGHT_DEFAULTS: DesignTokens = {
  colors: {
    background: '#ffffff',
    text: '#111827',
    primary: '#2563eb',
    surface: '#f8fafc',
    border: '#e5e7eb',
    muted: '#6b7280',
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: { h1: '36px', h2: '24px', h3: '20px', body: '16px', small: '13px' },
    fontWeight: { h1: 700, h2: 600, h3: 600, body: 400 },
    lineHeight: 1.5,
  },
  spacing: {
    sectionPadding: '60px 40px',
    cardPadding: '20px',
    gap: '16px',
    borderRadius: '8px',
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedStyle {
  color?: string
  backgroundColor?: string
  borderColor?: string
  fontFamily?: string
  fontSize?: string
  fontWeight?: number
  lineHeight?: number
  padding?: string
  margin?: string
  borderRadius?: string
  tagName: string
  text?: string
}

interface ExtractDesignTokenOptions {
  fallback?: 'dark' | 'light'
}

// ═══════════════════════════════════════════════════════════════════════════
// Color Extraction
// ═══════════════════════════════════════════════════════════════════════════

/** Normalize a hex color to lowercase with # prefix */
function normalizeColor(c: string): string {
  const trimmed = c.trim()
  if (trimmed.startsWith('#')) return trimmed.toLowerCase()
  return `#${trimmed.toLowerCase()}`
}

/** Check if a color is a neutral/gray tone (for muted detection) */
function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  // Neutrals have similar R, G, B values (within 10%)
  return (max - min) / (max || 1) < 0.15
}

/** Check if a color is dark (luminance < 0.3) */
function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum < 0.3
}

function extractColors(styles: ParsedStyle[], fallback: DesignTokens = DEFAULTS): DesignTokens['colors'] {
  const allColors: string[] = []
  const textColors: string[] = []
  const bgColors: string[] = []
  const borderColors: string[] = []

  for (const s of styles) {
    if (s.color) {
      const c = normalizeColor(s.color)
      allColors.push(c)
      textColors.push(c)
    }
    if (s.backgroundColor) {
      const c = normalizeColor(s.backgroundColor)
      allColors.push(c)
      bgColors.push(c)
    }
    if (s.borderColor) {
      const c = normalizeColor(s.borderColor)
      allColors.push(c)
      borderColors.push(c)
    }
  }

  if (allColors.length === 0) {
    return { ...fallback.colors }
  }

  // Frequency analysis
  const freq = new Map<string, number>()
  for (const c of allColors) {
    freq.set(c, (freq.get(c) || 0) + 1)
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])

  // Most common color → background (if dark) or surface
  const mostCommon = sorted[0]?.[0] || DEFAULTS.colors.background!

  // Find text color: most common text color from body-like tags (p, span, li, div)
  const textFreq = new Map<string, number>()
  for (const s of styles) {
    if (s.color) {
      const tag = s.tagName.toLowerCase()
      // Weight: body(3) > p(2) > span/li(2) > h1-3(1) > others(1)
      const tagWeights: Record<string, number> = { body: 3, p: 2, span: 2, li: 2 }
      const weight = tagWeights[tag] || 1
      const c = normalizeColor(s.color)
      textFreq.set(c, (textFreq.get(c) || 0) + weight)
    }
  }
  const topText = [...textFreq.entries()]
    .sort((a, b) => {
      // Primary sort: frequency (higher = better)
      if (b[1] !== a[1]) return b[1] - a[1]
      // Tiebreaker: prefer non-neutral colors over neutral (muted) ones
      const aNeutral = isNeutral(a[0])
      const bNeutral = isNeutral(b[0])
      if (aNeutral !== bNeutral) return aNeutral ? 1 : -1
      return 0
    })
    .find(([c]) => c !== mostCommon)?.[0]

  // Find background color: most common bg color
  const bgFreq = new Map<string, number>()
  for (const c of bgColors) {
    bgFreq.set(c, (bgFreq.get(c) || 0) + 1)
  }
  const topBg = [...bgFreq.entries()].sort((a, b) => b[1] - a[1])?.[0]?.[0]

  // Find accent: most common non-neutral, non-bg, non-text color
  const accent = sorted.find(([c]) =>
    c !== topBg && c !== topText && !isNeutral(c),
  )?.[0]

  // Find border: most common border color, or first neutral
  const borderFreq = new Map<string, number>()
  for (const c of borderColors) {
    borderFreq.set(c, (borderFreq.get(c) || 0) + 1)
  }
  const topBorder = [...borderFreq.entries()].sort((a, b) => b[1] - a[1])?.[0]?.[0]
  const border = topBorder || sorted.find(([c]) => isNeutral(c))?.[0] || DEFAULTS.colors.border!

  // Find muted: neutral color that's lighter than text
  const muted = sorted.find(([c]) => isNeutral(c) && c !== topBg)?.[0]

  // Surface: second most common bg-like color, or slightly lighter than bg
  const surface = sorted.find(([c]) => c !== topBg && bgFreq.has(c) && bgFreq.get(c)! > 1)?.[0]

  const bg = topBg || mostCommon
  const isDarkBg = isDark(bg)

  return {
    background: bg,
    text: topText || (isDarkBg ? '#e1e4e8' : '#1c2128'),
    primary: accent || DEFAULTS.colors.primary,
    surface: surface || (isDarkBg ? '#1c2128' : '#f0f6fc'),
    border,
    muted: muted || (isDarkBg ? '#8b949e' : '#6e7681'),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Typography Extraction
// ═══════════════════════════════════════════════════════════════════════════

function extractTypography(styles: ParsedStyle[], fallback: DesignTokens = DEFAULTS): DesignTokens['typography'] {
  const base = fallback.typography
  const fontSize = base.fontSize ?? DEFAULTS.typography.fontSize
  const fontWeight = base.fontWeight ?? DEFAULTS.typography.fontWeight
  const h1Size = fontSize?.h1 ?? '36px'
  const h2Size = fontSize?.h2 ?? '24px'
  const h3Size = fontSize?.h3 ?? '20px'
  const bodySize = fontSize?.body ?? '16px'
  const h1Weight = fontWeight?.h1 ?? 700
  const h2Weight = fontWeight?.h2 ?? 600
  const h3Weight = fontWeight?.h3 ?? 600
  const bodyWeight = fontWeight?.body ?? 400

  // Collect font families by frequency
  const fontFreq = new Map<string, number>()
  const fontSizeByTag: Record<string, string[]> = {}
  const fontWeightByTag: Record<string, number[]> = {}

  for (const s of styles) {
    if (s.fontFamily) fontFreq.set(s.fontFamily, (fontFreq.get(s.fontFamily) || 0) + 1)
    const tag = s.tagName.toLowerCase()
    if (s.fontSize) {
      if (!fontSizeByTag[tag]) fontSizeByTag[tag] = []
      fontSizeByTag[tag].push(s.fontSize)
    }
    if (s.fontWeight) {
      if (!fontWeightByTag[tag]) fontWeightByTag[tag] = []
      fontWeightByTag[tag].push(s.fontWeight)
    }
  }

  // Most common font family
  const topFont = [...fontFreq.entries()].sort((a, b) => b[1] - a[1])?.[0]?.[0]

  // Get most common size for a tag
  function commonSize(tag: string, def: string): string {
    const sizes = fontSizeByTag[tag]
    if (!sizes || sizes.length === 0) return def
    const freq = new Map<string, number>()
    for (const s of sizes) freq.set(s, (freq.get(s) || 0) + 1)
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  function commonWeight(tag: string, def: number): number {
    const weights = fontWeightByTag[tag]
    if (!weights || weights.length === 0) return def
    const freq = new Map<number, number>()
    for (const w of weights) freq.set(w, (freq.get(w) || 0) + 1)
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  return {
    fontFamily: topFont || base.fontFamily || DEFAULTS.typography.fontFamily,
    fontSize: {
      h1: commonSize('h1', h1Size),
      h2: commonSize('h2', h2Size),
      h3: commonSize('h3', h3Size),
      body: commonSize('p', bodySize),
      small: '13px',
    },
    fontWeight: {
      h1: commonWeight('h1', h1Weight),
      h2: commonWeight('h2', h2Weight),
      h3: commonWeight('h3', h3Weight),
      body: commonWeight('p', bodyWeight),
    },
    lineHeight: 1.5,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Spacing Extraction
// ═══════════════════════════════════════════════════════════════════════════

function extractSpacing(styles: ParsedStyle[], fallback: DesignTokens = DEFAULTS): DesignTokens['spacing'] {
  const base = fallback.spacing ?? DEFAULTS.spacing
  const paddings: string[] = []
  const gaps: string[] = []
  const radii: string[] = []

  for (const s of styles) {
    if (s.padding && !s.padding.includes('0')) paddings.push(s.padding)
    if (s.borderRadius && s.borderRadius !== '0') radii.push(s.borderRadius)
    // Gap can appear as a CSS property but won't be in inline styles often
  }

  function mostCommon(values: string[], def: string): string {
    if (values.length === 0) return def
    const freq = new Map<string, number>()
    for (const v of values) freq.set(v, (freq.get(v) || 0) + 1)
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  const sectionPadding = base.sectionPadding ?? DEFAULTS.spacing.sectionPadding ?? ''
  const cardPadding = base.cardPadding ?? DEFAULTS.spacing.cardPadding ?? ''
  const gap = base.gap ?? DEFAULTS.spacing.gap ?? ''
  const borderRadius = base.borderRadius ?? DEFAULTS.spacing.borderRadius ?? ''

  return {
    sectionPadding: mostCommon(paddings, sectionPadding),
    cardPadding: mostCommon(paddings.filter(p => !p.includes('60')), cardPadding),
    gap: mostCommon(gaps, gap),
    borderRadius: mostCommon(radii, borderRadius),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract design tokens from a set of parsed HTML styles.
 *
 * @param styles - Array of parsed inline styles from HTML elements
 * @param options.fallback - Default palette for clones with no extracted colors: 'dark' (EdgeGDE) or 'light' (browser/default)
 * @returns A complete DesignTokens object (missing values filled from defaults)
 */
export function extractDesignTokens(styles: ParsedStyle[], options: ExtractDesignTokenOptions = {}): DesignTokens {
  const fallback = options.fallback === 'light' ? LIGHT_DEFAULTS : DEFAULTS
  const colors = extractColors(styles, fallback)
  const typography = extractTypography(styles, fallback)
  const spacing = extractSpacing(styles, fallback)

  return {
    colors: {
      background: colors.background || fallback.colors.background,
      text: colors.text || fallback.colors.text,
      primary: colors.primary || fallback.colors.primary,
      surface: colors.surface || fallback.colors.surface,
      border: colors.border || fallback.colors.border,
      muted: colors.muted || fallback.colors.muted,
    },
    typography: {
      fontFamily: typography.fontFamily || fallback.typography.fontFamily,
      fontSize: typography.fontSize,
      fontWeight: typography.fontWeight,
      lineHeight: typography.lineHeight,
    },
    spacing: {
      sectionPadding: spacing.sectionPadding,
      cardPadding: spacing.cardPadding,
      gap: spacing.gap,
      borderRadius: spacing.borderRadius,
    },
  }
}

export type { ParsedStyle }

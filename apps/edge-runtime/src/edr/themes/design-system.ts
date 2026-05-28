/**
 * One-End Design System v1.1 — Canonical Definition
 * Strict whitelist for roles, presets, variants, and token mappings.
 *
 * This is the SOURCE OF TRUTH for all visual output.
 * AI expresses only preset + role + variant.
 * The system resolves to concrete pixel values.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Physical Tokens (concrete values)
// ═══════════════════════════════════════════════════════════════════════════

export const BASE_TOKENS: Record<string, string> = {
  // Radius
  'radius.small': '8px',
  'radius.medium': '12px',
  'radius.large': '18px',

  // Spacing
  'spacing.tight': '6px',
  'spacing.small': '10px',
  'spacing.medium': '14px',
  'spacing.spacious': '22px',

  // Typography
  'type.small': '0.875rem',
  'type.base': '1rem',
  'type.medium': '1.25rem',
  'type.large': '1.75rem',

  // Elevation
  'elevation.none': '0',
  'elevation.subtle': '0 1px 3px rgba(0,0,0,0.06)',
  'elevation.soft': '0 4px 12px rgba(0,0,0,0.08)',
  'elevation.strong': '0 8px 24px rgba(0,0,0,0.2)',

  // Colors
  'color.background': '#ffffff',
  'color.surface': '#f7f7f7',
  'color.text_primary': '#0a0a0a',
  'color.text_secondary': '#555555',
  'color.accent': '#3366ff',
  'color.muted': '#dddddd',
  'color.border_subtle': '#e5e5e5',
}

// ═══════════════════════════════════════════════════════════════════════════
// Presets (abstract → token selection)
// ═══════════════════════════════════════════════════════════════════════════

export interface PresetDefinition {
  radius: string
  spacing: string
  elevation: string
  type: string
}

export const PRESETS: Record<string, PresetDefinition> = {
  minimal:  { radius: 'small',  spacing: 'tight',   elevation: 'none',   type: 'small' },
  premium:  { radius: 'large',  spacing: 'spacious', elevation: 'soft',   type: 'medium' },
  neutral:  { radius: 'medium', spacing: 'medium',   elevation: 'subtle', type: 'base' },
  bold:     { radius: 'small',  spacing: 'spacious', elevation: 'strong', type: 'large' },
  glass:    { radius: 'large',  spacing: 'medium',   elevation: 'soft',   type: 'base' },
}

export type PresetName = keyof typeof PRESETS

// ═══════════════════════════════════════════════════════════════════════════
// Roles (UI building blocks)
// ═══════════════════════════════════════════════════════════════════════════

export interface RoleDefinition {
  padding?: string
  radius?: 'inherit' | string
  spacing?: string
  background?: string
  border?: string
  color?: string
  typeScale?: string
  weight?: string
}

export const ROLES: Record<string, RoleDefinition> = {
  primary_button: {
    padding: 'medium',
    radius: 'inherit',
    background: 'color.accent',
    color: 'color.background',
  },
  secondary_button: {
    padding: 'medium',
    radius: 'inherit',
    background: 'color.surface',
    color: 'color.text_primary',
  },
  input_field: {
    padding: 'small',
    radius: 'small',
    background: 'color.background',
    border: 'color.border_subtle',
    color: 'color.text_primary',
  },
  form_container: {
    spacing: 'medium',
    background: 'color.surface',
  },
  card: {
    padding: 'medium',
    radius: 'medium',
    background: 'color.surface',
  },
  hero_section: {
    spacing: 'spacious',
    background: 'color.background',
  },
  heading_primary: {
    typeScale: 'large',
    weight: 'bold',
    color: 'color.text_primary',
  },
  heading_secondary: {
    typeScale: 'medium',
    weight: 'medium',
    color: 'color.text_primary',
  },
  text_body: {
    typeScale: 'base',
    color: 'color.text_secondary',
  },
  data_display: {
    padding: 'small',
    typeScale: 'large',
    weight: 'bold',
    color: 'color.text_primary',
  },
}

export type RoleName = keyof typeof ROLES

// ═══════════════════════════════════════════════════════════════════════════
// Variants (controlled modifiers)
// ═══════════════════════════════════════════════════════════════════════════

export interface VariantDefinition {
  scaleMultiplier: number
  spacingMultiplier: number
}

export const VARIANTS: Record<string, VariantDefinition> = {
  default: { scaleMultiplier: 1.0, spacingMultiplier: 1.0 },
  hero:    { scaleMultiplier: 1.2, spacingMultiplier: 1.3 },
  compact: { scaleMultiplier: 0.85, spacingMultiplier: 0.75 },
}

export type VariantName = keyof typeof VARIANTS

// ═══════════════════════════════════════════════════════════════════════════
// Whitelist helpers
// ═══════════════════════════════════════════════════════════════════════════

export const VALID_PRESETS: string[] = Object.keys(PRESETS)
export const VALID_ROLES: string[] = Object.keys(ROLES)
export const VALID_VARIANTS: string[] = Object.keys(VARIANTS)

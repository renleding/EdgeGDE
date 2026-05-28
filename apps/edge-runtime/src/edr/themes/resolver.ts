/**
 * One-End Design System v1.1 — Resolution Engine
 *
 * Converts abstract design intent (preset + role + variant)
 * into concrete EDR token values for compilation.
 *
 * Pipeline:
 *   preset → token selection → semantic color resolution
 *   → role structure → variant scale → final value
 *
 * @packageDocumentation
 */

import {
  BASE_TOKENS,
  PRESETS,
  ROLES,
  VARIANTS,
  type PresetName,
  type RoleName,
  type VariantName,
  VALID_PRESETS,
  VALID_ROLES,
  VALID_VARIANTS,
} from './design-system'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DesignIntent {
  preset: PresetName
  role: RoleName
  variant?: VariantName
}

export interface ResolvedStyles {
  [key: string]: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Resolve a semantic token reference to its concrete value
// ═══════════════════════════════════════════════════════════════════════════

function resolveToken(ref: string): string {
  // Direct base token reference (e.g., "color.accent")
  if (BASE_TOKENS[ref]) return BASE_TOKENS[ref]

  // Semantic → base mapping
  const semanticMap: Record<string, string> = {
    'background.default': 'color.background',
    'background.elevated': 'color.surface',
    'text.primary': 'color.text_primary',
    'text.secondary': 'color.text_secondary',
    'action.primary': 'color.accent',
    'action.secondary': 'color.muted',
    'border.subtle': 'color.border_subtle',
  }

  if (semanticMap[ref]) return BASE_TOKENS[semanticMap[ref]] || ref
  return ref
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve a design intent into concrete CSS style values.
 *
 * @param intent - AI-generated design intent (preset + role + variant)
 * @returns ResolvedStyle map of CSS property → concrete value
 */
export function resolveDesign(intent: DesignIntent): ResolvedStyles {
  const preset = PRESETS[intent.preset]
  const role = ROLES[intent.role]
  const variant = VARIANTS[intent.variant || 'default']

  if (!preset) throw new Error(`Unknown preset: ${intent.preset}`)
  if (!role) throw new Error(`Unknown role: ${intent.role}`)
  if (!variant) throw new Error(`Unknown variant: ${intent.variant || 'default'}`)

  const styles: ResolvedStyles = {}

  // Resolve radius
  const rawRadius = role.radius === 'inherit' ? preset.radius : (role.radius || preset.radius)
  styles['border-radius'] = rawRadius ? resolveRadius(rawRadius) : '0'

  // Resolve padding
  if (role.padding) {
    const base = resolveSpacing(role.padding)
    styles['padding'] = scaleValue(base, variant.spacingMultiplier)
  }

  // Resolve spacing (gap or margin)
  if (role.spacing) {
    const base = resolveSpacing(role.spacing)
    styles['gap'] = scaleValue(base, variant.spacingMultiplier)
  }

  // Resolve background
  if (role.background) {
    styles['background-color'] = resolveToken(role.background)
  }

  // Resolve border
  if (role.border) {
    styles['border'] = `1px solid ${resolveToken(role.border)}`
  }

  // Resolve text color
  if (role.color) {
    styles['color'] = resolveToken(role.color)
  }

  // Resolve typography
  const typeScale = role.typeScale || preset.type
  const baseSize = resolveTypeScale(typeScale)
  styles['font-size'] = scaleValue(baseSize, variant.scaleMultiplier)

  if (role.weight) {
    styles['font-weight'] = role.weight
  }

  // Resolve elevation (box-shadow)
  const elevationKey = preset.elevation
  styles['box-shadow'] = BASE_TOKENS[`elevation.${elevationKey}`] || 'none'

  return styles
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function resolveRadius(level: string): string {
  return BASE_TOKENS[`radius.${level}`] || level
}

function resolveSpacing(level: string): string {
  return BASE_TOKENS[`spacing.${level}`] || level
}

function resolveTypeScale(level: string): string {
  return BASE_TOKENS[`type.${level}`] || level
}

/**
 * Scale a CSS value string by a multiplier.
 * Handles px, rem, and em units. Falls back to the raw value for unknown units.
 */
function scaleValue(value: string, multiplier: number): string {
  const match = value.match(/^([\d.]+)(px|rem|em)?$/)
  if (!match) return value
  const num = parseFloat(match[1]) * multiplier
  const unit = match[2] || 'px'
  return `${Math.round(num * 100) / 100}${unit}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationError {
  field: string
  message: string
}

/**
 * Validate a design intent against the whitelist.
 * Returns array of errors (empty = valid).
 */
export function validateIntent(intent: Partial<DesignIntent>): ValidationError[] {
  const errors: ValidationError[] = []

  if (!intent.preset || !VALID_PRESETS.includes(intent.preset)) {
    errors.push({ field: 'preset', message: `Unknown preset "${intent.preset}". Valid: ${VALID_PRESETS.join(', ')}` })
  }

  if (!intent.role || !VALID_ROLES.includes(intent.role)) {
    errors.push({ field: 'role', message: `Unknown role "${intent.role}". Valid: ${VALID_ROLES.join(', ')}` })
  }

  if (intent.variant && !VALID_VARIANTS.includes(intent.variant)) {
    errors.push({ field: 'variant', message: `Unknown variant "${intent.variant}". Valid: ${VALID_VARIANTS.join(', ')}` })
  }

  return errors
}

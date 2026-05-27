/**
 * EdgeGDE EDR — Parametric Theme Generator
 * v4.7.0: Generates valid Theme objects from numeric seeds.
 * Deterministic given seed — same seed always produces same theme.
 *
 * @packageDocumentation
 */

import type { Theme } from './registry'

// ═══════════════════════════════════════════════════════════════════════════
// Generator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a deterministic Theme from a numeric seed.
 *
 * - background_color: hsl derived from seed hue
 * - surface_bg: alpha varies with seed
 * - blur: 20-29px range
 * - border_radius: 14-23px range
 * - text_primary: always white for contrast
 */
export function generateTheme(seed: number): Theme {
  const hue = seed % 360
  const alpha = 0.08 + (seed % 10) * 0.01
  const blur = 20 + (seed % 10)
  const radius = 14 + (seed % 10)

  return {
    id: `theme-${seed}`,
    name: `Generated Theme #${seed}`,
    category: seed % 2 === 0 ? 'glass' : 'dark',
    tokens: {
      space_1: '8px',
      space_2: '16px',
      space_3: '24px',
      space_4: '32px',
      grid_columns: 'repeat(2, minmax(0, 1fr))',
      grid_gap_x: '24px',
      grid_gap_y: '32px',
      container_padding: '32px',
      background_color: `hsl(${hue}, 30%, 10%)`,
      surface_bg: `rgba(255,255,255,${alpha})`,
      surface_border: `1px solid rgba(255,255,255,${(alpha * 1.5).toFixed(2)})`,
      blur: `blur(${blur}px)`,
      border_radius: `${radius}px`,
      surface_shadow: `0 8px 32px rgba(0,0,0,0.25)`,
      input_bg: `rgba(255,255,255,${(alpha + 0.06).toFixed(2)})`,
      input_border: `1px solid rgba(255,255,255,${(alpha * 2).toFixed(2)})`,
      text_primary: '#ffffff',
      text_secondary: `hsla(${hue}, 10%, 80%, 0.75)`,
    },
  }
}

/**
 * Generate N theme variants and register them.
 * Returns the generated themes for immediate use.
 */
export function generateThemes(count: number, startSeed = 1): Theme[] {
  const themes: Theme[] = []
  for (let i = 0; i < count; i++) {
    themes.push(generateTheme(startSeed + i))
  }
  return themes
}

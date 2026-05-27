/**
 * EdgeGDE EDR — Theme Registry
 * v4.7.0: Curated + generated theme storage.
 * Each theme matches the ThemeSchema and provides valid EDR global tokens.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface Theme {
  id: string
  name: string
  category: string
  tokens: Record<string, string>
  components?: Record<string, Record<string, any>>
}

// ═══════════════════════════════════════════════════════════════════════════
// Curated Themes
// ═══════════════════════════════════════════════════════════════════════════

const CURATED_THEMES: Theme[] = [
  {
    id: 'glass-v1',
    name: 'Atmospheric Glass',
    category: 'glass',
    tokens: {
      space_1: '8px', space_2: '16px', space_3: '24px', space_4: '32px',
      grid_columns: 'repeat(2, minmax(0, 1fr))',
      grid_gap_x: '24px', grid_gap_y: '32px',
      container_padding: '32px',
      background_color: '#0b1326',
      surface_bg: 'rgba(255,255,255,0.12)',
      surface_border: '1px solid rgba(255,255,255,0.18)',
      blur: 'blur(28px)',
      border_radius: '18px',
      surface_shadow: '0 8px 32px rgba(0,0,0,0.25)',
      input_bg: 'rgba(255,255,255,0.18)',
      input_border: '1px solid rgba(255,255,255,0.25)',
      text_primary: '#ffffff',
      text_secondary: 'rgba(255,255,255,0.75)',
    },
  },
  {
    id: 'midnight-v1',
    name: 'Midnight Noir',
    category: 'dark',
    tokens: {
      space_1: '8px', space_2: '16px', space_3: '24px', space_4: '32px',
      grid_columns: 'repeat(2, minmax(0, 1fr))',
      grid_gap_x: '24px', grid_gap_y: '32px',
      container_padding: '32px',
      background_color: '#0a0a0f',
      surface_bg: 'rgba(255,255,255,0.06)',
      surface_border: '1px solid rgba(255,255,255,0.08)',
      blur: 'blur(32px)',
      border_radius: '12px',
      surface_shadow: '0 4px 24px rgba(0,0,0,0.4)',
      input_bg: 'rgba(255,255,255,0.08)',
      input_border: '1px solid rgba(255,255,255,0.12)',
      text_primary: '#e0e0e0',
      text_secondary: 'rgba(224,224,224,0.6)',
    },
  },
]

/** Runtime registry — starts with curated themes, generator can append */
let themeRegistry: Theme[] = [...CURATED_THEMES]

/** Get all registered themes */
export function getThemeRegistry(): Theme[] {
  return themeRegistry
}

/** Register a new theme at runtime */
export function registerTheme(theme: Theme): void {
  themeRegistry.push(theme)
}

/** Find a theme by ID */
export function findTheme(id: string): Theme | undefined {
  return themeRegistry.find(t => t.id === id)
}

/** Reset registry to curated defaults */
export function resetRegistry(): void {
  themeRegistry = [...CURATED_THEMES]
}

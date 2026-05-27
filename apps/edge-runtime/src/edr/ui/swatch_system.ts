/**
 * EdgeGDE EDR — Swatch UI System
 * v4.7.0: Theme gallery rendering + selection pipeline.
 * Generates swatch grid AST for the synthesis engine.
 *
 * @packageDocumentation
 */

import type { Theme } from '../themes/registry'
import type { EDRNode } from '../compiler/engine'

// ═══════════════════════════════════════════════════════════════════════════
// Color Extraction
// ═══════════════════════════════════════════════════════════════════════════

/** Extract surface/primary/accent colors from a theme's tokens for swatch display */
export function extractColors(tokens: Record<string, string>): string[] {
  const colors: string[] = []
  // Priority order: grab the key visual tokens
  const keys = ['background_color', 'surface_bg', 'input_bg', 'text_primary', 'text_secondary']
  for (const k of keys) {
    if (tokens[k]) colors.push(tokens[k])
  }
  return colors
}

// ═══════════════════════════════════════════════════════════════════════════
// Preview AST Builder
// ═══════════════════════════════════════════════════════════════════════════

/** Build a preview EDRNode AST that uses real EDR components for live preview */
export function buildPreviewAST(): EDRNode {
  return {
    type: 'div',
    props: { role: ['section_card'] },
    children: [
      { type: 'h4', children: 'Preview' },
      { type: 'input', props: { role: 'input_field', placeholder: 'Sample input' } },
    ],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Swatch Grid Builder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a complete swatch gallery AST from a list of themes.
 * Each swatch card shows: live preview (via buildPreviewAST), title, color strip.
 */
export function buildSwatchGrid(themes: Theme[]): EDRNode {
  return {
    type: 'div',
    props: { role: 'swatch_grid' },
    children: themes.map((t) => ({
      type: 'div',
      props: {
        role: 'swatch_card',
        onclick: `selectTheme('${t.id}')`,
        'data-theme-id': t.id,
      },
      children: [
        // Live preview pane
        {
          type: 'div',
          props: { role: 'swatch_preview', theme: t.id },
          children: [buildPreviewAST()],
        },
        // Metadata
        {
          type: 'div',
          props: { role: 'swatch_meta' },
          children: [
            { type: 'div', props: { role: 'swatch_title' }, children: t.name },
            // Color strip
            {
              type: 'div',
              props: { role: 'swatch_color_strip' },
              children: extractColors(t.tokens).map((c) => ({
                type: 'div',
                props: { role: 'swatch_color', style: `background:${c}` },
              })),
            },
          ],
        },
      ],
    })),
  }
}

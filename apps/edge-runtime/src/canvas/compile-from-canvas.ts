/**
 * EdgeGDE Canvas — compileFromCanvas Bridge
 * Canvas Platform v1.0.0
 * v2.1: Design token support — reads doc.designTokens and passes to EDR compiler.
 *
 * Pipeline:
 *   CanvasDocument → getTree() → map nodes to EDRNode tree → compileEDR() → HTML
 *
 * If designTokens are present on the CanvasDocument, they are converted to
 * EDR components so the compiler outputs CSS custom properties instead of
 * hardcoded values. This enables instant re-theming via token swap.
 *
 * @packageDocumentation
 */

import type { CanvasDocument, TreeNode } from './canvas-types'
import { getTree } from './canvas-engine'
import { compile as compileEDR } from '../edr/compiler/engine'
import type { EDR, EDRNode } from '../edr/compiler/engine'
import type { DesignTokens } from '../lib/design-parser'

// ═══════════════════════════════════════════════════════════════════════════
// Design Token → EDR Bridge
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert EdgeGDE DesignTokens into an EDR components definition.
 * The EDR compiler wraps these as CSS custom properties for runtime themeability.
 */
function designTokensToEDR(tokens: DesignTokens): EDR {
  const components: Record<string, Record<string, string>> = {}

  // Colors
  const c = tokens.colors
  if (c) {
    if (c.background) components['color-bg'] = { background_color: c.background }
    if (c.text) components['color-text'] = { color: c.text }
    if (c.primary) components['color-primary'] = { color: c.primary }
    if (c.surface) components['color-surface'] = { background_color: c.surface }
    if (c.border) components['color-border'] = { border_color: c.border }
    if (c.muted) components['color-muted'] = { color: c.muted }
  }

  // Typography
  const t = tokens.typography
  if (t?.fontFamily) components['font-family'] = { font_family: t.fontFamily }
  if (t?.fontSize?.h1) components['font-size-h1'] = { font_size: t.fontSize.h1 }
  if (t?.fontSize?.h2) components['font-size-h2'] = { font_size: t.fontSize.h2 }
  if (t?.fontSize?.h3) components['font-size-h3'] = { font_size: t.fontSize.h3 }
  if (t?.fontSize?.body) components['font-size-body'] = { font_size: t.fontSize.body }
  if (t?.fontWeight?.h1) components['font-weight-h1'] = { font_weight: String(t.fontWeight.h1) }
  if (t?.fontWeight?.body) components['font-weight-body'] = { font_weight: String(t.fontWeight.body) }

  // Spacing
  const s = tokens.spacing
  if (s?.borderRadius) components['border-radius'] = { border_radius: s.borderRadius }
  if (s?.gap) components['gap'] = { gap: s.gap }
  if (s?.sectionPadding) components['section-padding'] = { padding: s.sectionPadding }

  return { components, global: {} }
}

// ═══════════════════════════════════════════════════════════════════════════
// Type Mappings
// ═══════════════════════════════════════════════════════════════════════════

function nodeTypeToTag(type: string): string {
  switch (type) {
    case 'Page':    return 'main'
    case 'Section': return 'section'
    case 'Text':    return 'span'
    case 'Input':   return 'input'
    case 'Button':  return 'button'
    case 'Frame':   return 'div'
    default:        return 'div'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Style Mapping
// ═══════════════════════════════════════════════════════════════════════════

function normalizeStyleValue(value: any): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'number') return `${value}px`
  return String(value)
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function mapStyle(style: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    if (value == null) continue
    const normalized = normalizeStyleValue(value)
    if (normalized != null) {
      const kebabKey = camelToKebab(key)
      result[kebabKey] = normalized
    }
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Node Mapping
// ═══════════════════════════════════════════════════════════════════════════

function mapTreeNodeToEDRNode(node: TreeNode): EDRNode {
  const tag = nodeTypeToTag(node.type)
  const geometry = mapStyle(node.style)
  const tagProps: Record<string, any> = {}

  // Props → tag attributes (skip text content — it goes in children)
  if (node.props) {
    for (const [key, val] of Object.entries(node.props)) {
      if (key === 'text') continue
      if (key === 'level') continue
      tagProps[key] = String(val)
    }
  }

  // Node ID as HTML id
  tagProps.id = node.id

  const children: EDRNode[] | string | null =
    node.type === 'Text' && node.props?.text
      ? node.props.text
      : node.props?.text
        ? node.props.text      // Button/other nodes with text content
        : node.children.map(mapTreeNodeToEDRNode)

  return {
    type: tag,
    props: { role: [node.type.toLowerCase()], ...tagProps },
    geometry,
    children,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compile a CanvasDocument into HTML.
 *
 * @param doc - The CanvasDocument to compile
 * @returns HTML string
 */
export function compileFromCanvas(doc: CanvasDocument): string {
  const tree = getTree(doc)
  if (!tree) return '<div></div>'

  // Build EDR definition from design tokens (if present)
  const designTokens = (doc as any).designTokens as DesignTokens | undefined
  const edr = designTokens ? designTokensToEDR(designTokens) : DEFAULT_EDR
  const edrHash = designTokens ? 'canvas-design-tokens' : CANVAS_EDR_HASH

  const rootNode = mapTreeNodeToEDRNode(tree)

  let html: string
  try {
    html = compileEDR(rootNode, edr, edrHash, COMPILE_MODE)
  } catch {
    // Fallback: try legacy mode
    html = compileEDR(rootNode, edr, edrHash, 'legacy')
    // If that also fails, return empty
    if (!html) html = '<div><!-- compile error --></div>'
  }

  return html
}

const DEFAULT_EDR: EDR = { components: {}, global: {} }
const CANVAS_EDR_HASH = 'canvas-v1'
const COMPILE_MODE = 'legacy' as const

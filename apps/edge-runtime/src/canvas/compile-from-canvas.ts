/**
 * EdgeGDE Canvas — compileFromCanvas Bridge
 * Canvas Platform v1.0.0
 * v2.1: Design token support — auto-extracts from node styles,
 * or reads doc.designTokens if explicitly provided.
 *
 * Pipeline:
 *   CanvasDocument → getTree() → map nodes to EDRNode tree → compileEDR() → HTML
 *
 * Design tokens are auto-extracted from inline styles on nodes, then
 * emitted as CSS custom properties in <style id="canvas-tokens">.
 * This enables instant re-theming via token swap.
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

function designTokensToEDR(tokens: DesignTokens): EDR {
  const components: Record<string, Record<string, string>> = {}
  const c = tokens.colors
  if (c) {
    if (c.background) components['color-bg'] = { background_color: c.background }
    if (c.text) components['color-text'] = { color: c.text }
    if (c.primary) components['color-primary'] = { color: c.primary }
    if (c.surface) components['color-surface'] = { background_color: c.surface }
    if (c.border) components['color-border'] = { border_color: c.border }
    if (c.muted) components['color-muted'] = { color: c.muted }
  }
  const t = tokens.typography
  if (t?.fontFamily) components['font-family'] = { font_family: t.fontFamily }
  if (t?.fontSize?.h1) components['font-size-h1'] = { font_size: t.fontSize.h1 }
  if (t?.fontSize?.body) components['font-size-body'] = { font_size: t.fontSize.body }
  if (t?.fontWeight?.h1) components['font-weight-h1'] = { font_weight: String(t.fontWeight.h1) }
  if (t?.fontWeight?.body) components['font-weight-body'] = { font_weight: String(t.fontWeight.body) }
  const s = tokens.spacing
  if (s?.borderRadius) components['border-radius'] = { border_radius: s.borderRadius }
  if (s?.gap) components['gap'] = { gap: s.gap }
  return { components, global: {} }
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-extraction from canvas nodes
// ═══════════════════════════════════════════════════════════════════════════

function extractTokensFromDoc(doc: CanvasDocument): DesignTokens | null {
  // 1. Use explicit designTokens if present
  const explicit = (doc as any).designTokens
  if (explicit && explicit.colors) return explicit as DesignTokens

  // 2. Auto-extract from node styles
  const styles: Array<{ tagName: string; color?: string; backgroundColor?: string }> = []
  for (const n of Object.values(doc.nodes)) {
    const s: any = { tagName: n.type }
    if (n.style.color) s.color = n.style.color
    if (n.style.backgroundColor) s.backgroundColor = n.style.backgroundColor
    styles.push(s)
  }
  if (styles.length === 0) return null

  // Use the inline extractor (import at module level)
  const colors = extractColorsFallback(styles)
  if (!colors) return null

  return {
    colors: {
      background: colors.background || '#0d1117',
      text: colors.text || '#e1e4e8',
      primary: colors.primary || '#58a6ff',
      surface: colors.surface || '#1c2128',
      border: colors.border || '#2d3140',
      muted: colors.muted || '#8b949e',
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
}

function extractColorsFallback(styles: any[]): { background?: string; text?: string; primary?: string; surface?: string; border?: string; muted?: string } | null {
  if (styles.length === 0) return null
  const bgs = styles.filter((s: any) => s.backgroundColor).map((s: any) => s.backgroundColor)
  const colors = styles.filter((s: any) => s.color).map((s: any) => s.color)
  if (bgs.length === 0 && colors.length === 0) return null
  const bg = bgs[0]
  const text = colors[0]
  const accent = colors.length > 1 ? colors.find((c: string) => c !== text) : undefined
  return {
    background: bg || undefined,
    text: text || undefined,
    primary: accent || undefined,
    surface: bgs.length > 1 ? bgs[1] : undefined,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CSS Custom Properties Compilation
// ═══════════════════════════════════════════════════════════════════════════

function compileTokenCSS(tokens: DesignTokens): string {
  const parts: string[] = [':root {']
  const c = tokens.colors
  const bg = validCSSColor(c?.background); if (bg) parts.push('  --bg: ' + bg + ';')
  const tx = validCSSColor(c?.text); if (tx) parts.push('  --text: ' + tx + ';')
  const pr = validCSSColor(c?.primary); if (pr) parts.push('  --primary: ' + pr + ';')
  const sf = validCSSColor(c?.surface); if (sf) parts.push('  --surface: ' + sf + ';')
  const bd = validCSSColor(c?.border); if (bd) parts.push('  --border: ' + bd + ';')
  const mu = validCSSColor(c?.muted); if (mu) parts.push('  --muted: ' + mu + ';')
  const t = tokens.typography
  if (t?.fontFamily) parts.push('  --font-family: ' + t.fontFamily + ';')
  if (t?.fontSize?.h1) parts.push('  --h1-size: ' + t.fontSize.h1 + ';')
  if (t?.fontSize?.body) parts.push('  --body-size: ' + t.fontSize.body + ';')
  const s = tokens.spacing
  if (s?.borderRadius) parts.push('  --radius: ' + s.borderRadius + ';')
  if (s?.gap) parts.push('  --gap: ' + s.gap + ';')
  parts.push('}')
  return parts.join('\n')
}

function validCSSColor(val: string | undefined): string | undefined {
  if (!val) return undefined
  // Reject invalid hex-like values
  if (val.startsWith('#') && !/^#[0-9a-fA-F]{3,8}$/.test(val)) return undefined
  if (val.startsWith('#')) return val
  if (val.startsWith('rgb') || val.startsWith('hsl')) return val
  if (val === 'transparent' || val === 'none' || val === 'inherit' || val === 'initial') return val
  // Named colors
  const namedColors = new Set(['black','white','red','blue','green','gray','grey','dark','light'])
  if (namedColors.has(val)) return val
  return undefined // Reject invalid values like '#transparent'
}

// ═══════════════════════════════════════════════════════════════════════════
// Type Mappings
// ═══════════════════════════════════════════════════════════════════════════

function nodeTypeToTag(type: string, props?: Record<string, any>): string {
  if (type === 'Text' && props?.href) return 'a'
  if (type === 'Frame' && props?.src) return 'img'
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
      result[camelToKebab(key)] = normalized
    }
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Node Mapping
// ═══════════════════════════════════════════════════════════════════════════

function mapTreeNodeToEDRNode(node: TreeNode): EDRNode {
  const tag = nodeTypeToTag(node.type, node.props)
  const geometry = mapStyle(node.style)
  const tagProps: Record<string, any> = {}

  if (node.props) {
    for (const [key, val] of Object.entries(node.props)) {
      if (key === 'text') continue
      if (key === 'level') continue
      tagProps[key] = String(val)
    }
  }

  tagProps.id = node.id

  const children: EDRNode[] | string | null =
    tag === 'img' || tag === 'input'
      ? null
      : node.type === 'Text' && node.props?.text
        ? node.props.text
        : node.props?.text
          ? node.props.text
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

export function compileFromCanvas(doc: CanvasDocument): string {
  const tree = getTree(doc)
  if (!tree) return '<div></div>'

  // Auto-detect design tokens from doc (explicit or auto-extracted)
  const designTokens = extractTokensFromDoc(doc)
  const tokenCSS = designTokens ? compileTokenCSS(designTokens) : ''
  const edr = designTokens ? designTokensToEDR(designTokens) : DEFAULT_EDR
  const edrHash = designTokens ? 'canvas-design-tokens' : CANVAS_EDR_HASH

  const rootNode = mapTreeNodeToEDRNode(tree)

  let html: string
  try {
    html = compileEDR(rootNode, edr, edrHash, COMPILE_MODE)
  } catch {
    html = compileEDR(rootNode, edr, edrHash, 'legacy')
    if (!html) html = '<div><!-- compile error --></div>'
  }
  // Inject CSS custom properties from design tokens
  if (tokenCSS) {
    html = '<style id="canvas-tokens">' + tokenCSS + '</style>' + html
    // Apply design tokens to root element as inline style
    if (designTokens?.colors?.background || designTokens?.colors?.text || designTokens?.typography?.fontFamily) {
      const rootStyles: string[] = []
      if (designTokens.colors.background) rootStyles.push('background-color:' + designTokens.colors.background)
      if (designTokens.colors.text) rootStyles.push('color:' + designTokens.colors.text)
      if (designTokens.typography?.fontFamily) rootStyles.push('font-family:' + designTokens.typography.fontFamily)
      if (rootStyles.length > 0) {
        const styleStr = rootStyles.join(';')
        // Append to existing style if present
        if (html.includes('<main style=')) {
          html = html.replace('<main style="', '<main style="' + styleStr + ';')
        } else {
          html = html.replace('<main ', '<main style="' + styleStr + '" ')
        }
      }
    }
  }

  // Add space between adjacent inline elements to prevent text concatenation
  html = html.replace(/<\/span><span/g, '</span> <span')
  html = html.replace(/<\/button><button/g, '</button> <button')

  return html
}

const DEFAULT_EDR: EDR = { components: {}, global: {} }
const CANVAS_EDR_HASH = 'canvas-v1'
const COMPILE_MODE = 'legacy' as const

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  DEPRECATED — Legacy Registry Renderer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module is kept for backward compatibility only.
 * All new compilation should use the CanvasDocument pipeline.
 * Planned removal: v2.0.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * EdgeGDE — Registry Renderer
 * Phase 32: Typed renderer registry for all node types.
 * One compileNode() dispatches through this registry — Figma nodes,
 * form nodes, and composer nodes go through the same pipeline.
 *
 * @packageDocumentation
 */

import type { OpenPencilNode } from '@edgegde/schema'
import { getForm } from '../lib/form-registry'
import type { DesignTokens } from '../lib/design-parser'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Input passed to every registered renderer */
export interface RenderInput {
  node: OpenPencilNode
  style: Record<string, string>
  attrs: Record<string, string>
  childrenHtml: string
  /** Explicit slot content for composer types (separate from childrenHtml) */
  slotContent?: string
  /** Arbitrary props for composer types (logo, title, links, etc.) */
  props?: Record<string, any>
  /** Phase 33: design tokens from DESIGN.md */
  design: DesignTokens
}

/** A renderer function for a node type */
type NodeRenderer = (input: RenderInput) => string

// ═══════════════════════════════════════════════════════════════════════════
// HTML Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function escapeHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function serializeStyle(style: Record<string, string>): string {
  const entries = Object.entries(style)
  if (entries.length === 0) return ''
  return entries.map(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    return `${cssKey}:${value}`
  }).join(';')
}

type AttrBucket = 'id' | 'style' | 'type' | 'placeholder' | 'required' | 'minmax' | 'hx' | 'mcp'

function classifyAttr(name: string): AttrBucket {
  if (name === 'id') return 'id'
  if (name === 'style') return 'style'
  if (name === 'type') return 'type'
  if (name === 'placeholder') return 'placeholder'
  if (name === 'required') return 'required'
  if (name === 'min' || name === 'max' || name === 'step') return 'minmax'
  if (name.startsWith('hx-')) return 'hx'
  if (name.startsWith('mcp-')) return 'mcp'
  return 'mcp'
}

const BUCKET_ORDER: AttrBucket[] = ['id', 'style', 'type', 'placeholder', 'required', 'minmax', 'hx', 'mcp']

export function serializeAttributes(attrs: Record<string, string>): string {
  if (Object.keys(attrs).length === 0) return ''

  const buckets: Record<AttrBucket, [string, string][]> = {
    id: [], style: [], type: [], placeholder: [],
    required: [], minmax: [], hx: [], mcp: [],
  }

  for (const [name, value] of Object.entries(attrs)) {
    buckets[classifyAttr(name)].push([name, value])
  }

  for (const bucket of Object.keys(buckets) as AttrBucket[]) {
    buckets[bucket].sort(([a], [b]) => a.localeCompare(b))
  }

  const parts: string[] = []
  for (const bucket of BUCKET_ORDER) {
    for (const [name, value] of buckets[bucket]) {
      if (value === '') continue
      parts.push(`${name}="${value.replace(/"/g, '&quot;').replace(/&/g, '&amp;')}"`)
    }
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

function getTextContent(node: OpenPencilNode): string {
  if ((node as any).text && typeof (node as any).text === 'string') {
    return (node as any).text
  }
  return node.name || ''
}

/** Safely append a CSS property to an existing style string */
const appendStyle = (base: string | undefined, next: string): string =>
  base ? `${base};${next}` : next

// ═══════════════════════════════════════════════════════════════════════════
// Figma Node Renderers
// ═══════════════════════════════════════════════════════════════════════════

const FIGMA_RENDERERS: Record<string, NodeRenderer> = {
  FRAME: (input) => {
    const bgColor = input.design.colors.background
    const a = { ...input.attrs }
    if (bgColor && !a.style?.includes('background')) {
      a.style = appendStyle(a.style, `background-color:${bgColor}`)
    }
    return `<div${serializeAttributes(a)}>${input.childrenHtml}</div>`
  },
  GROUP: (input) => `<div${serializeAttributes(input.attrs)}>${input.childrenHtml}</div>`,
  COMPONENT: (input) => `<div${serializeAttributes(input.attrs)}>${input.childrenHtml}</div>`,
  INSTANCE: (input) => `<div${serializeAttributes(input.attrs)}>${input.childrenHtml}</div>`,
  TEXT: (input) => {
    const text = getTextContent(input.node)
    const font = input.design.typography.fontFamily
    const a = { ...input.attrs }
    if (font) {
      a.style = appendStyle(a.style, `font-family:${font}`)
    }
    return `<span${serializeAttributes(a)}>${escapeHtml(text)}</span>`
  },
  RECTANGLE: (input) => `<div${serializeAttributes(input.attrs)}>${input.childrenHtml}</div>`,
  ELLIPSE: (input) => {
    const a = { ...input.attrs }
    const style = input.style
    // Add border-radius: 50% for ellipses
    const styleStr = serializeStyle({ ...style, borderRadius: '50%' })
    if (styleStr) a.style = styleStr
    return `<div${serializeAttributes(a)}></div>`
  },
  LINE: (input) => `<hr${serializeAttributes(input.attrs)}>`,
  VECTOR: (input) => `<div${serializeAttributes(input.attrs)}></div>`,
}

// ═══════════════════════════════════════════════════════════════════════════
// Prefix Renderers (form / HTMX)
// ═══════════════════════════════════════════════════════════════════════════

function renderDataNode(input: RenderInput): string {
  const dataKey = input.node.name!.slice(5).trim()
  const a = { ...input.attrs }
  a['hx-get'] = `/api/telemetry?key=${encodeURIComponent(dataKey)}`
  a['hx-trigger'] = 'load, every 5s'
  a['hx-target'] = 'this'
  a['hx-swap'] = 'innerHTML'
  a['data-key'] = dataKey
  return `<span${serializeAttributes(a)}>--</span>`
}

function renderFormContainer(input: RenderInput): string {
  const formId = input.node.name!.slice(5).trim()
  const registered = getForm(formId)
  const a = { ...input.attrs }

  if (registered) {
    a['hx-post'] = `/api/form/${registered.def.id}`
    a['hx-target'] = `#${registered.def.resultTargetId}`
    a['hx-swap'] = 'outerHTML'
    a['mcp-tool'] = `form_${registered.def.id}`
    a['mcp-description'] = registered.def.label
  } else {
    a['hx-post'] = '#'
    a['hx-target'] = '#calculator-results'
    a['hx-swap'] = 'outerHTML'
  }

  let html = `<form${serializeAttributes(a)}>${input.childrenHtml}`

  // Append submit button if none found in children
  if (!input.childrenHtml.includes('type="submit"') && !input.childrenHtml.includes('Button:Submit')) {
    const btnStyle = serializeStyle({
      display: 'inline-block', padding: '8px 16px',
      backgroundColor: '#2563eb', color: '#ffffff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', fontSize: '14px', fontWeight: '600',
    })
    html += `<button type="submit" style="${btnStyle}">Submit</button>`
  }

  html += '</form>'
  return html
}

function renderInput(input: RenderInput): string {
  const name = input.node.name!.slice(6).trim()
  const a = { ...input.attrs }
  a.name = name
  a.type = 'text'
  const existingStyle = a.style || ''
  a.style = existingStyle + (existingStyle ? ';' : '') + 'appearance:none;border:none;outline:none;background:transparent'
  return `<input${serializeAttributes(a)}>`
}

function renderSubmitButton(input: RenderInput): string {
  const a = { ...input.attrs }
  a.type = 'submit'
  const existingStyle = a.style || ''
  a.style = existingStyle + (existingStyle ? ';' : '') + 'cursor:pointer;border:none;background:transparent'
  const label = escapeHtml(getTextContent(input.node) || 'Submit')
  return `<button${serializeAttributes(a)}>${label}</button>`
}

function renderResultsContainer(input: RenderInput): string {
  const a = { ...input.attrs }
  // attrs already includes the correct id from engine.ts
  return `<div${serializeAttributes(a)}>${input.childrenHtml}</div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Composer Renderers (for AI-generated / high-level layouts)
// ═══════════════════════════════════════════════════════════════════════════

const COMPOSER_RENDERERS: Record<string, NodeRenderer> = {
  Page: (input) => `<main>${input.slotContent || input.childrenHtml}</main>`,

  Header: (input) => {
    const p = input.props || {}
    const d = input.design
    const logo = escapeHtml(String(p.logo || ''))
    const links = (p.links || []).map((l: string) => `<a>${escapeHtml(String(l))}</a>`).join('')
    const textColor = d.colors.text || ''
    const style = textColor ? ` style="color:${textColor}"` : ''
    return `<header${style}>\n  <div>${logo}</div>\n  <nav>${links}</nav>\n</header>`
  },

  'Section:Hero': (input) => {
    const p = input.props || {}
    const d = input.design
    const title = escapeHtml(String(p.title || ''))
    const subtitle = escapeHtml(String(p.subtitle || ''))
    const bgColor = d.colors.background ? `background-color:${d.colors.background};` : ''
    const primary = d.colors.primary ? `color:${d.colors.primary};` : ''
    const style = (bgColor || primary) ? ` style="${bgColor}${primary}"` : ''
    return `<section${style}>\n  <h1>${title}</h1>\n  <p>${subtitle}</p>\n</section>`
  },

  Section: (input) => `<section>${input.slotContent || input.childrenHtml}</section>`,

  Footer: (input) => `<footer>${input.slotContent || input.childrenHtml}</footer>`,
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dispatch a node to the correct registered renderer.
 * Prefix priority: Data: > Form: > Input: > Button:Submit > Container:Results
 * Then figma types, then composer types, then fallback.
 */
export function renderNode(input: RenderInput): string {
  // Ensure design tokens always exist
  if (!input.design) {
    input.design = { colors: {}, typography: {}, spacing: {} } as DesignTokens
  }
  const nodeName = input.node.name || ''

  // Prefix priority (same order as Phase 29)
  if (nodeName.startsWith('Data:')) return renderDataNode(input)
  if (nodeName.startsWith('Form:')) return renderFormContainer(input)
  if (nodeName.startsWith('Input:')) return renderInput(input)
  if (nodeName === 'Button:Submit') return renderSubmitButton(input)
  if (nodeName === 'Container:Results') return renderResultsContainer(input)

  // Figma node types
  const figmaType = input.node.type
  const figmaRenderer = FIGMA_RENDERERS[figmaType]
  if (figmaRenderer) return figmaRenderer(input)

  // Composer types (for non-OpenPencil JSON layouts)
  const composerRenderer = COMPOSER_RENDERERS[figmaType || nodeName]
  if (composerRenderer) return composerRenderer(input)

  // Fallback
  return `<div${serializeAttributes(input.attrs)}>${input.childrenHtml}</div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Composer Layout Renderer (for POST /api/render)
// ═══════════════════════════════════════════════════════════════════════════

export interface ComposerNode {
  type: string
  props?: Record<string, any>
  children?: ComposerNode[]
}

/**
 * Render a composer-format layout tree (non-OpenPencil JSON).
 * Used by POST /api/render for AI-generated layouts.
 * Optionally accepts design tokens from DESIGN.md.
 */
export function renderComposerLayout(node: ComposerNode, design?: DesignTokens): string {
  const defaultDesign: DesignTokens = { colors: {}, typography: {}, spacing: {} }
  const typeName = node.type
  const renderer = COMPOSER_RENDERERS[typeName]
  if (!renderer) {
    throw new Error(`Unknown composer type: "${typeName}"`)
  }

  const slotContent = (node.children || [])
    .map((child) => renderComposerLayout(child, design))
    .join('')

  return renderer({
    node: {
      id: '', name: typeName, type: typeName,
      x: 0, y: 0, width: 0, height: 0,
    },
    style: {},
    attrs: {},
    childrenHtml: '',
    slotContent,
    props: node.props || {},
    design: design || defaultDesign,
  })
}

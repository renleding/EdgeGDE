/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  DEPRECATED — Legacy OpenPencil Compiler
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module is kept for backward compatibility only.
 * All new compilation should use the CanvasDocument pipeline:
 *   - openPencilToCanvas()   in src/canvas/openpencil-migration.ts
 *   - compileFromCanvas()    in src/canvas/compile-from-canvas.ts
 *
 * Planned removal: v2.0.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * EdgeGDE Mortgage Calculator — Inline-Style Compilation Engine
 * HSAES Phase 24: Translate LayoutDefinition schemas into functional
 * inline styles (text, fills, dimensions, flex layouts) without
 * external CSS framework dependencies.
 *
 * ⚠️ BOUNDARY GUARD: DO NOT import EDR modules here.
 * This is the LEGACY compiler. It must remain fully isolated from
 * the EDR pipeline (src/edr/compiler/engine.ts).
 *
 * Null-safe: all optional properties are guarded with ?? / ?. chains.
 * HTMX + WebMCP attributes preserved unchanged.
 *
 * @packageDocumentation
 */

import type { LayoutDefinition, OpenPencilNode } from '@edgegde/schema'
import { renderNode, escapeHtml } from './registry'
import type { DesignTokens } from '../lib/design-parser'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Compiler context passed through recursive calls */
interface CompileContext {
  /** Set of visited node IDs for cycle detection */
  visited: Set<string>
  /** Layout definition for form field / submit / result metadata */
  layout: LayoutDefinition
  /** Set of used mcp-param values for collision detection */
  usedMcpParams: Set<string>
  /** Form ID for HTMX endpoint generation (set by Form:* prefix) */
  formId: string | null
  /** Phase 33: design tokens propagated through the tree */
  design: DesignTokens
}

// ═══════════════════════════════════════════════════════════════════════════
// Inline style builder
// ═══════════════════════════════════════════════════════════════════════════

interface InlineStyle {
  [key: string]: string
}

/** Parse a fill value that may be {color: {r,g,b}} or {color: "#hex"} or a hex string */
function parseFillColor(fill: unknown): string | null {
  if (!fill || typeof fill !== 'object') return null

  const f = fill as Record<string, unknown>

  // { color: "#ff0000" }
  if (typeof f.color === 'string') return f.color

  // { color: { r: 1, g: 0, b: 0 } } — normalized 0-1 range
  if (f.color && typeof f.color === 'object') {
    const c = f.color as Record<string, unknown>
    const r = typeof c.r === 'number' ? Math.round(c.r * 255) : 0
    const g = typeof c.g === 'number' ? Math.round(c.g * 255) : 0
    const b = typeof c.b === 'number' ? Math.round(c.b * 255) : 0
    const a = typeof c.a === 'number' ? c.a : 1
    if (a < 1) return `rgba(${r},${g},${b},${a})`
    return `rgb(${r},${g},${b})`
  }

  return null
}

/** Build inline style object for a node */
function buildInlineStyle(node: OpenPencilNode): InlineStyle {
  const s: InlineStyle = {}
  const isText = node.type === 'TEXT'

  // ── Dimensions — skip for TEXT to avoid clipping ─────────────────────────
  if (!isText) {
    if (node.width != null && node.width > 0) s.width = `${Math.round(node.width)}px`
    if (node.height != null && node.height > 0) s.height = `${Math.round(node.height)}px`
  }

  // ── Positioning (absolute by default for design fidelity) ───────────────
  if (node.x != null && node.y != null) {
    s.position = 'absolute'
    s.left = `${Math.round(node.x)}px`
    s.top = `${Math.round(node.y)}px`
  }

  // ── Text sizing (content-driven, no clipping) ───────────────────────────
  if (isText) {
    s.display = 'inline-block'
    s.whiteSpace = 'nowrap'
    s.overflow = 'visible'
  }

  // ── Flex layout for FRAME / GROUP ───────────────────────────────────────
  if (node.type === 'FRAME' || node.type === 'GROUP') {
    s.display = 'flex'
    s.flexDirection = 'column'
    s.flexShrink = '0'
    s.position = s.position || 'relative'
  }

  // ── Corner radius ───────────────────────────────────────────────────────
  if (node.cornerRadius != null && node.cornerRadius > 0) {
    s.borderRadius = `${Math.round(node.cornerRadius)}px`
  }

  // ── Opacity ─────────────────────────────────────────────────────────────
  if (node.opacity != null && node.opacity < 1) {
    s.opacity = String(node.opacity)
  }

  // ── Fill colors (defensive — try to parse) ──────────────────────────────
  if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
    for (const fill of node.fills) {
      if (fill && typeof fill === 'object') {
        const f = fill as Record<string, unknown>
        // Skip fills that are explicitly invisible
        if (f.visible === false) continue
        const color = parseFillColor(fill)
        if (color) {
          s.backgroundColor = color
          break // first visible solid fill wins
        }
      }
    }
  }

  // ── Overflow (visible so child nodes aren't clipped) ──────────────────────
  // Non-text nodes (FRAME, GROUP, RECTANGLE, etc.) explicitly allow overflow
  // so absolutely-positioned children that extend beyond bounding boxes
  // remain visible. TEXT nodes already set overflow:visible above.
  if (!isText) {
    s.overflow = 'visible'
  }

  return s
}

/** Text content for TEXT nodes — props.content > text > name fallback */
function getTextContent(node: OpenPencilNode): string {
  // Phase 35: props.content is the absolute source of truth for AI-generated layouts
  if ((node as any).props?.content && typeof (node as any).props.content === 'string') {
    return (node as any).props.content
  }
  if ((node as any).text && typeof (node as any).text === 'string') {
    return (node as any).text
  }
  // Fallback: node name (the Figma layer name)
  return node.name || ''
}

// ═══════════════════════════════════════════════════════════════════════════
// Style serializer
// ═══════════════════════════════════════════════════════════════════════════

function serializeStyle(style: Record<string, string>): string {
  const entries = Object.entries(style)
  if (entries.length === 0) return ''
  return entries.map(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    return `${cssKey}:${value}`
  }).join(';')
}

// ═══════════════════════════════════════════════════════════════════════════
// Recursive node compiler
// ═══════════════════════════════════════════════════════════════════════════

function compileNode(node: OpenPencilNode, ctx: CompileContext): string {
  // ── Cycle detection ──────────────────────────────────────────────────
  if (ctx.visited.has(node.id)) {
    throw new Error(
      `Cycle detected: node "${node.id}" (${node.name}) has already been visited`
    )
  }
  ctx.visited.add(node.id)

  try {
    const nodeName = node.name || ''

    // ── Detect prefix to set formId on context ──────────────────────────
    if (nodeName.startsWith('Form:')) {
      ctx.formId = nodeName.slice(5).trim()
    }

    // ── Build inline style ──────────────────────────────────────────────
    const style = buildInlineStyle(node)

    // ── Build basic attributes (id + style only; registry handles prefixes) ─
    const allAttrs: Record<string, string> = {}
    const styleStr = serializeStyle(style)
    if (styleStr) {
      allAttrs.style = styleStr
    }
    allAttrs.id = node.id

    // ── Render children ─────────────────────────────────────────────────
    let childrenHtml = compileChildren(node, ctx)

    // Phase 35: Form input rendering — nodes with fieldId become interactive inputs
    if ((node as any).props?.fieldId) {
      const props = (node as any).props
      const fieldId = props.fieldId as string
      const label = (props.label as string) || node.name || ''
      const fieldType = (props.fieldType as string) || 'text'
      const required = props.required === true
      const placeholder = props.placeholder as string || label

      // ── Design token-driven field styling ─────────────────────────────
      const df = ctx.design.field || {}
      const fieldBg = df.background || 'rgba(255,255,255,0.1)'
      const fieldText = df.textColor || '#ffffff'
      const fieldLabel = df.labelColor || 'rgba(255,255,255,0.7)'
      const fieldRadius = df.borderRadius || '1rem'
      const fieldBorder = df.borderColor || 'rgba(255,255,255,0.2)'
      const fieldBlur = df.backdropBlur ? `backdrop-filter:blur(${df.backdropBlur});-webkit-backdrop-filter:blur(${df.backdropBlur});` : ''
      const fieldPad = df.padding || '16px'
      const fieldHeight = df.height || '48px'
      const fieldPlaceholder = df.placeholderColor || 'rgba(255,255,255,0.4)'
      const fieldFocus = df.focusColor || 'rgba(255,255,255,0.3)'

      const inputStyle = [
        `background:${fieldBg}`,
        `color:${fieldText}`,
        `border:1px solid ${fieldBorder}`,
        `border-radius:${fieldRadius}`,
        `padding:${fieldPad}`,
        `height:${fieldHeight}`,
        `width:100%`,
        `box-sizing:border-box`,
        `outline:none`,
        `font-size:16px`,
        `transition:border-color 0.2s,box-shadow 0.2s`,
      ].filter(Boolean).join(';')

      const labelStyle = [
        `color:${fieldLabel}`,
        `display:block`,
        `margin-bottom:6px`,
        `font-size:14px`,
        `font-weight:500`,
      ].join(';')

      const fieldContainerStyle = [
        fieldBlur,
        `border-radius:${fieldRadius}`,
        `margin-bottom:16px`,
      ].filter(Boolean).join(';')

      if (fieldType === 'select' || fieldType === 'dropdown') {
        const options: Array<{ value: string; label?: string }> = props.options || []
        const opts = options.map((o: any) => {
          const val = typeof o === 'string' ? o : (o.value || o)
          const lbl = typeof o === 'string' ? o : (o.label || val)
          return `<option value="${escapeHtml(val)}">${escapeHtml(lbl)}</option>`
        }).join('')
        childrenHtml = `<label style="${labelStyle}">${escapeHtml(label)}</label><select name="${escapeHtml(fieldId)}" ${required ? 'required' : ''} style="${inputStyle};appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"12\\" height=\\"12\\" viewBox=\\"0 0 12 12\\"><path fill=\\"white\\" d=\\"M6 8L1 3h10z\\"/></svg>');background-repeat:no-repeat;background-position:right 12px center;padding-right:36px"><option value="">Select...</option>${opts}</select>`
      } else if (fieldType === 'radio') {
        const options: Array<{ value: string; label?: string }> = props.options || []
        const opts = options.map((o: any) => {
          const val = typeof o === 'string' ? o : (o.value || o)
          const lbl = typeof o === 'string' ? o : (o.label || val)
          return `<label style="color:${fieldLabel};display:inline-flex;align-items:center;margin-right:16px;cursor:pointer"><input type="radio" name="${escapeHtml(fieldId)}" value="${escapeHtml(val)}" ${required ? 'required' : ''} style="margin-right:6px;accent-color:${fieldFocus}"/>${escapeHtml(lbl)}</label>`
        }).join('')
        childrenHtml = `<fieldset style="border:none;padding:0;margin:0"><legend style="${labelStyle};margin-bottom:8px">${escapeHtml(label)}</legend>${opts}</fieldset>`
      } else {
        const inputType = fieldType === 'number' ? 'number' : fieldType === 'email' ? 'email' : fieldType === 'tel' ? 'tel' : 'text'
        const phStyle = `${inputStyle};::placeholder{color:${fieldPlaceholder}}`
        childrenHtml = `<label style="${labelStyle}">${escapeHtml(label)}</label><div style="${fieldContainerStyle}"><input type="${inputType}" name="${escapeHtml(fieldId)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} style="${inputStyle}" onfocus="this.style.borderColor='${fieldFocus}'" onblur="this.style.borderColor='${fieldBorder}'"/></div>`
      }
    }

    // TEXT node content
    if (node.type === 'TEXT') {
      childrenHtml = escapeHtml(getTextContent(node))
    }

    // ── Dispatch to registry ────────────────────────────────────────────
    return renderNode({
      node,
      style,
      attrs: allAttrs,
      childrenHtml,
      design: ctx.design,
    })

  } catch (e) {
    ctx.visited.delete(node.id)
    throw e
  }
}

function compileChildren(node: OpenPencilNode, ctx: CompileContext): string {
  if (!node.children || !Array.isArray(node.children)) return ''
  return (node.children as OpenPencilNode[])
    .filter((child: OpenPencilNode) => child != null && typeof child === 'object')
    .map((child: OpenPencilNode) => compileNode(child, ctx))
    .join('')
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compile an OpenPencil LayoutDefinition into a deterministic HTML string
 * with inline styles. Zero external CSS framework dependency.
 *
 * - Recursively compiles nodes with cycle detection
 * - Generates inline styles for dimensions, positioning, fills, flex layouts
 * - Sorts attributes in fixed order: id → style → type → hx-* → mcp-*
 * - Injects HTMX attributes for form containers
 * - Injects WebMCP tool/param/description attributes
 * - Renders text content for TEXT nodes (name as fallback)
 *
 * @param layout - The validated layout definition
 * @returns Serialized HTML string with inline styles
 * @throws {Error} If a cycle is detected or mcp-param collision occurs
 */
export function compileLayout(
  layout: LayoutDefinition,
  design?: DesignTokens
): string {
  const defaultDesign: DesignTokens = { colors: {}, typography: {}, spacing: {} }
  // Build context (no legacy formFields/submitButton/resultNodeId)
  const ctx: CompileContext = {
    visited: new Set<string>(),
    layout,
    usedMcpParams: new Set<string>(),
    formId: null,
    design: design || defaultDesign,
  }

  // Compile the root node recursively
  const rootHtml = compileNode(layout.rootNode, ctx)

  // Phase 35: Wrap in <form> if layout has formFields
  const hasFormFields = layout.formFields && layout.formFields.length > 0
  if (hasFormFields) {
    const formAction = '/api/v1/tenant/data-ingest'
    return `<form hx-post="${formAction}" hx-trigger="submit" hx-swap="none" class="space-y-4">${rootHtml}</form>`
  }

  return rootHtml
}


/**
 * EdgeGDE Mortgage Calculator — Inline-Style Compilation Engine
 * HSAES Phase 24: Translate LayoutDefinition schemas into functional
 * inline styles (text, fills, dimensions, flex layouts) without
 * external CSS framework dependencies.
 *
 * Null-safe: all optional properties are guarded with ?? / ?. chains.
 * HTMX + WebMCP attributes preserved unchanged.
 *
 * @packageDocumentation
 */

import type { LayoutDefinition, OpenPencilNode, FormField } from '@edgegde/schema'
import { getForm } from '../lib/form-registry'

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
}

// ═══════════════════════════════════════════════════════════════════════════
// Node type → HTML element mapping
// ═══════════════════════════════════════════════════════════════════════════

type NodeType = 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'COMPONENT' | 'INSTANCE' | 'GROUP' | 'VECTOR'

const TYPE_TO_ELEMENT: Record<NodeType, string> = {
  FRAME: 'div',
  TEXT: 'span',
  RECTANGLE: 'div',
  ELLIPSE: 'div',
  LINE: 'hr',
  COMPONENT: 'div',
  INSTANCE: 'div',
  GROUP: 'div',
  VECTOR: 'div',
}

function getElementType(node: OpenPencilNode): string {
  return TYPE_TO_ELEMENT[node.type as NodeType] || 'div'
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

/** Text content for TEXT nodes — uses name as fallback when text field absent */
function getTextContent(node: OpenPencilNode): string {
  if ((node as any).text && typeof (node as any).text === 'string') {
    return (node as any).text
  }
  // Fallback: node name (the Figma layer name)
  return node.name || ''
}

// ═══════════════════════════════════════════════════════════════════════════
// Attribute builders
// ═══════════════════════════════════════════════════════════════════════════

function serializeStyle(style: InlineStyle): string {
  const entries = Object.entries(style)
  if (entries.length === 0) return ''
  return entries.map(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    return `${cssKey}:${value}`
  }).join(';')
}

// ═══════════════════════════════════════════════════════════════════════════
// Attribute serialization (sorted: id → style → hx-* → mcp-*)
// ═══════════════════════════════════════════════════════════════════════════

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

function serializeAttributes(attrs: Record<string, string>): string {
  if (Object.keys(attrs).length === 0) return ''

  const buckets: Record<AttrBucket, [string, string][]> = {
    id: [],
    style: [],
    type: [],
    placeholder: [],
    required: [],
    minmax: [],
    hx: [],
    mcp: [],
  }

  for (const [name, value] of Object.entries(attrs)) {
    const bucket = classifyAttr(name)
    buckets[bucket].push([name, value])
  }

  // Sort within each bucket alphabetically by attribute name
  for (const bucket of Object.keys(buckets) as AttrBucket[]) {
    buckets[bucket].sort(([a], [b]) => a.localeCompare(b))
  }

  // Concatenate in bucket order
  const parts: string[] = []
  for (const bucket of BUCKET_ORDER) {
    for (const [name, value] of buckets[bucket]) {
      if (value === '') continue
      parts.push(`${name}="${escapeAttr(value)}"`)
    }
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/&/g, '&amp;')
}

// ═══════════════════════════════════════════════════════════════════════════
// HTMX & WebMCP attribute generators
// ═══════════════════════════════════════════════════════════════════════════

function getFormContainerAttrs(formId: string | null): Record<string, string> {
  const attrs: Record<string, string> = {}
  const registered = formId ? getForm(formId) : undefined

  if (registered) {
    attrs['hx-post'] = `/api/form/${registered.def.id}`
    attrs['hx-target'] = `#${registered.def.resultTargetId}`
    attrs['hx-swap'] = 'outerHTML'
    attrs['mcp-tool'] = `form_${registered.def.id}`
    attrs['mcp-description'] = registered.def.label
  } else {
    attrs['hx-post'] = '#'
    attrs['hx-target'] = '#calculator-results'
    attrs['hx-swap'] = 'outerHTML'
    attrs['mcp-tool'] = 'unknown_form'
    attrs['mcp-description'] = 'Form'
  }

  return attrs
}

/**
 * Check if any node in the layout uses a Form:* prefix.
 * This replaces the old layout.formFields[] check.
 */
function needsFormWrapper(layout: LayoutDefinition): boolean {
  return hasPrefixNode(layout.rootNode, 'Form:')
}

/** Recursively check if any descendant has the given prefix */
function hasPrefixNode(node: OpenPencilNode, prefix: string): boolean {
  if (node.name && node.name.startsWith(prefix)) return true
  if (node.children && Array.isArray(node.children)) {
    return (node.children as OpenPencilNode[]).some((child) => hasPrefixNode(child, prefix))
  }
  return false
}

/**
 * Generate and validate the mcp-param for a given form field.
 */
function getMcpParam(field: FormField, usedMcpParams: Set<string>): string {
  const paramName = (field as any).mcpParam || toSnakeCase(field.label)
  if (usedMcpParams.has(paramName)) {
    throw new Error(
      `Duplicate mcp-param value: "${paramName}" — ` +
      `both "${field.label}" and a previous field would produce this value`
    )
  }
  usedMcpParams.add(paramName)
  return paramName
}

function toSnakeCase(label: string): string {
  return label
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
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
    const isText = node.type === 'TEXT'
    const isDataNode = nodeName.startsWith('Data:')
    const isFormPrefix = nodeName.startsWith('Form:')
    const isInputPrefix = nodeName.startsWith('Input:')
    const isButtonSubmit = nodeName === 'Button:Submit'
    const isContainerResults = nodeName === 'Container:Results'

    // Prefix priority: Data: > Form: > Input: > Button:Submit > Container:Results > standard

    // ── Determine element type ─────────────────────────────────────────
    let elementType: string
    let extractName = ''

    if (isDataNode) {
      elementType = 'span'
    } else if (isFormPrefix) {
      elementType = 'form'
      extractName = nodeName.slice(5).trim()
      ctx.formId = extractName
    } else if (isInputPrefix) {
      elementType = 'input'
      extractName = nodeName.slice(6).trim()
    } else if (isButtonSubmit) {
      elementType = 'button'
    } else if (isContainerResults) {
      elementType = 'div'
    } else if (isText) {
      elementType = 'span'
    } else {
      elementType = getElementType(node)
    }

    // ── Build attributes ───────────────────────────────────────────────
    const allAttrs: Record<string, string> = {}

    // Inline style
    const style = buildInlineStyle(node)
    const styleStr = serializeStyle(style)
    if (styleStr) {
      allAttrs.style = styleStr
    }

    // Form container HTMX + WebMCP attributes
    if (isFormPrefix) {
      Object.assign(allAttrs, getFormContainerAttrs(ctx.formId))
    }

    // Data node HTMX polling attributes
    if (isDataNode) {
      const dataKey = nodeName.slice(5).trim()
      allAttrs['hx-get'] = `/api/telemetry?key=${encodeURIComponent(dataKey)}`
      allAttrs['hx-trigger'] = 'load, every 5s'
      allAttrs['hx-target'] = 'this'
      allAttrs['hx-swap'] = 'innerHTML'
      allAttrs['data-key'] = dataKey
    }

    // id
    if (isContainerResults) {
      allAttrs.id = `results-${ctx.formId || 'unknown'}`
    } else {
      allAttrs.id = node.id
    }

    // Input attributes
    if (isInputPrefix) {
      allAttrs.name = extractName
      allAttrs.type = 'text'
      // CSS resets for native input appearance
      allAttrs.style = (allAttrs.style || '') +
        ';appearance:none;border:none;outline:none;background:transparent'
    }

    // Submit button attributes
    if (isButtonSubmit) {
      allAttrs.type = 'submit'
      // CSS resets for native button appearance
      allAttrs.style = (allAttrs.style || '') +
        ';cursor:pointer;border:none;background:transparent'
    }

    // ── Build children HTML ────────────────────────────────────────────
    let childrenHtml = compileChildren(node, ctx)

    // Button text content (use the node's text or name)
    if (isButtonSubmit) {
      childrenHtml = escapeHtml(getTextContent(node) || 'Submit')
    }

    // TEXT node content
    if (isText && !isInputPrefix && !isButtonSubmit) {
      const text = getTextContent(node)
      childrenHtml = escapeHtml(text)
    }

    // Data node fallback text
    if (isDataNode) {
      childrenHtml = '--'
    }

    // If this is the form container, append a submit button if none found in children
    if (isFormPrefix) {
      // Check if any child is already a button
      const hasButton = (node.children as OpenPencilNode[] || []).some(
        (child) => child.name === 'Button:Submit'
      )
      if (!hasButton) {
        const btnStyle = serializeStyle({
          display: 'inline-block',
          padding: '8px 16px',
          backgroundColor: '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '600',
        })
        childrenHtml += `<button type="submit" style="${btnStyle}">Submit</button>`
      }
    }

    // ── Serialize ──────────────────────────────────────────────────────
    const html = `<${elementType}${serializeAttributes(allAttrs)}>${childrenHtml}</${elementType}>`

    ctx.visited.delete(node.id)
    return html
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

function escapeHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
export function compileLayout(layout: LayoutDefinition): string {
  // Build context (no legacy formFields/submitButton/resultNodeId)
  const ctx: CompileContext = {
    visited: new Set<string>(),
    layout,
    usedMcpParams: new Set<string>(),
    formId: null,
  }

  // Compile the root node recursively
  return compileNode(layout.rootNode, ctx)
}

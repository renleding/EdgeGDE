/**
 * EdgeGDE Mortgage Calculator — JSON-to-HTML Compilation Engine
 * HSAES Phase 2: Provably stable compilation with strict sorting,
 * recursive loop protection, and WebMCP injections.
 *
 * @packageDocumentation
 */

import type { LayoutDefinition, OpenPencilNode, FormField } from '@/schemas/openpencil'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Compiler context passed through recursive calls */
interface CompileContext {
  /** Set of visited node IDs for cycle detection */
  visited: Set<string>
  /** Layout definition for form field / submit / result metadata */
  layout: LayoutDefinition
  /** Map of field data by node ID */
  fieldMap: Map<string, FormField>
  /** Set of used mcp-param values for collision detection */
  usedMcpParams: Set<string>
  /** Node ID of the submit button, if any */
  submitNodeId: string | null
  /** Submit button label */
  submitLabel: string
  /** Node ID of the result display, if any */
  resultNodeId: string | null
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
// Tailwind scale helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Rounded value scale — maps px to Tailwind rounded name */
const ROUNDED_MAP: [number, string][] = [
  [0, 'none'],
  [2, 'sm'],
  [4, 'md'],
  [6, 'lg'],
  [8, 'xl'],
  [12, '2xl'],
  [16, '3xl'],
]

function mapRounded(px: number): string {
  if (px >= 9999 || px >= 50) return 'full'
  let best = 'none'
  for (const [threshold, name] of ROUNDED_MAP) {
    if (px >= threshold) best = name
  }
  return best
}

/** Opacity class map */
const OPACITY_MAP: [number, string][] = [
  [0, '0'],
  [0.05, '5'],
  [0.1, '10'],
  [0.2, '20'],
  [0.25, '25'],
  [0.3, '30'],
  [0.4, '40'],
  [0.5, '50'],
  [0.6, '60'],
  [0.7, '70'],
  [0.75, '75'],
  [0.8, '80'],
  [0.9, '90'],
  [0.95, '95'],
  [1, '100'],
]

function mapOpacity(value: number): string {
  let best = '100'
  for (const [threshold, name] of OPACITY_MAP) {
    if (value >= threshold) best = name
  }
  return best
}

// ═══════════════════════════════════════════════════════════════════════════
// Label → snake_case helper
// ═══════════════════════════════════════════════════════════════════════════

function toSnakeCase(label: string): string {
  return label
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

// ═══════════════════════════════════════════════════════════════════════════
// Attribute builders
// ═══════════════════════════════════════════════════════════════════════════

function buildClasses(node: OpenPencilNode): string[] {
  const classes: string[] = []

  // Frame → flex layout
  if (node.type === 'FRAME' || node.type === 'GROUP') {
    classes.push('flex', 'flex-col')
  }

  // Corner radius
  if (node.cornerRadius != null && node.cornerRadius > 0) {
    classes.push(`rounded-${mapRounded(node.cornerRadius)}`)
  }

  // Opacity
  if (node.opacity != null && node.opacity < 1) {
    classes.push(`opacity-${mapOpacity(node.opacity)}`)
  }

  return classes
}

// ═══════════════════════════════════════════════════════════════════════════
// Attribute serialization (sorted: class → hx-* → id → mcp-*)
// ═══════════════════════════════════════════════════════════════════════════

type AttrBucket = 'class' | 'hx' | 'id' | 'mcp'

function classifyAttr(name: string): AttrBucket {
  if (name === 'class') return 'class'
  if (name === 'id') return 'id'
  if (name.startsWith('hx-')) return 'hx'
  if (name.startsWith('mcp-')) return 'mcp'
  return 'mcp'
}

function serializeAttributes(attrs: Record<string, string>): string {
  if (Object.keys(attrs).length === 0) return ''

  const buckets: Record<AttrBucket, [string, string][]> = {
    class: [],
    hx: [],
    id: [],
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
  for (const bucket of ['class', 'hx', 'id', 'mcp'] as AttrBucket[]) {
    for (const [name, value] of buckets[bucket]) {
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

function getFormContainerAttrs(): Record<string, string> {
  const attrs: Record<string, string> = {}

  // Always add HTMX attributes for form containers
  attrs['hx-post'] = '/api/calc/mortgage'
  attrs['hx-target'] = '#calculator-results'
  attrs['hx-swap'] = 'outerHTML'

  // Add WebMCP tool attributes
  attrs['mcp-tool'] = 'calculate_mortgage'
  attrs['mcp-description'] = 'Mortgage calculator — calculates repayments based on loan amount, interest rate, and term'

  return attrs
}

/**
 * Check if the layout has form-related content that needs a <form> wrapper.
 * A form wrapper is needed when there are form fields OR a submit button.
 */
function needsFormWrapper(layout: LayoutDefinition): boolean {
  const hasFields = layout.formFields && layout.formFields.length > 0
  const hasSubmit = !!layout.submitButton
  return hasFields || hasSubmit
}

/**
 * Generate and validate the mcp-param for a given form field.
 * Throws on duplicate param values.
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

// ═══════════════════════════════════════════════════════════════════════════
// Recursive node compiler
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compile a single node to its HTML representation.
 */
function compileNode(node: OpenPencilNode, ctx: CompileContext): string {
  // ── Cycle detection ──────────────────────────────────────────────────
  if (ctx.visited.has(node.id)) {
    throw new Error(
      `Cycle detected: node "${node.id}" (${node.name}) has already been visited`
    )
  }
  ctx.visited.add(node.id)

  try {
    const hasForm = needsFormWrapper(ctx.layout)
    const isFormContainer = hasForm && node.id === ctx.layout.rootNode.id
    const isFormField = ctx.fieldMap.has(node.id)
    const isSubmit = node.id === ctx.submitNodeId
    const isResult = node.id === ctx.resultNodeId

    // ── Determine element type ─────────────────────────────────────────
    let elementType: string
    if (isFormContainer) {
      elementType = 'form'
    } else if (isSubmit && !isFormContainer) {
      elementType = 'button'
    } else if (isFormField) {
      const field = ctx.fieldMap.get(node.id)!
      elementType = field.fieldType === 'select' ? 'select' : 'input'
    } else {
      elementType = getElementType(node)
    }

    // ── Build attributes ───────────────────────────────────────────────
    const allAttrs: Record<string, string> = {}
    const classes = buildClasses(node)

    // class
    if (classes.length > 0) {
      allAttrs.class = classes.join(' ')
    }

    // Form container HTMX + WebMCP attributes
    if (isFormContainer) {
      Object.assign(allAttrs, getFormContainerAttrs())
    }

    // id
    if (isResult) {
      allAttrs.id = 'calculator-results'
    } else {
      allAttrs.id = node.id
    }

    // Submit button gets type="submit"
    if (isSubmit && elementType === 'button') {
      allAttrs.type = 'submit'
    }

    // Form field attributes
    if (isFormField) {
      const field = ctx.fieldMap.get(node.id)!

      if (elementType === 'input') {
        allAttrs.type = field.fieldType === 'slider' ? 'range' : field.fieldType
        if (field.placeholder) allAttrs.placeholder = field.placeholder
        if (field.required) allAttrs.required = 'required'
        if (field.min != null) allAttrs.min = String(field.min)
        if (field.max != null) allAttrs.max = String(field.max)
        if (field.step != null) allAttrs.step = String(field.step)
      } else if (elementType === 'select') {
        if (field.required) allAttrs.required = 'required'
        if (field.placeholder) allAttrs.placeholder = field.placeholder
      }

      // mcp-param (register and get param name)
      const paramName = getMcpParam(field, ctx.usedMcpParams)
      allAttrs['mcp-param'] = paramName
    }

    // ── Build children HTML ────────────────────────────────────────────
    let childrenHtml = compileChildren(node, ctx)

    // If this is the submit button, use the label as text content
    if (isSubmit && elementType === 'button') {
      childrenHtml = escapeHtml(ctx.submitLabel)
    }

    // If this is the form container and the submit button IS the root,
    // append a submit button inside the form
    if (isFormContainer && ctx.submitNodeId === node.id) {
      const btnAttrs: Record<string, string> = {}
      btnAttrs.type = 'submit'
      if (classes.length > 0) btnAttrs.class = classes.join(' ')
      childrenHtml += `<button${serializeAttributes(btnAttrs)}>${escapeHtml(ctx.submitLabel)}</button>`
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
 * Compile an OpenPencil LayoutDefinition into a deterministic HTML string.
 *
 * - Recursively compiles nodes with cycle detection
 * - Sorts attributes in fixed order: class → hx-* → id → mcp-*
 * - Injects HTMX attributes for form containers
 * - Injects WebMCP tool/param/description attributes
 * - Maps OpenPencil layout properties to Tailwind classes
 *
 * @param layout - The validated layout definition
 * @returns Serialized HTML string
 * @throws {Error} If a cycle is detected or mcp-param collision occurs
 */
export function compileLayout(layout: LayoutDefinition): string {
  const fieldMap = new Map<string, FormField>()

  // Build field map — mcp-param validation happens at render time
  for (const field of layout.formFields || []) {
    fieldMap.set(field.nodeId, field)
  }

  // Validate mcp-param uniqueness across ALL fields upfront
  // (catches collisions even across different nodeIds before rendering)
  {
    const checkSet = new Set<string>()
    for (const field of layout.formFields || []) {
      const paramName = (field as any).mcpParam || toSnakeCase(field.label)
      if (checkSet.has(paramName)) {
        throw new Error(
          `Duplicate mcp-param value: "${paramName}" — ` +
          `both "${field.label}" and a previous field would produce this value`
        )
      }
      checkSet.add(paramName)
    }
  }

  // Build context
  const ctx: CompileContext = {
    visited: new Set<string>(),
    layout,
    fieldMap,
    usedMcpParams: new Set<string>(),
    submitNodeId: layout.submitButton?.nodeId ?? null,
    submitLabel: layout.submitButton?.label ?? 'Submit',
    resultNodeId: layout.resultDisplay?.nodeId ?? null,
  }

  // Compile the root node recursively
  return compileNode(layout.rootNode, ctx)
}

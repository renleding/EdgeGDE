/**
 * EdgeGDE Canvas — Lazy Migration
 * Phase 7: Convert legacy OpenPencil LayoutDefinition to CanvasDocument.
 *
 * Called when an existing tenant site is first opened in the Canvas editor.
 * One-time conversion — subsequent edits go through the Canvas pipeline.
 *
 * @packageDocumentation
 */

import type { CanvasDocument, Node, NodeType } from './canvas-types'

// ═══════════════════════════════════════════════════════════════════════════
// Minimal OpenPencil types (no dep on @edgegde/schema)
// ═══════════════════════════════════════════════════════════════════════════

interface OpenPencilNode {
  id: string
  name?: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  cornerRadius?: number
  opacity?: number
  fills?: Array<{ color?: { r?: number; g?: number; b?: number; a?: number }; visible?: boolean }>
  children?: OpenPencilNode[]
  props?: Record<string, any>
  text?: string
}

interface LayoutDefinition {
  rootNode: OpenPencilNode
  formFields?: Array<{ id: string; label: string; fieldType?: string; required?: boolean; placeholder?: string }>
  submitButton?: { id: string; label: string }
  resultNodeId?: string
  metadata?: Record<string, any>
}

// ═══════════════════════════════════════════════════════════════════════════
// Type Mapping
// ═══════════════════════════════════════════════════════════════════════════

const FIGMA_TO_CANVAS: Record<string, NodeType> = {
  FRAME: 'Frame',
  GROUP: 'Section',
  TEXT: 'Text',
  RECTANGLE: 'Frame',
  ELLIPSE: 'Frame',
  LINE: 'Frame',
  VECTOR: 'Frame',
  COMPONENT: 'Section',
  INSTANCE: 'Section',
}

// ═══════════════════════════════════════════════════════════════════════════
// Style Conversion
// ═══════════════════════════════════════════════════════════════════════════

function convertFills(fills?: OpenPencilNode['fills']): Record<string, string> {
  const style: Record<string, string> = {}
  if (!fills || !Array.isArray(fills) || fills.length === 0) return style

  const visibleFill = fills.find((f) => f?.visible !== false)
  if (!visibleFill) return style

  const c = visibleFill.color
  if (c && typeof c.r === 'number') {
    const r = Math.round(c.r * 255)
    const g = Math.round(c.g * 255)
    const b = Math.round(c.b * 255)
    const a = typeof c.a === 'number' ? c.a : 1
    style.backgroundColor = a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`
  }

  return style
}

function convertNodeStyles(opNode: OpenPencilNode): Record<string, any> {
  const style: Record<string, any> = {}

  // Dimensions (skip TEXT to avoid clipping)
  if (opNode.type !== 'TEXT') {
    if (opNode.width != null && opNode.width > 0) style.width = Math.round(opNode.width)
    if (opNode.height != null && opNode.height > 0) style.height = Math.round(opNode.height)
  }

  // Corner radius
  if (opNode.cornerRadius != null && opNode.cornerRadius > 0) {
    style.borderRadius = Math.round(opNode.cornerRadius)
  }

  // Opacity
  if (opNode.opacity != null && opNode.opacity < 1) {
    style.opacity = opNode.opacity
  }

  // Fills
  const fillStyles = convertFills(opNode.fills)
  Object.assign(style, fillStyles)

  // Text sizing
  if (opNode.type === 'TEXT') {
    style.display = 'inline-block'
    style.whiteSpace = 'nowrap'
    style.overflow = 'visible'
  }

  // Flex for containers
  if (opNode.type === 'FRAME' || opNode.type === 'GROUP') {
    style.display = 'flex'
    style.flexDirection = 'column'
  }

  return style
}

// ═══════════════════════════════════════════════════════════════════════════
// Text Extraction
// ═══════════════════════════════════════════════════════════════════════════

function getTextContent(opNode: OpenPencilNode): string {
  if (opNode.props?.content && typeof opNode.props.content === 'string') {
    return opNode.props.content
  }
  if (opNode.text && typeof opNode.text === 'string') {
    return opNode.text
  }
  return opNode.name || ''
}

// ═══════════════════════════════════════════════════════════════════════════
// Prefix Detection
// ═══════════════════════════════════════════════════════════════════════════

interface PrefixResult {
  nodeType: NodeType
  props: Record<string, any>
}

function detectPrefix(name: string): PrefixResult | null {
  if (!name) return null

  if (name.startsWith('Form:')) {
    return { nodeType: 'Frame', props: { mcpTool: `form_${name.slice(5).trim()}` } }
  }
  if (name.startsWith('Input:')) {
    const fieldName = name.slice(6).trim()
    return { nodeType: 'Input', props: { name: fieldName, type: 'text', placeholder: fieldName } }
  }
  if (name === 'Button:Submit') {
    return { nodeType: 'Button', props: { text: 'Submit' } }
  }
  if (name.startsWith('Container:Results')) {
    return { nodeType: 'Frame', props: { role: 'results' } }
  }
  if (name.startsWith('Data:')) {
    return { nodeType: 'Text', props: { dataKey: name.slice(5).trim(), text: '--' } }
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// Node ID counter
// ═══════════════════════════════════════════════════════════════════════════

let nodeCounter = 0
function nextId(): string {
  return `migrate-${++nodeCounter}`
}
function resetCounter(): void {
  nodeCounter = 0
}

// ═══════════════════════════════════════════════════════════════════════════
// Recursive Converter
// ═══════════════════════════════════════════════════════════════════════════

function convertOpenPencilNode(
  opNode: OpenPencilNode,
  parentId: string | null,
  nodes: Record<string, Node>,
): string {
  const prefix = detectPrefix(opNode.name || '')
  let nodeType: NodeType
  let props: Record<string, any> = {}
  let nodeId: string

  if (prefix) {
    nodeType = prefix.nodeType
    props = { ...prefix.props }
    nodeId = opNode.id || nextId()
  } else {
    nodeType = FIGMA_TO_CANVAS[opNode.type] || 'Frame'
    nodeId = opNode.id || nextId()
  }

  const style = convertNodeStyles(opNode)

  // Text content
  if (nodeType === 'Text' && !props.text) {
    props.text = getTextContent(opNode)
  }

  const node: Node = {
    id: nodeId,
    type: nodeType,
    parentId,
    children: [],
    props,
    style,
  }

  nodes[nodeId] = node

  // Convert children
  if (opNode.children && Array.isArray(opNode.children)) {
    for (const child of opNode.children) {
      if (child && typeof child === 'object') {
        const childId = convertOpenPencilNode(child, nodeId, nodes)
        node.children.push(childId)
      }
    }
  }

  return nodeId
}

// ═══════════════════════════════════════════════════════════════════════════
// Form Fields Conversion
// ═══════════════════════════════════════════════════════════════════════════

function convertFormFields(
  layout: LayoutDefinition,
  rootId: string,
  nodes: Record<string, Node>,
): void {
  if (!layout.formFields || layout.formFields.length === 0) return

  const formId = layout.rootNode.id || nextId()
  const formFrameId = `form-${formId}`

  nodes[formFrameId] = {
    id: formFrameId,
    type: 'Frame',
    parentId: rootId,
    children: [],
    props: { role: 'form', mcpTool: `form_${layout.metadata?.name || 'legacy'}` },
    style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px' },
  }
  nodes[rootId].children.push(formFrameId)

  for (const field of layout.formFields) {
    const inputId = field.id || nextId()
    const inputType = field.fieldType || 'text'
    nodes[inputId] = {
      id: inputId,
      type: 'Input',
      parentId: formFrameId,
      children: [],
      props: {
        name: field.id,
        label: field.label,
        type: inputType,
        placeholder: field.placeholder || field.label,
        required: field.required || false,
      },
      style: {},
    }
    nodes[formFrameId].children.push(inputId)
  }

  // Submit button
  if (layout.submitButton) {
    const btnId = layout.submitButton.id || nextId()
    nodes[btnId] = {
      id: btnId,
      type: 'Button',
      parentId: formFrameId,
      children: [],
      props: { text: layout.submitButton.label || 'Submit' },
      style: {
        backgroundColor: '#238636',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        padding: '10px 20px',
        cursor: 'pointer',
        fontSize: '14px',
      },
    }
    nodes[formFrameId].children.push(btnId)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a legacy OpenPencil LayoutDefinition to a CanvasDocument.
 *
 * @param layout - The legacy layout definition
 * @param canvasId - Optional canvas ID (generated if omitted)
 * @returns A new CanvasDocument
 */
export function openPencilToCanvas(
  layout: LayoutDefinition,
  canvasId?: string,
): CanvasDocument {
  resetCounter()

  const id = canvasId || `canvas-migrated-${Date.now()}`
  const nodes: Record<string, Node> = {}

  // Convert the OpenPencil node tree
  const rootId = convertOpenPencilNode(layout.rootNode, null, nodes)

  // Ensure root is type Page
  if (nodes[rootId]) {
    nodes[rootId].type = 'Page'
  }

  // Convert form fields
  convertFormFields(layout, rootId, nodes)

  const doc: CanvasDocument = {
    id,
    version: 0,
    baseNodes: JSON.parse(JSON.stringify(nodes)),
    nodes,
    rootId,
    history: [],
    stagingPointer: -1,
    livePointer: -1,
    metadata: {
      name: layout.metadata?.name || 'Migrated Layout',
      source: 'openpencil-migration',
      createdAt: Date.now(),
    },
  }

  return doc
}

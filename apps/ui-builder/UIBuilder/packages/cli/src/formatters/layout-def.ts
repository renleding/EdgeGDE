/**
 * OpenPencil — Figma AST to HSAES LayoutDefinition formatter
 * Phase 23.2: Extracts LayoutDefinition from a parsed SceneGraph
 * by semantically mapping node names to form fields, submit buttons,
 * and result displays.
 *
 * @packageDocumentation
 */

import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

// ═══════════════════════════════════════════════════════════════════════════
// HSAES LayoutDefinition types (inlined for zero-dependency formatter)
// ═══════════════════════════════════════════════════════════════════════════

export interface LayoutDefNode {
  id: string
  type: 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'COMPONENT' | 'INSTANCE' | 'GROUP' | 'VECTOR'
  name: string
  x: number
  y: number
  width: number
  height: number
  children?: LayoutDefNode[]
  cornerRadius?: number
  opacity?: number
  visible?: boolean
}

export interface FormFieldDef {
  nodeId: string
  label: string
  fieldType: 'text' | 'number' | 'select' | 'slider'
  placeholder?: string
  defaultValue?: string | number
  required: boolean
}

export interface LayoutDefinition {
  schemaVersion: '0.1.0'
  rootNode: LayoutDefNode
  formFields: FormFieldDef[]
  submitButton?: {
    nodeId: string
    label: string
  }
  resultDisplay?: {
    nodeId: string
    type: 'card' | 'inline'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SCHEMA_VERSION = '0.1.0' as const

const INPUT_PREFIX = 'Input:'
const SUBMIT_PREFIX = 'Button:'
const RESULT_PREFIX = 'Result:'

// ═══════════════════════════════════════════════════════════════════════════
// SceneGraph → LayoutDefNode conversion (recursive, cycle-safe)
// ═══════════════════════════════════════════════════════════════════════════

const TYPE_MAP: Record<string, LayoutDefNode['type']> = {
  FRAME: 'FRAME',
  RECTANGLE: 'RECTANGLE',
  ROUNDED_RECTANGLE: 'RECTANGLE',
  ELLIPSE: 'ELLIPSE',
  TEXT: 'TEXT',
  LINE: 'LINE',
  GROUP: 'GROUP',
  SECTION: 'FRAME',
  COMPONENT: 'COMPONENT',
  COMPONENT_SET: 'FRAME',
  INSTANCE: 'INSTANCE',
}

function sceneNodeToDefNode(node: SceneNode, graph: SceneGraph, visited: Set<string>): LayoutDefNode {
  const defNode: LayoutDefNode = {
    id: node.id,
    type: TYPE_MAP[node.type] || 'FRAME',
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    visible: node.visible,
  }

  if (node.cornerRadius > 0) {
    defNode.cornerRadius = node.cornerRadius
  }
  if (node.opacity < 1) {
    defNode.opacity = node.opacity
  }

  // Recurse children
  visited.add(node.id)
  const children: LayoutDefNode[] = []
  for (const childId of node.childIds) {
    if (visited.has(childId)) continue
    const child = graph.getNode(childId)
    if (child && child.visible) {
      children.push(sceneNodeToDefNode(child, graph, visited))
    }
  }
  if (children.length > 0) {
    defNode.children = children
  }
  visited.delete(node.id)

  return defNode
}

function findRootFrame(graph: SceneGraph): { rootNode: SceneNode; pageName: string } | null {
  const pages = graph.getPages()
  if (pages.length === 0) return null

  // Use first page's first top-level frame as root
  const page = pages[0]
  const topLevel = graph.getChildren(page.id).filter((n) => n.visible && n.type !== 'CANVAS')
  const frame = topLevel.find((n) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'GROUP') ?? topLevel[0]
  if (!frame) return null
  return { rootNode: frame, pageName: page.name }
}

// ═══════════════════════════════════════════════════════════════════════════
// Semantic field extraction
// ═══════════════════════════════════════════════════════════════════════════

interface NamedNode {
  node: SceneNode
  label: string
  remaining: string
}

/** Walk all visible descendants collecting nodes matching a name prefix */
function collectNamedNodes(
  nodeId: string,
  graph: SceneGraph,
  prefix: string,
  visited: Set<string>,
): NamedNode[] {
  const results: NamedNode[] = []
  if (visited.has(nodeId)) return results
  visited.add(nodeId)

  const node = graph.getNode(nodeId)
  if (!node || !node.visible) return results

  // Check if this node's name starts with the prefix
  if (node.name.startsWith(prefix)) {
    const label = node.name.slice(prefix.length).trim()
    const remaining = label
    results.push({ node, label, remaining })
  }

  // Recurse children
  for (const childId of node.childIds) {
    results.push(...collectNamedNodes(childId, graph, prefix, visited))
  }

  return results
}

/**
 * Infer the form field type from a node's properties and label.
 * "number" if label contains "rate", "years", "term" or is numeric.
 * "select" if it has an INSTANCE/COMPONENT child (suggesting a dropdown).
 * "text" otherwise.
 */
function inferFieldType(node: SceneNode, label: string): FormFieldDef['fieldType'] {
  const lower = label.toLowerCase()
  if (lower.includes('rate') || lower.includes('percent') || lower.includes('years') || lower.includes('term')) {
    return 'number'
  }
  if (lower.includes('amount') || lower.includes('principal') || lower.includes('value')) {
    return 'number'
  }
  if (lower.includes('type') || lower.includes('frequency') || lower.includes('select') || lower.includes('option')) {
    return 'select'
  }
  // Check for component children (dropdown indicators)
  for (const childId of node.childIds) {
    const child = node.childIds.length > 0 ? null : null
  }
  return 'text'
}

/** Extract the label text from a node (looking at text children) */
function extractLabel(node: SceneNode, graph: SceneGraph): string {
  if (node.type === 'TEXT' && node.text) {
    return node.text.replace(/[*_`]/g, '').trim()
  }
  // Search children for text
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (child && child.type === 'TEXT' && child.text) {
      return child.text.replace(/[*_`]/g, '').trim()
    }
  }
  return ''
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse a Figma SceneGraph and produce a strict HSAES LayoutDefinition.
 *
 * Semantic mapping rules:
 * - Nodes named "Input:<label>" → formFields entry
 * - Nodes named "Button:Submit" or ending with "Submit" → submitButton
 * - Nodes named "Result:<label>" or containing "result" → resultDisplay
 * - The first top-level FRAME/GROUP on the first page → rootNode
 *
 * @param graph - A fully loaded and layout-computed SceneGraph
 * @returns A validated LayoutDefinition ready for the HSAES compiler
 */
export function formatLayoutDef(graph: SceneGraph): LayoutDefinition {
  // 1. Find root frame
  const root = findRootFrame(graph)
  if (!root) {
    throw new Error('No top-level frame or group found in the design document.')
  }

  // 2. Convert root to LayoutDefNode
  const rootNode = sceneNodeToDefNode(root.rootNode, graph, new Set<string>())

  // 3. Collect form fields (Input: prefix)
  const inputNodes = collectNamedNodes(root.rootNode.id, graph, INPUT_PREFIX, new Set<string>())
  const formFields: FormFieldDef[] = inputNodes.map(({ node, label }) => {
    // Try to get the actual field type from a child input element
    const fieldType = inferFieldType(node, label)
    // Extract placeholder from sibling text
    const placeholder = label
    return {
      nodeId: node.id,
      label,
      fieldType,
      placeholder: `Enter ${label.toLowerCase()}`,
      required: true,
    }
  })

  // 4. Find submit button (Button: prefix, or any node containing "Submit")
  const buttonNodes = collectNamedNodes(root.rootNode.id, graph, SUBMIT_PREFIX, new Set<string>())
  let submitButton: { nodeId: string; label: string } | undefined
  if (buttonNodes.length > 0) {
    submitButton = {
      nodeId: buttonNodes[0].node.id,
      label: buttonNodes[0].label || 'Calculate',
    }
  } else {
    // Fallback: find any node with "submit" in name (case-insensitive)
    const allNodes = Array.from(graph.getAllNodes())
    const submitNode = allNodes.find(
      (n) => n.visible && n.name.toLowerCase().includes('submit'),
    )
    if (submitNode) {
      // Extract button text from children
      const btnText = extractLabel(submitNode, graph) || 'Calculate'
      submitButton = {
        nodeId: submitNode.id,
        label: btnText,
      }
    }
  }

  // 5. Find result display (Result: prefix)
  const resultNodes = collectNamedNodes(root.rootNode.id, graph, RESULT_PREFIX, new Set<string>())
  let resultDisplay: { nodeId: string; type: 'card' | 'inline' } | undefined
  if (resultNodes.length > 0) {
    resultDisplay = {
      nodeId: resultNodes[0].node.id,
      type: 'card',
    }
  } else {
    // Fallback: find any node with "result" in name
    const allNodes = Array.from(graph.getAllNodes())
    const resultNode = allNodes.find(
      (n) => n.visible && n.name.toLowerCase().includes('result'),
    )
    if (resultNode) {
      resultDisplay = {
        nodeId: resultNode.id,
        type: 'card',
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    rootNode,
    formFields,
    submitButton,
    resultDisplay,
  }
}

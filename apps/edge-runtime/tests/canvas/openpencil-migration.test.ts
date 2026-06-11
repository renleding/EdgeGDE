/**
 * EdgeGDE Canvas — OpenPencil Migration Tests
 * Phase 7: Lazy migration from legacy LayoutDefinition to CanvasDocument.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { openPencilToCanvas } from '../../src/canvas/openpencil-migration'
import { getTree } from '../../src/canvas/canvas-engine'

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e: any) {
    failed++
    console.error('  ✗ ' + name)
    console.error('    ' + e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeOpNode(overrides: any = {}): any {
  return {
    id: 'root',
    name: 'Root',
    type: 'FRAME',
    x: 0, y: 0, width: 1440, height: 900,
    children: [],
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

run('converts basic FRAME to CanvasDocument', () => {
  const layout = { rootNode: makeOpNode() }
  const doc = openPencilToCanvas(layout)

  assert.strictEqual(typeof doc.id, 'string')
  assert.strictEqual(doc.version, 0)
  assert.strictEqual(doc.nodes[doc.rootId].type, 'Page')
  assert.ok(doc.rootId in doc.nodes)
})

run('converts TEXT node with text content', () => {
  const layout = {
    rootNode: makeOpNode({
      id: 'root', type: 'FRAME',
      children: [
        { id: 't1', name: 'Title', type: 'TEXT', x: 0, y: 0, text: 'Hello World' },
      ],
    }),
  }
  const doc = openPencilToCanvas(layout)
  const texts = Object.values(doc.nodes).filter((n: any) => n.type === 'Text')
  assert.ok(texts.length >= 1)
  const hasText = texts.some((n: any) => n.props?.text === 'Hello World')
  assert.ok(hasText)
})

run('converts fills to backgroundColor', () => {
  const layout = {
    rootNode: makeOpNode({
      fills: [{ color: { r: 1, g: 0, b: 0 }, visible: true }],
    }),
  }
  const doc = openPencilToCanvas(layout)
  const root = doc.nodes[doc.rootId]
  assert.ok(root.style.backgroundColor)
})

run('maps Figma types to Canvas types', () => {
  const layout = {
    rootNode: makeOpNode({
      id: 'root', type: 'FRAME',
      children: [
        { id: 'g1', name: 'Group', type: 'GROUP', x: 0, y: 0 },
        { id: 'r1', name: 'Rect', type: 'RECTANGLE', x: 0, y: 0, width: 100, height: 50 },
      ],
    }),
  }
  const doc = openPencilToCanvas(layout)
  const groups = Object.values(doc.nodes).filter((n: any) => n.type === 'Section')
  assert.ok(groups.length >= 1)
  const frames = Object.values(doc.nodes).filter((n: any) => n.type === 'Frame')
  assert.ok(frames.length >= 1)
})

run('detects prefix-based node types', () => {
  const layout = {
    rootNode: makeOpNode({
      id: 'root', type: 'FRAME',
      children: [
        { id: 'f1', name: 'Form:contact', type: 'FRAME', x: 0, y: 0 },
        { id: 'i1', name: 'Input:email', type: 'TEXT', x: 0, y: 0 },
        { id: 'b1', name: 'Button:Submit', type: 'TEXT', x: 0, y: 0 },
      ],
    }),
  }
  const doc = openPencilToCanvas(layout)
  const inputs = Object.values(doc.nodes).filter((n: any) => n.type === 'Input')
  const buttons = Object.values(doc.nodes).filter((n: any) => n.type === 'Button')
  assert.ok(inputs.length >= 1, 'Should have Input nodes')
  assert.ok(buttons.length >= 1, 'Should have Button nodes')
})

run('converts formFields from layout definition', () => {
  const layout = {
    rootNode: makeOpNode(),
    formFields: [
      { id: 'name', label: 'Full Name', fieldType: 'text', required: true },
      { id: 'email', label: 'Email', fieldType: 'email' },
    ],
    submitButton: { id: 'submit', label: 'Send' },
    metadata: { name: 'Contact Form' },
  }
  const doc = openPencilToCanvas(layout)
  const inputs = Object.values(doc.nodes).filter((n: any) => n.type === 'Input')
  const buttons = Object.values(doc.nodes).filter((n: any) => n.type === 'Button')
  assert.strictEqual(inputs.length, 2, 'Should have 2 input fields')
  assert.strictEqual(buttons.length, 1, 'Should have submit button')
})

run('produces getTree-compatible output', () => {
  const layout = {
    rootNode: makeOpNode({
      id: 'root', type: 'FRAME',
      children: [
        { id: 's1', name: 'Section', type: 'GROUP', x: 0, y: 0, children: [
          { id: 't1', name: 'Text', type: 'TEXT', x: 0, y: 0, text: 'Nested' },
        ]},
      ],
    }),
  }
  const doc = openPencilToCanvas(layout)
  const tree = getTree(doc)
  assert.ok(tree !== null)
  assert.strictEqual((tree as any).type, 'Page')
})

run('maintains parent-child hierarchy', () => {
  const layout = {
    rootNode: makeOpNode({
      id: 'root', type: 'FRAME',
      children: [
        { id: 's1', name: 'Section 1', type: 'GROUP', x: 0, y: 0, children: [
          { id: 't1', name: 'Text 1', type: 'TEXT', x: 0, y: 0, text: 'A' },
          { id: 't2', name: 'Text 2', type: 'TEXT', x: 0, y: 0, text: 'B' },
        ]},
      ],
    }),
  }
  const doc = openPencilToCanvas(layout)
  const section = Object.values(doc.nodes).find((n: any) => n.id === 's1')!
  assert.strictEqual(section.parentId, 'root')
  assert.strictEqual(section.children.length, 2)
  assert.strictEqual(doc.nodes['t1'].parentId, 's1')
})

console.log('\nOpenPencil Migration: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)

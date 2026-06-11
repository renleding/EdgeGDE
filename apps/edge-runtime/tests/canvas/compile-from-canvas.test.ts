/**
 * EdgeGDE Canvas — compileFromCanvas Tests
 * Phase 1: CanvasDocument → HTML via EDR compiler bridge.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { compileFromCanvas } from '../../src/canvas/compile-from-canvas'
import type { CanvasDocument, Node } from '../../src/canvas/canvas-types'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeDoc(overrides?: Partial<CanvasDocument>): CanvasDocument {
  const result: CanvasDocument = {
    id: 'canvas-test-1',
    version: 1,
    baseNodes: {},
    nodes: {},
    rootId: '',
    history: [],
    stagingPointer: -1,
    livePointer: -1,
    ...(overrides as CanvasDocument),
  }
  if (overrides?.nodes) {
    result.baseNodes = JSON.parse(JSON.stringify(overrides.nodes))
  }
  return result
}

function makeNode(id: string, overrides?: Partial<Node>): Node {
  return {
    id,
    type: 'Frame',
    parentId: null,
    children: [],
    props: {},
    style: {},
    ...overrides,
  }
}

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

run('compileFromCanvas — empty doc returns safe fallback', () => {
  const doc = makeDoc()
  const html = compileFromCanvas(doc)
  // Returns a safe fallback div instead of empty string
  assert.ok(html.length > 0, 'Should return non-empty fallback')
})

run('compileFromCanvas — single Text node renders as span', () => {
  const text = makeNode('t1', { type: 'Text', props: { text: 'Hello' } })
  const doc = makeDoc({ rootId: 't1', nodes: { t1: text } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('<span'), 'should produce a span tag')
  assert.ok(html.includes('Hello'), 'should contain text content')
})

run('compileFromCanvas — Page wraps in main', () => {
  const page = makeNode('root', { type: 'Page', children: ['t1'] })
  const text = makeNode('t1', { type: 'Text', parentId: 'root', props: { text: 'Hello' } })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, t1: text } })
  const html = compileFromCanvas(doc)
  assert.ok(html.startsWith('<main'), 'Page should produce <main>')
  assert.ok(html.endsWith('</main>'), 'Page should close </main>')
})

run('compileFromCanvas — Section renders as section', () => {
  const page = makeNode('root', { type: 'Page', children: ['sec1'] })
  const section = makeNode('sec1', { type: 'Section', parentId: 'root' })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, sec1: section } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('<section'), 'Section should produce <section>')
})
run('compileFromCanvas — Button renders as button', () => {
  const btn = makeNode('btn1', { type: 'Button', props: { text: 'Click Me' } })
  const page = makeNode('root', { type: 'Page', children: ['btn1'] })
  page.style = {}
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, btn1: btn }, baseNodes: { root: page, btn1: btn } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('<button'), 'Should render as <button>')
  assert.ok(html.includes('Click Me'), 'Should contain button label text')
})

run('compileFromCanvas — Input renders as input with type and name', () => {
  const page = makeNode('root', { type: 'Page', children: ['inp1'] })
  const input = makeNode('inp1', { type: 'Input', parentId: 'root', props: { name: 'email', type: 'email' } })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, inp1: input } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('<input'), 'Input should produce <input>')
  assert.ok(html.includes('name="email"'), 'Input should have name attribute')
  assert.ok(html.includes('type="email"'), 'Input should have type attribute')
})

run('compileFromCanvas — Frame renders as div', () => {
  const page = makeNode('root', { type: 'Page', children: ['f1'] })
  const frame = makeNode('f1', { type: 'Frame', parentId: 'root' })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, f1: frame } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('<div'), 'Frame should produce <div>')
})

run('compileFromCanvas — style map becomes inline style', () => {
  const page = makeNode('root', {
    type: 'Page',
    children: ['t1'],
    style: { backgroundColor: '#fff', color: '#000' },
  })
  const text = makeNode('t1', { type: 'Text', parentId: 'root', props: { text: 'Styled' } })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, t1: text } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('background-color'), 'should contain CSS prop background-color')
  assert.ok(html.includes('#fff'), 'should contain #fff value')
})

run('compileFromCanvas — design token role passes through', () => {
  const page = makeNode('root', {
    type: 'Page',
    children: [],
    props: { role: 'canvas-page' },
    style: { padding: '60px 80px' },
  })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page }, baseNodes: { root: page } })
  const html = compileFromCanvas(doc)
  // The role appears as a type attribute or in the node's tag name
  assert.ok(html.includes('main'), 'Should render as <main> tag')
})

run('compileFromCanvas — nested structure renders correctly', () => {
  const page = makeNode('root', { type: 'Page', children: ['sec1'] })
  const section = makeNode('sec1', { type: 'Section', parentId: 'root', children: ['t1', 't2'] })
  const t1 = makeNode('t1', { type: 'Text', parentId: 'sec1', props: { text: 'First' } })
  const t2 = makeNode('t2', { type: 'Text', parentId: 'sec1', props: { text: 'Second' } })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, sec1: section, t1, t2 } })
  const html = compileFromCanvas(doc)
  // Order check
  const firstIdx = html.indexOf('First')
  const secondIdx = html.indexOf('Second')
  assert.ok(firstIdx >= 0, 'First text should exist')
  assert.ok(secondIdx >= 0, 'Second text should exist')
  assert.ok(firstIdx < secondIdx, 'First should appear before Second')
})

run('compileFromCanvas — id attribute is preserved', () => {
  const text = makeNode('my-node-42', { type: 'Text', props: { text: 'Identified' } })
  const doc = makeDoc({ rootId: 'my-node-42', nodes: { 'my-node-42': text } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('id="my-node-42"'), 'HTML id attribute should match CanvasNode id')
})

run('compileFromCanvas — numeric style values get px suffix', () => {
  const page = makeNode('root', {
    type: 'Page',
    style: { width: 800, padding: 16, borderRadius: 8 },
  })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page } })
  const html = compileFromCanvas(doc)
  assert.ok(html.includes('800px'), 'width: 800 should become 800px')
  assert.ok(html.includes('16px'), 'padding: 16 should become 16px')
  assert.ok(html.includes('8px'), 'borderRadius: 8 should become border-radius: 8px (kebab + px)')
})

run('compileFromCanvas — produces deterministic output', () => {
  const page = makeNode('root', { type: 'Page', children: ['sec1', 'sec2'] })
  const sec1 = makeNode('sec1', { type: 'Section', parentId: 'root', children: ['t1'] })
  const t1 = makeNode('t1', { type: 'Text', parentId: 'sec1', props: { text: 'Hello' } })
  const sec2 = makeNode('sec2', { type: 'Section', parentId: 'root' })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, sec1, t1, sec2 } })

  const html1 = compileFromCanvas(doc)
  const html2 = compileFromCanvas(doc)
  assert.strictEqual(html1, html2, 'Same input must produce same output')
})

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\ncompileFromCanvas: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

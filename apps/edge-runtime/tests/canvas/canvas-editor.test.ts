/**
 * EdgeGDE Canvas — Canvas Editor Route Tests
 * Phase 3: Editor page serving and interaction logic.
 *
 * Tests the route handler and HTML page generation.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { renderEditorPage, renderCanvasLanding } from '../../src/routes/canvas-editor'
import type { CanvasDocument, Node } from '../../src/canvas/canvas-types'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeNode(id: string, overrides?: Partial<Node>): Node {
  return { id, type: 'Frame', parentId: null, children: [], props: {}, style: {}, ...overrides }
}

function makeDoc(overrides?: Partial<CanvasDocument>): CanvasDocument {
  const result: CanvasDocument = {
    id: 'canvas-test-1',
    version: 0,
    baseNodes: {},
    nodes: {},
    rootId: '',
    history: [],
    stagingPointer: -1,
    livePointer: -1,
  }
  if (overrides) Object.assign(result, overrides)
  if (overrides?.nodes) {
    result.baseNodes = JSON.parse(JSON.stringify(overrides.nodes))
  }
  return result
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
// TESTS: renderEditorPage
// ═══════════════════════════════════════════════════════════════════════════

run('renderEditorPage — returns HTML with correct structure', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  const html = renderEditorPage(doc, 'canvas-test-1')

  assert.ok(html.includes('<!DOCTYPE html>'), 'Should be an HTML document')
  assert.ok(html.includes('id="canvas-root"'), 'Should contain canvas-root div')
  assert.ok(html.includes('<main'), 'Should contain compiled HTML')
  assert.ok(html.includes('id="editor-overlay"'), 'Should contain editor overlay div')
  assert.ok(html.includes('<script>'), 'Should contain inline editor script')
  assert.ok(html.includes('data-canvas-id="canvas-test-1"'), 'Should embed canvas ID')
})

run('renderEditorPage — includes compiled canvas HTML', () => {
  const text = makeNode('t1', { type: 'Text', props: { text: 'Hello Editor' } })
  const doc = makeDoc({ rootId: 't1', nodes: { t1: text } })
  const html = renderEditorPage(doc, 'canvas-1')

  assert.ok(html.includes('Hello Editor'), 'Compiled text should appear in page')
  assert.ok(html.includes('data-version="0"'), 'Should embed current version')
})

run('renderEditorPage — includes WebSocket endpoint', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root') } })
  const html = renderEditorPage(doc, 'canvas-42')

  assert.ok(html.includes('data-canvas-id=\"canvas-42\"'), 'Should reference canvas ID')
  assert.ok(html.includes('ws-client.js'), 'Should include WS client module')
  assert.ok(html.includes('editor-config'), 'Should include config script')
})

run('renderEditorPage — includes mutation interceptors', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root') } })
  const html = renderEditorPage(doc, 'canvas-1')

  assert.ok(html.includes('interactions.js'), 'Should include interactions module')
  assert.ok(html.includes('mcp-runtime.js'), 'Should include MCP runtime module')
})

run('renderEditorPage — includes ID-based node binding', () => {
  const page = makeNode('page1', { type: 'Page' })
  const doc = makeDoc({ rootId: 'page1', nodes: { page1: page } })
  const html = renderEditorPage(doc, 'canvas-1')

  assert.ok(html.includes('page1'), 'Node ID should appear in compiled HTML')
})

run('renderEditorPage — handles empty doc gracefully', () => {
  const doc = makeDoc()
  const html = renderEditorPage(doc, 'test-id')
  assert.ok(html.length > 0, 'Should produce some HTML')
  assert.ok(html.includes('canvas-root'), 'Should include canvas container')
})

run('renderEditorPage — includes modular script tags', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root') } })
  const html = renderEditorPage(doc, 'canvas-1')

  assert.ok(html.includes('event-bus.js'), 'Should include EventBus')
  assert.ok(html.includes('editor-state.js'), 'Should include EditorState')
  assert.ok(html.includes('nodes.js'), 'Should include nodes module')
  assert.ok(html.includes('main.js'), 'Should include main bootstrap')
})

run('renderEditorPage — nested nodes render in order', () => {
  const page = makeNode('root', { type: 'Page', children: ['s1', 's2'] })
  const s1 = makeNode('s1', { type: 'Section', parentId: 'root', children: ['t1'] })
  const t1 = makeNode('t1', { type: 'Text', parentId: 's1', props: { text: 'First' } })
  const s2 = makeNode('s2', { type: 'Section', parentId: 'root' })
  const doc = makeDoc({ rootId: 'root', nodes: { root: page, s1, t1, s2 } })
  const html = renderEditorPage(doc, 'canvas-1')

  const firstIdx = html.indexOf('First')
  const rootMain = html.indexOf('<main')
  assert.ok(firstIdx > rootMain, 'First should appear inside main')
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: renderCanvasLanding
// ═══════════════════════════════════════════════════════════════════════════

run('renderCanvasLanding — shows clone, generate, and empty options', () => {
  const html = renderCanvasLanding()

  assert.ok(html.includes('Clone Website'), 'Should have clone option')
  assert.ok(html.includes('Generate from Prompt'), 'Should have generate option')
  assert.ok(html.includes('Start Empty'), 'Should have empty canvas option')
  assert.ok(html.includes('Canvas Platform v1.0.0'), 'Should show version')
  assert.ok(html.includes('createEmpty'), 'Should have create empty function')
  assert.ok(html.includes('cloneWebsite'), 'Should have clone function')
  assert.ok(html.includes('generateWebsite'), 'Should have generate function')
})

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\nCanvas Editor Route: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

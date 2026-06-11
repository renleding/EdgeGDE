/**
 * EdgeGDE Canvas — Layout Generator Tests
 * Phase 5: LLM prompt -> CanvasDocument generation.
 *
 * Tests use a mock LLM provider to avoid API dependencies.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import type { CanvasDocument, Node, NodeType } from '../../src/canvas/canvas-types'
import { generateCanvas } from '../../src/generator/layout-generator'
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

// ── Mock LLM provider for testing ──────────────────────────────────

function mockLLM(prompt: string): Promise<any> {
  const lower = prompt.toLowerCase()
  const rawNodes: Array<{
    id: string; type: NodeType; parentId: string | null
    props: Record<string, any>; style: Record<string, any>
  }> = []
  const nodes: Record<string, Node> = {}
  const children: string[] = []
  let idCounter = 1
  const id = () => 'gen-' + (idCounter++)

  function addNode(n: {
    id: string; type: NodeType; parentId: string | null
    props: Record<string, any>; style: Record<string, any>
  }) {
    nodes[n.id] = { id: n.id, type: n.type, parentId: n.parentId, children: [], props: n.props || {}, style: n.style || {} }
    rawNodes.push(n)
  }

  const rootId = id()
  addNode({ id: rootId, type: 'Page', parentId: null, props: {}, style: {} })

  if (lower.includes('hero') || lower.includes('landing')) {
    const secId = id()
    const tId = id()
    const sId = id()
    addNode({ id: secId, type: 'Section', parentId: rootId, props: {}, style: { backgroundColor: '#1c2128', padding: '60px' } })
    addNode({ id: tId, type: 'Text', parentId: secId, props: { text: 'Welcome' }, style: { fontSize: '36px', fontWeight: '700' } })
    addNode({ id: sId, type: 'Text', parentId: secId, props: { text: 'Built with EdgeGDE Canvas' }, style: { fontSize: '18px' } })
    children.push(secId)
  }

  if (lower.includes('feature') || lower.includes('service')) {
    const secId = id()
    for (let i = 1; i <= 3; i++) {
      const fId = id()
      addNode({ id: fId, type: 'Section', parentId: secId, props: { text: 'Feature ' + i }, style: { padding: '20px' } })
    }
    addNode({ id: secId, type: 'Section', parentId: rootId, props: {}, style: { padding: '40px', display: 'flex' } })
    children.push(secId)
  }

  if (lower.includes('contact') || lower.includes('form')) {
    const fId = id()
    addNode({ id: fId, type: 'Frame', parentId: rootId, props: {}, style: { padding: '20px' } })
    addNode({ id: id(), type: 'Input', parentId: fId, props: { name: 'name', type: 'text', placeholder: 'Your Name' }, style: {} })
    addNode({ id: id(), type: 'Input', parentId: fId, props: { name: 'email', type: 'email', placeholder: 'Your Email' }, style: {} })
    addNode({ id: id(), type: 'Button', parentId: fId, props: { text: 'Submit' }, style: { backgroundColor: '#238636' } })
    children.push(fId)
  }

  if (lower.includes('footer')) {
    const fId = id()
    addNode({ id: fId, type: 'Section', parentId: rootId, props: { text: '\u00a9 2026' }, style: { padding: '20px', textAlign: 'center' } })
    children.push(fId)
  }

  if (lower.includes('paragraph') || lower.includes('text') || lower.includes('content')) {
    const tId = id()
    addNode({ id: tId, type: 'Text', parentId: rootId, props: { text: 'Generated content.' }, style: { fontSize: '16px' } })
    children.push(tId)
  }

  if (nodes[rootId]) nodes[rootId].children = children

  const title = prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt

  return Promise.resolve({ rootId, nodes: rawNodes, title })
}

// ── Tests ───────────────────────────────────────────────────────────

run('generate - produces a CanvasDocument with correct structure', async () => {
  const doc = await generateCanvas('A simple page', { llmProvider: mockLLM })
  assert.strictEqual(typeof doc.id, 'string')
  assert.strictEqual(doc.version, 0)
  assert.strictEqual(doc.stagingPointer, -1)
  assert.ok(doc.rootId in doc.nodes)
  assert.strictEqual(doc.nodes[doc.rootId].type, 'Page')
})

run('generate - creates hero section for landing page prompts', async () => {
  const doc = await generateCanvas('A landing page with hero', { llmProvider: mockLLM })
  const texts = findAllText(doc)
  assert.ok(texts.includes('Welcome'))
})

run('generate - creates features section', async () => {
  const doc = await generateCanvas('A services page with features', { llmProvider: mockLLM })
  const texts = findAllText(doc)
  assert.ok(texts.some((t: string) => t.startsWith('Feature')))
})

run('generate - creates contact form', async () => {
  const doc = await generateCanvas('A contact page with form', { llmProvider: mockLLM })
  const inputs = findNodesByType(doc, 'Input')
  const buttons = findNodesByType(doc, 'Button')
  assert.ok(inputs.length >= 1)
  assert.ok(buttons.length >= 1)
})

run('generate - creates footer', async () => {
  const doc = await generateCanvas('A complete site with footer', { llmProvider: mockLLM })
  const texts = findAllText(doc)
  assert.ok(texts.some((t: string) => t.includes('\u00a9')))
})

run('generate - produces getTree-compatible output', async () => {
  const doc = await generateCanvas('A landing page', { llmProvider: mockLLM })
  const tree = getTree(doc)
  assert.ok(tree !== null)
  assert.strictEqual((tree as any).type, 'Page')
  assert.ok((tree as any).children.length > 0)
})

run('generate - nodes have valid parent-child consistency', async () => {
  const doc = await generateCanvas('A page with sections', { llmProvider: mockLLM })
  for (const nodeId in doc.nodes) {
    const node = doc.nodes[nodeId]
    if (node.parentId) {
      const parent = doc.nodes[node.parentId]
      assert.ok(parent !== undefined)
      assert.ok(parent.children.includes(nodeId))
    }
  }
})

// ── Helpers ─────────────────────────────────────────────────────────

function findAllText(doc: CanvasDocument): string[] {
  const texts: string[] = []
  for (const nodeId in doc.nodes) {
    const n = doc.nodes[nodeId]
    if (n.props && n.props.text) texts.push(n.props.text)
  }
  return texts
}

function findNodesByType(doc: CanvasDocument, type: string): any[] {
  const result: any[] = []
  for (const nodeId in doc.nodes) {
    if (doc.nodes[nodeId].type === type) result.push(doc.nodes[nodeId])
  }
  return result
}

console.log('\nLayout Generator: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)

/**
 * EdgeGDE Canvas — Website Cloner Tests
 * Phase 4: DOM → CanvasDocument conversion.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { cloneWebsite } from '../../src/cloner/website-cloner'
import type { CanvasDocument } from '../../src/canvas/canvas-types'

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

run('cloneWebsite — creates a CanvasDocument with correct structure', () => {
  const html = '<html><body><main><h1>Hello</h1><p>World</p></main></body></html>'
  const doc = cloneWebsite('https://example.com', html)

  assert.strictEqual(typeof doc.id, 'string', 'Should have an id')
  assert.ok(doc.id.length > 0, 'id should not be empty')
  assert.strictEqual(doc.version, 0, 'Should start at version 0')
  assert.strictEqual(doc.stagingPointer, -1, 'Should start at stagingPointer -1')
  assert.strictEqual(doc.livePointer, -1, 'Should start at livePointer -1')
  assert.ok(doc.rootId in doc.nodes, 'root node should exist')
  assert.ok(doc.nodes[doc.rootId].type === 'Page', 'Root should be a Page')
})

run('cloneWebsite — extracts text from headings and paragraphs', () => {
  const html = '<html><body><h1>Title</h1><h2>Subtitle</h2><p>Paragraph text</p></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  const allText = findAllText(doc)

  assert.ok(allText.includes('Title'), 'Should extract h1 text')
  assert.ok(allText.includes('Subtitle'), 'Should extract h2 text')
  assert.ok(allText.includes('Paragraph text'), 'Should extract paragraph text')
})

run('cloneWebsite — extracts images as hotlinks', () => {
  const html = '<html><body><img src="https://example.com/photo.jpg" alt="A photo"></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  const imgs = findNodesByType(doc, 'Frame')

  // Images become Frame nodes with src in props
  let foundImg = false
  for (const nodeId in doc.nodes) {
    const n = doc.nodes[nodeId]
    if (n.props && n.props.src === 'https://example.com/photo.jpg') {
      foundImg = true
      break
    }
  }
  assert.ok(foundImg, 'Should extract image src')
})

run('cloneWebsite — extracts inline styles', () => {
  const html = '<html><body><div style="color:red;font-size:18px">Styled</div></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  let foundStyle = false
  for (const nodeId in doc.nodes) {
    const n = doc.nodes[nodeId]
    if (n.style && n.style.color === 'red') {
      foundStyle = true
      break
    }
  }
  assert.ok(foundStyle, 'Should extract inline style')
})

run('cloneWebsite — preserves nesting hierarchy', () => {
  const html = '<html><body><main><section><p>Nested</p></section></main></body></html>'
  const doc = cloneWebsite('https://example.com', html)

  // Walk from root and verify nesting depth
  const root = doc.nodes[doc.rootId]
  assert.ok(root, 'Root node exists')
  assert.strictEqual(root.type, 'Page')

  // Should have at least 3 levels of nesting from root
  function depth(id: string, current: number): number {
    const node = doc.nodes[id]
    if (!node.children.length) return current
    return Math.max(...node.children.map((c: string) => depth(c, current + 1)))
  }
  const maxDepth = depth(doc.rootId, 1)
  assert.ok(maxDepth >= 3, `Should have at least 3 levels of nesting, got ${maxDepth}`)
})

run('cloneWebsite — handles empty body gracefully', () => {
  const html = '<html><head><title>Empty</title></head><body></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  assert.ok(doc.nodes[doc.rootId] !== undefined, 'Should still have a root node')
})

run('cloneWebsite — extracts title from head', () => {
  const html = '<html><head><title>My Page</title></head><body><p>Content</p></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  const meta = doc.metadata
  assert.strictEqual(meta?.name, 'My Page', 'Should extract page title as name')
})

run('cloneWebsite — extracts links', () => {
  const html = '<html><body><a href="/about">About Us</a></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  let foundLink = false
  for (const nodeId in doc.nodes) {
    const n = doc.nodes[nodeId]
    if (n.props && n.props.href) {
      foundLink = true
      break
    }
  }
  assert.ok(foundLink, 'Should extract link href')
})

run('cloneWebsite — extracts forms and inputs', () => {
  const html = '<html><body><form><input type="text" name="email" placeholder="Email"><button>Submit</button></form></body></html>'
  const doc = cloneWebsite('https://example.com', html)
  const inputs = findNodesByType(doc, 'Input')
  const buttons = findNodesByType(doc, 'Button')
  assert.ok(inputs.length >= 1, 'Should extract input elements')
  assert.ok(buttons.length >= 1, 'Should extract button elements')
})

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

function findAllText(doc: CanvasDocument): string[] {
  const texts: string[] = []
  for (const nodeId in doc.nodes) {
    const n = doc.nodes[nodeId]
    if (n.type === 'Text' && n.props.text) {
      texts.push(n.props.text)
    }
    if (n.type === 'Button' && n.props.text) {
      texts.push(n.props.text)
    }
  }
  return texts
}

function findNodesByType(doc: CanvasDocument, type: string): any[] {
  const result: any[] = []
  for (const nodeId in doc.nodes) {
    if (doc.nodes[nodeId].type === type) {
      result.push(doc.nodes[nodeId])
    }
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\nWebsite Cloner: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

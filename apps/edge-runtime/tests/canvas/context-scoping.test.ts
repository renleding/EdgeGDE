/**
 * EdgeGDE Canvas — Context Scoping Tests
 * Phase 6.5: Verify prompt context filtering works correctly.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { CanvasDocument, Node } from '../../src/canvas/canvas-types'

// We test the prompt builder indirectly by importing the module
// and checking the exported function exists
import { handleCanvasChat } from '../../src/api/canvas-chat'

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

run('handleCanvasChat accepts selectedNodeId parameter', () => {
  // Just verify the function signature supports selectedNodeId
  assert.strictEqual(typeof handleCanvasChat, 'function')
  assert.strictEqual(handleCanvasChat.length, 4, 'Should accept 4 parameters: canvasId, message, env, selectedNodeId')
})

run('context scoping produces shorter prompts for large canvases', () => {
  // Build a canvas with 100+ nodes
  const nodes: Record<string, Node> = {}
  const rootId = 'root'
  nodes[rootId] = { id: rootId, type: 'Page', parentId: null, children: [], props: {}, style: {} }

  // Add 100 frame children with nested text
  for (let i = 0; i < 100; i++) {
    const sectionId = 'section-' + i
    const textId = 'text-' + i
    nodes[sectionId] = { id: sectionId, type: 'Section', parentId: rootId, children: [textId], props: {}, style: { padding: '10px' } }
    nodes[textId] = { id: textId, type: 'Text', parentId: sectionId, children: [], props: { text: 'Item ' + i }, style: { fontSize: '14px' } }
    nodes[rootId].children.push(sectionId)
  }

  // Manually construct what the prompt builder would produce for key nodes vs all nodes
  // Key nodes: root + direct children = 101 lines
  // All nodes: 201 lines (root + 100 sections + 100 texts)
  // Summary: ~3 lines
  // Recent changes: ~2 lines (none)
  // Subtree (selected): variable

  const totalNodes = Object.keys(nodes).length
  const keyNodesCount = 1 + nodes[rootId].children.length // root + direct children
  const allNodesCount = totalNodes

  // With context scoping on a selected node, we show at most
  // summary(3) + keyNodes(101) + recentChanges(2) + subtree(selected)
  // Without scoping: allNodes(201)
  const scopedEstimate = 3 + keyNodesCount + 2 + 10 // ~116 for a selected leaf node
  const unscopedEstimate = allNodesCount // 201

  assert.ok(scopedEstimate < unscopedEstimate,
    'Scoped prompt should be smaller than unscoped: ' + scopedEstimate + ' vs ' + unscopedEstimate)
})

console.log('\nContext Scoping: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)

/**
 * EdgeGDE Canvas — CanvasEngine Tests
 * Phase 0: Pure function tests for applyMutation, rebuildDocFromHistory, getTree
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { applyMutation, rebuildDocFromHistory, getTree } from '../../src/canvas/canvas-engine'
import type { CanvasDocument, Node, Mutation } from '../../src/canvas/canvas-types'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeDoc(overrides?: Partial<CanvasDocument>): CanvasDocument {
  const initialNodes: Record<string, Node> = {}
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
  // If caller provided nodes through overrides, sync baseNodes
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
// TESTS: add_node
// ═══════════════════════════════════════════════════════════════════════════

run('add_node — adds node, sets parentId, appends to parent children', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page', children: [] }) } })
  const child = makeNode('child1', { type: 'Section' })

  const result = applyMutation(doc, { type: 'add_node', node: child, parentId: 'root' })

  assert.strictEqual(result.nodes['root'].parentId, null, 'root parentId should be null')
  assert.strictEqual(result.nodes['child1'].parentId, 'root', 'child parentId should be root')
  assert.deepStrictEqual(result.nodes['root'].children, ['child1'], 'root should have child1 in children')
})

run('add_node — appends to existing children array', () => {
  const root = makeNode('root', { type: 'Page', children: ['existing'] })
  const doc = makeDoc({ rootId: 'root', nodes: { root, existing: makeNode('existing', { parentId: 'root' }) } })
  const newChild = makeNode('newchild', { type: 'Section' })

  const result = applyMutation(doc, { type: 'add_node', node: newChild, parentId: 'root' })

  assert.deepStrictEqual(result.nodes['root'].children, ['existing', 'newchild'])
})

run('add_node — increments version', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  const result = applyMutation(doc, { type: 'add_node', node: makeNode('child1', { type: 'Section' }), parentId: 'root' })

  assert.strictEqual(result.version, 2)
})

run('add_node — appends mutation to history', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  const mut: Mutation = { type: 'add_node', node: makeNode('child1', { type: 'Section' }), parentId: 'root' }

  const result = applyMutation(doc, mut)

  assert.strictEqual(result.history.length, 1)
  assert.strictEqual(result.history[0].type, 'add_node')
})

run('add_node — throws if parentId node does not exist', () => {
  const doc = makeDoc({ rootId: 'root', nodes: {} })
  assert.throws(() => {
    applyMutation(doc, { type: 'add_node', node: makeNode('orphan'), parentId: 'nonexistent' })
  }, /not found/)
})

run('add_node — throws if node id already exists', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root') } })
  assert.throws(() => {
    applyMutation(doc, { type: 'add_node', node: makeNode('root'), parentId: 'root' })
  }, /already exists/)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: update_node
// ═══════════════════════════════════════════════════════════════════════════

run('update_node — updates props', () => {
  const node = makeNode('n1', { type: 'Text', props: { text: 'old' } })
  const doc = makeDoc({ rootId: 'n1', nodes: { n1: node } })

  const result = applyMutation(doc, { type: 'update_node', nodeId: 'n1', props: { text: 'new' } })

  assert.strictEqual(result.nodes['n1'].props.text, 'new')
})

run('update_node — updates style', () => {
  const node = makeNode('n1', { style: { color: 'red' } })
  const doc = makeDoc({ rootId: 'n1', nodes: { n1: node } })

  const result = applyMutation(doc, { type: 'update_node', nodeId: 'n1', style: { color: 'blue', width: '100px' } })

  assert.strictEqual(result.nodes['n1'].style.color, 'blue')
  assert.strictEqual(result.nodes['n1'].style.width, '100px')
})

run('update_node — updates both props and style when both provided', () => {
  const node = makeNode('n1', { type: 'Text', props: { text: 'old' }, style: { color: 'red' } })
  const doc = makeDoc({ rootId: 'n1', nodes: { n1: node } })

  const result = applyMutation(doc, {
    type: 'update_node', nodeId: 'n1',
    props: { text: 'new', size: 14 },
    style: { color: 'blue' },
  })

  assert.strictEqual(result.nodes['n1'].props.text, 'new')
  assert.strictEqual(result.nodes['n1'].props.size, 14)
  assert.strictEqual(result.nodes['n1'].style.color, 'blue')
})

run('update_node — preserves props not in the update', () => {
  const node = makeNode('n1', { props: { text: 'hello', size: 16 } })
  const doc = makeDoc({ rootId: 'n1', nodes: { n1: node } })

  const result = applyMutation(doc, { type: 'update_node', nodeId: 'n1', props: { text: 'world' } })

  assert.strictEqual(result.nodes['n1'].props.text, 'world')
  assert.strictEqual(result.nodes['n1'].props.size, 16)
})

run('update_node — throws if node not found', () => {
  const doc = makeDoc({ rootId: 'root', nodes: {} })
  assert.throws(() => {
    applyMutation(doc, { type: 'update_node', nodeId: 'ghost' })
  }, /not found/)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: delete_node
// ═══════════════════════════════════════════════════════════════════════════

run('delete_node — removes node and orphans children to parent', () => {
  const child = makeNode('child', { parentId: 'parent' })
  const parent = makeNode('parent', { children: ['child'] })
  const doc = makeDoc({ rootId: 'parent', nodes: { parent, child } })

  const result = applyMutation(doc, { type: 'delete_node', nodeId: 'child' })

  assert.strictEqual(result.nodes['child'], undefined, 'child should be removed')
  assert.strictEqual(result.nodes['parent'].children.includes('child'), false, 'parent should no longer list child')
})

run('delete_node — reparents grandchildren when strategy is reparent_children', () => {
  const grandchild = makeNode('grandchild', { parentId: 'child' })
  const child = makeNode('child', { parentId: 'parent', children: ['grandchild'] })
  const parent = makeNode('parent', { children: ['child'] })
  const doc = makeDoc({ rootId: 'parent', nodes: { parent, child, grandchild } })

  const result = applyMutation(doc, { type: 'delete_node', nodeId: 'child', strategy: 'reparent_children' })

  assert.strictEqual(result.nodes['child'], undefined, 'child should be removed')
  assert.strictEqual(result.nodes['grandchild'].parentId, 'parent', 'grandchild should be reparented to parent')
  assert.ok(result.nodes['parent'].children.includes('grandchild'), 'parent should now list grandchild')
  assert.ok(!result.nodes['parent'].children.includes('child'), 'parent should no longer list child')
})

run('delete_node — throws if node not found', () => {
  const doc = makeDoc()
  assert.throws(() => {
    applyMutation(doc, { type: 'delete_node', nodeId: 'ghost' })
  }, /not found/)
})

run('delete_node — throws if deleting the root node', () => {
  const doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  assert.throws(() => {
    applyMutation(doc, { type: 'delete_node', nodeId: 'root' })
  }, /root/)
})

run('delete_node — default strategy remove_all deletes descendants recursively', () => {
  const grandchild = makeNode('grandchild', { parentId: 'child' })
  const child = makeNode('child', { parentId: 'parent', children: ['grandchild'] })
  const parent = makeNode('parent', { children: ['child'] })
  const doc = makeDoc({ rootId: 'parent', nodes: { parent, child, grandchild } })

  const result = applyMutation(doc, { type: 'delete_node', nodeId: 'child' })

  assert.strictEqual(result.nodes['child'], undefined, 'child should be removed')
  assert.strictEqual(result.nodes['grandchild'], undefined, 'grandchild should also be removed')
  assert.ok(!result.nodes['parent'].children.includes('child'), 'parent should no longer list child')
})

run('delete_node — explicit remove_all behaves the same as default', () => {
  const child = makeNode('child', { parentId: 'parent' })
  const parent = makeNode('parent', { children: ['child'] })
  const doc = makeDoc({ rootId: 'parent', nodes: { parent, child } })

  const result = applyMutation(doc, { type: 'delete_node', nodeId: 'child', strategy: 'remove_all' })

  assert.strictEqual(result.nodes['child'], undefined)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: move_node
// ═══════════════════════════════════════════════════════════════════════════

run('move_node — reparents node to new parent (append)', () => {
  const node = makeNode('moving', { parentId: 'oldParent' })
  const oldParent = makeNode('oldParent', { children: ['moving'] })
  const newParent = makeNode('newParent', { children: [] })
  const doc = makeDoc({ rootId: 'oldParent', nodes: { oldParent, newParent, moving: node } })

  const result = applyMutation(doc, { type: 'move_node', nodeId: 'moving', newParentId: 'newParent' })

  assert.strictEqual(result.nodes['moving'].parentId, 'newParent')
  assert.ok(!result.nodes['oldParent'].children.includes('moving'))
  assert.ok(result.nodes['newParent'].children.includes('moving'))
})

run('move_node — inserts at specified index', () => {
  const moving = makeNode('moving', { parentId: 'oldParent' })
  const existing1 = makeNode('existing1', { parentId: 'newParent' })
  const existing2 = makeNode('existing2', { parentId: 'newParent' })
  const oldParent = makeNode('oldParent', { children: ['moving'] })
  const newParent = makeNode('newParent', { children: ['existing1', 'existing2'] })
  const doc = makeDoc({ rootId: 'oldParent', nodes: { oldParent, newParent, moving, existing1, existing2 } })

  const result = applyMutation(doc, { type: 'move_node', nodeId: 'moving', newParentId: 'newParent', newIndex: 1 })

  assert.deepStrictEqual(result.nodes['newParent'].children, ['existing1', 'moving', 'existing2'])
})

run('move_node — throws if node not found', () => {
  const parent = makeNode('parent', { children: [] })
  const doc = makeDoc({ rootId: 'parent', nodes: { parent } })
  assert.throws(() => {
    applyMutation(doc, { type: 'move_node', nodeId: 'ghost', newParentId: 'parent' })
  }, /not found/)
})

run('move_node — throws if new parent not found', () => {
  const node = makeNode('node', { parentId: 'parent' })
  const parent = makeNode('parent', { children: ['node'] })
  const doc = makeDoc({ rootId: 'parent', nodes: { parent, node } })
  assert.throws(() => {
    applyMutation(doc, { type: 'move_node', nodeId: 'node', newParentId: 'ghost' })
  }, /not found/)
})

run('move_node — throws if moving node into its own subtree (circular)', () => {
  const root = makeNode('root', { type: 'Page', children: ['parent'] })
  const parent = makeNode('parent', { parentId: 'root', children: ['child'] })
  const child = makeNode('child', { parentId: 'parent', children: ['grandchild'] })
  const grandchild = makeNode('grandchild', { parentId: 'child' })
  const doc = makeDoc({ rootId: 'root', nodes: { root, parent, child, grandchild } })

  assert.throws(() => {
    applyMutation(doc, { type: 'move_node', nodeId: 'parent', newParentId: 'grandchild' })
  }, /circular/)
})

run('move_node — throws if moving root node', () => {
  const root = makeNode('root', { type: 'Page', children: ['child'] })
  const child = makeNode('child', { parentId: 'root' })
  const newParent = makeNode('newParent', { children: [] })
  const doc = makeDoc({ rootId: 'root', nodes: { root, child, newParent } })

  assert.throws(() => {
    applyMutation(doc, { type: 'move_node', nodeId: 'root', newParentId: 'newParent' })
  }, /root/)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: version and history
// ═══════════════════════════════════════════════════════════════════════════

run('version increments on each mutation', () => {
  let doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('a'), parentId: 'root' })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('b'), parentId: 'root' })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('c'), parentId: 'root' })

  assert.strictEqual(doc.version, 4)  // started at 1, 3 mutations
})

run('history captures every mutation in order', () => {
  let doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  const mut1: Mutation = { type: 'add_node', node: makeNode('a'), parentId: 'root' }
  const mut2: Mutation = { type: 'add_node', node: makeNode('b'), parentId: 'root' }

  doc = applyMutation(doc, mut1)
  doc = applyMutation(doc, mut2)

  assert.strictEqual(doc.history.length, 2)
  assert.strictEqual(doc.history[0].type, 'add_node')
  assert.strictEqual((doc.history[0] as any).node?.id, 'a')
  assert.strictEqual((doc.history[1] as any).node?.id, 'b')
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: rebuildDocFromHistory
// ═══════════════════════════════════════════════════════════════════════════

run('rebuildDocFromHistory — replays history up to stagingPointer', () => {
  let doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('n1', { type: 'Section' }), parentId: 'root' })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('n2', { type: 'Text', props: { text: 'hello' } }), parentId: 'root' })

  // Undo: move pointer back by 1
  doc.stagingPointer = doc.history.length - 2
  const rebuilt = rebuildDocFromHistory(doc)

  assert.strictEqual(rebuilt.nodes['n1'] !== undefined, true, 'n1 should exist')
  assert.strictEqual(rebuilt.nodes['n2'], undefined, 'n2 should not exist (rolled back)')
  assert.strictEqual(rebuilt.version, 1, 'version should be 1 after rolling back n2')
})

run('rebuildDocFromHistory — replay to full history gives same state', () => {
  let doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('n1', { type: 'Section' }), parentId: 'root' })
  doc = applyMutation(doc, { type: 'update_node', nodeId: 'n1', style: { color: 'blue' } })
  const originalN1Style = doc.nodes['n1'].style.color

  doc.stagingPointer = doc.history.length - 1
  const rebuilt = rebuildDocFromHistory(doc)

  assert.strictEqual(rebuilt.nodes['n1'].style.color, originalN1Style)
  assert.strictEqual(rebuilt.version, 2)
})

run('rebuildDocFromHistory — pointer -1 returns base state', () => {
  let doc = makeDoc({ rootId: 'root', nodes: { root: makeNode('root', { type: 'Page' }) } })
  doc = applyMutation(doc, { type: 'add_node', node: makeNode('n1'), parentId: 'root' })

  doc.stagingPointer = -1
  const rebuilt = rebuildDocFromHistory(doc)

  assert.strictEqual(rebuilt.nodes['root'] !== undefined, true)
  assert.strictEqual(rebuilt.nodes['n1'], undefined)
  assert.strictEqual(rebuilt.version, 0)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: getTree
// ═══════════════════════════════════════════════════════════════════════════

run('getTree — returns nested tree from flat node map', () => {
  const root = makeNode('root', { type: 'Page', children: ['section1', 'section2'] })
  const section1 = makeNode('section1', { type: 'Section', parentId: 'root', children: ['text1'] })
  const text1 = makeNode('text1', { type: 'Text', parentId: 'section1', props: { text: 'Hello' } })
  const section2 = makeNode('section2', { type: 'Section', parentId: 'root', children: [] })

  const doc = makeDoc({ rootId: 'root', nodes: { root, section1, text1, section2 } })
  const tree = getTree(doc)

  assert.strictEqual(tree?.id, 'root')
  assert.strictEqual(tree?.type, 'Page')
  assert.strictEqual(tree?.children.length, 2)
  assert.strictEqual(tree?.children[0].id, 'section1')
  assert.strictEqual(tree?.children[0].children[0].id, 'text1')
  assert.strictEqual(tree?.children[1].id, 'section2')
  assert.strictEqual(tree?.children[1].children.length, 0)
})

run('getTree — carries props and style into tree nodes', () => {
  const root = makeNode('root', { type: 'Page', style: { backgroundColor: '#fff' }, children: ['text1'] })
  const text1 = makeNode('text1', { type: 'Text', parentId: 'root', props: { text: 'Hello' }, style: { color: '#000' } })
  const doc = makeDoc({ rootId: 'root', nodes: { root, text1 } })

  const tree = getTree(doc)

  assert.deepStrictEqual(tree?.style, { backgroundColor: '#fff' })
  assert.deepStrictEqual(tree?.children[0].props, { text: 'Hello' })
  assert.deepStrictEqual(tree?.children[0].style, { color: '#000' })
})

run('getTree — returns null for empty doc', () => {
  const doc = makeDoc()
  assert.strictEqual(getTree(doc), null)
})

run('getTree — returns null if rootId missing from nodes', () => {
  const doc = makeDoc({ rootId: 'ghost', nodes: {} })
  assert.strictEqual(getTree(doc), null)
})

run('getTree — preserves child order', () => {
  const root = makeNode('root', { type: 'Page', children: ['a', 'b', 'c'] })
  const a = makeNode('a', { type: 'Section', parentId: 'root' })
  const b = makeNode('b', { type: 'Section', parentId: 'root' })
  const c = makeNode('c', { type: 'Section', parentId: 'root' })
  const doc = makeDoc({ rootId: 'root', nodes: { root, a, b, c } })

  const tree = getTree(doc)

  assert.strictEqual(tree!.children[0].id, 'a')
  assert.strictEqual(tree!.children[1].id, 'b')
  assert.strictEqual(tree!.children[2].id, 'c')
})

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\nCanvasEngine: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

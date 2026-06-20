/**
 * EdgeGDE Canvas — AgentCommand normalization tests.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { normalizeAgentCommandPayload } from '../../src/canvas/agent-command-normalizer'
import { agentCommandSchema } from '../../src/canvas/agent-command-schema'
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

function makeDoc(): CanvasDocument {
  return {
    id: 'canvas-test',
    version: 7,
    rootId: 'root',
    baseNodes: {
      root: { id: 'root', type: 'Page', parentId: null, children: [], props: {}, style: {} },
    },
    nodes: {
      root: { id: 'root', type: 'Page', parentId: null, children: [], props: {}, style: {} },
    },
    history: [],
    stagingPointer: -1,
    livePointer: -1,
  }
}

run('normalizeAgentCommandPayload fills add_node node.parentId from mutation.parentId', () => {
  const normalized = normalizeAgentCommandPayload({
    intent: 'Arrange hero menu',
    expectedVersion: 7,
    mutations: [{
      type: 'add_node',
      parentId: 'root',
      node: {
        id: 'nav-item-1',
        type: 'Button',
        children: [],
        props: { text: 'Plans' },
        style: {},
      },
    }],
  }, makeDoc())

  const mutation = normalized.mutations[0] as {
    type: 'add_node'
    parentId: string
    node: { parentId: string | null }
  }
  assert.strictEqual(mutation.node.parentId, 'root')
  agentCommandSchema.parse(normalized)
})

run('normalizeAgentCommandPayload fills add_node mutation.parentId from node.parentId', () => {
  const normalized = normalizeAgentCommandPayload({
    intent: 'Arrange hero menu',
    expectedVersion: 7,
    mutations: [{
      type: 'add_node',
      node: {
        id: 'nav-item-2',
        type: 'Button',
        parentId: 'root',
        children: [],
        props: { text: 'Learn More' },
        style: {},
      },
    }],
  }, makeDoc())

  const mutation = normalized.mutations[0] as {
    type: 'add_node'
    parentId: string
    node: { parentId: string | null }
  }
  assert.strictEqual(mutation.parentId, 'root')
  assert.strictEqual(mutation.node.parentId, 'root')
  agentCommandSchema.parse(normalized)
})

run('normalizeAgentCommandPayload defaults expectedVersion to current document version', () => {
  const normalized = normalizeAgentCommandPayload({
    intent: 'Arrange hero menu',
    mutations: [{
      type: 'update_node',
      nodeId: 'root',
      props: {},
    }],
  }, makeDoc())

  assert.strictEqual(normalized.expectedVersion, 7)
  agentCommandSchema.parse(normalized)
})

console.log(`\nAgentCommand Normalizer: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

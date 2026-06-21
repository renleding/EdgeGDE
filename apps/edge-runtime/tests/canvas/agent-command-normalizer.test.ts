import assert from 'node:assert'
import { normalizeAgentCommandPayload } from '../../src/canvas/agent-command-normalizer'
import type { CanvasDocument } from '../../src/canvas/canvas-types'

type NormalizedAddNodeMutation = {
  type: 'add_node'
  nodeId?: string
  parentId: string
  node: {
    id: string
    type: string
    parentId: string | null
    children: string[]
    props: Record<string, unknown>
    style: Record<string, unknown>
  }
}

type NormalizedUpdateNodeMutation = {
  type: 'update_node'
  nodeId: string
  node?: {
    id: string
    type: string
    parentId: string | null
    children: string[]
    props: Record<string, unknown>
    style: Record<string, unknown>
  }
}

type NormalizedMutation = NormalizedAddNodeMutation | NormalizedUpdateNodeMutation

let passed = 0
let failed = 0

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}\n    ${errorMessage(err)}`)
  }
}

function makeDoc(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    id: 'canvas-test',
    version: 7,
    rootId: 'root',
    baseNodes: {},
    nodes: {},
    history: overrides.history ?? [],
    stagingPointer: 0,
    livePointer: 0,
    ...overrides,
  }
}

function mutationAt(result: ReturnType<typeof normalizeAgentCommandPayload>, index: number): NormalizedMutation {
  return result.mutations[index] as NormalizedMutation
}

run('normalizeAgentCommandPayload — defaults empty payload to document version and no mutations', () => {
  const result = normalizeAgentCommandPayload({}, makeDoc({ version: 12 }))

  assert.strictEqual(result.intent, 'Canvas edit')
  assert.strictEqual(result.expectedVersion, 12)
  assert.deepStrictEqual(result.mutations, [])
})

run('normalizeAgentCommandPayload — add_node uses explicit mutation parent over node parent', () => {
  const result = normalizeAgentCommandPayload({
    intent: 'Add section',
    expectedVersion: 3,
    mutations: [
      {
        type: 'add_node',
        nodeId: 'incoming-node-id',
        parentId: 'section-parent',
        node: {
          id: 'node-from-agent',
          type: 'Section',
          parentId: 'node-parent',
          children: [],
          props: {},
          style: {},
        },
      },
    ],
  }, makeDoc())

  assert.deepStrictEqual(result.mutations, [
    {
      type: 'add_node',
      nodeId: 'incoming-node-id',
      parentId: 'section-parent',
      node: {
        id: 'node-from-agent',
        type: 'Section',
        parentId: 'section-parent',
        children: [],
        props: {},
        style: {},
      },
    },
  ])
})

run('normalizeAgentCommandPayload — add_node falls back to node parent then document root', () => {
  const result = normalizeAgentCommandPayload({
    intent: 'Add text',
    expectedVersion: 3,
    mutations: [
      {
        type: 'add_node',
        node: {
          id: 'text-node',
          type: 'Text',
          parentId: 'node-parent',
          children: [],
          props: { text: 'Hello' },
          style: {},
        },
      },
      {
        type: 'add_node',
        node: {
          id: 'rooted-node',
          type: 'Text',
          parentId: null,
          children: [],
          props: { text: 'Rooted' },
          style: {},
        },
      },
    ],
  }, makeDoc({ rootId: 'canvas-root' }))

  const first = mutationAt(result, 0) as NormalizedAddNodeMutation
  const second = mutationAt(result, 1) as NormalizedAddNodeMutation
  assert.strictEqual(first.parentId, 'node-parent')
  assert.strictEqual(first.node.parentId, 'node-parent')
  assert.strictEqual(second.parentId, 'canvas-root')
  assert.strictEqual(second.node.parentId, 'canvas-root')
})

run('normalizeAgentCommandPayload — update_node copies nodeId from node.id when missing', () => {
  const result = normalizeAgentCommandPayload({
    intent: 'Update text',
    expectedVersion: 3,
    mutations: [
      {
        type: 'update_node',
        node: {
          id: 'text-node',
          type: 'Text',
          parentId: 'root',
          children: [],
          props: { text: 'Updated' },
          style: {},
        },
      },
    ],
  }, makeDoc())

  assert.deepStrictEqual(result.mutations, [
    {
      type: 'update_node',
      nodeId: 'text-node',
      node: {
        id: 'text-node',
        type: 'Text',
        parentId: 'root',
        children: [],
        props: { text: 'Updated' },
        style: {},
      },
    },
  ])
})

run('normalizeAgentCommandPayload — update_node does not reuse add_node node id', () => {
  const result = normalizeAgentCommandPayload({
    intent: 'Add and update',
    expectedVersion: 3,
    mutations: [
      {
        type: 'add_node',
        node: {
          id: 'added-node',
          type: 'Text',
          parentId: 'root',
          children: [],
          props: { text: 'Added' },
          style: {},
        },
      },
      {
        type: 'update_node',
        node: {
          id: 'updated-node',
          type: 'Text',
          parentId: 'root',
          children: [],
          props: { text: 'Updated' },
          style: {},
        },
      },
    ],
  }, makeDoc())

  assert.strictEqual(mutationAt(result, 0).type, 'add_node')
  assert.strictEqual((mutationAt(result, 1) as NormalizedUpdateNodeMutation).nodeId, 'updated-node')
})

if (failed === 0) {
  console.log(`✅ ${passed} canvas command normalizer tests passed`)
  process.exit(0)
}

console.error(`❌ ${failed}/${passed + failed} canvas command normalizer tests failed`)
process.exit(1)

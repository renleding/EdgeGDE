/**
 * EdgeGDE Canvas — AgentCommand Schema Tests
 * Phase 6: Zod validation for LLM → Canvas mutation protocol.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { agentCommandSchema } from '../../src/canvas/agent-command-schema'

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
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

run('valid AgentCommand with add_node passes', () => {
  const result = agentCommandSchema.parse({
    intent: 'Add a section',
    expectedVersion: 5,
    mutations: [
      {
        type: 'add_node',
        node: { id: 's1', type: 'Section', parentId: null, props: {}, style: {} },
        parentId: 'root',
      },
    ],
  })
  assert.strictEqual(result.intent, 'Add a section')
  assert.strictEqual(result.expectedVersion, 5)
  assert.strictEqual(result.mutations.length, 1)
})

run('valid AgentCommand with update_node passes', () => {
  const result = agentCommandSchema.parse({
    intent: 'Update styling',
    expectedVersion: 3,
    mutations: [
      {
        type: 'update_node',
        nodeId: 'title',
        props: { text: 'New Title' },
        style: { fontSize: '32px', color: '#fff' },
      },
    ],
  })
  assert.strictEqual(result.mutations[0].type, 'update_node')
})

run('valid AgentCommand with delete_node passes', () => {
  const result = agentCommandSchema.parse({
    intent: 'Remove a node',
    expectedVersion: 7,
    mutations: [
      { type: 'delete_node', nodeId: 'old-section' },
    ],
  })
  assert.strictEqual(result.mutations[0].type, 'delete_node')
})

run('valid AgentCommand with move_node passes', () => {
  const result = agentCommandSchema.parse({
    intent: 'Move section',
    expectedVersion: 2,
    mutations: [
      { type: 'move_node', nodeId: 's1', newParentId: 'new-parent', newIndex: 0 },
    ],
  })
  assert.strictEqual(result.mutations[0].type, 'move_node')
})

run('valid AgentCommand with multiple mutations passes', () => {
  const result = agentCommandSchema.parse({
    intent: 'Add hero section',
    expectedVersion: 1,
    mutations: [
      { type: 'add_node', node: { id: 'hero', type: 'Section', parentId: null, props: {}, style: {} }, parentId: 'root' },
      { type: 'add_node', node: { id: 'title', type: 'Text', parentId: null, props: { text: 'Hello' }, style: {} }, parentId: 'hero' },
      { type: 'update_node', nodeId: 'root', style: { backgroundColor: '#000' } },
    ],
  })
  assert.strictEqual(result.mutations.length, 3)
})

run('rejects missing intent', () => {
  assert.throws(() => {
    agentCommandSchema.parse({
      expectedVersion: 1,
      mutations: [{ type: 'add_node', node: { id: 'n1', type: 'Text', parentId: null, props: {}, style: {} }, parentId: 'root' }],
    })
  }, /intent/)
})

run('rejects missing expectedVersion', () => {
  assert.throws(() => {
    agentCommandSchema.parse({
      intent: 'test',
      mutations: [],
    })
  }, /expectedVersion/)
})

run('rejects empty mutations array', () => {
  assert.throws(() => {
    agentCommandSchema.parse({
      intent: 'test',
      expectedVersion: 0,
      mutations: [],
    })
  }, /at least one/)
})

run('rejects invalid mutation type', () => {
  assert.throws(() => {
    agentCommandSchema.parse({
      intent: 'test',
      expectedVersion: 0,
      mutations: [{ type: 'invalid_type' }],
    })
  })
})

run('rejects negative expectedVersion', () => {
  assert.throws(() => {
    agentCommandSchema.parse({
      intent: 'test',
      expectedVersion: -1,
      mutations: [{ type: 'add_node', node: { id: 'n1', type: 'Text', parentId: null, props: {}, style: {} }, parentId: 'root' }],
    })
  })
})

console.log('\nAgentCommand Schema: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)

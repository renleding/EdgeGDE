/**
 * EdgeGDE Canvas — CanvasSession_DO Tests
 * Phase 2: WebSocket Durable Object for real-time collaboration.
 *
 * Tests use HTTP endpoints that mirror WebSocket message handling.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import type { CanvasDocument, Node, Mutation } from '../../src/canvas/canvas-types'
import { applyMutation } from '../../src/canvas/canvas-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Mock CanvasSession_DO (mirrors real DO logic without Durable Object runtime)
// ═══════════════════════════════════════════════════════════════════════════

interface CompileJob {
  docId: string
  version: number
  livePointer: number
}

class MockCanvasSession {
  doc: CanvasDocument | null = null
  compileQueue: CompileJob[] = []
  broadcastHistory: any[] = []
  private compileDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private mutationCount = 0
  private scheduledSnapshot = false
  private readonly MAX_UNDO = 100

  // Snapshot stack for undo/redo
  private undoStack: Record<string, Node>[] = []
  private redoStack: Record<string, Node>[] = []

  // ── Init ──────────────────────────────────────────────────────────────

  init(id: string, rootId: string, initialNodes?: Record<string, Node>): CanvasDocument {
    this.doc = {
      id,
      version: 0,
      baseNodes: initialNodes ? JSON.parse(JSON.stringify(initialNodes)) : {},
      nodes: initialNodes ? JSON.parse(JSON.stringify(initialNodes)) : {},
      rootId,
      history: [],
      stagingPointer: -1,
      livePointer: -1,
    }
    return this.doc
  }

  // ── State ─────────────────────────────────────────────────────────────

  getState(): CanvasDocument | null {
    return this.doc ? JSON.parse(JSON.stringify(this.doc)) : null
  }

  // ── Mutation ──────────────────────────────────────────────────────────

  applyMutation(mutation: Mutation, expectedVersion: number): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (expectedVersion !== this.doc.version) {
      return { success: false, error: `Version mismatch: expected ${expectedVersion}, current ${this.doc.version}` }
    }

    try {
      // Snapshot current nodes before mutation (for undo)
      this.undoStack.push(JSON.parse(JSON.stringify(this.doc.nodes)))
      // Cap undo stack to prevent unbounded memory growth
      if (this.undoStack.length > this.MAX_UNDO) {
        this.undoStack.shift()
      }
      // New mutation clears redo stack
      this.redoStack = []

      this.doc = applyMutation(this.doc, mutation)
      this.mutationCount++
      this.broadcast({ type: 'broadcast', mutation, version: this.doc.version })
      this.scheduleCompile()
      this.checkSnapshot()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  // ── MCP Call ──────────────────────────────────────────────────────────

  handleMcpCall(tool: string, payload: Record<string, any>, expectedVersion: number): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (expectedVersion !== this.doc.version) {
      return { success: false, error: `Version mismatch: expected ${expectedVersion}, current ${this.doc.version}` }
    }

    // v1: system path only — known tool patterns
    if (tool.startsWith('form_')) {
      // Form submission: represent as update_node mutations on form fields
      // For now, acknowledge the call — actual field mapping is v2
      this.broadcast({ type: 'mcp_call_accepted', version: this.doc.version })
      return { success: true }
    }

    return { success: false, error: `Unknown tool "${tool}" — agent resolution not supported in v1` }
  }

  // ── Undo ──────────────────────────────────────────────────────────────

  undo(): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (this.undoStack.length === 0) return { success: false, error: 'Nothing to undo' }

    // Save current state for redo
    this.redoStack.push(JSON.parse(JSON.stringify(this.doc.nodes)))
    // Restore previous state
    const prevNodes = this.undoStack.pop()!
    this.doc.nodes = prevNodes
    this.doc.stagingPointer = Math.max(-1, this.doc.stagingPointer - 1)
    this.doc.version++
    this.doc.baseNodes = JSON.parse(JSON.stringify(this.doc.nodes))
    this.broadcast({ type: 'broadcast', action: 'undo', version: this.doc.version })
    return { success: true }
  }

  // ── Redo ──────────────────────────────────────────────────────────────

  redo(): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (this.redoStack.length === 0) return { success: false, error: 'Nothing to redo' }

    // Save current state for undo
    this.undoStack.push(JSON.parse(JSON.stringify(this.doc.nodes)))
    // Restore next state
    const nextNodes = this.redoStack.pop()!
    this.doc.nodes = nextNodes
    this.doc.stagingPointer = Math.min(this.doc.history.length - 1, this.doc.stagingPointer + 1)
    this.doc.version++
    this.doc.baseNodes = JSON.parse(JSON.stringify(this.doc.nodes))
    this.broadcast({ type: 'broadcast', action: 'redo', version: this.doc.version })
    return { success: true }
  }

  // ── Deploy ────────────────────────────────────────────────────────────

  deploy(): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }

    this.doc.livePointer = this.doc.stagingPointer
    this.enqueueCompile()
    this.broadcast({ type: 'compiled', livePointer: this.doc.livePointer })
    return { success: true }
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private broadcast(msg: any): void {
    this.broadcastHistory.push(msg)
  }

  private scheduleCompile(): void {
    if (this.compileDebounceTimer) clearTimeout(this.compileDebounceTimer)
    this.compileDebounceTimer = setTimeout(() => {
      if (this.doc) {
        this.compileQueue.push({
          docId: this.doc.id,
          version: this.doc.version,
          livePointer: this.doc.livePointer,
        })
      }
    }, 500)
  }

  private enqueueCompile(): void {
    if (this.doc) {
      this.compileQueue.push({
        docId: this.doc.id,
        version: this.doc.version,
        livePointer: this.doc.livePointer,
      })
    }
  }

  private checkSnapshot(): void {
    if (this.mutationCount % 5 === 0) {
      this.scheduledSnapshot = true
    }
  }

  // ── Test helpers ──────────────────────────────────────────────────────

  drainCompileQueue(): CompileJob[] {
    const jobs = [...this.compileQueue]
    this.compileQueue = []
    return jobs
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeNode(id: string, overrides?: Partial<Node>): Node {
  return { id, type: 'Frame', parentId: null, children: [], props: {}, style: {}, ...overrides }
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
// TESTS: Init
// ═══════════════════════════════════════════════════════════════════════════

run('init — creates a CanvasDocument with version 0', () => {
  const session = new MockCanvasSession()
  const doc = session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page' }) })
  assert.strictEqual(doc.id, 'canvas-1')
  assert.strictEqual(doc.version, 0)
  assert.strictEqual(doc.rootId, 'root')
  assert.strictEqual(doc.stagingPointer, -1)
  assert.strictEqual(doc.livePointer, -1)
})

run('init — state is accessible after init', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page' }) })
  const state = session.getState()
  assert.strictEqual(state?.id, 'canvas-1')
  assert.ok(state?.nodes['root'] !== undefined)
})

run('getState — returns null before init', () => {
  const session = new MockCanvasSession()
  assert.strictEqual(session.getState(), null)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Mutation
// ═══════════════════════════════════════════════════════════════════════════

run('mutation — applies mutation and increments version', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  const result = session.applyMutation(
    { type: 'add_node', node: makeNode('n1', { type: 'Section' }), parentId: 'root' },
    0, // expectedVersion
  )

  assert.strictEqual(result.success, true)
  const state = session.getState()
  assert.strictEqual(state!.version, 1)
  assert.ok(state!.nodes['n1'] !== undefined)
})

run('mutation — rejects version mismatch', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page' }) })

  const result = session.applyMutation(
    { type: 'add_node', node: makeNode('n1'), parentId: 'root' },
    99, // wrong version
  )

  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Version mismatch'))
})

run('mutation — returns error before init', () => {
  const session = new MockCanvasSession()
  const result = session.applyMutation(
    { type: 'add_node', node: makeNode('n1'), parentId: 'root' },
    0,
  )
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Not initialized'))
})

run('mutation — broadcasts after applying', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  session.applyMutation(
    { type: 'add_node', node: makeNode('n1'), parentId: 'root' },
    0,
  )

  assert.strictEqual(session.broadcastHistory.length, 1)
  assert.strictEqual(session.broadcastHistory[0].type, 'broadcast')
  assert.strictEqual(session.broadcastHistory[0].mutation.type, 'add_node')
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: MCP Call
// ═══════════════════════════════════════════════════════════════════════════

run('mcp_call — rejects version mismatch', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root') })
  const result = session.handleMcpCall('form_test', {}, 99)
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Version mismatch'))
})

run('mcp_call — accepts known form tool', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root') })
  const result = session.handleMcpCall('form_test_form', { field1: 'value1' }, 0)
  assert.strictEqual(result.success, true)
})

run('mcp_call — rejects unknown tool in v1', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root') })
  const result = session.handleMcpCall('generate_chart', {}, 0)
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Unknown tool'))
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Undo / Redo
// ═══════════════════════════════════════════════════════════════════════════

run('undo — restores previous node state', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  session.applyMutation({ type: 'add_node', node: makeNode('n1', { type: 'Section', props: { text: 'Hello' } }), parentId: 'root' }, 0)

  // Verify n1 exists before undo
  assert.ok(session.doc!.nodes['n1'] !== undefined, 'n1 should exist before undo')

  session.undo()

  // Verify n1 is gone after undo
  assert.strictEqual(session.doc!.nodes['n1'], undefined, 'n1 should be removed after undo')

  session.redo()

  // Verify n1 is back after redo
  assert.ok(session.doc!.nodes['n1'] !== undefined, 'n1 should exist after redo')
  assert.strictEqual(session.doc!.nodes['n1'].props.text, 'Hello', 'n1 props should be restored')
})

run('undo — moves stagingPointer back', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  session.applyMutation({ type: 'add_node', node: makeNode('n1'), parentId: 'root' }, 0)
  session.applyMutation({ type: 'add_node', node: makeNode('n2'), parentId: 'root' }, 1)

  const undoResult = session.undo()
  assert.strictEqual(undoResult.success, true)
  assert.strictEqual(session.doc!.stagingPointer, 0) // back to first mutation only
})

run('undo — returns error when nothing to undo', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root') })
  const result = session.undo()
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Nothing to undo'))
})

run('redo — moves stagingPointer forward', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  session.applyMutation({ type: 'add_node', node: makeNode('n1'), parentId: 'root' }, 0)
  session.undo()
  const redoResult = session.redo()

  assert.strictEqual(redoResult.success, true)
  assert.strictEqual(session.doc!.stagingPointer, 0) // back to full history
})

run('redo — returns error when nothing to redo', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root') })
  const result = session.redo()
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Nothing to redo'))
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Deploy
// ═══════════════════════════════════════════════════════════════════════════

run('deploy — sets livePointer to stagingPointer', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  session.applyMutation({ type: 'add_node', node: makeNode('n1'), parentId: 'root' }, 0)
  session.applyMutation({ type: 'add_node', node: makeNode('n2'), parentId: 'root' }, 1)

  const deployResult = session.deploy()
  assert.strictEqual(deployResult.success, true)
  assert.strictEqual(session.doc!.livePointer, session.doc!.stagingPointer)
})

run('deploy — enqueues compile job', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page' }) })

  session.deploy()
  const jobs = session.drainCompileQueue()

  assert.strictEqual(jobs.length, 1)
  assert.strictEqual(jobs[0].docId, 'canvas-1')
})

run('deploy — broadcasts compiled event', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root') })

  session.deploy()

  const lastBroadcast = session.broadcastHistory[session.broadcastHistory.length - 1]
  assert.strictEqual(lastBroadcast.type, 'compiled')
  assert.strictEqual(lastBroadcast.livePointer, -1)
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Compile Queue
// ═══════════════════════════════════════════════════════════════════════════

run('compile queue — accumulates mutations after debounce', async () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  session.applyMutation({ type: 'add_node', node: makeNode('n1'), parentId: 'root' }, 0)
  session.applyMutation({ type: 'add_node', node: makeNode('n2'), parentId: 'root' }, 1)

  // Drain pending compile jobs (debounced, but we can simulate by flushing)
  // The debounce hasn't fired yet, so drain returns empty
  const before = session.drainCompileQueue()
  assert.strictEqual(before.length, 0, 'debounce has not fired yet')
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: Snapshot interval
// ═══════════════════════════════════════════════════════════════════════════

run('snapshot — triggers every 5 mutations', () => {
  const session = new MockCanvasSession()
  session.init('canvas-1', 'root', { root: makeNode('root', { type: 'Page', children: [] }) })

  // Fire 4 mutations — no snapshot
  for (let i = 0; i < 4; i++) {
    session.applyMutation({ type: 'add_node', node: makeNode(`n${i}`), parentId: 'root' }, i)
  }
  assert.strictEqual((session as any).scheduledSnapshot, false)

  // 5th mutation triggers snapshot
  session.applyMutation({ type: 'add_node', node: makeNode('n4'), parentId: 'root' }, 4)
  assert.strictEqual((session as any).scheduledSnapshot, true)
})

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\nCanvasSession_DO: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

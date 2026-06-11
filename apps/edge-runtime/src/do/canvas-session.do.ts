/**
 * EdgeGDE Canvas — CanvasSession_DO
 * Canvas Platform v1.0.0
 * Phase 2: Real-time collaborative editing Durable Object.
 *
 * Single source of truth for canvas editing sessions.
 * - WebSocket transport for real-time collaboration
 * - Deterministic mutation pipeline via CanvasEngine
 * - Two-pointer versioning (stagingPointer, livePointer)
 * - Debounced compile queue on mutation
 * - D1 snapshots every 5 mutations
 *
 * Reuses ChatSession_DO infrastructure patterns (snapshot,
 * alarm, state management).
 *
 * @packageDocumentation
 */

import type { CanvasDocument, Mutation, ClientMessage, ServerMessage, Node } from '../canvas/canvas-types'
import { applyMutation } from '../canvas/canvas-engine'

const SNAPSHOT_INTERVAL = 5
const COMPILE_DEBOUNCE_MS = 500
const MAX_UNDO_STACK = 100

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Connection Tracker
// ═══════════════════════════════════════════════════════════════════════════

interface WsConnection {
  socket: WebSocket
  closed: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// CanvasSession_DO
// ═══════════════════════════════════════════════════════════════════════════

export class CanvasSession_DO {
  private doc: CanvasDocument | null = null
  private connections: WsConnection[] = []
  private compileTimer: ReturnType<typeof setTimeout> | null = null
  private scheduledSnapshot = false
  private mutationCount = 0
  readonly state_: DurableObjectState
  private env: any

  constructor(state: DurableObjectState, env: any) {
    this.state_ = state
    this.env = env
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Fetch Handler
  // ═══════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // ── WebSocket upgrade ──────────────────────────────────────────────
    if (path === '/ws') {
      return this.handleWebSocketUpgrade(request)
    }

    // ── HTTP API (for testing and non-WebSocket clients) ───────────────
    if (path === '/init' && request.method === 'POST') {
      const { id, rootId, nodes } = await request.json() as {
        id: string
        rootId: string
        nodes?: Record<string, Node>
      }
      return this.handleInit(id, rootId, nodes)
    }

    if (path === '/state') {
      return this.handleGetState()
    }

    if (path === '/mutation' && request.method === 'POST') {
      const { mutation, expectedVersion } = await request.json() as {
        mutation: Mutation
        expectedVersion: number
      }
      return this.handleMutation(mutation, expectedVersion)
    }

    if (path === '/mcp_call' && request.method === 'POST') {
      const { tool, payload, expectedVersion } = await request.json() as {
        tool: string
        payload: Record<string, any>
        expectedVersion: number
      }
      return this.handleMcpCall(tool, payload, expectedVersion)
    }

    if (path === '/undo' && request.method === 'POST') {
      return this.handleUndo()
    }

    if (path === '/redo' && request.method === 'POST') {
      return this.handleRedo()
    }

    if (path === '/deploy' && request.method === 'POST') {
      return this.handleDeploy()
    }

    return new Response('Unknown action', { status: 400 })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WebSocket
  // ═══════════════════════════════════════════════════════════════════════

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [server, client] = Object.values(pair)

    const conn: WsConnection = { socket: server, closed: false }
    this.connections.push(conn)

    server.accept()

    // Send current state on connect
    if (this.doc) {
      const msg: ServerMessage = { type: 'state', doc: this.doc }
      server.send(JSON.stringify(msg))
    }

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as ClientMessage
        this.handleWsMessage(data, server)
      } catch (e: any) {
        server.send(JSON.stringify({ type: 'mutation_rejected', reason: e.message, currentVersion: this.doc?.version ?? 0 }))
      }
    })

    server.addEventListener('close', () => {
      conn.closed = true
      this.connections = this.connections.filter(c => c !== conn)
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private handleWsMessage(msg: ClientMessage, socket: WebSocket): void {
    switch (msg.type) {
      case 'mutation': {
        const { mutation, expectedVersion } = msg
        const result = this.applyMutationInternal(mutation, expectedVersion)
        if (!result.success) {
          socket.send(JSON.stringify({
            type: 'mutation_rejected',
            reason: result.error,
            currentVersion: this.doc?.version ?? 0,
          }))
        }
        break
      }

      case 'mcp_call': {
        const { tool, payload, expectedVersion } = msg
        const result = this.handleMcpCallInternal(tool, payload, expectedVersion)
        if (!result.success) {
          socket.send(JSON.stringify({ type: 'mcp_call_failed', reason: result.error }))
        }
        break
      }

      case 'undo': {
        const result = this.handleUndoInternal()
        if (!result.success && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'mutation_rejected', reason: result.error!, currentVersion: this.doc?.version ?? 0 }))
        }
        break
      }

      case 'redo': {
        const result = this.handleRedoInternal()
        if (!result.success && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'mutation_rejected', reason: result.error!, currentVersion: this.doc?.version ?? 0 }))
        }
        break
      }

      case 'deploy': {
        const result = this.handleDeployInternal()
        if (!result.success && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'mutation_rejected', reason: result.error!, currentVersion: this.doc?.version ?? 0 }))
        }
        break
      }

      case 'request_state': {
        if (this.doc && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'state', doc: this.doc }))
        }
        break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HTTP Handlers
  // ═══════════════════════════════════════════════════════════════════════

  private handleInit(id: string, rootId: string, nodes?: Record<string, Node>): Response {
    this.doc = {
      id,
      version: 0,
      baseNodes: nodes ? JSON.parse(JSON.stringify(nodes)) : {},
      nodes: nodes ? JSON.parse(JSON.stringify(nodes)) : {},
      rootId,
      history: [],
      stagingPointer: -1,
      livePointer: -1,
    }
    return new Response(JSON.stringify(this.doc))
  }

  private handleGetState(): Response {
    if (!this.doc) return new Response('Not initialized', { status: 400 })
    return new Response(JSON.stringify(this.doc))
  }

  private handleMutation(mutation: Mutation, expectedVersion: number): Response {
    const result = this.applyMutationInternal(mutation, expectedVersion)
    if (!result.success) {
      return new Response(JSON.stringify({
        error: result.error,
        currentVersion: this.doc?.version ?? 0,
      }), { status: 409 })
    }
    return new Response(JSON.stringify({ version: this.doc!.version }))
  }

  private handleMcpCall(tool: string, payload: Record<string, any>, expectedVersion: number): Response {
    const result = this.handleMcpCallInternal(tool, payload, expectedVersion)
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { status: 400 })
    }
    return new Response(JSON.stringify({ version: this.doc!.version }))
  }

  private handleUndo(): Response {
    const result = this.handleUndoInternal()
    if (!result.success) return new Response(JSON.stringify({ error: result.error }), { status: 400 })
    return new Response(JSON.stringify({ version: this.doc!.version }))
  }

  private handleRedo(): Response {
    const result = this.handleRedoInternal()
    if (!result.success) return new Response(JSON.stringify({ error: result.error }), { status: 400 })
    return new Response(JSON.stringify({ version: this.doc!.version }))
  }

  private handleDeploy(): Response {
    const result = this.handleDeployInternal()
    if (!result.success) return new Response(JSON.stringify({ error: result.error }), { status: 400 })
    return new Response(JSON.stringify({ livePointer: this.doc!.livePointer }))
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Core Logic (shared between HTTP and WebSocket paths)
  // ═══════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════
  // Snapshot stack for undo/redo (node maps captured before each mutation)
  // ═══════════════════════════════════════════════════════════════════════

  private undoStack: Record<string, Node>[] = []
  private redoStack: Record<string, Node>[] = []

  private applyMutationInternal(mutation: Mutation, expectedVersion: number): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (expectedVersion !== this.doc.version) {
      return { success: false, error: `Version mismatch: expected ${expectedVersion}, current ${this.doc.version}` }
    }

    try {
      // Snapshot current nodes before mutation (for undo)
      this.undoStack.push(JSON.parse(JSON.stringify(this.doc.nodes)))
      // Cap undo stack to prevent unbounded memory growth
      if (this.undoStack.length > MAX_UNDO_STACK) {
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

  private handleMcpCallInternal(tool: string, payload: Record<string, any>, expectedVersion: number): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (expectedVersion !== this.doc.version) {
      return { success: false, error: `Version mismatch: expected ${expectedVersion}, current ${this.doc.version}` }
    }

    // v1: system path only — known tool patterns
    if (tool.startsWith('form_')) {
      this.broadcast({ type: 'mcp_call_accepted', version: this.doc.version })
      return { success: true }
    }

    return { success: false, error: `Unknown tool "${tool}" — agent resolution not supported in v1` }
  }

  private handleUndoInternal(): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }
    if (this.undoStack.length === 0) return { success: false, error: 'Nothing to undo' }

    // Save current state for redo
    this.redoStack.push(JSON.parse(JSON.stringify(this.doc.nodes)))
    // Restore previous state
    const prevNodes = this.undoStack.pop()!
    this.doc.nodes = prevNodes
    this.doc.stagingPointer = Math.max(-1, this.doc.stagingPointer - 1)
    this.doc.version++
    // Rebuild baseNodes from current nodes for future rebuildDocFromHistory calls
    this.doc.baseNodes = JSON.parse(JSON.stringify(this.doc.nodes))
    this.broadcast({ type: 'broadcast', action: 'undo', version: this.doc.version })
    return { success: true }
  }

  private handleRedoInternal(): { success: boolean; error?: string } {
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

  private handleDeployInternal(): { success: boolean; error?: string } {
    if (!this.doc) return { success: false, error: 'Not initialized' }

    this.doc.livePointer = this.doc.stagingPointer
    this.enqueueCompile()
    this.broadcast({ type: 'compiled', livePointer: this.doc.livePointer })
    return { success: true }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Broadcast
  // ═══════════════════════════════════════════════════════════════════════

  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg)
    for (const conn of this.connections) {
      if (!conn.closed && conn.socket.readyState === WebSocket.OPEN) {
        try {
          conn.socket.send(json)
        } catch {
          conn.closed = true
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Compile Queue
  // ═══════════════════════════════════════════════════════════════════════

  private scheduleCompile(): void {
    if (this.compileTimer) clearTimeout(this.compileTimer)
    this.compileTimer = setTimeout(() => {
      this.enqueueCompile()
      this.compileTimer = null
    }, COMPILE_DEBOUNCE_MS)
  }

  private enqueueCompile(): void {
    if (!this.doc) return
    try {
      const queue = this.env?.COMPILE_QUEUE
      if (queue) {
        queue.send({
          type: 'compile_canvas',
          docId: this.doc.id,
          version: this.doc.version,
          livePointer: this.doc.livePointer,
        })
      }
    } catch (e) {
      console.error('[CanvasSession_DO] enqueueCompile failed:', e)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // D1 Snapshots
  // ═══════════════════════════════════════════════════════════════════════

  private checkSnapshot(): void {
    if (this.mutationCount % SNAPSHOT_INTERVAL === 0) {
      this.triggerSnapshot()
    }
  }

  private triggerSnapshot(): void {
    if (this.scheduledSnapshot) return
    this.scheduledSnapshot = true
    this.state_.waitUntil(this.snapshotNow())
  }

  private async snapshotNow(): Promise<void> {
    if (!this.doc) return
    try {
      const db = this.env?.DB
      if (!db) return

      await db.prepare(
        `UPDATE canvas_sessions SET doc_json = ?, version = ?, staging_pointer = ?, live_pointer = ?, updated_at = ? WHERE id = ?`
      ).bind(
        JSON.stringify(this.doc),
        this.doc.version,
        this.doc.stagingPointer,
        this.doc.livePointer,
        Date.now(),
        this.doc.id,
      ).run()
    } catch (e) {
      console.error('[CanvasSession_DO] snapshot failed:', e)
    } finally {
      this.scheduledSnapshot = false
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Alarm
  // ═══════════════════════════════════════════════════════════════════════

  async alarm(): Promise<void> {
    if (this.doc) {
      await this.snapshotNow()
    }
  }
}

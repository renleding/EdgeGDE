import type { CanvasDocument, Node, Mutation } from '../canvas/canvas-types'
import { applyMutation } from '../canvas/canvas-engine'
import { AegisMutationGate } from '../canvas/aegis-gate'
import { guardKV } from '../lib/kv'

const SNAPSHOT_INTERVAL = 5
const MAX_UNDO_STACK = 100

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Message Types
// ═══════════════════════════════════════════════════════════════════════════

interface ClientMessage {
  type: 'request_state' | 'mutation' | 'mcp_call' | 'undo' | 'redo'
    | 'deploy' | 'approve_proposal' | 'reject_proposal'
    | 'jump_to_timeline' | 'filter_timeline' | 'inspect_link' | 'rollback_replay'
  mutation?: Mutation
  tool?: string
  payload?: any
  expectedVersion?: number
  // FRS v3
  nodeId?: string
  index?: number
  mutationType?: string
  agentId?: string
  linkId?: string
  auditEntryId?: string
}

interface ApplyResult {
  success: boolean
  error?: string
  newVersion?: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CanvasSession_DO — Durable Object
// ═══════════════════════════════════════════════════════════════════════════

export class CanvasSession_DO implements DurableObject {
  readonly state_: DurableObjectState
  readonly env_: any
  private doc: CanvasDocument | null = null
  private mutationCount = 0
  private undoStack: CanvasDocument[] = []
  private scheduledSnapshot = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** Aegis governance gate — validates every mutation before execution */
  private aegis = new AegisMutationGate()

  constructor(state: DurableObjectState, env: any) {
    this.state_ = state
    this.env_ = env
  }

  get env(): any { return this.env_ }

  // ═══════════════════════════════════════════════════════════════════════
  // Fetch Handler
  // ═══════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/ws') {
      const canvasId = url.searchParams.get('do') || url.searchParams.get('canvasId') || url.searchParams.get('id')
      if (!this.doc && canvasId) {
        const restoreRes = await this.handleRestore(canvasId)
        if (restoreRes.status === 200) {
          this.doc = JSON.parse(await restoreRes.text()) as CanvasDocument
        }
      }
      return this.handleWebSocketUpgrade(request)
    }

    if (path === '/init' && request.method === 'POST') {
      const data = await request.json() as { id: string; rootId: string; nodes: Record<string, Node>; designTokens?: unknown }
      const { id, rootId, nodes } = data
      return this.handleInit(id, rootId, nodes, data.designTokens)
    }

    if (path === '/restore' && request.method === 'POST') {
      const data = await request.json() as { canvasId: string }
      return this.handleRestore(data.canvasId)
    }

    if (path === '/state') return this.handleGetState()
    const self = this as unknown as CanvasSession_DO & { handleMcpCall: (tool: string, payload: unknown, expectedVersion: number) => Promise<Response>; handleDeploy: () => Promise<Response> }

    if (path === '/mutation' && request.method === 'POST') {
      const { mutation, expectedVersion } = await request.json() as { mutation: Mutation; expectedVersion: number }
      return this.handleMutation(mutation, expectedVersion)
    }

    if (path === '/mutation/batch' && request.method === 'POST') {
      const { mutations, expectedVersion } = await request.json() as { mutations: Mutation[]; expectedVersion: number }
      return this.handleBatchMutation(mutations, expectedVersion)
    }

    if (path === '/mcp_call' && request.method === 'POST') {
      const { tool, payload, expectedVersion } = await request.json() as { tool: string; payload: any; expectedVersion: number }
      return self.handleMcpCall(tool, payload, expectedVersion)
    }

    if (path === '/deploy' && request.method === 'POST') return self.handleDeploy()

    // ═══════════════════════════════════════════════════════════════════════
    // FRS v3 Routes
    // ═══════════════════════════════════════════════════════════════════════
    if (path === '/transition_agent_state' && request.method === 'POST') {
      const { nodeId, newState, expectedVersion } = await request.json() as { nodeId: string; newState: any; expectedVersion: number }
      return this.handleMutation({ type: 'transition_agent_state', nodeId, newState }, expectedVersion)
    }
    if (path === '/create_proposal' && request.method === 'POST') {
      const { node, proposalData, expectedVersion } = await request.json() as { node: any; proposalData: any; expectedVersion: number }
      return this.handleMutation({ type: 'create_proposal', node, proposalData }, expectedVersion)
    }
    if (path === '/approve_proposal' && request.method === 'POST') {
      const { nodeId, expectedVersion } = await request.json() as { nodeId: string; expectedVersion: number }
      return this.handleMutation({ type: 'approve_proposal', nodeId }, expectedVersion)
    }
    if (path === '/reject_proposal' && request.method === 'POST') {
      const { nodeId, expectedVersion } = await request.json() as { nodeId: string; expectedVersion: number }
      return this.handleMutation({ type: 'reject_proposal', nodeId }, expectedVersion)
    }
    if (path === '/rollback' && request.method === 'POST') {
      const { targetPointer, expectedVersion } = await request.json() as { targetPointer: number; expectedVersion: number }
      return this.handleMutation({ type: 'rollback_to_point', targetPointer }, expectedVersion)
    }
    if (path === '/link_workspaces' && request.method === 'POST') {
      const { link, expectedVersion } = await request.json() as { link: any; expectedVersion: number }
      return this.handleMutation({ type: 'link_workspaces', link }, expectedVersion)
    }

    return new Response('Not found', { status: 404 })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WebSocket Handler
  // ═══════════════════════════════════════════════════════════════════════

  private handleWebSocketUpgrade(request: Request): Response {
    if (!this.doc) return new Response('Not initialized', { status: 400 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg: ClientMessage = JSON.parse(event.data as string)
        this.handleWsMessage(msg, server)
      } catch { /* ignore malformed */ }
    })

    server.addEventListener('close', () => { /* cleanup */ })

    return new Response(null, { status: 101, webSocket: client })
  }

  private handleWsMessage(msg: ClientMessage, socket: WebSocket): void {
    const canvasActor: any = this
    switch (msg.type) {
      case 'request_state':
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'state', doc: this.doc }))
        }
        break
      case 'mutation': {
        const result = canvasActor.applyMutationInternal(msg.mutation!, msg.expectedVersion!)
        if (!result.success && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'mutation_rejected', reason: result.error, currentVersion: this.doc?.version ?? 0 }))
        }
        break
      }
      case 'mcp_call': {
        const result = canvasActor.handleMcpCallInternal(msg.tool!, msg.payload, msg.expectedVersion!)
        if (!result.success && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'mcp_call_failed', reason: result.error }))
        }
        break
      }
      case 'undo': {
        const result = canvasActor.handleUndoInternal()
        if (!result.success && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'undo_failed', reason: result.error }))
        }
        break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HTTP Handlers
  // ═══════════════════════════════════════════════════════════════════════

  private async handleInit(id: string, rootId: string, nodes?: Record<string, Node>, designTokens?: any): Promise<Response> {
    if (!id || !rootId || !nodes) return new Response('Invalid init data', { status: 400 })
    this.doc = {
      id, version: 0, rootId,
      baseNodes: JSON.parse(JSON.stringify(nodes)),
      nodes: JSON.parse(JSON.stringify(nodes)),
      history: [], stagingPointer: -1, livePointer: -1,
    }
    if (designTokens) (this.doc as CanvasDocument & { designTokens: unknown }).designTokens = designTokens
    await this.snapshotNow()
    return new Response(JSON.stringify(this.doc))
  }

  private async handleRestore(canvasId?: string): Promise<Response> {
    if (this.doc) return new Response(JSON.stringify(this.doc))
    try {
      const kv = guardKV(this.env_?.TENANT_KV)
      if (!canvasId) return new Response('No canvas ID', { status: 400 })
      const docJson = await kv.get('canvas:snapshot:' + canvasId)

      this.doc = JSON.parse(docJson)
      return new Response(JSON.stringify(this.doc))
    } catch (e: any) {
      return new Response('Restore failed: ' + e.message, { status: 500 })
    }
  }

  private handleGetState(): Response {
    if (!this.doc) return new Response('Not initialized', { status: 400 })
    return new Response(JSON.stringify(this.doc))
  }

  private applyMutationInternal(mutation: Mutation, expectedVersion: number): ApplyResult {
    if (!this.doc) return { success: false, error: 'Canvas not initialized' }
    if (this.doc.version !== expectedVersion) return { success: false, error: 'Version conflict' }

    // ═══ Aegis Gate: Validate mutation structure before execution (FRS v3 Rec #1) ═══
    const gateResult = this.aegis.validate(mutation)
    if (!gateResult.valid) {
      return {
        success: false,
        error: `Aegis rejected mutation: ${gateResult.errors.map(e => `${e.path}: ${e.message}`).join('; ')}`,
      }
    }

    try {
      this.doc = applyMutation(this.doc, gateResult.mutation)
      this.doc.version += 1
      this.triggerSnapshot()
      return { success: true, newVersion: this.doc.version }
    } catch (e: any) {
      return { success: false, error: e.message || 'Mutation failed' }
    }
  }

  private handleMutation(mutation: Mutation, expectedVersion: number): Response {
    const result = this.applyMutationInternal(mutation, expectedVersion)
    if (!result.success) return new Response(JSON.stringify({ error: result.error }), { status: 409 })
    return new Response(JSON.stringify({ version: result.newVersion }))
  }

  private async handleBatchMutation(mutations: Mutation[], expectedVersion: number): Promise<Response> {
    const canvasActor: any = this
    let version = expectedVersion
    for (const mutation of mutations) {
      const result = this.applyMutationInternal(mutation, version)
      if (!result.success) return new Response(JSON.stringify({ error: result.error, failedMutation: mutation }), { status: 409 })
      version = result.newVersion!
    }
    await this.snapshotNow()
    return new Response(JSON.stringify({ version }))
  }

  // Snapshot on every non-batch mutation trigger
  private triggerSnapshot(): void {
    if (this.scheduledSnapshot) return
    this.scheduledSnapshot = true
    this.state_.waitUntil(this.snapshotNow().finally(() => { this.scheduledSnapshot = false }))
  }

  private async snapshotNow(): Promise<void> {
    if (!this.doc) return
    try {
      const kv = guardKV(this.env_?.TENANT_KV)
      await kv.put('canvas:snapshot:' + this.doc.id, JSON.stringify(this.doc), undefined, { expirationTtl: 86400 })
    } catch (e) {

    }
  }

  async alarm(): Promise<void> {
    if (this.doc) await this.snapshotNow()
  }
}

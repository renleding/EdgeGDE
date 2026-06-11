/**
 * EdgeGDE — Chat Session Durable Object
 *
 * Single source of truth for active chat session state.
 * Eliminates D1 race conditions by serializing all state mutations.
 *
 * Strict rules:
 * - Contains ZERO business logic — delegates to processChatState
 * - State mutations complete BEFORE streaming begins
 * - D1 is persistence-only; DO state always wins
 */

const SNAPSHOT_INTERVAL = 5

export interface ChatSessionState {
  sessionId: string
  tenantId: string
  collected: Record<string, unknown>
  currentField: string
  status: 'active' | 'complete' | 'abandoned'
  stepCount: number
  flowStack?: FlowStackEntry[]
  activeFlowIndex?: number
  globalCollected?: Record<string, unknown>
  ocrStatus?: string
  createdAt: number
  updatedAt: number
}

export interface FlowStackEntry {
  flowId: string
  scope: string
  type: string
  requiresAuth: boolean
  insightId?: string
  state: 'ACTIVE' | 'COMPLETED' | 'BLOCKED'
  completedFields: string[]
  completedDocs: string[]
  authState?: 'PENDING' | 'VERIFIED'
  blockReason?: string
  totalWeight: { fields: number; docs: number; compliance: number }
}

export class ChatSession_DO {
  private state: ChatSessionState | null = null
  private scheduledSnapshot = false
  readonly state_: DurableObjectState
  private env: any

  constructor(state: DurableObjectState, env: any) {
    this.state_ = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/hydrate') {
      const { tenantId } = await request.json() as { tenantId: string }
      await this.hydrateFromD1(tenantId)
      return new Response('OK')
    }

    if (path === '/init') {
      const { sessionId, tenantId } = await request.json() as { sessionId: string; tenantId: string }
      this.state = {
        sessionId,
        tenantId,
        collected: {},
        currentField: '',
        status: 'active',
        stepCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      return new Response(JSON.stringify(this.state))
    }

    if (path === '/state') {
      if (!this.state) return new Response('Not initialized', { status: 400 })
      return new Response(JSON.stringify(this.state))
    }

    if (path === '/update') {
      if (!this.state) {
        // Auto-initialize if not yet started
        this.state = {
          sessionId: '',
          tenantId: '',
          collected: {},
          globalCollected: {},
          flowStack: [],
          activeFlowIndex: 0,
          currentField: '',
          status: 'active',
          ocrStatus: '',
          stepCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      }
      const state: ChatSessionState = this.state!
      const { collected, nextField } = await request.json() as { collected: Record<string, unknown>; nextField: string }
      state.collected = { ...state.collected, ...(collected || {}) }
      state.currentField = nextField || ''
      state.stepCount++
      state.updatedAt = Date.now()
      if (this.shouldSnapshot()) this.triggerSnapshot()
      return new Response(JSON.stringify(this.state))
    }

    if (path === '/complete') {
      if (!this.state) return new Response('Not initialized', { status: 400 })
      this.state.status = 'complete'
      this.state.updatedAt = Date.now()
      await this.snapshotNow()
      return new Response('OK')
    }

    return new Response('Unknown action', { status: 400 })
  }

  private async hydrateFromD1(tenantId: string): Promise<void> {
    if (this.state) return
    try {
      const db = this.env?.DB
      if (!db) return
      const row: any = await db.prepare(
        `SELECT id, collected_fields_json, state_json, status FROM chat_sessions WHERE id = ? AND tenant_id = ?`
      ).bind(this.state_.id.toString(), tenantId).first()
      if (row) {
        this.state = {
          sessionId: row.id,
          tenantId,
          collected: row.collected_fields_json ? JSON.parse(row.collected_fields_json) : {},
          currentField: row.state_json ? (JSON.parse(row.state_json).currentField || '') : '',
          status: row.status || 'active',
          stepCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      }
    } catch { /* non-blocking */ }
  }

  private shouldSnapshot(): boolean {
    return this.state !== null && this.state.stepCount % SNAPSHOT_INTERVAL === 0
  }

  private triggerSnapshot(): void {
    if (this.scheduledSnapshot) return
    this.scheduledSnapshot = true
    this.state_.waitUntil(this.snapshotNow())
  }

  private async snapshotNow(): Promise<void> {
    if (!this.state) return
    try {
      const db = this.env?.DB
      if (!db) return
      const s = this.state
      await db.prepare(
        `UPDATE chat_sessions SET collected_fields_json = ?, state_json = ?, status = ?, updated_at = ? WHERE id = ?`
      ).bind(
        JSON.stringify(s.collected),
        JSON.stringify({ currentField: s.currentField }),
        s.status,
        s.updatedAt,
        s.sessionId,
      ).run()
    } catch (e) {
      console.error('[ChatSession_DO] snapshot failed:', e)
    } finally {
      this.scheduledSnapshot = false
    }
  }

  async alarm(): Promise<void> {
    if (this.state && this.state.status === 'active') {
      await this.snapshotNow()
    }
  }
}

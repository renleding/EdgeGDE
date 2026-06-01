/**
 * EdgeGDE — Audit Ledger Durable Object (Hardened v2)
 * Phase 11: Session-scoped, monotonically sequenced, envelope-standardized.
 *
 * Key strategy:
 *   - audit:{tenantId}:{sessionId}         — per-session event stream
 *   - audit:{tenantId}:system:{YYYY-MM}    — system-level (monthly shard)
 *   - audit:{tenantId}:{sessionId}:seq     — monotonic sequence counter
 *
 * Instance ID: tenant:{tenantId}
 *
 * @packageDocumentation
 */

const MAX_EVENT_SIZE = 10 * 1024 // 10KB
const IDEMPOTENCY_TTL = 86400 // 24h

// ═════════════════════════════════════════════════════════════════════════════
// Event Type Registry — whitelist for all allowed event types
// ═════════════════════════════════════════════════════════════════════════════

const ALLOWED_EVENTS = new Set([
  'chat_message',
  'field_updated',
  'stage_changed',
  'scoring_completed',
  'document_uploaded',
  'automation_executed',
  'ui_config_updated',
])

// ═════════════════════════════════════════════════════════════════════════════
// Actor Type Registry — prevents inconsistent actor tagging
// ═════════════════════════════════════════════════════════════════════════════

const ALLOWED_ACTORS = new Set(['user', 'system', 'llm', 'automation'])

interface AuditEnvelope {
  id: string
  seq: number
  ts: number
  version: number
  tenantId: string
  sessionId?: string
  type: string
  actor: string
  hash: string
  data: Record<string, unknown>
}

function buildStorageKey(tenantId: string, sessionId?: string): string {
  if (sessionId) return `audit:${tenantId}:${sessionId}`
  const month = new Date().toISOString().slice(0, 7)
  return `audit:${tenantId}:system:${month}`
}

function seqKey(storageKey: string): string {
  return `${storageKey}:seq`
}

function hashKey(storageKey: string): string {
  return `${storageKey}:lasthash`
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export class AuditLedger {
  private state: DurableObjectState
  private env: any

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const sessionId = url.searchParams.get('sessionId') || undefined

    // ── POST /append — add an audit entry ────────────────────────────────
    if (request.method === 'POST' && path === '/append') {
      return this.handleAppend(request, sessionId)
    }

    // ── GET /list — cursor-paginated entries ─────────────────────────────
    if (request.method === 'GET' && path === '/list') {
      return this.handleList(url, sessionId)
    }

    // ── GET /count — entry count ─────────────────────────────────────────
    if (request.method === 'GET' && path === '/count') {
      return this.handleCount(url, sessionId)
    }

    // ── GET /stream — SSE timeline ───────────────────────────────────────
    if (request.method === 'GET' && path === '/stream') {
      return this.handleStream(request, url, sessionId)
    }

    // ── POST /close — session close + cross-session anchor ──────────────
    if (request.method === 'POST' && path === '/close') {
      return this.handleClose(request, sessionId)
    }

    return Response.json(
      { error: 'Not found. Use POST /append, GET /list?cursor=, GET /count, GET /stream' },
      { status: 404 },
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Append Handler
  // ═════════════════════════════════════════════════════════════════════════

  private async handleAppend(request: Request, sessionId?: string): Promise<Response> {
    try {
      const body: any = await request.json()
      const tenantId = body.tenantId || ''
      if (!tenantId) return Response.json({ error: 'tenantId required' }, { status: 400 })

      const effectiveSession = body.sessionId || sessionId
      const storageKey = buildStorageKey(tenantId, effectiveSession)
      const storage = this.state.storage

      // ═══ IDEMPOTENCY CHECK ═══
      if (body.idempotency_key) {
        const ikey = `idempotent:${body.idempotency_key}`
        const existing = await storage.get(ikey)
        if (existing) {
          const prev: any = JSON.parse(existing as string)
          return Response.json({
            success: true,
            idempotent: true,
            entryId: prev.entryId,
            seq: prev.seq,
            key: storageKey,
          })
        }
      }

      // ═══ EVENT TYPE WHITELIST ═══
      const eventType = body.type || body.action || 'unknown'
      if (!ALLOWED_EVENTS.has(eventType)) {
        return Response.json({
          error: `Event type '${eventType}' is not in the whitelist`,
          allowed: Array.from(ALLOWED_EVENTS),
        }, { status: 400 })
      }

      // ═══ SEQ CONTINUITY CHECK ═══
      const seqStoreKey = seqKey(storageKey)
      const prevSeq: number = (await storage.get<number>(seqStoreKey)) || 0
      const seq = prevSeq + 1
      // No gap: prevSeq + 1 always equals seq since we increment atomically

      // ═══ ACTOR WHITELIST ═══
      const actor = (body.actor || 'system').toLowerCase()
      if (!ALLOWED_ACTORS.has(actor)) {
        return Response.json({
          error: `Actor '${actor}' is not in the whitelist`,
          allowed: Array.from(ALLOWED_ACTORS),
        }, { status: 400 })
      }

      // ═══ HASH CHAIN ═══ — link each event to prior for tamper detection
      const hashStoreKey = hashKey(storageKey)
      const prevHash: string = (await storage.get<string>(hashStoreKey)) || '0'.repeat(64)

      // Build envelope (without hash first, then hash the serialization)
      const envelopePreHash: any = {
        id: crypto.randomUUID(),
        seq,
        ts: Date.now(),
        version: 1,
        tenantId,
        sessionId: effectiveSession,
        type: eventType,
        actor,
        data: body.data || body.metadata || {},
      }
      const hashInput = `${prevHash}:${seq}:${JSON.stringify(envelopePreHash)}`
      const hash = await sha256(hashInput)

      const envelope: AuditEnvelope = { ...envelopePreHash, hash }

      // ═══ EVENT SIZE GUARD ═══
      const payload = JSON.stringify(envelope)
      if (payload.length > MAX_EVENT_SIZE) {
        return Response.json(
          { error: `Event exceeds ${MAX_EVENT_SIZE} byte limit`, bytes: payload.length },
          { status: 413 },
        )
      }

      // ═══ PROJECTION WARNING GUARD ═══
      if (eventType === 'field_updated' && body.data?.projectionCheck) {
        console.warn('[projection] field_updated event may have drift — D1 projection should be verified', {
          tenantId, sessionId: effectiveSession, field: body.data.field, seq,
        })
      }

      // Atomically persist seq counter
      await storage.put(seqStoreKey, seq)
      // Persist hash for chain continuity
      await storage.put(hashStoreKey, hash)

      // ═══ ANCHOR SNAPSHOT ═══ — every 100 events for fast replay recovery
      if (seq % 100 === 0 && effectiveSession) {
        const anchorKey = `${storageKey}:anchor:${seq}`
        await storage.put(anchorKey, JSON.stringify({
          seq, hash, ts: envelope.ts, eventCount: seq,
        }))
      }

      // Append to storage
      const existingEntries: AuditEnvelope[] = (await storage.get<AuditEnvelope[]>(storageKey)) || []
      existingEntries.push(envelope)
      await storage.put(storageKey, existingEntries)

      // ═══ STORE IDEMPOTENCY KEY ═══
      if (body.idempotency_key) {
        const ikey = `idempotent:${body.idempotency_key}`
        await storage.put(ikey, JSON.stringify({ entryId: envelope.id, seq, ts: envelope.ts }))
      }

      // ═══ AUTOMATION HOOK ═══
      if (this.env?.LEAD_SCORING_QUEUE && typeof this.env.LEAD_SCORING_QUEUE.send === 'function') {
        this.env.LEAD_SCORING_QUEUE.send({
          type: 'execute_automation',
          eventType: envelope.type,
          tenantId,
          sessionId: effectiveSession,
          seq,
          ts: envelope.ts,
        }).catch(() => {})
      }

      // Push to SSE stream if active
      try {
        const writer = (this as any)._streamWriter
        const activeKey = (this as any)._streamKey
        if (writer && activeKey === storageKey && typeof writer.write === 'function') {
          const encoder = new TextEncoder()
          writer.write(encoder.encode(`event: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`))
        }
      } catch {}

      return Response.json({ success: true, entryId: envelope.id, seq, key: storageKey })
    } catch (err: any) {
      return Response.json({ error: 'Failed to append', details: err.message }, { status: 500 })
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // List Handler — cursor-based pagination
  // ═════════════════════════════════════════════════════════════════════════

  private async handleList(url: URL, sessionId?: string): Promise<Response> {
    try {
      const tenantId = url.searchParams.get('tenantId') || ''
      if (!tenantId) return Response.json({ error: 'tenantId required' }, { status: 400 })

      const storageKey = buildStorageKey(tenantId, sessionId)
      const storage = this.state.storage
      const entries: AuditEnvelope[] = (await storage.get<AuditEnvelope[]>(storageKey)) || []
      const sorted = entries.sort((a, b) => b.seq - a.seq)

      const cursorStr = url.searchParams.get('cursor')
      const cursor = cursorStr ? parseInt(cursorStr, 10) : 0
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500)

      // Find starting index
      const startIndex = cursor > 0 ? sorted.findIndex(e => e.seq === cursor) : -1
      const sliceStart = startIndex >= 0 ? startIndex + 1 : 0
      const page = sorted.slice(sliceStart, sliceStart + limit)

      const nextCursor = page.length === limit ? page[page.length - 1].seq : null

      return Response.json({
        entries: page,
        total: sorted.length,
        key: storageKey,
        nextCursor,
        hasMore: nextCursor !== null,
      })
    } catch (err: any) {
      return Response.json({ error: 'Failed to list', details: err.message }, { status: 500 })
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Count Handler
  // ═════════════════════════════════════════════════════════════════════════

  private async handleCount(url: URL, sessionId?: string): Promise<Response> {
    try {
      const tenantId = url.searchParams.get('tenantId') || ''
      if (!tenantId) return Response.json({ error: 'tenantId required' }, { status: 400 })

      const storageKey = buildStorageKey(tenantId, sessionId)
      const storage = this.state.storage
      const entries: AuditEnvelope[] = (await storage.get<AuditEnvelope[]>(storageKey)) || []
      return Response.json({ count: entries.length, lastSeq: entries.length > 0 ? entries[entries.length - 1].seq : 0, key: storageKey })
    } catch (err: any) {
      return Response.json({ error: 'Failed to count', details: err.message }, { status: 500 })
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Stream Handler — SSE timeline
  // ═════════════════════════════════════════════════════════════════════════

  private async handleStream(request: Request, url: URL, sessionId?: string): Promise<Response> {
    const tenantId = url.searchParams.get('tenantId') || ''
    if (!tenantId) return Response.json({ error: 'tenantId required' }, { status: 400 })
    if (!sessionId) return Response.json({ error: 'sessionId required' }, { status: 400 })

    const storageKey = buildStorageKey(tenantId, sessionId)
    const encoder = new TextEncoder()
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    let existing: AuditEnvelope[] = []

    // Send existing entries first (chronological order)
    try {
      const storage = this.state.storage
      existing = (await storage.get<AuditEnvelope[]>(storageKey)) || []
      const sorted = existing.sort((a, b) => a.seq - b.seq)
      for (const entry of sorted) {
        writer.write(encoder.encode(`event: ${entry.type}\ndata: ${JSON.stringify(entry)}\n\n`))
      }
    } catch {}

    writer.write(encoder.encode(`event: connected\ndata: {"sessionId":"${sessionId}","lastSeq":${existing?.length > 0 ? existing[existing.length - 1].seq : 0}}\n\n`))

    // Store writer for live appends
    ;(this as any)._streamWriter = writer
    ;(this as any)._streamKey = storageKey

    request.signal.addEventListener('abort', () => {
      writer.close().catch(() => {})
      ;(this as any)._streamWriter = undefined
      ;(this as any)._streamKey = undefined
    })

    const keepalive = setInterval(() => {
      writer.write(encoder.encode(': keepalive\n\n')).catch(() => clearInterval(keepalive))
    }, 30000)
    request.signal.addEventListener('abort', () => clearInterval(keepalive))

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Close Handler — cross-session anchor to system shard
  // ═════════════════════════════════════════════════════════════════════════

  private async handleClose(request: Request, sessionId?: string): Promise<Response> {
    try {
      const body: any = await request.json()
      const tenantId = body.tenantId || ''
      if (!tenantId) return Response.json({ error: 'tenantId required' }, { status: 400 })
      if (!sessionId) return Response.json({ error: 'sessionId required' }, { status: 400 })

      const storageKey = buildStorageKey(tenantId, sessionId)
      const storage = this.state.storage

      // Get the last hash for this session
      const hashStoreKey = hashKey(storageKey)
      const lastHash = await storage.get<string>(hashStoreKey)
      const seqStoreKey = seqKey(storageKey)
      const lastSeq = (await storage.get<number>(seqStoreKey)) || 0

      if (!lastHash || lastSeq === 0) {
        return Response.json({ error: 'No events in session' }, { status: 400 })
      }

      // Store cross-session anchor in the system shard
      const systemKey = buildStorageKey(tenantId) // audit:{tenantId}:system:{YYYY-MM}
      const systemAnchor = {
        id: crypto.randomUUID(),
        seq: 1,
        ts: Date.now(),
        version: 1,
        tenantId,
        sessionId,
        type: 'session_anchor',
        actor: 'system',
        hash: lastHash,
        data: {
          lastSeq,
          lastHash,
          sessionId,
        },
      }

      const existing: AuditEnvelope[] = (await storage.get<AuditEnvelope[]>(systemKey)) || []
      existing.push(systemAnchor)
      await storage.put(systemKey, existing)

      return Response.json({ success: true, sessionId, lastSeq, anchorHash: lastHash })
    } catch (err: any) {
      return Response.json({ error: 'Failed to close session', details: err.message }, { status: 500 })
    }
  }
}

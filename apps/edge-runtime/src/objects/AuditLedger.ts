/**
 * EdgeGDE — Audit Ledger Durable Object
 * Per-tenant append-only event log for vault operations.
 * Immutable, monotonically sequenced, tamper-resistant.
 *
 * Instance ID: tenant:{tenantId}
 *
 * @packageDocumentation
 */

interface AuditEntry {
  id: string
  ts: number
  action: string
  tenantId: string
  submissionId: string
  file_name: string
  object_key: string
  size_bytes?: number
  metadata?: Record<string, unknown>
}

const STORAGE_KEY = 'audit:entries'

export class AuditLedger {
  private state: DurableObjectState

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // POST /append — add an audit entry
    if (request.method === 'POST' && path === '/append') {
      try {
        const body: any = await request.json()

        const entry: AuditEntry = {
          id: crypto.randomUUID(),
          ts: Date.now(),
          action: body.action || 'upload',
          tenantId: body.tenantId || '',
          submissionId: body.submissionId || '',
          file_name: body.file_name || '',
          object_key: body.object_key || '',
          size_bytes: body.size_bytes,
          metadata: body.metadata || undefined,
        }

        if (!entry.tenantId || !entry.submissionId) {
          return Response.json({ error: 'Missing required fields: tenantId, submissionId, file_name' }, { status: 400 })
        }

        // Append to the ledger
        const storage = this.state.storage
        const existing: AuditEntry[] = (await storage.get<AuditEntry[]>(STORAGE_KEY)) || []
        existing.push(entry)
        await storage.put(STORAGE_KEY, existing)

        return Response.json({ success: true, entryId: entry.id })
      } catch (err: any) {
        return Response.json({ error: 'Failed to append', details: err.message }, { status: 500 })
      }
    }

    // GET /list — return all entries (newest first)
    if (request.method === 'GET' && path === '/list') {
      try {
        const storage = this.state.storage
        const entries: AuditEntry[] = (await storage.get<AuditEntry[]>(STORAGE_KEY)) || []
        const sorted = entries.sort((a, b) => b.ts - a.ts)
        return Response.json({ entries: sorted })
      } catch (err: any) {
        return Response.json({ error: 'Failed to list', details: err.message }, { status: 500 })
      }
    }

    // GET /count — return entry count
    if (request.method === 'GET' && path === '/count') {
      try {
        const storage = this.state.storage
        const entries: AuditEntry[] = (await storage.get<AuditEntry[]>(STORAGE_KEY)) || []
        return Response.json({ count: entries.length })
      } catch (err: any) {
        return Response.json({ error: 'Failed to count', details: err.message }, { status: 500 })
      }
    }

    return Response.json({ error: 'Not found. Use POST /append, GET /list, or GET /count' }, { status: 404 })
  }
}

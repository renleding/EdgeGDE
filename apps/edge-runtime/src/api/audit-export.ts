/**
 * EdgeGDE — Audit Export Endpoint
 * GET /api/v1/admin/audit/export
 * Compliance-grade audit trail for sessions, rules, and disclosures.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { guardDB } from '../lib/db'
import { queryAuditLogs } from '../lib/audit'

const auditRouter = new Hono()

auditRouter.get('/export', async (c) => {
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query param required' }, 400)

  const db = guardDB((c.env as any)?.DB)
  const ctx = { tenantId, env: c.env }

  const sessionId = c.req.query('session_id') || undefined
  const eventType = c.req.query('event_type') || undefined
  const limit = parseInt(c.req.query('limit') || '100', 10)
  const offset = parseInt(c.req.query('offset') || '0', 10)

  const events = await queryAuditLogs(
    (c.env as any)?.DB,
    tenantId,
    { sessionId, eventType, limit, offset }
  )

  const parsed = events.map((e: any) => ({
    id: e.id,
    session_id: e.session_id,
    event_type: e.event_type,
    payload: tryParse(e.payload_json),
    timestamp: e.created_at,
  }))

  return c.json({
    tenant_id: tenantId,
    total: parsed.length,
    events: parsed,
  })
})

function tryParse(s: string): any {
  try { return JSON.parse(s) } catch { return s }
}

export { auditRouter }

/**
 * EdgeGDE — Audit Logger
 * Minimal, deterministic audit event logging for compliance and traceability.
 * Logs key events: rule_evaluated, disclosure_shown, chat_response
 *
 * @packageDocumentation
 */

export async function logAuditEvent(
  db: any,
  tenantId: string,
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!db || !tenantId || !sessionId || !eventType) return

  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const payloadJson = JSON.stringify(payload)

  try {
    await db.prepare(
      'INSERT INTO audit_logs (id, tenant_id, session_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, tenantId, sessionId, eventType, payloadJson, now).run()
  } catch {
    // Non-blocking — audit failures never break the runtime
  }
}

/**
 * Query audit logs for a tenant.
 */
export async function queryAuditLogs(
  db: any,
  tenantId: string,
  options: { sessionId?: string; eventType?: string; limit?: number; offset?: number } = {},
): Promise<any[]> {
  if (!db) return []

  const conditions: string[] = ['tenant_id = ?']
  const params: unknown[] = [tenantId]

  if (options.sessionId) {
    conditions.push('session_id = ?')
    params.push(options.sessionId)
  }
  if (options.eventType) {
    conditions.push('event_type = ?')
    params.push(options.eventType)
  }

  const limit = Math.min(Math.max(1, options.limit || 100), 1000)
  const offset = Math.max(0, options.offset || 0)

  try {
    const { results } = await db.prepare(
      `SELECT * FROM audit_logs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all()
    return results || []
  } catch {
    return []
  }
}

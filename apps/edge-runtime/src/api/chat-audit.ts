/**
 * EdgeGDE Chat — Audit Module
 * Immutable event logging via AuditLedger DO.
 *
 * @packageDocumentation
 */

export async function logAuditEvent(
  env: any,
  tenantId: string | undefined,
  action: string,
  submissionId: string,
  sessionId: string | undefined,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const auditDo = (env as any)?.AUDIT_LEDGER
    if (!auditDo || typeof auditDo.idFromName !== 'function') return
    if (!tenantId) return

    const doId = auditDo.idFromName(`tenant:${tenantId}`)
    const stub = auditDo.get(doId)
    await stub.fetch('http://do/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: action,
        actor: 'system',
        tenantId,
        sessionId,
        submissionId: submissionId || '',
        data: metadata || {},
      }),
    })
  } catch (err) {
    console.warn('[audit] append failed:', err)
  }
}

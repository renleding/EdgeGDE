/**
 * EdgeGDE — MCP Swarm Ingress Endpoint
 * Phase 21: External agent ingestion only.
 * Internal agents bypass this endpoint entirely.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

export const swarmRouter = new Hono()

const ALLOWED_EVENTS = ['affordability_assessed', 'risk_profile_generated', 'application_readiness_evaluated']

// ═════════════════════════════════════════════════════════════════════════════
// POST /swarm/ingress — external agent event ingestion
// ═════════════════════════════════════════════════════════════════════════════

swarmRouter.post('/swarm/ingress', async (c) => {
  try {
    // 1. Auth — verify SWARM_AUTH_TOKEN
    const authHeader = c.req.header('authorization') || ''
    const expectedToken = (c.env as any)?.SWARM_AUTH_TOKEN
    if (!expectedToken) return c.json({ error: 'Swarm auth not configured' }, 500)
    if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== expectedToken) {
      return c.json({ error: 'Invalid or missing swarm token' }, 401)
    }

    // 2. Validate body
    const body: any = await c.req.json()
    const { event_type, application_id, payload } = body
    if (!event_type) return c.json({ error: 'event_type required' }, 400)
    if (!ALLOWED_EVENTS.includes(event_type)) return c.json({ error: `event_type must be one of: ${ALLOWED_EVENTS.join(', ')}` }, 400)
    if (!application_id) return c.json({ error: 'application_id required' }, 400)
    if (!payload || typeof payload !== 'object') return c.json({ error: 'payload must be an object' }, 400)

    // 3. Append to AuditLedger
    const doBinding = (c.env as any)?.AUDIT_LEDGER
    if (!doBinding || typeof doBinding.idFromName !== 'function') return c.json({ error: 'AUDIT_LEDGER binding required' }, 500)

    const doId = doBinding.idFromName('tenant:afirmico')
    const stub = doBinding.get(doId)
    const result: any = await stub.fetch('http://do/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: event_type,
        actor: 'mcp_swarm_engine',
        tenantId: 'au-mortgage-broker-afirmico',
        sessionId: application_id,
        submissionId: application_id,
        data: { application_id, ...payload },
      }),
    })

    if (!result.ok) {
      const err = await result.text()
      return c.json({ error: 'DO append failed', details: err }, 500)
    }

    return c.json({ success: true, status: 'event accepted' })
  } catch (err: any) {
    return c.json({ error: 'Swarm ingress failed', details: err.message }, 500)
  }
})

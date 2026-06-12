/**
 * EdgeGDE Chat — Init Module
 * Handles POST /chat/init — creates a new chat session.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { logAuditEvent } from './chat-audit'

export const initRouter = new Hono()

initRouter.post('/chat/init', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  let body: { objective?: string; contactId?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const sessionId = crypto.randomUUID()
  const now = Date.now()

  try {
    await db.prepare(
      `INSERT INTO chat_sessions (id, tenant_id, objective, state_json, collected_fields_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      sessionId,
      tenantId,
      body.objective || 'mortgage_application',
      JSON.stringify({ currentField: '', completedFields: [], errors: [], phase: 'collecting' }),
      '{}',
      now,
      now,
    ).run()

    // Audit — session created
    c.executionCtx.waitUntil(logAuditEvent(c.env, tenantId, 'chat_message', '', sessionId, { text: `Session started: ${body.objective || 'mortgage_application'}` }))

    return c.json({
      sessionId,
      tenantId,
      status: 'active',
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to create session', details: err.message }, 500)
  }
})

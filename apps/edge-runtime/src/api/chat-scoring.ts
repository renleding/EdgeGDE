/**
 * EdgeGDE Chat — Scoring Module
 * Triggers the background scoring pipeline when chat collection is complete.
 *
 * @packageDocumentation
 */

export async function triggerScoring(
  db: any,
  env: any,
  sessionId: string,
  tenantId: string,
  collected: Record<string, unknown>,
): Promise<void> {
  try {
    const submissionId = crypto.randomUUID()
    console.log('[triggerScoring] starting', { sessionId, tenantId, submissionId })

    if (!db || typeof db.prepare !== 'function') {
      console.error('[triggerScoring] D1 binding not available')
      return
    }

    const payloadStr = JSON.stringify(collected)
    if (payloadStr.length > 50000) {
      console.error('[triggerScoring] payload too large', { bytes: payloadStr.length })
      return
    }

    const insertResult = await db.prepare(
      `INSERT INTO form_submissions (id, tenant_id, form_id, payload)
       VALUES (?, ?, 'mortgage_chat', ?)`
    ).bind(submissionId, tenantId, payloadStr).run()
    console.log('[triggerScoring] D1 insert complete', { submissionId, success: !!insertResult })

    await db.prepare(
      `UPDATE chat_sessions SET submission_id = ?, status = 'complete', updated_at = ? WHERE id = ?`
    ).bind(submissionId, Date.now(), sessionId).run()
    console.log('[triggerScoring] session linked', { sessionId, submissionId })

    // Bridge: link submission to application via email
    try {
      const sessionRow: any = await db.prepare(`SELECT collected_fields_json FROM chat_sessions WHERE id = ?`).bind(sessionId).first()
      if (sessionRow?.collected_fields_json) {
        const fields: any = JSON.parse(sessionRow.collected_fields_json)
        const email: string | undefined = fields.email
        if (email) {
          const contact: any = await db.prepare(`SELECT id FROM contacts WHERE email = ? ORDER BY last_updated_ts DESC LIMIT 1`).bind(email.toLowerCase().trim()).first()
          if (contact?.id) {
            const result = await db.prepare(`UPDATE applications SET submission_id = ? WHERE contact_id = ? AND submission_id IS NULL`).bind(submissionId, contact.id).run()
            if ((result as any)?.meta?.changes === 0) {
              console.warn('[bridge] link failed — no matching application', { sessionId, email, submissionId })
            } else {
              console.log('[bridge] linked submission to application', { submissionId, contactId: contact.id })
            }
          }
        }
      }
    } catch (e) {
      console.warn('[bridge] lookup failed:', e)
    }

    // Enqueue for scoring
    const queue = (env as any)?.LEAD_SCORING_QUEUE
    if (queue && typeof queue.send === 'function') {
      const msg = {
        submissionId,
        tenantId,
        formId: 'mortgage_chat',
        payload: collected,
        contactInfo: {
          name: String(collected.fullName || ''),
          email: String(collected.email || ''),
          phone: String(collected.phone || ''),
        },
      }
      await queue.send(msg)
      console.log('[triggerScoring] queued for scoring', { submissionId })
    } else {
      console.warn('[triggerScoring] LEAD_SCORING_QUEUE binding not available')
    }
  } catch (err) {
    console.error('[triggerScoring] FAILED:', err)
    try {
      const kv = (env as any)?.TELEMETRY_KV
      if (kv && typeof kv.put === 'function') {
        await kv.put(
          `diagnostic:chat:failed:${sessionId}`,
          JSON.stringify({ sessionId, err: String(err), ts: Date.now() }),
          { expirationTtl: 86400 }
        )
      }
    } catch {}
  }
}

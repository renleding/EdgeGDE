/**
 * EdgeGDE — Workspace Origination API
 * Phase 18-20: Application lifecycle, document upload, pipeline view.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

export const workspaceRouter = new Hono()

// ═════════════════════════════════════════════════════════════════════════════
// Audit Helper — append event to AuditLedger DO
// ═════════════════════════════════════════════════════════════════════════════

async function appendEvent(env: any, tenantId: string, type: string, data: Record<string, unknown>, sessionId?: string): Promise<void> {
  try {
    const doBinding = (env as any)?.AUDIT_LEDGER
    if (!doBinding || typeof doBinding.idFromName !== 'function') return

    const doId = doBinding.idFromName(`tenant:${tenantId}`)
    const stub = doBinding.get(doId)
    await stub.fetch('http://do/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        actor: 'system',
        tenantId,
        sessionId,
        submissionId: (data.application_id || data.session_id || '') as string,
        data,
      }),
    })
  } catch {}
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /workspace/init — start a new application
// ═════════════════════════════════════════════════════════════════════════════

workspaceRouter.post('/workspace/init', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query required' }, 400)

  let body: { fullName?: string; email?: string; phone?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const sessionId = crypto.randomUUID()
  const now = Date.now()

  try {
    // 1. Upsert contact
    if (body.email) {
      const email = body.email.toLowerCase().trim()
      const existing: any = await db.prepare(
        `SELECT id FROM contacts WHERE tenant_id = ? AND email = ? LIMIT 1`
      ).bind(tenantId, email).first()

      if (!existing) {
        await db.prepare(
          `INSERT INTO contacts (id, tenant_id, name, email, phone) VALUES (?, ?, ?, ?, ?)`
        ).bind(sessionId, tenantId, body.fullName || '', email, body.phone || '').run()
      }
    }

    // 2. Create application
    await db.prepare(
      `INSERT INTO applications (id, contact_id, workflow_stage, created_ts, updated_ts)
       VALUES (?, ?, 'intake', ?, ?)`
    ).bind(sessionId, sessionId, now, now).run()

    // 3. Append events
    c.executionCtx.waitUntil(appendEvent(c.env, tenantId, 'origination_started', { session_id: sessionId, ts: now }, sessionId))
    c.executionCtx.waitUntil(appendEvent(c.env, tenantId, 'applicant_details_provided', {
      full_name: body.fullName || '', email: body.email || '', phone: body.phone || '',
    }, sessionId))

    return c.json({ success: true, applicationId: sessionId, workflowStage: 'intake' })
  } catch (err: any) {
    return c.json({ error: 'Failed to create application', details: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /workspace/advance — move application to next stage
// ═════════════════════════════════════════════════════════════════════════════

workspaceRouter.patch('/workspace/advance', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query required' }, 400)

  let body: { applicationId?: string; stage?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { applicationId, stage } = body
  if (!applicationId) return c.json({ error: 'applicationId required' }, 400)
  if (!stage) return c.json({ error: 'stage required' }, 400)

  const allowed = ['intake', 'assessment', 'submission']
  if (!allowed.includes(stage)) return c.json({ error: `stage must be one of: ${allowed.join(', ')}` }, 400)

  try {
    await db.prepare(
      `UPDATE applications SET workflow_stage = ?, updated_ts = ? WHERE id = ?`
    ).bind(stage, Date.now(), applicationId).run()

    c.executionCtx.waitUntil(appendEvent(c.env, tenantId, 'origination_stage_advanced', {
      application_id: applicationId, workflow_stage: stage,
    }))

    return c.json({ success: true, applicationId, workflowStage: stage })
  } catch (err: any) {
    return c.json({ error: 'Failed to advance stage', details: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /workspace/financials — declare financial baseline
// ═════════════════════════════════════════════════════════════════════════════

workspaceRouter.post('/workspace/financials', async (c) => {
  const db = (c.env as any)?.DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query required' }, 400)

  let body: { applicationId?: string; targetLoanAmount?: number; financials?: Record<string, unknown> }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { applicationId, targetLoanAmount } = body
  if (!applicationId) return c.json({ error: 'applicationId required' }, 400)
  if (!targetLoanAmount || targetLoanAmount < 0) return c.json({ error: 'valid targetLoanAmount required' }, 400)

  try {
    await db.prepare(
      `UPDATE applications SET target_loan_amount = ?, collected_financials_json = ?, updated_ts = ? WHERE id = ?`
    ).bind(targetLoanAmount, JSON.stringify(body.financials || {}), Date.now(), applicationId).run()

    c.executionCtx.waitUntil(appendEvent(c.env, tenantId, 'financial_baseline_declared', {
      target_loan_amount: targetLoanAmount,
      collected_financials_json: body.financials || {},
      application_id: applicationId,
    }))

    return c.json({ success: true, applicationId, targetLoanAmount })
  } catch (err: any) {
    return c.json({ error: 'Failed to record financials', details: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /workspace/upload — document upload (multipart to R2)
// ═════════════════════════════════════════════════════════════════════════════

workspaceRouter.post('/workspace/upload', async (c) => {
  const r2 = (c.env as any)?.VAULT_BUCKET
  const db = (c.env as any)?.DB
  if (!r2) return c.json({ error: 'VAULT_BUCKET binding required' }, 500)
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query required' }, 400)

  try {
    const formData = await c.req.formData()
    const file = formData.get('document_file') as File | null
    const applicationId = formData.get('application_id') as string | null
    const documentType = formData.get('document_type') as string | null

    if (!file) return c.json({ error: 'document_file field required' }, 400)
    if (!applicationId) return c.json({ error: 'application_id required' }, 400)
    if (!documentType) return c.json({ error: 'document_type required' }, 400)

    // Validate mime type
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowedMimes.includes(file.type)) {
      const msg = `Invalid file type '${file.type}'. Allowed: ${allowedMimes.join(', ')}`
      return c.json({ error: msg }, 400)
    }

    // Validate size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'File exceeds 10MB limit' }, 413)
    }

    // Compute content hash for dedup
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    // Derive storage key
    const storageKey = `docs/${applicationId}/${documentType}/${fileHash}`

    // Write to R2
    await r2.put(storageKey, buffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: { fileName: file.name, documentType, applicationId, tenantId },
    })

    // Store metadata in D1
    const docId = `${applicationId}:${documentType}`
    await db.prepare(
      `INSERT OR REPLACE INTO application_documents
       (id, application_id, document_type, storage_pointer, file_name, mime_type, size_bytes, uploaded_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(docId, applicationId, documentType, storageKey, file.name, file.type, file.size, Date.now()).run()

    // Append event
    c.executionCtx.waitUntil(appendEvent(c.env, tenantId, 'document_securely_stored', {
      application_id: applicationId,
      document_type: documentType,
      storage_pointer: storageKey,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    }))

    // Return OOB HTMX response
    return c.html(
      `<div id="doc-status-${documentType}" hx-swap-oob="true">
        <span class="badge" style="color:#3fb950">✓ ${file.name} uploaded</span>
       </div>`
    )
  } catch (err: any) {
    return c.json({ error: 'Upload failed', details: err.message }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /workspace/pipeline — HTMX pipeline view with application cards
// ═════════════════════════════════════════════════════════════════════════════

workspaceRouter.get('/workspace/pipeline', async (c) => {
  const db = (c.env as any)?.DB
  const kv = (c.env as any)?.TENANT_KV
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.html('<div>Tenant query required</div>')

  // ═══ PIPELINE CACHE ═══ — 15s TTL, cache-aside
  const cacheKey = `tenant:${tenantId}:pipeline:html`
  if (kv) {
    try {
      const cached = await kv.get(cacheKey)
      if (cached) return c.html(cached)
    } catch {}
  }

  try {
    const { results } = await db.prepare(`
      SELECT a.id, a.target_loan_amount, a.workflow_stage, a.created_ts,
             c.name as full_name, c.email, c.phone,
             a.affordability_score, a.risk_level, a.readiness_status,
             (SELECT verification_status FROM application_documents WHERE application_id = a.id LIMIT 1) as kyc_status
      FROM applications a
      JOIN contacts c ON a.contact_id = c.id
      WHERE c.tenant_id = ?
      ORDER BY a.created_ts DESC
      LIMIT 50
    `).bind(tenantId).all()

    const apps = (results || []) as any[]
    // ... (same rendering logic unchanged) ...
    const intake = apps.filter(a => a.workflow_stage === 'intake')
    const assessment = apps.filter(a => a.workflow_stage === 'assessment')
    const submission = apps.filter(a => a.workflow_stage === 'submission')

    function renderCard(app: any): string {
      return `
        <div class="card" style="border:1px solid #2d3140;border-radius:12px;padding:16px;background:rgba(255,255,255,0.03)">
          <div style="font-weight:600;color:#e1e4e8">${escapeHtml(app.full_name || 'Unknown')}</div>
          <div style="font-size:12px;color:#8b949e">$${(app.target_loan_amount || 0).toLocaleString()}</div>
          <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:#58a6ff20;color:#58a6ff;margin-top:4px">${escapeHtml(app.workflow_stage || 'intake')}</span>
        </div>`
    }

    function renderColumn(title: string, items: any[], id: string): string {
      return `
        <div id="${id}" style="flex:1;min-width:200px">
          <h3 style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#8b949e;margin-bottom:8px">${title} (${items.length})</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${items.length === 0 ? '<div style="font-size:12px;color:#4a4d55;padding:12px;text-align:center;border:1px dashed #2d3140;border-radius:8px">No applications</div>' : items.map(renderCard).join('\n')}
          </div>
        </div>`
    }

    const html = `
      <div hx-get="/api/v1/workspace/pipeline?tenant=${escapeHtml(tenantId)}" hx-trigger="every 30s" hx-swap="outerHTML">
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${renderColumn('Intake', intake, 'cards-intake')}
          ${renderColumn('Assessment', assessment, 'cards-assessment')}
          ${renderColumn('Submission', submission, 'cards-submission')}
        </div>
      </div>`

    // Write to KV cache with 15s TTL
    if (kv) {
      c.executionCtx.waitUntil(
        kv.put(cacheKey, html, { expirationTtl: 15 }).catch(() => {})
      )
    }

    return c.html(html)
  } catch (err: any) {
    return c.html(`<div style="color:#f85149">Pipeline error: ${escapeHtml(err.message)}</div>`)
  }
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * EdgeGDE — Document Vault API
 * Track 4 Phase 5: Upload files to R2, track metadata in D1.
 * Streams file content directly to R2 without intermediate buffering.
 * Download uses D1 lookup for tenant isolation — never constructs keys from URL.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { adminAuth } from '../middleware/auth'
import { envFromContext, type Env } from '../lib/env'

export const vaultRouter = new Hono()

// All vault endpoints require admin auth
vaultRouter.use('*', adminAuth)

// ═══════════════════════════════════════════════════════════════════════════
// PUT /vault/upload/:submissionId/:filename
// ═══════════════════════════════════════════════════════════════════════════

vaultRouter.put('/upload/:submissionId/:filename', async (c) => {
  const vault = envFromContext(c).VAULT_BUCKET
  if (!vault) {
    return c.json({
      error: 'VAULT_BUCKET not configured',
      message: 'R2 bucket edgegde-vault must be created and bound. Enable R2 in the Cloudflare Dashboard first.',
    }, 501)
  }

  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const submissionId = c.req.param('submissionId')
  let filename = c.req.param('filename')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  // Size limit check before streaming
  const contentLength = c.req.header('content-length')
  if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
    return c.json({ error: 'File exceeds 100MB maximum upload size' }, 413)
  }

  // Sanitise filename: strip path separators, collapse whitespace
  filename = filename.replace(/[/\\]/g, '_').replace(/\s+/g, '_').replace(/\.\./g, '')
  if (!filename) return c.json({ error: 'Invalid filename after sanitization' }, 400)

  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const body = c.req.raw.body
  if (!body) return c.json({ error: 'Request body required' }, 400)

  const docId = crypto.randomUUID()
  const objectKey = `tenant/${tenantId}/submission/${submissionId}/${docId}-${filename}`

  try {
    // 1. Stream directly to R2 — no intermediate buffer
    const r2Object = await vault.put(objectKey, body, {
      httpMetadata: { contentType },
      customMetadata: {
        docId,
        tenantId,
        submissionId,
        fileName: filename,
      },
    })

    const sizeBytes = r2Object.size

    // 2. Record metadata in D1
    await db.prepare(
      `INSERT INTO document_vault (id, tenant_id, submission_id, file_name, object_key, content_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(docId, tenantId, submissionId, filename, objectKey, contentType, sizeBytes).run()

    // 3. Fire-and-forget audit event
    c.executionCtx.waitUntil(logAudit(envFromContext(c), {
      type: 'upload',
      actor: 'system',
      tenantId,
      submissionId,
      file_name: filename,
      object_key: objectKey,
      data: { file_name: filename, object_key: objectKey, size_bytes: sizeBytes },
    }))

    console.log(JSON.stringify({
      event: 'vault_upload',
      docId,
      tenantId,
      submissionId,
      filename,
      sizeBytes,
      contentType,
    }))

    return c.json({
      success: true,
      docId,
      objectKey,
      fileName: filename,
      sizeBytes,
      contentType,
      message: `Uploaded ${filename} (${sizeBytes} bytes)`,
    })
  } catch (err: any) {
    console.error('[vault] upload failed:', err)
    return c.json({ error: 'Upload failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /vault/download/:submissionId/:filename — delete from R2 + D1
// ═══════════════════════════════════════════════════════════════════════════

vaultRouter.delete('/download/:submissionId/:filename', async (c) => {
  const vault = envFromContext(c).VAULT_BUCKET
  if (!vault) return c.json({ error: 'VAULT_BUCKET not configured' }, 501)

  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const submissionId = c.req.param('submissionId')
  const filename = c.req.param('filename')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    // 1. D1 lookup — verify tenant ownership, get object_key + id
    const doc: any = await db.prepare(
      `SELECT id, object_key FROM document_vault
       WHERE tenant_id = ? AND submission_id = ? AND file_name = ?
       ORDER BY uploaded_at DESC LIMIT 1`
    ).bind(tenantId, submissionId, filename).first()

    if (!doc) return c.json({ error: 'File not found' }, 404)

    // 2. Delete from R2
    await vault.delete(doc.object_key)

    // 3. Delete metadata row from D1
    await db.prepare('DELETE FROM document_vault WHERE id = ?').bind(doc.id).run()

    // 4. Fire-and-forget audit event
    c.executionCtx.waitUntil(logAudit(envFromContext(c), {
      type: 'delete',
      actor: 'system',
      tenantId,
      submissionId,
      file_name: filename,
      object_key: doc.object_key,
      data: { file_name: filename, object_key: doc.object_key },
    }))

    return c.json({ success: true, deleted: filename, docId: doc.id })
  } catch (err: any) {
    return c.json({ error: 'Delete failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /vault/audit — proxy to AuditLedger DO (must be before /:submissionId)
// ═══════════════════════════════════════════════════════════════════════════

vaultRouter.get('/audit', async (c) => {
  const doBinding = envFromContext(c).AUDIT_LEDGER
  if (!doBinding || typeof doBinding.idFromName !== 'function') {
    return c.json({ error: 'AUDIT_LEDGER not configured' }, 501)
  }

  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    const doId = doBinding.idFromName(`tenant:${tenantId}`)
    const stub = doBinding.get(doId)
    const res = await stub.fetch('http://do/list')
    const data: any = await res.json()
    return c.json(data)
  } catch (err: any) {
    return c.json({ error: 'Audit query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /vault/:submissionId — list documents for a submission
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: This route must be registered AFTER /audit to avoid conflicts

vaultRouter.get('/:submissionId', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const submissionId = c.req.param('submissionId')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    const { results } = await db.prepare(
      `SELECT id, file_name, content_type, size_bytes, uploaded_at
       FROM document_vault
       WHERE submission_id = ? AND tenant_id = ?
       ORDER BY uploaded_at DESC`
    ).bind(submissionId, tenantId).all()

    return c.json({ documents: results || [] })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /vault/download/:submissionId/:filename — stream file from R2
// ═══════════════════════════════════════════════════════════════════════════
// Tenant isolation: D1 query first, then fetch the stored object_key.
// Never constructs R2 keys from URL parameters directly.

vaultRouter.get('/download/:submissionId/:filename', async (c) => {
  const vault = envFromContext(c).VAULT_BUCKET
  if (!vault) return c.json({ error: 'VAULT_BUCKET not configured' }, 501)

  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const submissionId = c.req.param('submissionId')
  const filename = c.req.param('filename')
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query parameter required' }, 400)

  try {
    // 1. D1 lookup — verifies tenant ownership
    const doc: any = await db.prepare(
      `SELECT id, object_key, content_type
       FROM document_vault
       WHERE tenant_id = ? AND submission_id = ? AND file_name = ?
       ORDER BY uploaded_at DESC LIMIT 1`
    ).bind(tenantId, submissionId, filename).first()

    if (!doc) return c.json({ error: 'File not found' }, 404)

    // 2. R2 fetch using stored object_key (never from URL)
    const object = await vault.get(doc.object_key)
    if (!object) return c.json({ error: 'File not found in storage' }, 404)

    const headers = new Headers()
    headers.set('Content-Type', doc.content_type || 'application/octet-stream')
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    headers.set('Cache-Control', 'private, max-age=3600')

    // 3. Fire-and-forget audit event
    c.executionCtx.waitUntil(logAudit(envFromContext(c), {
      type: 'download',
      actor: 'system',
      tenantId,
      submissionId,
      file_name: filename,
      object_key: doc.object_key,
      data: { file_name: filename, object_key: doc.object_key },
    }))

    return new Response(object.body, { headers })
  } catch (err: any) {
    return c.json({ error: 'Download failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Audit Helper — fire-and-forget DO append
// ═══════════════════════════════════════════════════════════════════════════

interface AuditEvent {
  type: string
  actor: string
  tenantId: string
  submissionId: string
  file_name: string
  object_key: string
  data: Record<string, unknown>
}

async function logAudit(env: Env, event: AuditEvent): Promise<void> {
  try {
    const doBinding = env.AUDIT_LEDGER
    if (!doBinding || typeof doBinding.idFromName !== 'function') return

    const doId = doBinding.idFromName(`tenant:${event.tenantId}`)
    const stub = doBinding.get(doId)
    await stub.fetch('http://do/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: event.type,
        actor: event.actor,
        tenantId: event.tenantId,
        submissionId: event.submissionId,
        data: event.data,
      }),
    })
  } catch {
    // Audit failure is non-blocking
  }
}

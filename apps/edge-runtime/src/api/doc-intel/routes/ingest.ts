/**
 * EdgeGDE — Document Intelligence Ingest Endpoint
 *
 * POST /api/v1/doc-intel/ingest
 * Accepts multipart file upload → stores original in R2 → creates D1 record → creates processing job.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { resolveTenant, resolveBindings, errorBody } from '../lib/errors'
import { queryRun } from '../lib/db'
import { auditStageStarted } from '../lib/audit'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

/** Allowed MIME types for document upload */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/tiff',
]

export const ingestRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /ingest
// ═══════════════════════════════════════════════════════════════════════════

ingestRouter.post('/ingest', async (c) => {
  const startTime = Date.now()
  const workflowId = crypto.randomUUID()

  try {
    // 1. Resolve tenant
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    // 2. Resolve bindings
    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db, r2 } = bindings

    // 3. Parse multipart upload
    const body = await c.req.parseBody()
    const file = body['file'] as File | null

    if (!file) {
      const err = errorBody('INVALID_INPUT', 'No file provided. Use multipart field name "file".')
      return c.json(err.body, err.status)
    }

    // 4. Validate file
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
    if (!ALLOWED_MIME_TYPES.includes(file.type) && ext !== 'pdf') {
      const err = errorBody('INVALID_FILE_TYPE', `Unsupported file type: ${file.type}. Allowed: PDF, JPEG, PNG, HEIC, TIFF.`)
      return c.json(err.body, err.status)
    }

    if (file.size > MAX_FILE_SIZE) {
      const err = errorBody('FILE_TOO_LARGE', `File exceeds 100MB maximum (${file.size} bytes).`)
      return c.json(err.body, err.status)
    }

    // 5. Create R2 key (UUID-based per R2-002)
    const documentId = crypto.randomUUID()
    const r2Key = `documents/${documentId}.${ext}`

    // 6. Sanitize display filename per FN-001 convention
    const filenameDisplay = file.name.replace(/[/\\]/g, '_').replace(/\s+/g, '_')

    // 7. Upload original to R2 (kept forever per R2-005)
    const buffer = await file.arrayBuffer()
    await r2.put(r2Key, buffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        documentId,
        tenant,
        filename: filenameDisplay,
        originalSize: String(file.size),
      },
    })

    // 8. Create document record in D1
    await queryRun(
      db,
      `INSERT INTO documents (
        document_id, document_type, filename_display,
        original_r2_key, original_size_bytes, ocr_status,
        document_version, active_version, data_classification,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 1, 1, 'CONFIDENTIAL', unixepoch(), unixepoch())`,
      documentId,
      'unknown',
      filenameDisplay,
      r2Key,
      file.size,
    )

    // 9. Create processing job
    const jobId = crypto.randomUUID()
    await queryRun(
      db,
      `INSERT INTO processing_jobs (
        job_id, document_id, status, attempt_count, workflow_id,
        created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, unixepoch(), unixepoch())`,
      jobId,
      documentId,
      workflowId,
    )

    // 10. Write activities record
    await queryRun(
      db,
      `INSERT INTO activities (
        activity_id, profile_id, activity_type, detail, workflow_id, created_at
      ) VALUES (?, ?, 'upload', ?, ?, unixepoch())`,
      crypto.randomUUID(),
      '',
      JSON.stringify({
        documentId,
        filename: filenameDisplay,
        sizeBytes: file.size,
        r2Key,
      }),
      workflowId,
    )

    // 11. Fire-and-forget audit event
    const durationMs = Date.now() - startTime
    c.executionCtx.waitUntil(
      auditStageStarted(db, tenant, workflowId, 'upload', {
        document_id: documentId,
        duration_ms: durationMs,
        after_state: JSON.stringify({ documentId, jobId, r2Key, sizeBytes: file.size }),
      }),
    )

    // 12. Log for observability
    console.log(JSON.stringify({
      event: 'doc_intel_ingest',
      documentId,
      jobId,
      tenant,
      workflowId,
      filename: filenameDisplay,
      sizeBytes: file.size,
      durationMs,
    }))

    // 13. Return job reference
    return c.json({
      document_id: documentId,
      job_id: jobId,
      workflow_id: workflowId,
      status: 'pending',
      filename_display: filenameDisplay,
      size_bytes: file.size,
    }, 201)

  } catch (err: any) {
    console.error('[doc-intel:ingest] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

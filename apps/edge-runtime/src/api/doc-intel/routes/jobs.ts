/**
 * EdgeGDE — Document Intelligence Job Lifecycle Endpoints
 *
 * Two-phase async processing API for M1 poller:
 *   GET  /jobs/pending       — list pending jobs
 *   POST /jobs/claim         — claim a job for processing
 *   POST /jobs/result        — submit processing results
 *   POST /jobs/heartbeat     — update job heartbeat
 *   POST /jobs/:id/retry     — admin: retry a failed job
 *   POST /jobs/:id/reset     — admin: reset a stuck job
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { resolveTenant, resolveBindings, errorBody } from '../lib/errors'
import { queryFirst, queryAll, queryRun } from '../lib/db'
import { auditStageStarted, auditStageCompleted, auditStageFailed } from '../lib/audit'
import { encryptFields } from '../../../lib/encryption'
import type { JobStatus, ErrorClassification } from '../lib/types'

export const jobsRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// GET /jobs/pending
// ═══════════════════════════════════════════════════════════════════════════

jobsRouter.get('/jobs/pending', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const jobs = await queryAll<{
      job_id: string
      document_id: string
      status: string
      created_at: number
    }>(
      db,
      `SELECT job_id, document_id, status, created_at
       FROM processing_jobs
       WHERE status IN ('pending', 'retry_pending')
       ORDER BY created_at ASC
       LIMIT 10`,
    )

    return c.json({ jobs })
  } catch (err: any) {
    console.error('[doc-intel:jobs:pending] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /jobs/claim
// ═══════════════════════════════════════════════════════════════════════════

jobsRouter.post('/jobs/claim', async (c) => {
  const startTime = Date.now()

  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const body: { worker_id?: string } = await c.req.json()
    if (!body.worker_id) {
      const err = errorBody('INVALID_INPUT', 'worker_id is required')
      return c.json(err.body, err.status)
    }

    // Atomic claim: update the first pending job
    const now = Math.floor(Date.now() / 1000)
    const job = await queryFirst<{ job_id: string; document_id: string; original_r2_key: string }>(
      db,
      `SELECT pj.job_id, pj.document_id, d.original_r2_key
       FROM processing_jobs pj
       JOIN documents d ON d.document_id = pj.document_id
       WHERE pj.status IN ('pending', 'retry_pending')
       ORDER BY pj.created_at ASC
       LIMIT 1`,
    )

    if (!job) {
      return c.json({ jobs: [] })
    }

    // Claim atomically — if another worker beat us, this will affect 0 rows
    const result = await (
      db.prepare(
        `UPDATE processing_jobs
         SET status = 'claimed',
             worker_id = ?,
             claimed_at = ?,
             updated_at = ?
         WHERE job_id = ? AND status IN ('pending', 'retry_pending')`
      ).bind(body.worker_id, now, now, job.job_id).run()
    )

    if (result.meta.changes === 0) {
      const errResp = errorBody('JOB_ALREADY_CLAIMED', `Job ${job.job_id} was already claimed by another worker.`)
      return c.json(errResp.body, errResp.status)
    }

    const workflowId = crypto.randomUUID()
    c.executionCtx.waitUntil(
      auditStageStarted(db, tenant, workflowId, 'ocr', {
        document_id: job.document_id,
        duration_ms: Date.now() - startTime,
      }),
    )

    return c.json({
      job_id: job.job_id,
      document_id: job.document_id,
      r2_original_key: job.original_r2_key,
      status: 'claimed',
    })
  } catch (err: any) {
    console.error('[doc-intel:jobs:claim] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /jobs/result
// ═══════════════════════════════════════════════════════════════════════════

jobsRouter.post('/jobs/result', async (c) => {
  const startTime = Date.now()

  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db, r2 } = bindings

    interface ResultBody {
      job_id: string
      status: JobStatus
      document_type: string
      confidence: number
      fields?: Array<{
        name: string
        value: string
        confidence: number
        classification: string
      }>
      ocr_r2_key: string
      fields_r2_key: string
      compressed_r2_key?: string
      compressed_size_bytes?: number
      original_size_bytes: number
      duration_ms: number
      error?: string
      error_classification?: ErrorClassification
    }

    const body: ResultBody = await c.req.json()

    if (!body.job_id || !body.status) {
      const err = errorBody('INVALID_INPUT', 'job_id and status are required')
      return c.json(err.body, err.status)
    }

    // Verify job exists and is claimed/processing
    const job = await queryFirst<{ job_id: string; document_id: string; workflow_id: string | null }>(
      db,
      `SELECT job_id, document_id, workflow_id
       FROM processing_jobs
       WHERE job_id = ? AND status IN ('claimed', 'processing', 'retry_pending')`,
      body.job_id,
    )

    if (!job) {
      const errResp = errorBody('JOB_NOT_FOUND', `Job ${body.job_id} not found or not in a claimable state.`)
      return c.json(errResp.body, errResp.status)
    }

    const now = Math.floor(Date.now() / 1000)

    // Determine final status: if confidence < 85%, mark as completed_with_warnings
    const finalStatus: JobStatus = body.status === 'completed' && body.confidence > 0 && body.confidence < 0.85
      ? 'completed_with_warnings'
      : body.status

    await queryRun(
      db,
      `UPDATE processing_jobs
       SET status = ?, completed_at = ?, last_error = ?, error_classification = ?,
           attempt_count = attempt_count + 1, updated_at = ?
       WHERE job_id = ?`,
      finalStatus,
      now,
      body.error ?? null,
      body.error_classification ?? null,
      now,
      body.job_id,
    )

    // Update document status
    const docStatus = finalStatus === 'completed' || finalStatus === 'completed_with_warnings'
      ? finalStatus
      : 'failed'

    await queryRun(
      db,
      `UPDATE documents
       SET document_type = ?, ocr_status = ?, confidence = ?,
           working_r2_key = ?, compressed_size_bytes = ?,
           fields_r2_key = ?, ocr_r2_key = ?,
           updated_at = ?
       WHERE document_id = ?`,
      body.document_type || 'unknown',
      docStatus,
      body.confidence ?? null,
      body.compressed_r2_key ?? null,
      body.compressed_size_bytes ?? null,
      body.fields_r2_key ?? null,
      body.ocr_r2_key ?? null,
      now,
      job.document_id,
    )

    // Insert extracted fields (encrypted) into D1 and store encrypted blob in R2
    let usedKeyVersion = 1
    if (body.fields && body.fields.length > 0) {
      const { encryptedFields, keyVersion } = await encryptFields(
        body.fields.map(f => ({
          name: f.name,
          value: f.value,
          classification: f.classification || 'CONFIDENTIAL',
        })),
        db,
        tenant,
        c.env as Record<string, unknown>,
      )
      usedKeyVersion = keyVersion

      // Store in D1 extracted_fields table
      for (const field of encryptedFields) {
        await queryRun(
          db,
          `INSERT INTO extracted_fields (
            field_id, document_id, field_name, field_value_encrypted,
            confidence, key_version, data_classification, source_document, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'paddleocr+ollama', unixepoch())`,
          crypto.randomUUID(),
          job.document_id,
          field.field_name,
          field.field_value_encrypted,
          body.fields.find(f => f.name === field.field_name)?.confidence ?? 0,
          field.key_version,
          field.classification,
        )
      }

      // Store encrypted fields JSON blob in R2 using fields_r2_key
      if (body.fields_r2_key && r2) {
        const fieldsBlob = JSON.stringify({
          encrypted_fields: encryptedFields,
          key_version: keyVersion,
          tenant,
          document_id: job.document_id,
        })
        await r2.put(body.fields_r2_key, fieldsBlob, {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            documentId: job.document_id,
            tenant,
            keyVersion: String(keyVersion),
            fieldCount: String(encryptedFields.length),
          },
        })
      }
    }

    // Log the key version used for encryption
    console.log(JSON.stringify({
      event: 'doc_intel_fields_encrypted',
      document_id: job.document_id,
      job_id: body.job_id,
      tenant,
      field_count: body.fields?.length ?? 0,
      key_version: usedKeyVersion,
      fields_r2_key: body.fields_r2_key,
    }))

    // Write activities
    await queryRun(
      db,
      `INSERT INTO activities (
        activity_id, profile_id, activity_type, detail, workflow_id, created_at
      ) VALUES (?, ?, 'ocr', ?, ?, unixepoch())`,
      crypto.randomUUID(),
      '',
      JSON.stringify({
        jobId: body.job_id,
        status: finalStatus,
        confidence: body.confidence,
        documentType: body.document_type,
        fieldsCount: body.fields?.length ?? 0,
        durationMs: body.duration_ms,
      }),
      job.workflow_id ?? '',
    )

    // Audit
    const auditDuration = Date.now() - startTime
    c.executionCtx.waitUntil(
      finalStatus === 'completed' || finalStatus === 'completed_with_warnings'
        ? auditStageCompleted(db, tenant, job.workflow_id ?? '', 'ocr', body.duration_ms || auditDuration)
        : auditStageFailed(db, tenant, job.workflow_id ?? '', 'ocr', body.error || 'Processing failed'),
    )

    return c.json({
      accepted: true,
      document_id: job.document_id,
      status: finalStatus,
    })
  } catch (err: any) {
    console.error('[doc-intel:jobs:result] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /jobs/heartbeat
// ═══════════════════════════════════════════════════════════════════════════

jobsRouter.post('/jobs/heartbeat', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const body: { job_id?: string } = await c.req.json()
    if (!body.job_id) {
      const err = errorBody('INVALID_INPUT', 'job_id is required')
      return c.json(err.body, err.status)
    }

    const now = Math.floor(Date.now() / 1000)
    await queryRun(
      db,
      `UPDATE processing_jobs SET heartbeat_at = ?, updated_at = ? WHERE job_id = ?`,
      now,
      now,
      body.job_id,
    )

    return c.json({ updated: true })
  } catch (err: any) {
    console.error('[doc-intel:jobs:heartbeat] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /jobs/:id/retry
// ═══════════════════════════════════════════════════════════════════════════

jobsRouter.post('/jobs/:id/retry', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const jobId = c.req.param('id')

    // Verify job exists and is in a retryable state
    const job = await queryFirst<{ job_id: string }>(
      db,
      `SELECT job_id FROM processing_jobs WHERE job_id = ? AND status = 'failed'`,
      jobId,
    )

    if (!job) {
      const errResp = errorBody('JOB_NOT_FOUND', `Job ${jobId} not found or not in failed state.`)
      return c.json(errResp.body, errResp.status)
    }

    const now = Math.floor(Date.now() / 1000)
    await queryRun(
      db,
      `UPDATE processing_jobs
       SET status = 'retry_pending', worker_id = NULL, claimed_at = NULL,
           started_at = NULL, completed_at = NULL, heartbeat_at = NULL,
           updated_at = ?
       WHERE job_id = ?`,
      now,
      jobId,
    )

    return c.json({ job_id: jobId, status: 'retry_pending' })
  } catch (err: any) {
    console.error('[doc-intel:jobs:retry] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /jobs/:id/reset
// ═══════════════════════════════════════════════════════════════════════════

jobsRouter.post('/jobs/:id/reset', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const jobId = c.req.param('id')

    // Verify job exists
    const job = await queryFirst<{ job_id: string }>(
      db,
      `SELECT job_id FROM processing_jobs WHERE job_id = ?`,
      jobId,
    )

    if (!job) {
      const errResp = errorBody('JOB_NOT_FOUND', `Job ${jobId} not found.`)
      return c.json(errResp.body, errResp.status)
    }

    const now = Math.floor(Date.now() / 1000)
    await queryRun(
      db,
      `UPDATE processing_jobs
       SET status = 'pending', worker_id = NULL, claimed_at = NULL,
           started_at = NULL, completed_at = NULL, heartbeat_at = NULL,
           last_error = NULL, error_classification = NULL, updated_at = ?
       WHERE job_id = ?`,
      now,
      jobId,
    )

    return c.json({ job_id: jobId, status: 'pending' })
  } catch (err: any) {
    console.error('[doc-intel:jobs:reset] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

/**
 * EdgeGDE — Document Intelligence Search and Document Query Endpoints
 *
 *   GET /documents?profile_id=...&type=...&status=...  — search documents
 *   GET /audit?workflow_id=...                          — query audit log
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { resolveTenant, resolveBindings, errorBody } from '../lib/errors'
import { queryAll, queryFirst, queryRun } from '../lib/db'
import { decryptFields } from '../../../lib/encryption'

export const searchRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// GET /documents
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.get('/documents', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db, r2 } = bindings

    const profileId = c.req.query('profile_id')
    const docType = c.req.query('type')
    const status = c.req.query('status')
    const documentId = c.req.query('document_id')
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const conditions: string[] = []
    const params: unknown[] = []

    if (profileId) {
      conditions.push('d.profile_id = ?')
      params.push(profileId)
    }
    if (docType) {
      conditions.push('d.document_type = ?')
      params.push(docType)
    }
    if (status) {
      conditions.push('d.ocr_status = ?')
      params.push(status)
    }
    if (documentId) {
      conditions.push('d.document_id = ?')
      params.push(documentId)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const documents = await queryAll<{
      document_id: string
      document_type: string
      filename_display: string
      ocr_status: string
      confidence: number | null
      fields_r2_key: string | null
      created_at: number
    }>(
      db,
      `SELECT d.document_id, d.document_type, d.filename_display,
              d.ocr_status, d.confidence, d.fields_r2_key, d.created_at
       FROM documents d
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    )

    // If document_id is provided, also fetch and decrypt fields from R2
    let decryptedFields: Array<{
      field_name: string
      field_value: string
      key_version: number
      data_classification: string
    }> | null = null

    if (documentId && documents.length > 0) {
      const doc = documents[0]
      if (doc.fields_r2_key) {
        try {
          const r2Obj = await r2.get(doc.fields_r2_key)
          if (r2Obj) {
            const fieldsBlob = await r2Obj.json() as {
              encrypted_fields: Array<{
                field_name: string
                field_value_encrypted: string
                key_version: number
                classification: string
              }>
              key_version: number
            }
            if (fieldsBlob.encrypted_fields?.length > 0) {
              const decrypted = await decryptFields(
                fieldsBlob.encrypted_fields.map(f => ({
                  field_name: f.field_name,
                  field_value_encrypted: f.field_value_encrypted,
                  key_version: f.key_version,
                  data_classification: f.classification,
                })),
                db,
                tenant,
                c.env as Record<string, unknown>,
              )
              decryptedFields = decrypted
            } else {
              // Fall back to D1 extracted_fields if R2 blob has no encrypted_fields key
              const extractedFields = await queryAll<{
                field_name: string
                field_value_encrypted: string
                key_version: number
                data_classification: string
              }>(
                db,
                `SELECT field_name, field_value_encrypted, key_version, data_classification
                 FROM extracted_fields
                 WHERE document_id = ?
                 ORDER BY created_at ASC`,
                documentId,
              )
              if (extractedFields.length > 0) {
                const decrypted = await decryptFields(extractedFields, db, tenant, c.env as Record<string, unknown>)
                decryptedFields = decrypted
              }
            }
          }
        } catch (err) {
          console.error(`[doc-intel:search] Failed to decrypt fields for document ${documentId}:`, err)
        }
      } else {
        // No R2 key — fall back to D1 extracted_fields
        try {
          const extractedFields = await queryAll<{
            field_name: string
            field_value_encrypted: string
            key_version: number
            data_classification: string
          }>(
            db,
            `SELECT field_name, field_value_encrypted, key_version, data_classification
             FROM extracted_fields
             WHERE document_id = ?
             ORDER BY created_at ASC`,
            documentId,
          )
          if (extractedFields.length > 0) {
            const decrypted = await decryptFields(extractedFields, db, tenant, c.env as Record<string, unknown>)
            decryptedFields = decrypted
          }
        } catch (err) {
          console.error(`[doc-intel:search] Failed to decrypt D1 fields for document ${documentId}:`, err)
        }
      }
    }

    return c.json({ documents, ...(decryptedFields !== null ? { fields: decryptedFields } : {}) })
  } catch (err: any) {
    console.error('[doc-intel:search] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /audit
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.get('/audit', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const workflowId = c.req.query('workflow_id')
    const documentId = c.req.query('document_id')
    const stage = c.req.query('stage')
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const conditions: string[] = ['al.tenant_id = ?']
    const params: unknown[] = [tenant]

    if (workflowId) {
      conditions.push('al.workflow_id = ?')
      params.push(workflowId)
    }
    if (documentId) {
      conditions.push('al.document_id = ?')
      params.push(documentId)
    }
    if (stage) {
      conditions.push('al.stage = ?')
      params.push(stage)
    }

    const events = await queryAll<{
      audit_id: string
      workflow_id: string
      document_id: string | null
      profile_id: string | null
      stage: string
      status: string
      duration_ms: number | null
      created_at: number
    }>(
      db,
      `SELECT audit_id, workflow_id, document_id, profile_id,
              stage, status, duration_ms, created_at
       FROM audit_log al
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    )

    return c.json({ events })
  } catch (err: any) {
    console.error('[doc-intel:audit] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /documents/custom-fields — list custom fields for a document
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.get('/documents/custom-fields', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const documentId = c.req.query('document_id')
    if (!documentId) {
      return c.json({ error: 'document_id query parameter is required' }, 400)
    }

    const fields = await queryAll<{
      field_name: string
      field_value: string
      created_at: number
    }>(
      db,
      `SELECT field_name, field_value, created_at
       FROM custom_fields
       WHERE document_id = ?
       ORDER BY created_at ASC`,
      documentId,
    )

    return c.json({ fields })
  } catch (err: any) {
    console.error('[doc-intel:custom-fields] GET error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /documents/custom-fields — add a custom field to a document
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.post('/documents/custom-fields', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const body = await c.req.json<{
      document_id: string
      field_name: string
      field_value: string
    }>()

    if (!body.document_id || !body.field_name) {
      return c.json({ error: 'document_id and field_name are required' }, 400)
    }

    const id = crypto.randomUUID()

    await queryRun(
      db,
      `INSERT INTO custom_fields (custom_field_id, document_id, field_name, field_value, created_at)
       VALUES (?, ?, ?, ?, unixepoch())`,
      id,
      body.document_id,
      body.field_name,
      body.field_value ?? '',
    )

    return c.json({ success: true, custom_field_id: id }, 201)
  } catch (err: any) {
    console.error('[doc-intel:custom-fields] POST error:', err)
    return c.json({ error: err.message }, 500)
  }
})

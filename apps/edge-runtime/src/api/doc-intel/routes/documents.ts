/**
 * EdgeGDE — Document Intelligence Document Storage Endpoints
 *
 * R2 proxy endpoints for the M1 poller to download originals and upload artifacts.
 * Also provides document detail retrieval with decrypted fields and custom field management.
 *
 *   GET  /documents/download?r2_key=...      — stream file from R2
 *   POST /documents/upload?r2_key=...        — upload artifact to R2
 *   GET  /documents/:id                      — get document with decrypted fields
 *   PUT  /documents/:id/fields               — add custom fields (for the UI)
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { resolveTenant, errorBody, resolveBindings } from '../lib/errors'
import { queryFirst, queryAll, queryRun } from '../lib/db'
import { decryptFields } from '../../../lib/encryption'

export const documentsRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// GET /documents/download?r2_key=...
// Proxies R2 document download for the M1 poller
// ═══════════════════════════════════════════════════════════════════════════

documentsRouter.get('/documents/download', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { r2 } = bindings

    const r2Key = c.req.query('r2_key')
    if (!r2Key) {
      const err = errorBody('INVALID_INPUT', 'r2_key query parameter is required')
      return c.json(err.body, err.status)
    }

    const object = await r2.get(r2Key)
    if (!object) {
      const err = errorBody('DOCUMENT_NOT_FOUND', `Object not found: ${r2Key}`)
      return c.json(err.body, err.status)
    }

    const headers = new Headers()
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
    headers.set('Content-Disposition', `attachment; filename="${r2Key.split('/').pop()}"`)
    headers.set('Cache-Control', 'private, max-age=3600')

    return new Response(object.body, { headers })
  } catch (err: any) {
    console.error('[doc-intel:download] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /documents/upload?r2_key=...
// Accepts an artifact file upload and stores it in the tenant's R2 bucket
// ═══════════════════════════════════════════════════════════════════════════

documentsRouter.post('/documents/upload', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { r2 } = bindings

    const r2Key = c.req.query('r2_key')
    if (!r2Key) {
      const err = errorBody('INVALID_INPUT', 'r2_key query parameter is required')
      return c.json(err.body, err.status)
    }

    const body = await c.req.parseBody()
    const file = body['file'] as File | null

    if (!file) {
      const err = errorBody('INVALID_INPUT', 'No file provided. Use multipart field name "file".')
      return c.json(err.body, err.status)
    }

    const buffer = await file.arrayBuffer()
    await r2.put(r2Key, buffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        tenant,
        uploadedBy: 'poller',
        originalFilename: file.name,
      },
    })

    return c.json({
      success: true,
      r2_key: r2Key,
      size_bytes: file.size,
    }, 201)
  } catch (err: any) {
    console.error('[doc-intel:upload] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /documents/:id
// Returns document metadata with decrypted extracted fields and custom fields
// ═══════════════════════════════════════════════════════════════════════════

documentsRouter.get('/documents/:id', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const documentId = c.req.param('id')

    // Fetch document
    const doc = await queryFirst<{
      document_id: string
      profile_id: string | null
      document_type: string
      filename_display: string
      original_r2_key: string
      working_r2_key: string | null
      original_size_bytes: number
      compressed_size_bytes: number | null
      ocr_status: string
      confidence: number | null
      document_version: number
      data_classification: string
      created_at: number
      updated_at: number
    }>(
      db,
      `SELECT document_id, profile_id, document_type, filename_display,
              original_r2_key, working_r2_key, original_size_bytes,
              compressed_size_bytes, ocr_status, confidence,
              document_version, data_classification, created_at, updated_at
       FROM documents
       WHERE document_id = ?`,
      documentId,
    )

    if (!doc) {
      const errResp = errorBody('DOCUMENT_NOT_FOUND', `Document ${documentId} not found.`)
      return c.json(errResp.body, errResp.status)
    }

    // Fetch extracted fields
    const extractedFields = await queryAll<{
      field_name: string
      field_value_encrypted: string
      key_version: number
      data_classification: string
      confidence: number
    }>(
      db,
      `SELECT field_name, field_value_encrypted, key_version, data_classification, confidence
       FROM extracted_fields
       WHERE document_id = ?
       ORDER BY created_at ASC`,
      documentId,
    )

    // Decrypt fields
    let decryptedFields: Array<{
      field_name: string
      field_value: string
      key_version: number
      data_classification: string
      confidence: number
    }> = []

    if (extractedFields.length > 0) {
      const decrypted = await decryptFields(
        extractedFields.map(f => ({
          field_name: f.field_name,
          field_value_encrypted: f.field_value_encrypted,
          key_version: f.key_version,
          data_classification: f.data_classification,
        })),
        db,
        tenant,
        c.env as Record<string, unknown>,
      )

      // Merge confidence back
      decryptedFields = decrypted.map(d => {
        const original = extractedFields.find(f => f.field_name === d.field_name)
        return {
          field_name: d.field_name,
          field_value: d.field_value,
          key_version: d.key_version,
          data_classification: d.data_classification,
          confidence: original?.confidence ?? 0,
        }
      })
    }

    // Fetch custom fields
    const customFields = await queryAll<{
      custom_field_id: string
      field_name: string
      field_value: string
      created_at: number
    }>(
      db,
      `SELECT custom_field_id, field_name, field_value, created_at
       FROM custom_fields
       WHERE document_id = ?
       ORDER BY created_at ASC`,
      documentId,
    )

    return c.json({
      document: {
        document_id: doc.document_id,
        profile_id: doc.profile_id,
        document_type: doc.document_type,
        filename_display: doc.filename_display,
        original_r2_key: doc.original_r2_key,
        working_r2_key: doc.working_r2_key,
        original_size_bytes: doc.original_size_bytes,
        compressed_size_bytes: doc.compressed_size_bytes,
        ocr_status: doc.ocr_status,
        confidence: doc.confidence,
        document_version: doc.document_version,
        data_classification: doc.data_classification,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      },
      fields: decryptedFields,
      custom_fields: customFields,
    })
  } catch (err: any) {
    console.error('[doc-intel:document:detail] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// PUT /documents/:id/fields
// Adds custom fields to a document (for the UI).
// Accepts an array of { field_name, field_value } objects.
// ═══════════════════════════════════════════════════════════════════════════

documentsRouter.put('/documents/:id/fields', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const documentId = c.req.param('id')

    // Verify document exists
    const doc = await queryFirst<{ document_id: string }>(
      db,
      `SELECT document_id FROM documents WHERE document_id = ?`,
      documentId,
    )

    if (!doc) {
      const errResp = errorBody('DOCUMENT_NOT_FOUND', `Document ${documentId} not found.`)
      return c.json(errResp.body, errResp.status)
    }

    interface CustomFieldInput {
      field_name: string
      field_value: string
    }

    const body = await c.req.json() as { fields: CustomFieldInput[] }
    if (!body.fields || !Array.isArray(body.fields) || body.fields.length === 0) {
      const err = errorBody('INVALID_INPUT', 'Request body must contain a non-empty "fields" array with field_name and field_value.')
      return c.json(err.body, err.status)
    }

    const inserted: Array<{
      custom_field_id: string
      field_name: string
      created_at: number
    }> = []

    for (const field of body.fields) {
      if (!field.field_name || typeof field.field_value !== 'string') {
        const err = errorBody('INVALID_INPUT', 'Each field must have field_name (string) and field_value (string).')
        return c.json(err.body, err.status)
      }

      const customFieldId = crypto.randomUUID()
      await queryRun(
        db,
        `INSERT INTO custom_fields (custom_field_id, document_id, field_name, field_value, created_at)
         VALUES (?, ?, ?, ?, unixepoch())`,
        customFieldId,
        documentId,
        field.field_name,
        field.field_value,
      )

      inserted.push({
        custom_field_id: customFieldId,
        field_name: field.field_name,
        created_at: Math.floor(Date.now() / 1000),
      })
    }

    return c.json({
      success: true,
      document_id: documentId,
      fields_added: inserted.length,
      fields: inserted,
    }, 201)
  } catch (err: any) {
    console.error('[doc-intel:document:fields] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status)
  }
})

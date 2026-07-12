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
      original_size_bytes: number | null
      created_at: number
    }>(
      db,
      `SELECT d.document_id, d.document_type, d.filename_display,
              d.ocr_status, d.confidence, d.fields_r2_key, d.original_size_bytes, d.created_at
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

// ═══════════════════════════════════════════════════════════════════════════
// POST /documents/:id/approve — approve a document for CRM provisioning
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.post('/documents/:id/approve', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const documentId = c.req.param('id')

    // Verify document exists and is in a reviewable state
    const doc = await queryFirst<{ document_id: string; ocr_status: string }>(
      db,
      `SELECT document_id, ocr_status FROM documents WHERE document_id = ?`,
      documentId,
    )

    if (!doc) {
      const errResp = errorBody('DOCUMENT_NOT_FOUND', `Document ${documentId} not found.`)
      return c.json(errResp.body, errResp.status as any)
    }

    if (doc.ocr_status !== 'completed_with_warnings' && doc.ocr_status !== 'completed') {
      const errResp = errorBody('INVALID_INPUT', `Document ${documentId} is in status "${doc.ocr_status}" and cannot be approved. Only documents with status "completed" or "completed_with_warnings" can be approved.`)
      return c.json(errResp.body, errResp.status as any)
    }

    const now = Math.floor(Date.now() / 1000)

    await queryRun(
      db,
      `UPDATE documents SET ocr_status = 'approved', updated_at = ? WHERE document_id = ?`,
      now,
      documentId,
    )

    // TODO: CRM provisioning placeholder — integrate with Edge CRM (CRM-001, CRM-002)
    // This is where CRM create/update logic would be triggered after human approval.
    console.log(JSON.stringify({
      event: 'doc_intel_document_approved',
      document_id: documentId,
      tenant,
      timestamp: now,
    }))

    // Write activity
    await queryRun(
      db,
      `INSERT INTO activities (
        activity_id, profile_id, activity_type, detail, workflow_id, created_at
      ) VALUES (?, ?, 'crm_update', ?, '', unixepoch())`,
      crypto.randomUUID(),
      '',
      JSON.stringify({
        documentId,
        action: 'approve',
        status: 'approved',
        note: 'Document approved for CRM provisioning',
      }),
    )

    return c.json({
      success: true,
      document_id: documentId,
      status: 'approved',
    })
  } catch (err: any) {
    console.error('[doc-intel:approve] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /documents/:id/reject — reject a document
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.post('/documents/:id/reject', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const documentId = c.req.param('id')

    // Verify document exists and is in a reviewable state
    const doc = await queryFirst<{ document_id: string; ocr_status: string }>(
      db,
      `SELECT document_id, ocr_status FROM documents WHERE document_id = ?`,
      documentId,
    )

    if (!doc) {
      const errResp = errorBody('DOCUMENT_NOT_FOUND', `Document ${documentId} not found.`)
      return c.json(errResp.body, errResp.status as any)
    }

    if (doc.ocr_status !== 'completed_with_warnings' && doc.ocr_status !== 'completed') {
      const errResp = errorBody('INVALID_INPUT', `Document ${documentId} is in status "${doc.ocr_status}" and cannot be rejected. Only documents with status "completed" or "completed_with_warnings" can be rejected.`)
      return c.json(errResp.body, errResp.status as any)
    }

    const now = Math.floor(Date.now() / 1000)

    await queryRun(
      db,
      `UPDATE documents SET ocr_status = 'rejected', updated_at = ? WHERE document_id = ?`,
      now,
      documentId,
    )

    // Write activity
    await queryRun(
      db,
      `INSERT INTO activities (
        activity_id, profile_id, activity_type, detail, workflow_id, created_at
      ) VALUES (?, ?, 'validation', ?, '', unixepoch())`,
      crypto.randomUUID(),
      '',
      JSON.stringify({
        documentId,
        action: 'reject',
        status: 'rejected',
        note: 'Document was rejected by human reviewer',
      }),
    )

    return c.json({
      success: true,
      document_id: documentId,
      status: 'rejected',
    })
  } catch (err: any) {
    console.error('[doc-intel:reject] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /documents/pending-review — list documents needing human approval
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.get('/documents/pending-review', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const documents = await queryAll<{
      document_id: string
      document_type: string
      filename_display: string
      ocr_status: string
      confidence: number | null
      created_at: number
    }>(
      db,
      `SELECT d.document_id, d.document_type, d.filename_display,
              d.ocr_status, d.confidence, d.created_at
       FROM documents d
       WHERE d.ocr_status = 'completed_with_warnings'
       ORDER BY d.created_at ASC
       LIMIT ? OFFSET ?`,
      limit,
      offset,
    )

    return c.json({ documents, total: documents.length })
  } catch (err: any) {
    console.error('[doc-intel:pending-review] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /documents/check-duplicates — detect duplicate documents by field matching
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.post('/documents/check-duplicates', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db, r2 } = bindings

    const body = await c.req.json<{
      name?: string
      dob?: string
      email?: string
      mobile?: string
      licence_number?: string
      passport_number?: string
      medicare_number?: string
      document_type?: string
    }>()

    // At least one field is required for meaningful duplicate detection
    const hasAnyField = body.name || body.dob || body.email || body.mobile ||
      body.licence_number || body.passport_number || body.medicare_number
    if (!hasAnyField) {
      return c.json({
        error: 'At least one candidate field (name, dob, email, mobile, licence_number, passport_number, medicare_number) is required for duplicate detection',
      }, 400)
    }

    // Build query to find candidate documents — look at documents that were
    // successfully processed (completed, completed_with_warnings, approved)
    const statuses = ["'completed'", "'completed_with_warnings'", "'approved'"]
    let typeClause = ''
    const queryParams: unknown[] = []
    if (body.document_type) {
      typeClause = 'AND d.document_type = ?'
      queryParams.push(body.document_type)
    }

    const candidateDocs = await queryAll<{
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
       WHERE d.ocr_status IN (${statuses.join(',')}) ${typeClause}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      ...queryParams,
    )

    if (candidateDocs.length === 0) {
      return c.json({ duplicates: [], matched: false })
    }

    // Fetch and decrypt fields for each candidate document
    interface DecryptedField {
      field_name: string
      field_value: string
    }

    interface MatchResult {
      document_id: string
      document_type: string
      filename_display: string
      confidence: number | null
      created_at: number
      match_score: number
      matched_fields: Array<{ field: string; value: string }>
    }

    const matches: MatchResult[] = []

    for (const doc of candidateDocs) {
      let fields: DecryptedField[] = []

      if (doc.fields_r2_key) {
        try {
          const r2Obj = await r2.get(doc.fields_r2_key)
          if (r2Obj) {
            const fieldsBlob = await r2Obj.json() as {
              encrypted_fields?: Array<{
                field_name: string
                field_value_encrypted: string
                key_version: number
                classification: string
              }>
            }
            if (fieldsBlob.encrypted_fields && fieldsBlob.encrypted_fields.length > 0) {
              const encFields = fieldsBlob.encrypted_fields!
              const decrypted = await decryptFields(
                encFields.map(f => ({
                  field_name: f.field_name,
                  field_value_encrypted: f.field_value_encrypted,
                  key_version: f.key_version,
                  data_classification: f.classification,
                })),
                db,
                tenant,
                c.env as Record<string, unknown>,
              )
              fields = decrypted.map(f => ({ field_name: f.field_name, field_value: f.field_value }))
            }
          }
        } catch (err) {
          console.error(`[doc-intel:check-duplicates] Failed to decrypt fields for ${doc.document_id}:`, err)
          continue
        }
      }

      // Fall back to D1 extracted_fields if no R2 key or R2 fetch failed
      if (fields.length === 0) {
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
            doc.document_id,
          )
          if (extractedFields.length > 0) {
            const decrypted = await decryptFields(extractedFields, db, tenant, c.env as Record<string, unknown>)
            fields = decrypted.map(f => ({ field_name: f.field_name, field_value: f.field_value }))
          }
        } catch (err) {
          console.error(`[doc-intel:check-duplicates] Failed to decrypt D1 fields for ${doc.document_id}:`, err)
          continue
        }
      }

      if (fields.length === 0) continue

      // Build a lookup map for quick field access
      const fieldMap = new Map<string, string>()
      for (const f of fields) {
        fieldMap.set(f.field_name.toLowerCase(), f.field_value.toLowerCase().trim())
      }

      // Match against candidate fields (CRM-003 priority order: email → mobile → name+DOB → govID)
      const matchedFields: Array<{ field: string; value: string }> = []
      let score = 0

      // 1. Email match (highest weight)
      if (body.email && fieldMap.has('email')) {
        if (fieldMap.get('email') === body.email.toLowerCase().trim()) {
          matchedFields.push({ field: 'email', value: body.email })
          score += 40
        }
      }

      // 2. Mobile match (high weight)
      if (body.mobile && fieldMap.has('mobile')) {
        // Normalize both for comparison (strip non-digits)
        const normalizedCandidate = body.mobile.replace(/\D/g, '')
        const normalizedStored = fieldMap.get('mobile')?.replace(/\D/g, '') ?? ''
        if (normalizedStored === normalizedCandidate) {
          matchedFields.push({ field: 'mobile', value: body.mobile })
          score += 30
        }
      }

      // 3. Name + DOB match
      let nameMatch = false
      if (body.name && (fieldMap.has('full_name') || fieldMap.has('name') || fieldMap.has('given_names'))) {
        const candidateName = body.name.toLowerCase().trim()
        const storedName = fieldMap.get('full_name') || fieldMap.get('name') || fieldMap.get('given_names') || ''
        if (storedName === candidateName || storedName.includes(candidateName) || candidateName.includes(storedName)) {
          nameMatch = true
          matchedFields.push({ field: 'name', value: body.name })
          score += 15
        }
      }
      if (body.dob && (fieldMap.has('date_of_birth') || fieldMap.has('dob'))) {
        const storedDob = fieldMap.get('date_of_birth') || fieldMap.get('dob') || ''
        const candidateDob = body.dob.toLowerCase().trim()
        if (storedDob === candidateDob) {
          matchedFields.push({ field: 'dob', value: body.dob })
          score += 15
          // Bonus if both name and dob matched
          if (nameMatch) score += 10
        }
      }

      // 4. Government ID match
      if (body.licence_number && (fieldMap.has('licence_number') || fieldMap.has('drivers_licence'))) {
        const storedLic = fieldMap.get('licence_number') || fieldMap.get('drivers_licence') || ''
        if (storedLic === body.licence_number.toLowerCase().trim()) {
          matchedFields.push({ field: 'licence_number', value: body.licence_number })
          score += 35
        }
      }
      if (body.passport_number && fieldMap.has('passport_number')) {
        if (fieldMap.get('passport_number') === body.passport_number.toLowerCase().trim()) {
          matchedFields.push({ field: 'passport_number', value: body.passport_number })
          score += 35
        }
      }
      if (body.medicare_number && fieldMap.has('medicare_number')) {
        if (fieldMap.get('medicare_number') === body.medicare_number.toLowerCase().trim()) {
          matchedFields.push({ field: 'medicare_number', value: body.medicare_number })
          score += 35
        }
      }

      if (score > 0) {
        matches.push({
          document_id: doc.document_id,
          document_type: doc.document_type,
          filename_display: doc.filename_display,
          confidence: doc.confidence,
          created_at: doc.created_at,
          match_score: score,
          matched_fields: matchedFields,
        })
      }
    }

    // Sort by match score descending (best match first)
    matches.sort((a, b) => b.match_score - a.match_score)

    return c.json({
      duplicates: matches,
      matched: matches.length > 0,
      total_candidates_checked: candidateDocs.length,
    })
  } catch (err: any) {
    console.error('[doc-intel:check-duplicates] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /documents/:id — delete a document and its R2 artifacts
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.delete('/documents/:id', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db, r2 } = bindings

    const documentId = c.req.param('id')

    // Fetch the document to get R2 keys
    const doc = await queryFirst<{
      original_r2_key: string
      fields_r2_key: string | null
      ocr_r2_key: string | null
    }>(
      db,
      `SELECT original_r2_key, fields_r2_key, ocr_r2_key
       FROM documents WHERE document_id = ?`,
      documentId,
    )

    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    // Delete R2 artifacts
    const keysToDelete = [doc.original_r2_key]
    if (doc.fields_r2_key) keysToDelete.push(doc.fields_r2_key)
    if (doc.ocr_r2_key) keysToDelete.push(doc.ocr_r2_key)

    const deletePromises = keysToDelete.map(key => r2.delete(key).catch(() => {}))
    await Promise.all(deletePromises)

    // Delete child records and document
    await queryRun(db, 'DELETE FROM processing_jobs WHERE document_id = ?', documentId)
    await queryRun(db, 'DELETE FROM custom_fields WHERE document_id = ?', documentId)
    await queryRun(db, 'DELETE FROM extracted_fields WHERE document_id = ?', documentId)
    await queryRun(db, 'DELETE FROM documents WHERE document_id = ?', documentId)

    return c.json({ success: true, deleted_keys: keysToDelete })
  } catch (err: any) {
    console.error('[doc-intel:delete] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// PUT /fields/:id/:name — override a field value (manual edit)
// ═══════════════════════════════════════════════════════════════════════════

searchRouter.put('/fields/:id/:name', async (c) => {
  try {
    const tenant = resolveTenant(c)
    if (tenant instanceof Response) return tenant

    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db } = bindings

    const documentId = c.req.param('id')
    const fieldName = c.req.param('name')
    const body = await c.req.json<{ value: string }>()

    if (!body.value && body.value !== '') {
      return c.json({ error: 'value is required' }, 400)
    }

    // Upsert: delete existing and insert new
    await queryRun(db, "DELETE FROM custom_fields WHERE document_id = ? AND field_name = ?", documentId, fieldName)
    await queryRun(
      db,
      `INSERT INTO custom_fields (custom_field_id, document_id, field_name, field_value, created_at)
       VALUES (?, ?, ?, 'MANUAL_OVERRIDE:' || ?, unixepoch())`,
      crypto.randomUUID(),
      documentId,
      fieldName,
      body.value,
    )

    return c.json({ success: true, field_name: fieldName, overridden_value: body.value })
  } catch (err: any) {
    console.error('[doc-intel:field-override] error:', err)
    const errResp = errorBody('INTERNAL_ERROR', err.message)
    return c.json(errResp.body, errResp.status as any)
  }
})

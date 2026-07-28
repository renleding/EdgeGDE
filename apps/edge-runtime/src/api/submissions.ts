/**
 * EdgeGDE Runtime — Tenant Layout Submission Queue
 * Phase 35D: Tenant self-service with admin approval gate.
 *
 * Flow:
 *   Tenant  → submit-layout (validated, queued)
 *   Admin   → view pending (SELECT * WHERE status = 'pending')
 *   Admin   → approve (fetches from D1, calls deployTenantLayout, updates status)
 *
 * D1 is used for the queue (not KV) — queryable, atomic state transitions,
 * permanent audit trail.
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { deployTenantLayout } from '../lib/publish-tenant'
import { generateTestScript } from '../lib/test-generator'
import { layoutDefinitionSchema } from '@edgegde/schema'
import { validateDesign } from '../lib/design-validator'

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const submissionRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/tenant/submit-layout — tenant submits a layout for approval
// Auth: tenantAuth (verifies tenantId exists)
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.post('/tenant/submit-layout', async (c) => {
  // ── Auth is handled by tenantAuth middleware ─────────────────────────────

  const tenantId = (c as any).get('authenticatedTenantId') as string

  // Parse body for layout + design
  let raw: any
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const layout = raw.layout
  const design = raw.design
  const source = raw.source || 'ai'
  const submittedBy = raw.submittedBy || tenantId

  // ── 1. Validate layout with Zod ─────────────────────────────────────────
  const layoutParsed = layoutDefinitionSchema.safeParse(layout)
  if (!layoutParsed.success) {
    const issues = layoutParsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }))
    return c.json({ error: 'validation_failed', details: issues }, 400)
  }

  // ── 2. Validate design ─────────────────────────────────────────────────
  const designResult = validateDesign(design)
  if (!designResult.valid) {
    return c.json({ error: 'validation_failed', details: designResult.errors }, 400)
  }

  // ── 3. Resolve D1 ──────────────────────────────────────────────────────
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  // ── 4. Insert into queue ───────────────────────────────────────────────
  const submissionId = crypto.randomUUID()
  const layoutJson = JSON.stringify(layoutParsed.data)

  try {
    await db.prepare(
      `INSERT INTO tenant_submissions (id, tenant_id, layout_json, design_md, source, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(submissionId, tenantId, layoutJson, design, source, submittedBy)
      .run()
  } catch (err: any) {
    return c.json({ error: 'Queue submission failed', details: err.message }, 500)
  }

  console.log(JSON.stringify({
    event: 'submission',
    action: 'submitted',
    submissionId,
    tenantId,
    source,
    timestamp: Date.now(),
  }))

  return c.json({
    success: true,
    submissionId,
    status: 'pending',
    message: 'Layout submitted for admin review',
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/pending-layouts — list pending submissions
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.get('/admin/pending-layouts', async (c) => {
  // ── Auth is handled by adminAuth middleware ─────────────────────────────

  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  try {
    const { results } = await db.prepare(
      `SELECT id, tenant_id, source, status, submitted_by, created_at
       FROM tenant_submissions
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 50`
    ).all()

    return c.json({ submissions: results })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/admin/approve-layout — approve a pending submission
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.post('/admin/approve-layout', async (c) => {
  // ── Auth is handled by adminAuth middleware ─────────────────────────────

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const submissionId = body.submissionId
  if (!submissionId || typeof submissionId !== 'string') {
    return c.json({ error: 'Missing submissionId' }, 400)
  }

  // ── 1. Resolve bindings ────────────────────────────────────────────────
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  // ── 2. Fetch submission ────────────────────────────────────────────────
  const submission = await db.prepare(
    `SELECT * FROM tenant_submissions WHERE id = ? AND status = 'pending'`
  ).bind(submissionId).first()

  if (!submission) {
    return c.json({ error: 'Submission not found or already processed' }, 404)
  }

  // ── 3. Parse stored payload ────────────────────────────────────────────
  let layout: any
  try {
    layout = JSON.parse(submission.layout_json as string)
  } catch {
    return c.json({ error: 'Stored layout is corrupt' }, 500)
  }

  const design = submission.design_md as string
  const tenantId = submission.tenant_id as string
  const source = (submission.source as string) || 'ai'

    // ── 4. Re-validate (belt-and-suspenders) ──────────────────────────────────
  const layoutParsed = layoutDefinitionSchema.safeParse(layout)
  if (!layoutParsed.success) {
    await db.prepare(
      `UPDATE tenant_submissions SET status = 'rejected', approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
    ).bind('admin', submissionId).run()
    return c.json({
      error: 'Layout no longer valid',
      details: layoutParsed.error.issues,
    }, 400)
  }

  // ── 5. Deploy via existing publish pipeline ────────────────────────────
  try {
    const result = await deployTenantLayout(
      tenantId,
      layoutParsed.data,
      design,
      db,
      TENANT_KV,
      source,
    )

    // ── 6. Mark approved (guarded: only if still pending) ─────────────────
    const updateResult = await db.prepare(
      `UPDATE tenant_submissions
       SET status = 'approved', approved_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`
    ).bind('admin', submissionId).run()

    if (!updateResult || (updateResult.meta?.changes ?? 0) === 0) {
      // Race condition — another admin already processed this submission
      return c.json({ error: 'Submission already processed by another admin' }, 409)
    }

    console.log(JSON.stringify({
      event: 'submission',
      action: 'approved',
      submissionId,
      tenantId,
      version: result.version,
      source,
      timestamp: Date.now(),
    }))

    return c.json({
      success: true,
      tenantId: result.tenantId,
      version: result.version,
      url: result.url,
    })

  } catch (err: any) {
    // Deploy failed — mark as 'failed' for visibility
    try {
      await db.prepare(
        `UPDATE tenant_submissions SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(submissionId).run()
    } catch { /* non-fatal */ }

    console.log(JSON.stringify({
      event: 'submission',
      action: 'failed',
      submissionId,
      tenantId,
      error: err.message,
      timestamp: Date.now(),
    }))

    return c.json({ error: 'Deploy failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/admin/reject-layout — reject a pending submission
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.post('/admin/reject-layout', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const submissionId = body.submissionId
  if (!submissionId || typeof submissionId !== 'string') {
    return c.json({ error: 'Missing submissionId' }, 400)
  }

  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const result = await db.prepare(
    `UPDATE tenant_submissions
     SET status = 'rejected', approved_by = 'admin', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`
  ).bind(submissionId).run()

  if (!result || (result.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'Submission not found or already processed' }, 404)
  }

  console.log(JSON.stringify({
    event: 'submission',
    action: 'rejected',
    submissionId,
    timestamp: Date.now(),
  }))

  return c.json({ success: true, status: 'rejected' })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/submissions — list submissions with optional status filter
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.get('/admin/submissions', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const status = c.req.query('status')
  const limitRaw = c.req.query('limit')
  const limit = Math.min(Math.max(1, Number(limitRaw) || 50), 200)

  try {
    let sql: string
    let bindings: string[]

    if (status && ['pending', 'approved', 'rejected', 'failed'].includes(status)) {
      sql = `SELECT id, tenant_id, source, status, submitted_by, approved_by, created_at, updated_at
             FROM tenant_submissions
             WHERE status = ?
             ORDER BY created_at DESC
             LIMIT ?`
      bindings = [status, String(limit)]
    } else {
      sql = `SELECT id, tenant_id, source, status, submitted_by, approved_by, created_at, updated_at
             FROM tenant_submissions
             ORDER BY created_at DESC
             LIMIT ?`
      bindings = [String(limit)]
    }

    const { results } = await db.prepare(sql).bind(...bindings).all()
    return c.json({ submissions: results })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/tenant/layout — read tenant layout snapshot (version + layout + design)
// Phase 35E: Unified read primitive for OCC-safe editing workflow.
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.get('/tenant/layout', async (c) => {
  // ── Auth is handled by tenantAuth middleware ─────────────────────────────

  const tenantId = (c as any).get('authenticatedTenantId') as string
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  // ── 1. Read version from D1 (source of truth) ──────────────────────────
  let version = 0
  try {
    const row = await db.prepare(
      `SELECT version FROM tenant_artifacts WHERE tenant_id = ? AND artifact_id = 'layout'`
    ).bind(tenantId).first()
    if (row && typeof (row as any).version === 'number') {
      version = (row as any).version
    }
  } catch {
    // Missing D1 row = version 0 (new tenant)
  }

  // ── 2. Read layout + design from TENANT_KV ─────────────────────────────
  let layout: any = null
  let design = ''

  try {
    layout = await TENANT_KV.get(`tenant:${tenantId}:layout:latest`, 'json')
  } catch {
    // KV miss = new tenant
  }

  try {
    design = await TENANT_KV.get(`tenant:${tenantId}:design`) || ''
  } catch {
    // KV miss = new tenant
  }

  // ── 3. Fallback to safe defaults if no layout exists ───────────────────
  if (!layout) {
    layout = {
      type: 'Page',
      children: [
        {
          type: 'Header',
          props: { logo: tenantId, links: ['Home', 'About'] },
        },
        {
          type: 'Section:Hero',
          props: {
            title: tenantId,
            subtitle: 'Powered by EdgeGDE',
          },
        },
        { type: 'Footer' },
      ],
    }
  }

  if (!design) {
    design = '## Colors\nprimary: #1a73e8\nbackground: #ffffff\ntext: #111111'
  }

  // ── 4. Return atomic snapshot ──────────────────────────────────────────
  console.log(JSON.stringify({
    event: 'tenant_layout_read',
    tenantId,
    version,
    timestamp: Date.now(),
  }))

  return c.json({
    tenantId,
    layout,
    design,
    version,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/smoke-test — generate auto-test script for tenant layout
// Phase 35F: Returns a self-contained bash/curl smoke test script.
// Auth: adminAuth (test generation is an admin operation)
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.get('/admin/smoke-test', async (c) => {
  // ── Auth is handled by adminAuth middleware ─────────────────────────────

  const tenantId = c.req.query('tenantId')
  if (!tenantId) return c.json({ error: 'Missing tenantId query param' }, 400)

  const baseUrl = c.req.query('baseUrl') || undefined
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV not available' }, 500)

  // Fetch layout
  let layout: any
  try {
    layout = await TENANT_KV.get(`tenant:${tenantId}:layout:latest`, 'json')
  } catch { /* fall through */ }

  if (!layout) return c.json({ error: 'No layout found for tenant' }, 404)

  // Generate test script
  const script = generateTestScript(layout, { tenantId, baseUrl })

  console.log(JSON.stringify({
    event: 'smoke_test_generated',
    tenantId,
    fieldCount: (() => {
      try {
        const walk = (n: any): number => {
          let c = (n.name || '').startsWith('Input:') ? 1 : 0
          if (n.children) for (const ch of n.children) c += walk(ch)
          return c
        }
        return walk(layout)
      } catch { return -1 }
    })(),
    timestamp: Date.now(),
  }))

  return c.text(script, 200, {
    'Content-Type': 'text/plain',
    'Content-Disposition': `attachment; filename="smoke-test-${tenantId}.sh"`,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/leads/:tenantId/export.csv — export leads as CSV
// Track 4 Phase 2: Dynamic schema, bounded 1000 rows, CSV-escaped.
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

submissionRouter.get('/admin/leads/:tenantId/export.csv', async (c) => {
  // ── Auth is handled by adminAuth middleware ─────────────────────────────

  const tenantId = c.req.param('tenantId')

  // ── 1. Parse query params with defaults ────────────────────────────────
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const startDate = c.req.query('startDate') || thirtyDaysAgo.toISOString()
  const endDate = c.req.query('endDate') || now.toISOString()
  const formId = c.req.query('formId') || null
  const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 1000), 1000)
  const offset = Math.max(0, Number(c.req.query('offset')) || 0)

  // ── 2. Query D1 ────────────────────────────────────────────────────────
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  let rows: any[]
  try {
    let sql: string
    let bindings: any[]

    if (formId) {
      sql = `SELECT id, form_id, payload, created_at
             FROM form_submissions
             WHERE tenant_id = ? AND created_at >= ? AND created_at <= ? AND form_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
      bindings = [tenantId, startDate, endDate, formId, limit, offset]
    } else {
      sql = `SELECT id, form_id, payload, created_at
             FROM form_submissions
             WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
      bindings = [tenantId, startDate, endDate, limit, offset]
    }

    const result = await db.prepare(sql).bind(...bindings).all()
    rows = result.results || []
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }

  // ── 3. Parse payloads and discover dynamic headers ─────────────────────
  interface ParsedRow {
    id: string
    formId: string
    createdAt: string
    fields: Record<string, unknown>
  }

  const parsed: ParsedRow[] = []
  const allFieldKeys = new Set<string>()

  for (const row of rows) {
    let fields: Record<string, unknown> = {}
    try {
      fields = JSON.parse(row.payload as string) as Record<string, unknown>
    } catch {
      fields = {}
    }

    const pid = row.id as string
    const pformId = row.form_id as string
    const pcreatedAt = row.created_at as string

    parsed.push({ id: pid, formId: pformId, createdAt: pcreatedAt, fields })

    // Collect field keys from current row for dynamic headers
    for (const key of Object.keys(fields)) {
      allFieldKeys.add(key)
    }
  }

  // ── 4. Build sorted header columns ─────────────────────────────────────
  const staticColumns = ['submission_id', 'form_id', 'timestamp']
  const dynamicColumns = Array.from(allFieldKeys).sort()
  // Always include correlation_id as last column if present
  const headers = [
    ...staticColumns,
    ...dynamicColumns.filter((k) => k !== '_test_correlation'),
    '_test_correlation',
  ]

  // ── 5. CSV escape function ─────────────────────────────────────────────
  function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
  }

  // ── 6. Build CSV rows ──────────────────────────────────────────────────
  const csvLines: string[] = []
  csvLines.push(headers.map(csvEscape).join(','))

  for (const row of parsed) {
    const values = headers.map((col) => {
      if (col === 'submission_id') return csvEscape(row.id)
      if (col === 'form_id') return csvEscape(row.formId)
      if (col === 'timestamp') return csvEscape(row.createdAt)
      if (col === '_test_correlation') return csvEscape(row.fields['_test_correlation'])
      return csvEscape(row.fields[col])
    })
    csvLines.push(values.join(','))
  }

  const csv = csvLines.join('\n')

  // ── 7. Log + return ────────────────────────────────────────────────────
  console.log(JSON.stringify({
    event: 'csv_export',
    tenantId,
    rowCount: parsed.length,
    formId: formId || 'all',
    timestamp: Date.now(),
  }))

  const dateStr = now.toISOString().split('T')[0]
  return c.text(csv, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="leads-${tenantId}-${dateStr}.csv"`,
  })
})

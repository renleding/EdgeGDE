/**
 * EdgeGDE Runtime — Dynamic Form Builder (Draft State Machine)
 * Track 4 Phase 4: RFC 6902 JSON Patch drafts with path whitelist,
 * optimistic locking, dedicated rate limiter, and publish adapter.
 *
 * Flow: create → patch → patch → ... → publish → pending_approval → deploy
 */

import { Hono } from 'hono'
import { applyPatches, type PatchOperation } from '../lib/patch-engine'
import { layoutDefinitionSchema } from '@edgegde/schema'
import { validateDesign } from '../lib/design-validator'
import { LocalRateLimiter } from '../lib/rate-limiter'
import { envFromContext } from '../lib/env'

/**
 * Typed helper to read authenticatedTenantId from Hono context.
 * The context variable is set by tenant-auth middleware.
 */
function getTenantId(c: unknown): string {
  return (c as { get: (key: string) => unknown }).get('authenticatedTenantId') as string
}

// Rate limiter: 5 patch/s per tenant
// Dedicated per-tenant rate limiter for builder mutations (5 req/s)
// ═══════════════════════════════════════════════════════════════════════════

const builderRateLimiter = new LocalRateLimiter()

function checkBuilderRate(tenantId: string): boolean {
  return builderRateLimiter.check(tenantId) !== null
}

// ═══════════════════════════════════════════════════════════════════════════
// SHA-256 helper
// ═══════════════════════════════════════════════════════════════════════════

async function sha256(obj: any): Promise<string> {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort())
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sorted))
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ═══════════════════════════════════════════════════════════════════════════
// Partial validation — tree structure, IDs, children arrays only (no Zod)
// ═══════════════════════════════════════════════════════════════════════════

function validatePartial(layout: any): { valid: boolean; error?: string } {
  if (!layout || typeof layout !== 'object') {
    return { valid: false, error: 'Layout must be an object' }
  }
  if (!layout.type) return { valid: false, error: 'Layout must have a type' }
  if (layout.children !== undefined && !Array.isArray(layout.children)) {
    return { valid: false, error: 'Children must be an array' }
  }
  return { valid: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dynamic Form Builder router — draft state machine
 * Supports create, patch (RFC 6902), publish, and preview operations
 * for tenant-specific form drafts.
 */
export const builderRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /tenant/builder/drafts — create a new draft
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

builderRouter.post('/tenant/builder/drafts', async (c) => {
  const tenantId = getTenantId(c)
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = body.name as string
  const baseTemplateId = (body.baseTemplateId as string) || null

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }

  // Initialize layout from template or empty
  let layout: any = {
    id: `draft-${Date.now()}`,
    type: 'Page',
    props: { title: name, description: '' },
    children: [],
  }

  if (baseTemplateId) {
    const ARTIFACT_KV = envFromContext(c).ARTIFACT_KV
    if (ARTIFACT_KV) {
      try {
        const payload: Record<string, unknown> | null = await ARTIFACT_KV.get(`template:${baseTemplateId}`, 'json')
        if (payload?.layout) layout = JSON.parse(JSON.stringify(payload.layout))
      } catch { /* fall through — use default layout */ }
    }
  }

  const draftId = crypto.randomUUID()
  const design = (body.design as string) || '## Colors\nprimary: #1a73e8\nbackground: #ffffff\ntext: #111111'
  const checksum = await sha256({ layout, design })

  // Store payload in TENANT_KV
  await TENANT_KV.put(`draft:${tenantId}:${draftId}`, JSON.stringify({ layout, design }))

  // Insert D1 metadata
  await db.prepare(
    `INSERT INTO form_drafts (id, tenant_id, name, base_template_id, status, version, checksum)
     VALUES (?, ?, ?, ?, 'drafting', 1, ?)`
  ).bind(draftId, tenantId, name, baseTemplateId, checksum).run()

  console.warn(JSON.stringify({ event: 'draft_created', tenantId, draftId, name, timestamp: Date.now() }))

  return c.json({ success: true, draftId, version: 1, status: 'drafting' })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /tenant/builder/drafts/:id — get draft payload
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

builderRouter.get('/tenant/builder/drafts/:id', async (c) => {
  const tenantId = getTenantId(c)
  const draftId = c.req.param('id')
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const meta = await db.prepare(
    `SELECT * FROM form_drafts WHERE id = ? AND tenant_id = ?`
  ).bind(draftId, tenantId).first()

  if (!meta) return c.json({ error: 'Draft not found' }, 404)

  let payload: any = null
  try {
    payload = await TENANT_KV.get(`draft:${tenantId}:${draftId}`, 'json')
  } catch { /* fall through */ }

  return c.json({ metadata: meta, payload: payload || null })
})

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /tenant/builder/drafts/:id — RFC 6902 JSON Patch mutation
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

builderRouter.patch('/tenant/builder/drafts/:id', async (c) => {
  const tenantId = getTenantId(c)
  const draftId = c.req.param('id')
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  // Rate limit check
  const rateResult = await builderRateLimiter.check(`builder:${tenantId}`)
  if (!rateResult.allowed) {
    return c.json({ error: 'Rate limit exceeded', message: 'Max 5 patch requests per second' }, 429)
  }

  // Parse body
  let operations: PatchOperation[]
  try {
    operations = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be a JSON array of patch operations' }, 400)
  }

  // Fetch current draft metadata (lock via optimistic version)
  const meta: any = await db.prepare(
    `SELECT * FROM form_drafts WHERE id = ? AND tenant_id = ? AND status = 'drafting'`
  ).bind(draftId, tenantId).first()

  if (!meta) return c.json({ error: 'Draft not found or not in drafting status' }, 404)

  // Fetch current payload
  let payload: any = null
  try {
    payload = await TENANT_KV.get(`draft:${tenantId}:${draftId}`, 'json')
  } catch { /* fall through */ }

  if (!payload) return c.json({ error: 'Draft payload not found' }, 500)

  // Apply patches
  const patchResult = applyPatches(payload.layout, operations)
  if (!patchResult.success) {
    // Reject patch, retain previous KV state, return error
    return c.json({
      error: 'patch_rejected',
      code: patchResult.error?.includes('root') ? 'INVALID_PATH'
        : patchResult.error?.includes('not allowed') ? 'INVALID_PATH'
        : patchResult.error?.includes('not exist') ? 'INVALID_PATH'
        : 'PATCH_FAILED',
      message: patchResult.error,
      path: patchResult.path,
      lastValidVersion: meta.version,
    }, 400)
  }

  // Partial validation
  const partial = validatePartial(patchResult.layout)
  if (!partial.valid) {
    return c.json({
      error: 'patch_rejected',
      message: partial.error,
      lastValidVersion: meta.version,
    }, 400)
  }

  // Write KV (atomic: write before D1)
  const newPayload = { layout: patchResult.layout, design: payload.design }
  await TENANT_KV.put(`draft:${tenantId}:${draftId}`, JSON.stringify(newPayload))

  // Update D1 metadata (optimistic lock via version increment)
  const newVersion = (meta.version || 1) + 1
  const newChecksum = await sha256(newPayload)

  const updateResult = await db.prepare(
    `UPDATE form_drafts SET version = ?, checksum = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ? AND status = 'drafting' AND version = ?`
  ).bind(newVersion, newChecksum, draftId, tenantId, meta.version).run()

  if (!updateResult || (updateResult.meta?.changes ?? 0) === 0) {
    // Optimistic lock failure — roll back KV
    await TENANT_KV.put(`draft:${tenantId}:${draftId}`, JSON.stringify(payload))
    return c.json({ error: 'Version conflict — draft was modified elsewhere', version: meta.version }, 409)
  }

  console.warn(JSON.stringify({
    event: 'patch_applied', tenantId, draftId, version: newVersion,
    ops: operations.length, timestamp: Date.now(),
  }))

  return c.json({ success: true, version: newVersion, checksum: newChecksum })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /tenant/builder/drafts/:id/publish — submit draft for approval
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

builderRouter.post('/tenant/builder/drafts/:id/publish', async (c) => {
  const tenantId = getTenantId(c)
  const draftId = c.req.param('id')
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  // Fetch draft (lock state — must be 'drafting')
  const meta: any = await db.prepare(
    `SELECT * FROM form_drafts WHERE id = ? AND tenant_id = ? AND status = 'drafting'`
  ).bind(draftId, tenantId).first()

  if (!meta) return c.json({ error: 'Draft not found or not in drafting status' }, 404)

  // Fetch payload
  let payload: any
  try {
    payload = await TENANT_KV.get(`draft:${tenantId}:${draftId}`, 'json')
  } catch { /* fall through */ }
  if (!payload) return c.json({ error: 'Draft payload not found' }, 500)

  // Full validation (Zod + design)
  const layoutParsed = layoutDefinitionSchema.safeParse(payload.layout)
  if (!layoutParsed.success) {
    return c.json({
      error: 'Full validation failed — publish blocked',
      details: layoutParsed.error.issues,
      lastValidVersion: meta.version,
    }, 400)
  }

  const designResult = validateDesign(payload.design)
  if (!designResult.valid) {
    return c.json({
      error: 'Design validation failed',
      details: designResult.errors,
    }, 400)
  }

  // Snapshot to KV
  await TENANT_KV.put(
    `draft_snapshot:${tenantId}:${draftId}:v${meta.version}`,
    JSON.stringify(payload),
  )

  // Route to tenant_submissions queue (existing approval pipeline)
  const submissionId = crypto.randomUUID()
  const layoutJson = JSON.stringify(layoutParsed.data)

  await db.prepare(
    `INSERT INTO tenant_submissions (id, tenant_id, layout_json, design_md, source, status, submitted_by)
     VALUES (?, ?, ?, ?, 'builder', 'pending', ?)`
  ).bind(submissionId, tenantId, layoutJson, payload.design, tenantId).run()

  // Update draft status
  await db.prepare(
    `UPDATE form_drafts SET status = 'pending_approval', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ? AND status = 'drafting'`
  ).bind(draftId, tenantId).run()

  console.warn(JSON.stringify({
    event: 'draft_published', tenantId, draftId, submissionId,
    version: meta.version, timestamp: Date.now(),
  }))

  return c.json({
    success: true,
    submissionId,
    draftVersion: meta.version,
    status: 'pending_approval',
    message: 'Draft submitted for admin review',
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /tenant/builder/drafts/:id/preview — render draft layout as HTML
// Auth: tenantAuth
// ═══════════════════════════════════════════════════════════════════════════

builderRouter.get('/tenant/builder/drafts/:id/preview', async (c) => {
  const tenantId = getTenantId(c)
  const draftId = c.req.param('id')
  const db = envFromContext(c).DB
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  const meta: any = await db.prepare(
    `SELECT * FROM form_drafts WHERE id = ? AND tenant_id = ?`
  ).bind(draftId, tenantId).first()

  if (!meta) return c.json({ error: 'Draft not found' }, 404)

  let payload: any
  try {
    payload = await TENANT_KV.get(`draft:${tenantId}:${draftId}`, 'json')
  } catch { /* fall through */ }
  if (!payload) return c.json({ error: 'Draft payload not found' }, 500)

  // Partial validation first
  const partial = validatePartial(payload.layout)
  if (!partial.valid) {
    return c.text('Preview unavailable — layout has structural errors', 400)
  }

  // Compile layout to HTML via new Canvas pipeline
  try {
    const { openPencilToCanvas } = await import('../canvas/openpencil-migration')
    const { compileFromCanvas } = await import('../canvas/compile-from-canvas')
    const doc = openPencilToCanvas(payload.layout)
    const content = compileFromCanvas(doc)

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview — ${meta.name}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    .preview-banner {
      background: #fbbf24; color: #1e3a5f;
      text-align: center; padding: 8px;
      font-size: 13px; font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="preview-banner">DRAFT PREVIEW — ${meta.name} v${meta.version}</div>
  <main class="max-w-4xl mx-auto p-4">${content}</main>
</body>
</html>`

    c.header('Content-Type', 'text/html; charset=utf-8')
    c.header('Cache-Control', 'no-cache, no-store')
    return c.body(html)
  } catch (err: any) {
    return c.text(`Preview error: ${err.message}`, 500)
  }
})

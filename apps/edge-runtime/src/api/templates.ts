/**
 * EdgeGDE Runtime — Template Gallery
 * Track 4 Phase 3: Immutable, versioned, self-contained form templates.
 *
 * Storage: D1 (registry metadata) + ARTIFACT_KV (layout + design payloads)
 * Instantiation: deployTenantLayout() via publishCore — no approval queue
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { deployTenantLayout } from '../lib/publish-tenant'
import { layoutDefinitionSchema } from '@edgegde/schema'
import { validateDesign } from '../lib/design-validator'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface TemplateMeta {
  id: string
  tenant_id: string | null
  name: string
  category: string
  version: number
  schema_version: number
  checksum: string
  origin: 'system' | 'tenant' | 'ai'
  is_active: boolean
  created_at: string
}

interface TemplatePayload {
  layout: any
  design: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Router — mounted at /api/v1/admin/*
// ═══════════════════════════════════════════════════════════════════════════

export const templateRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/templates — list active templates
// Auth: adminAuth (via /api/v1/admin/* middleware)
// ═══════════════════════════════════════════════════════════════════════════

templateRouter.get('/templates', async (c) => {
  const db = envFromContext(c).DB
  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  const category = c.req.query('category') || null
  const tenantId = c.req.query('tenantId') || null

  try {
    let sql: string
    let bindings: any[]

    if (category && tenantId) {
      sql = `SELECT id, name, category, version, origin, created_at
             FROM template_registry
             WHERE is_active = 1 AND category = ? AND (tenant_id IS NULL OR tenant_id = ?)
             ORDER BY name ASC`
      bindings = [category, tenantId]
    } else if (category) {
      sql = `SELECT id, name, category, version, origin, created_at
             FROM template_registry
             WHERE is_active = 1 AND category = ?
             ORDER BY name ASC`
      bindings = [category]
    } else {
      sql = `SELECT id, name, category, version, origin, created_at
             FROM template_registry
             WHERE is_active = 1
             ORDER BY name ASC`
      bindings = []
    }

    const { results } = await db.prepare(sql).bind(...bindings).all()
    return c.json({ templates: results })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/templates/:id — get template detail (metadata + payload)
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

templateRouter.get('/templates/:id', async (c) => {
  const templateId = c.req.param('id')
  const db = envFromContext(c).DB
  const ARTIFACT_KV = envFromContext(c).ARTIFACT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)

  // Fetch metadata from D1
  const meta = await db.prepare(
    `SELECT * FROM template_registry WHERE id = ? AND is_active = 1`
  ).bind(templateId).first()

  if (!meta) return c.json({ error: 'Template not found' }, 404)

  // Fetch payload from ARTIFACT_KV
  let payload: TemplatePayload | null = null
  if (ARTIFACT_KV) {
    try {
      payload = await ARTIFACT_KV.get(`template:${templateId}`, 'json')
    } catch { /* fall through */ }
  }

  return c.json({
    metadata: meta,
    payload: payload || null,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/templates — create a new template
// Auth: adminAuth
// ═══════════════════════════════════════════════════════════════════════════

templateRouter.post('/templates', async (c) => {
  const db = envFromContext(c).DB
  const ARTIFACT_KV = envFromContext(c).ARTIFACT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!ARTIFACT_KV) return c.json({ error: 'ARTIFACT_KV required' }, 500)

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const id = body.id as string
  const name = body.name as string
  const category = (body.category as string) || 'general'
  const layout = body.layout
  const design = body.design as string

  if (!id || typeof id !== 'string') return c.json({ error: 'id is required' }, 400)
  if (!name || typeof name !== 'string') return c.json({ error: 'name is required' }, 400)
  if (!layout) return c.json({ error: 'layout is required' }, 400)

  // Validate layout
  const layoutParsed = layoutDefinitionSchema.safeParse(layout)
  if (!layoutParsed.success) {
    return c.json({
      error: 'Layout validation failed',
      details: layoutParsed.error.issues,
    }, 400)
  }

  // Validate design
  const designResult = validateDesign(design || '')
  if (!designResult.valid) {
    return c.json({
      error: 'Design validation failed',
      details: designResult.errors,
    }, 400)
  }

  // Generate checksum
  const checksum = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(layout) + design),
  ).then((h) => Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join(''))

  // Check for existing
  const existing = await db.prepare(
    `SELECT id FROM template_registry WHERE id = ?`
  ).bind(id).first()
  if (existing) return c.json({ error: `Template "${id}" already exists` }, 409)

  // Insert D1 metadata
  await db.prepare(
    `INSERT INTO template_registry (id, name, category, version, schema_version, checksum, origin)
     VALUES (?, ?, ?, 1, 1, ?, 'system')`
  ).bind(id, name, category, checksum).run()

  // Store payload in ARTIFACT_KV
  await ARTIFACT_KV.put(`template:${id}`, JSON.stringify({
    layout: layoutParsed.data,
    design: design || '## Colors\nprimary: #1a73e8\nbackground: #ffffff\ntext: #111111',
  }))

  console.warn(JSON.stringify({
    event: 'template_created',
    id,
    name,
    category,
    timestamp: Date.now(),
  }))

  return c.json({ success: true, id, name })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /tenant/forms/instantiate-template — instantiate a template for a tenant
// Auth: tenantAuth (via /api/v1/tenant/* middleware)
// Bypasses approval queue — templates are pre-approved.
// ═══════════════════════════════════════════════════════════════════════════

export const instantiateRouter = new Hono()

instantiateRouter.post('/tenant/forms/instantiate-template', async (c) => {
  // ── Auth is handled by tenantAuth middleware ─────────────────────────────

  const tenantId = (c as { get: (key: string) => unknown }).get('authenticatedTenantId') as string
  const db = envFromContext(c).DB
  const ARTIFACT_KV = envFromContext(c).ARTIFACT_KV
  const TENANT_KV = envFromContext(c).TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV required' }, 500)

  // Parse body
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const templateId = body.templateId as string
  if (!templateId) return c.json({ error: 'templateId is required' }, 400)

  // 1. Fetch template metadata from D1
  const meta: any = await db.prepare(
    `SELECT * FROM template_registry WHERE id = ? AND is_active = 1`
  ).bind(templateId).first()

  if (!meta) return c.json({ error: 'Template not found' }, 404)

  // 2. Fetch payload from ARTIFACT_KV
  let payload: TemplatePayload | null = null
  if (ARTIFACT_KV) {
    try {
      payload = await ARTIFACT_KV.get(`template:${templateId}`, 'json')
    } catch { /* fall through */ }
  }

  if (!payload) return c.json({ error: 'Template payload missing' }, 500)

  // 3. Apply overrides (scoped to props level for safety)
  const overrides = body.overrides as Record<string, any> | undefined
  let layout = payload.layout

  if (overrides && typeof overrides === 'object') {
    // Deep merge: apply path-based overrides to props only
    layout = JSON.parse(JSON.stringify(payload.layout)) // deep clone

    for (const [path, value] of Object.entries(overrides)) {
      const parts = path.split('.')
      let current: any = layout
      let validPath = true

      for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
          validPath = false
          break
        }
        current = current[parts[i]]
      }

      if (validPath) {
        current[parts[parts.length - 1]] = value
      }
    }
  }

  // 4. Validate after merge
  const layoutParsed = layoutDefinitionSchema.safeParse(layout)
  if (!layoutParsed.success) {
    return c.json({
      error: 'invalid_override',
      message: 'Override resulted in invalid layout',
      details: layoutParsed.error.issues,
    }, 400)
  }

  const designStr = payload.design || ''
  const designResult = validateDesign(designStr)
  if (!designResult.valid) {
    return c.json({
      error: 'Design validation failed',
      details: designResult.errors,
    }, 400)
  }

  // 5. Deploy via publishCore
  const result = await deployTenantLayout(
    tenantId,
    layoutParsed.data,
    designStr,
    db,
    TENANT_KV,
    'template',
  )

  console.warn(JSON.stringify({
    event: 'template_instantiated',
    templateId,
    tenantId,
    version: result.version,
    timestamp: Date.now(),
  }))

  return c.json({
    success: true,
    tenantId: result.tenantId,
    version: result.version,
    url: result.url,
  })
})

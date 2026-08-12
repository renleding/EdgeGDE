/**
 * EdgeGDE Runtime — Tenant Provisioning API
 * Phase 34: Admin-only tenant creation endpoint.
 */

import { Hono } from 'hono'
import type { TenantConfig } from '../lib/tenant'
import { validateSlug } from '../lib/tenant'
import type { WebhookConfig } from '../lib/webhook'
import { envFromContext } from '../lib/env'

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const tenantRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/tenants — create a new tenant (admin only)
// ═══════════════════════════════════════════════════════════════════════════

tenantRouter.post('/', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  // ── 1. Parse body ───────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // ── 2. Validate slug ────────────────────────────────────────────────────
  let slug: string
  try {
    slug = validateSlug(String(body.slug || ''))
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }

  // ── 3. Check for duplicates ─────────────────────────────────────────────
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!TENANT_KV) {
    return c.json({ error: 'TENANT_KV not available' }, 500)
  }

  const existing = await TENANT_KV.get(`tenant:${slug}`, 'json')
  if (existing) {
    return c.json({ error: `Slug "${slug}" is already taken` }, 400)
  }

  // ── 4. Create tenant ────────────────────────────────────────────────────
  const tenantId = crypto.randomUUID()

  const tenant: TenantConfig = {
    tenantId,
    slug,
    name: String(body.name || slug),
    createdAt: new Date().toISOString(),
    plan: 'free',
  }

  await TENANT_KV.put(`tenant:${slug}`, JSON.stringify(tenant))

  // ── 5. Seed default layout + design ─────────────────────────────────────
  await TENANT_KV.put(
    `tenant:${tenantId}:layout:latest`,
    JSON.stringify({
      type: 'Page',
      children: [
        {
          type: 'Header',
          props: { logo: tenant.name, links: ['Home', 'Products', 'Contact'] },
        },
        {
          type: 'Section:Hero',
          props: {
            title: `${tenant.name}`,
            subtitle: 'Powered by EdgeGDE',
          },
        },
        { type: 'Footer' },
      ],
    })
  )

  await TENANT_KV.put(
    `tenant:${tenantId}:design`,
    '## Colors\nprimary: #1a73e8\nbackground: #ffffff\ntext: #111111'
  )

  // ── 6. Mirror to D1 for safe querying ────────────────────────────────────
  const db = envFromContext(c).DB
  if (db && typeof db.prepare === 'function') {
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO tenants (slug, tenant_id, name, plan) VALUES (?, ?, ?, ?)`
      ).bind(slug, tenantId, tenant.name, tenant.plan).run()
    } catch {
      // D1 mirror failure is non-fatal — KV is source of truth
    }
  }

  // ── 7. Return ───────────────────────────────────────────────────────────
  return c.json({
    tenantId,
    slug,
    name: tenant.name,
    url: `https://${slug}.edgegde.com`,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/tenants — list all tenants (admin only)
// ═══════════════════════════════════════════════════════════════════════════

tenantRouter.get('/', async (c) => {
  const db = envFromContext(c).DB

  if (!db || typeof db.prepare !== 'function') {
    return c.json({ error: 'D1 binding required' }, 500)
  }

  try {
    const { results } = await db.prepare(
      `SELECT slug, tenant_id, name, plan, created_at
       FROM tenants
       ORDER BY created_at DESC`
    ).all()

    return c.json({ tenants: results || [] })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/tenants/:slug/webhook — read webhook config
// Auth: adminAuth (via middleware on /api/tenants)
// ═══════════════════════════════════════════════════════════════════════════

tenantRouter.get('/:slug/webhook', async (c) => {
  const slug = c.req.param('slug')
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV not available' }, 500)

  const config: WebhookConfig | null =
    await TENANT_KV.get(`tenant:${slug}:webhook`, 'json')

  return c.json({
    slug,
    webhook: config || { url: '', enabled: false },
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/tenants/:slug/webhook — set webhook config
// Auth: adminAuth (via middleware on /api/tenants)
// ═══════════════════════════════════════════════════════════════════════════

tenantRouter.put('/:slug/webhook', async (c) => {
  const slug = c.req.param('slug')
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV not available' }, 500)

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const url = body.url
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'url is required' }, 400)
  }

  // Validate URL format
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return c.json({ error: 'URL must use http or https protocol' }, 400)
    }
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400)
  }

  const config: WebhookConfig = {
    url,
    enabled: body.enabled !== false,
    secret: typeof body.secret === 'string' && body.secret.length > 0
      ? body.secret
      : undefined,
  }

  await TENANT_KV.put(`tenant:${slug}:webhook`, JSON.stringify(config))

  console.warn(JSON.stringify({
    event: 'webhook_config',
    action: 'set',
    slug,
    enabled: config.enabled,
    hasSecret: !!config.secret,
    timestamp: Date.now(),
  }))

  return c.json({ success: true, slug, webhook: config })
})

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/tenants/:slug/webhook — remove webhook config
// Auth: adminAuth (via middleware on /api/tenants)
// ═══════════════════════════════════════════════════════════════════════════

tenantRouter.delete('/:slug/webhook', async (c) => {
  const slug = c.req.param('slug')
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV not available' }, 500)

  await TENANT_KV.delete(`tenant:${slug}:webhook`)

  console.warn(JSON.stringify({
    event: 'webhook_config',
    action: 'deleted',
    slug,
    timestamp: Date.now(),
  }))

  return c.json({ success: true, slug, webhook: null })
})

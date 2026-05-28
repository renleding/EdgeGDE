/**
 * EdgeGDE Mortgage Calculator — Hono Edge Runtime
 * HSAES Phase 5 & 6: Registry-driven calculator tools with MCP discovery,
 * dynamic tenant-gated API routing, and KV-backed artifact publishing.
 * HSAES Phase 20: Hostname-based multi-tenancy, rate limiting, telemetry.
 * Phase 34: Unified tenant model, strict isolation, lazy migration.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { CALCULATOR_REGISTRY } from './registry/calculators'
import { PAGE_REGISTRY } from './registry/pages'
import { THEME_REGISTRY } from './registry/themes'
import { router as apiRouter } from './routes/api'
import { agentRouter } from './routes/agent'
import { mcpDeployRouter } from './routes/mcp-deploy'
import { dashboardRouter } from './routes/dashboard'
import { tenantRouter } from './api/tenants'
import { submissionRouter } from './api/submissions'
import { tenantAuth } from './middleware/tenant-auth'
import { templateRouter, instantiateRouter } from './api/templates'
import { builderRouter } from './api/builder'
import { scoringAdminRouter, scoringTenantRouter } from './api/scoring'
import { reportAdminRouter, reportCronHandler } from './api/reports'
import { fragmentRouter } from './routes/fragment'
import {
  getCachedLayout,
  setCachedLayout,
  getCachedDesign,
  setCachedDesign,
  clearLayout,
  clearDesign,
} from './lib/cache'
import { MemoryKvStore } from './lib/publish'
import type { KvStore } from './lib/publish'
import { getLatestVersion, getVersion } from './lib/versioning'
import { compileLayout } from './compiler/engine'
import { tenantResolver } from './middleware/tenant-resolver'
import { adminAuth } from './middleware/auth'
import { rateLimiter } from './lib/rate-limiter'
import { logEvent } from './lib/telemetry'
import type { TenantConfig } from './lib/tenant'
import type { LayoutDefinition } from '@edgegde/schema'
// ═══════════════════════════════════════════════════════════════════════════
// Form Registry (Phase 29)
// ═══════════════════════════════════════════════════════════════════════════
import { mountFormRoutes } from './lib/form-registry'
import { registerForms } from './registry/forms'

// ═══════════════════════════════════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════════════════════════════════

const app = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Global KV store for local dev — shared across handlers
// ═══════════════════════════════════════════════════════════════════════════

export const kv = new MemoryKvStore()

// ═══════════════════════════════════════════════════════════════════════════
// KV.list() Safety Guard — hard crash if any code calls list() on TENANT_KV
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Override a KV namespace binding's `list` method to throw immediately.
 * This is a permanent runtime safety net — NOT a debugging tool.
 *
 * KV.list() is forbidden in this architecture.
 * All listing MUST go through D1 or counter reads.
 */
function guardKvList(kvBinding: any, name: string): void {
  if (kvBinding && typeof kvBinding === 'object') {
    try {
      kvBinding.list = () => {
        throw new Error(
          `🚨 KV.list() is FORBIDDEN on ${name}. ` +
          'Use D1 queries or counter reads for aggregation. ' +
          'This is a runtime safety guard — not a configuration issue.'
        )
      }
    } catch {
      // Binding may be frozen in some environments — guard silently skipped
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE ORDER — MUST BE STRICTLY ENFORCED
//   1. tenantResolver — resolves tenant before ANY logic
//   2. rateLimiter — protects /api/* endpoints
//   3. adminAuth — protects admin endpoints
// ═══════════════════════════════════════════════════════════════════════════

// 1. KV LIST GUARD — patch TENANT_KV binding on first request
app.use('*', async (c, next) => {
  // This middleware is idempotent — patching a frozen binding is a no-op
  guardKvList((c.env as any)?.TENANT_KV, 'TENANT_KV')
  guardKvList((c.env as any)?.ARTIFACT_KV, 'ARTIFACT_KV')
  guardKvList((c.env as any)?.TELEMETRY_KV, 'TELEMETRY_KV')
  await next()
})

// 2. TENANT RESOLVER — always first after guard
app.use('*', tenantResolver)

// 2. RATE LIMITER — /api/* endpoints only (not healthz, MCP discovery, static)
async function rateLimitHandler(c: any, next: any) {
  const tenant = (c as any).get('tenant') as TenantConfig | undefined

  if (!tenant) {
    // No tenant resolved (admin/agent endpoints) — skip rate limiting
    return next()
  }

  const ip = c.req.header('cf-connecting-ip') || 'unknown'
  const path = c.req.path

  // Key includes tenantId (immutable), endpoint path, and IP
  const key = `rate:${tenant.tenantId}:${path}:${ip}`
  const result = await rateLimiter.check(key)

  if (!result.allowed) {
    c.header('Retry-After', '60')
    c.header('X-RateLimit-Remaining', '0')
    return c.json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again in 60 seconds.',
      remaining: 0,
    }, 429)
  }

  c.header('X-RateLimit-Remaining', String(result.remaining))
  await next()
}

app.use('/api/*', rateLimitHandler)

// 3. TENANT AUTH — submission endpoints
app.use('/api/v1/tenant/*', tenantAuth)

// 4. ADMIN AUTH — protected endpoint patterns
app.use('/api/v1/agent/*', adminAuth)
app.use('/api/v1/mcp/*', adminAuth)
app.use('/api/tenants', adminAuth)
app.use('/api/v1/admin/*', adminAuth)
app.use('/dev/deploy-staging', adminAuth)
app.use('/api/admin/*', adminAuth)

// ═══════════════════════════════════════════════════════════════════════════
// Health Check — zero dependency endpoint
// ═══════════════════════════════════════════════════════════════════════════

app.get('/healthz', (c) => {
  return c.text('ok')
})

// ═══════════════════════════════════════════════════════════════════════════
// MCP Discovery Document — dynamically derived from CALCULATOR_REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

app.get('/.well-known/mcp.json', (c) => {
  const calcTools = Object.values(CALCULATOR_REGISTRY).map((tool) => {
    // Unwrap ZodEffects (refined) schemas to get the inner ZodObject
    const innerSchema = (tool.schema as any)._def?.innerType ?? tool.schema
    return {
      name: `calculate_${tool.id}`,
      description: tool.description,
      inputSchema: zodToJsonSchema(innerSchema as any) as Record<string, unknown>,
    }
  })

  const pageTools = Object.values(PAGE_REGISTRY).map((page) => ({
    name: `render_page_${page.id}`,
    description: page.description,
    inputSchema: {} as Record<string, unknown>,
  }))

  const themeTools = Object.values(THEME_REGISTRY).map((theme) => ({
    name: `apply_theme_${theme.id}`,
    description: theme.description,
    inputSchema: {} as Record<string, unknown>,
  }))

  const discoveryDoc = {
    protocolVersion: '2025-03-26',
    tools: [
      // Static deploy tool — wraps full generate→validate→publish pipeline
      {
        name: 'deploy_layout_from_json',
        description:
          'Deploy a tenant layout from structured LayoutDefinition JSON ' +
          'and DESIGN.md. You MUST generate both internally before calling. ' +
          'Returns live URL on success, structured Zod errors on failure.',
        inputSchema: {
          type: 'object',
          required: ['layout', 'design', 'tenantId'],
          properties: {
            layout: {
              type: 'object',
              description: 'Strict LayoutDefinition JSON — must conform to the schema',
            },
            design: {
              type: 'string',
              description: 'DESIGN.md formatted string (e.g. "## Colors\\nprimary: #1a73e8")',
            },
            tenantId: {
              type: 'string',
              description: 'Target tenant slug or tenant ID',
            },
            source: {
              type: 'string',
              enum: ['ai', 'manual', 'import'],
              description: 'Optional origin label for audit',
            },
          },
        },
      },
      // Static read tool — get tenant layout snapshot (version + layout + design)
      {
        name: 'get_tenant_layout',
        description:
          'Retrieve the current layout, design, and version for a tenant. ' +
          'Always use this before editing to ensure OCC correctness.',
        inputSchema: {
          type: 'object',
          required: ['tenantId'],
          properties: {
            tenantId: {
              type: 'string',
              description: 'Target tenant slug or tenant ID',
            },
          },
        },
      },
      // Smoke test generator — generates bash/curl test script for a tenant
      {
        name: 'generate_smoke_test',
        description:
          'Generate a self-contained bash/curl smoke test script for a tenant. ' +
          'Tests layout rendering, health endpoint, MCP discovery, form submission, ' +
          'and D1 persistence. Returns a runnable shell script.',
        inputSchema: {
          type: 'object',
          required: ['tenantId'],
          properties: {
            tenantId: {
              type: 'string',
              description: 'Target tenant slug or tenant ID',
            },
            baseUrl: {
              type: 'string',
              description: 'Optional base URL override (defaults to tenant.edgegde.com)',
            },
          },
        },
      },
      // Dynamic registry tools
      ...calcTools,
      ...pageTools,
      ...themeTools,
    ],
  }
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(discoveryDoc)
})

// ═══════════════════════════════════════════════════════════════════════════
// Mount Routers
// ═══════════════════════════════════════════════════════════════════════════

app.route('/api', apiRouter)
app.route('/api', dashboardRouter)
app.route('/api', fragmentRouter)
app.route('/api/v1', agentRouter)
app.route('/api/v1', mcpDeployRouter)
app.route('/api/v1', submissionRouter)
app.route('/api/v1/admin', templateRouter)
app.route('/api/v1', instantiateRouter)
app.route('/api/v1', builderRouter)
app.route('/api/v1/admin', scoringAdminRouter)
app.route('/api/v1', scoringTenantRouter)
app.route('/api/v1/admin', reportAdminRouter)
app.route('/api/v1', reportCronHandler)

// Tenant provisioning (admin)
app.route('/api/tenants', tenantRouter)

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/tenants/:slug — update tenant config (admin only)
// ═══════════════════════════════════════════════════════════════════════════

app.put('/api/tenants/:slug', adminAuth, async (c) => {
  const slug = c.req.param('slug')
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV not available' }, 500)

  const existing = await TENANT_KV.get(`tenant:${slug}`, 'json')
  if (!existing) return c.json({ error: 'Not found' }, 404)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updated = {
    ...existing,
    ...(body.name ? { name: String(body.name) } : {}),
    ...(body.plan ? { plan: String(body.plan) } : {}),
    updatedAt: new Date().toISOString(),
  }

  await TENANT_KV.put(`tenant:${slug}`, JSON.stringify(updated))

  // Bust in-memory cache
  const { clearTenant } = await import('./lib/cache')
  clearTenant(slug)

  return c.json(updated)
})

// ═══════════════════════════════════════════════════════════════════════════
// Mount Form Routes (Phase 29) — auto-generated from form registry
// ═══════════════════════════════════════════════════════════════════════════

registerForms()
mountFormRoutes(app)

// ═══════════════════════════════════════════════════════════════════════════
// One-Time Counter Seed Route (Phase 30)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/dev/seed-counters', async (c) => {
  const db = (c.env as any)?.DB

  if (!db || typeof db.prepare !== 'function') {
    return c.text('D1 binding required', 500)
  }

  try {
    // Use D1 COUNT queries instead of KV.list() — KV.list() is forbidden
    const [submissionsResult, tenantsResult, draftsResult] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as count FROM form_submissions`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM tenants`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM form_drafts`).first(),
    ])

    const artifactCount = 0 // Artifacts are KV-only — no D1 mirror yet
    const submissionCount = (submissionsResult as any)?.count || 0
    const tenantCount = (tenantsResult as any)?.count || 0
    const draftCount = (draftsResult as any)?.count || 0

    return c.text(
      `D1 counters: submissions=${submissionCount} tenants=${tenantCount} drafts=${draftCount}`
    )
  } catch (err: any) {
    return c.text(`Count failed: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Admin API (Phase 31) — securely gated lead retrieval
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/admin/leads/:tenantId', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  const tenantId = c.req.param('tenantId')
  const offsetRaw = c.req.query('offset')
  const offset = Math.max(0, Number(offsetRaw) || 0)
  const limit = 100

  try {
    const db = (c.env as any)?.DB
    if (!db || typeof db.prepare !== 'function') {
      return c.json({ error: 'D1 not available' }, 500)
    }

    const { results } = await db.prepare(`
      SELECT * FROM form_submissions
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
      .bind(tenantId, limit, offset)
      .all()

    return c.json({ leads: results })
  } catch (err: any) {
    return c.json({ error: 'Query failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Composer Layout Renderer (Phase 32) — renders JSON layout trees
// ═══════════════════════════════════════════════════════════════════════════

import { renderComposerLayout } from './compiler/registry'
import { parseDesignMd, type DesignTokens } from './lib/design-parser'

app.post('/api/render', async (c) => {
  try {
    const body = await c.req.json() as any
    const layout = body.layout || body

    let design: DesignTokens | undefined
    if (body.designMd) {
      design = parseDesignMd(body.designMd)
    }

    if (body.debugDesign) {
      console.log('[Design Tokens]', JSON.stringify(design))
    }

    const html = renderComposerLayout(layout, design)
    return c.html(html)
  } catch (err: any) {
    return c.json({ error: 'Render failed', details: err.message }, 400)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Layout Render — serves tenant layouts via subdomain or ?tenant=
// Phase 34: cached, tenant-aware, deterministic
// ═══════════════════════════════════════════════════════════════════════════

app.get('/', async (c) => {
  const tenant = (c as any).get('tenant') as TenantConfig | undefined
  if (!tenant) return c.text('Tenant not resolved', 500)

  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.text('TENANT_KV not available', 500)

  try {
    const tenantId = tenant.tenantId

    // ── 1. Layout (memory → KV) ──────────────────────────────────────────
    let layout: any = getCachedLayout(tenantId)
    if (!layout) {
      layout = await TENANT_KV.get(`tenant:${tenantId}:layout:latest`, 'json')
      if (layout) setCachedLayout(tenantId, layout)
    }

    if (!layout) return c.text('No layout found for tenant', 404)

    // Layout size guard
    const layoutSize = JSON.stringify(layout).length
    if (layoutSize > 200_000) {
      console.warn(`[CRITICAL] Layout ${tenantId} exceeds 200KB (${layoutSize} chars)`)
    } else if (layoutSize > 100_000) {
      console.warn(`[WARNING] Layout ${tenantId} exceeds 100KB (${layoutSize} chars)`)
    }

    // ── 2. Design (memory → KV → parse) ──────────────────────────────────
    let design = getCachedDesign(tenantId)
    if (!design) {
      const designMd = await TENANT_KV.get(`tenant:${tenantId}:design`)
      const { parseDesignMd } = await import('./lib/design-parser')
      design = parseDesignMd(designMd || '')
      setCachedDesign(tenantId, design)
    }

    // ── 3. Compiled HTML cache (KV, 120s + jitter) ────────────────────────
    const cacheKey = `tenant:${tenantId}:compiled`
    let html = await TENANT_KV.get(cacheKey)

    if (!html) {
      // Detect EDR-based layout vs legacy OpenPencil layout
      if (layout && layout.root) {
        // EDR pipeline: compile via pure_compiler
        const { transform } = await import('./edr/compiler/synthesis')
        const synthesized = transform(layout.root)
        const edrDef: import('./edr/compiler/engine').EDR = {
          components: layout.edr?.components || {},
          global: layout.edr?.global || {},
        }
        const { compile: edrCompile } = await import('./edr/compiler/engine')
        html = edrCompile(synthesized, edrDef, layout.edrHash || 'default', 'edr')

        // Generate CSS from EDR components
        const { generateCSS } = await import('./lib/generateCSS')
        const css = generateCSS(edrDef, layout.edrHash || 'default')
        html = `<style>${css}</style>${html}`
      } else {
        // Legacy OpenPencil pipeline
        html = compileLayout(layout, design)
      }
      const ttl = 120 + Math.floor(Math.random() * 20)
      await TENANT_KV.put(cacheKey, html, { expirationTtl: ttl })
    }

    // ── Environment badge ───────────────────────────────────────────────
    // Only show for non-production environments
    const queryEnv = c.req.query('env')
    const envBadge = queryEnv === 'staging'
      ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-400 uppercase tracking-wider">STAGING</span>'
      : ''

    const title = `${tenant.name} — EdgeGDE`

    const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    .htmx-indicator { opacity:0; transition:opacity 0.2s; }
    .htmx-request .htmx-indicator { opacity:1; }
    .htmx-request button { pointer-events:none; opacity:0.6; }
    .htmx-request input, .htmx-request select { pointer-events:none; opacity:0.7; }

    /* Hide spinners on number inputs paired with sliders */
    input[type="range"] + input[type="number"]::-webkit-inner-spin-button,
    input[type="range"] + input[type="number"]::-webkit-outer-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    input[type="range"] + input[type="number"] {
      -moz-appearance: textfield;
    }

    /* Responsive grid — 1 column on mobile, 2 on tablet+ */
    @media (max-width: 640px) {
      [class*="grid_container"] { grid-template-columns:1fr !important; }
      [class*="page"] { padding:16px !important; }
      [class*="app_shell"] { max-width:100% !important; }
      [class*="section_card"], [class*="subsection_card"] { padding:16px !important; }
      header div { flex-direction:column; gap:4px; text-align:center; }
      h1 { font-size:28px !important; }
    }
    @media (min-width: 641px) and (max-width: 1024px) {
      [class*="page"] { padding:24px !important; }
    }
  </style>
</head>
<body class="min-h-screen bg-[#0b1326]">
  <header class="bg-[#0b1326]/90 border-b border-white/10 backdrop-blur-2xl">
    <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
      <span class="text-lg font-semibold text-white uppercase tracking-wider">${tenant.name}</span>
      ${envBadge}
    </div>
  </header>
  <main id="app-root"
        class="max-w-4xl mx-auto"
        hx-get="/api/fragment/render-root"
        hx-trigger="ui-schema-mutated from:body"
        hx-swap="innerHTML">
    ${html}
  </main>
  ${queryEnv === 'staging' ? `
  <div id="dev-sentinel"
       hx-get="/api/fragment/dev-hash"
       hx-trigger="every 1s"
       hx-swap="outerHTML"
       hx-headers='{"X-Current-Hash": "default-hash"}'>
  </div>` : ''}
</body>
</html>`

    c.header('Content-Type', 'text/html; charset=utf-8')
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    return c.body(page)
  } catch (err: any) {
    return c.text(`Layout render error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export default app
export { RateLimiter } from './objects/RateLimiter'

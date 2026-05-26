/**
 * EdgeGDE Mortgage Calculator — Hono Edge Runtime
 * HSAES Phase 5 & 6: Registry-driven calculator tools with MCP discovery,
 * dynamic tenant-gated API routing, and KV-backed artifact publishing.
 * HSAES Phase 20: Hostname-based multi-tenancy, rate limiting, telemetry.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { CALCULATOR_REGISTRY, hydrateCalculatorsFromKV } from './registry/calculators'
import { PAGE_REGISTRY, hydratePagesFromKV } from './registry/pages'
import { THEME_REGISTRY, hydrateThemesFromKV } from './registry/themes'
import { router as apiRouter } from './routes/api'
import { agentRouter } from './routes/agent'
import { mcpDeployRouter } from './routes/mcp-deploy'
import { dashboardRouter } from './routes/dashboard'
import { MemoryKvStore } from './lib/publish'
import type { KvStore } from './lib/publish'
import { getLatestVersion, getVersion } from './lib/versioning'
import { compileLayout } from './compiler/engine'
import { tenantMiddleware } from './middleware/tenant'
import { rateLimiter } from './lib/rate-limiter'
import { logEvent } from './lib/telemetry'
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
// Global Tenant Middleware — resolves tenant from hostname
// ═══════════════════════════════════════════════════════════════════════════

app.use('*', tenantMiddleware)

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limit Middleware — local dev shim for /api/v1/* routes
// ═══════════════════════════════════════════════════════════════════════════

app.use('/api/v1/*', async (c: any, next) => {
  const tenantConfig = c.get('tenantConfig') as { hostname?: string } | undefined
  const tenantId = tenantConfig?.hostname ?? 'localhost'

  const result = await rateLimiter.check(tenantId)

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
})

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
    tools: [...calcTools, ...pageTools, ...themeTools],
  }
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(discoveryDoc)
})

// ═══════════════════════════════════════════════════════════════════════════
// Mount API Router
// ═══════════════════════════════════════════════════════════════════════════

app.route('/api', apiRouter)

// ═══════════════════════════════════════════════════════════════════════════
// Mount Dashboard Router
// ═══════════════════════════════════════════════════════════════════════════

app.route('/api', dashboardRouter)

// ═══════════════════════════════════════════════════════════════════════════
// Mount Agent Router (publish endpoint)
// ═══════════════════════════════════════════════════════════════════════════

app.route('/api/v1', agentRouter)

// ═══════════════════════════════════════════════════════════════════════════
// Mount MCP Deploy Router (deployment management endpoints)
// ═══════════════════════════════════════════════════════════════════════════

app.route('/api/v1', mcpDeployRouter)

// ═══════════════════════════════════════════════════════════════════════════
// Mount Form Routes (Phase 29) — auto-generated from form registry
// ═══════════════════════════════════════════════════════════════════════════

registerForms()
mountFormRoutes(app)

// ═══════════════════════════════════════════════════════════════════════════
// One-Time Counter Seed Route (Phase 30) — run after deploy to bootstrap
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/dev/seed-counters', async (c) => {
  const artifactsKv = (c.env as any)?.ARTIFACT_KV
  const tenantKv = (c.env as any)?.TENANT_KV
  const telemetryKv = (c.env as any)?.TELEMETRY_KV

  if (!artifactsKv || !tenantKv || !telemetryKv) {
    return c.text('KV namespaces not available', 500)
  }

  try {
    const [artifacts, tenants, telemetry, _r] = await Promise.all([
      artifactsKv.list(),
      tenantKv.list(),
      telemetryKv.list(),
      // Write artifact count (exclude counter key itself)
      artifactsKv.put('_counts:artifacts', String(0)),
    ])

    const artifactCount = (artifacts.keys ?? []).filter(
      (k: any) => k.name !== '_counts:artifacts'
    ).length
    const tenantCount = (tenants.keys ?? []).length
    const telemetryCount = (telemetry.keys ?? []).length

    await Promise.all([
      artifactsKv.put('_counts:artifacts', String(artifactCount)),
      tenantKv.put('_counts:tenants', String(tenantCount)),
      telemetryKv.put('_counts:telemetry', String(telemetryCount)),
    ])

    return c.text(`Counters seeded: artifacts=${artifactCount} tenants=${tenantCount} telemetry=${telemetryCount}`)
  } catch (err: any) {
    return c.text(`Seed failed: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Admin API (Phase 31) — securely gated lead retrieval
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/admin/leads/:tenantId', async (c) => {
  const token = c.req.header('Authorization')
  const adminToken = (c.env as any)?.ADMIN_TOKEN

  if (!adminToken || token !== `Bearer ${adminToken}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

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
// Root Layout Render — serves tenant layouts via ?tenant=&env= query params
// ═══════════════════════════════════════════════════════════════════════════

app.get('/', async (c) => {
  const url = new URL(c.req.url)
  const tenantId = url.searchParams.get('tenant')
  if (!tenantId) return c.text('404 Not Found', 404)

  const isStaging = url.searchParams.get('env') === 'staging' || url.hostname.startsWith('vnext.')
  const env = isStaging ? 'staging' : 'production'

  // Resolve KV binding
  const bindings = (c.env as any)?.ARTIFACT_KV
  const kv = bindings && typeof bindings.get === 'function' ? bindings as KvStore : null
  if (!kv) return c.text('KV not available', 500)

  // Get latest version for the target environment
  const version = await getLatestVersion(kv, tenantId, env)
  if (!version) return c.text(`No ${env} version found for "${tenantId}"`, 404)

  // Fetch and compile the layout
  const raw = await getVersion(kv, tenantId, version)
  if (!raw) return c.text(`Version ${version} not found`, 404)

  try {
    const layoutDef = JSON.parse(raw) as LayoutDefinition
    const content = compileLayout(layoutDef)
    const envTag = isStaging ? 'staging' : 'production'
    const title = `${tenantId.charAt(0).toUpperCase() + tenantId.slice(1)} — ${envTag}`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="min-h-screen bg-gray-100">
  <header class="bg-white border-b border-gray-200 shadow-sm">
    <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
      <span class="text-lg font-semibold text-gray-900">${tenantId}</span>
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isStaging ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
      }">${envTag}</span>
    </div>
  </header>
  <main class="max-w-4xl mx-auto p-4">
    ${content}
  </main>
</body>
</html>`
    c.header('Content-Type', 'text/html; charset=utf-8')
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    return c.body(html)
  } catch (err: any) {
    return c.text(`Layout render error: ${err.message}`, 500)
  }
})

export default app

export { RateLimiter } from './objects/RateLimiter'

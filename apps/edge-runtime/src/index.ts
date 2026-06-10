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
import { adminRouter } from './api/admin-views'
import { adminSiteRouter } from './api/admin-site'
import { adminRulesRouter } from './api/admin-rules'
import { adminBlueprintsRouter } from './api/admin-blueprints'
import { adminFactoryRouter } from './api/admin-factory'
import { adminDriftRouter } from './api/admin-drift'
import { adminPacksRouter } from './api/admin-packs'
import { embedRouter } from './api/embed'
import { ocrRouter } from './api/ocr'
import { dashboardHtml } from './lib/dashboard-html'
import { auditRouter } from './api/audit-export'
import { reportAdminRouter, reportCronHandler } from './api/reports'
import { vaultRouter } from './api/vault'
import { chatRouter } from './api/chat'
import { chatViewsRouter } from './api/chat-views'
import { workspaceRouter } from './api/workspace'
import { ChatSession_DO } from './do/chat-session.do'
import { swarmRouter } from './api/swarm'
import { fragmentRouter } from './routes/fragment'
import { stagingRouter } from './routes/staging'
import leadScorer from './queues/lead-scorer'
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
import { getLatestHash } from './edr/runtime/hash'
import { tenantResolver } from './middleware/tenant-resolver'
import { tenantResolver as tenantContextResolver } from './middleware/tenant-context'
import { adminAuth } from './middleware/auth'
import { tenantQueryAuth } from './middleware/tenant-query-auth'
import { rateLimiter } from './lib/rate-limiter'
import { logEvent } from './lib/telemetry'
import { incrementRequest, flushMetrics } from './lib/metrics'
import type { TenantConfig } from './lib/tenant'
import type { LayoutDefinition } from '@edgegde/schema'
import { runDispatcher } from './crons/dispatcher'
import { guardDB } from './lib/db'
import { guardKV } from './lib/kv'
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

/**
 * Guard against storing event data in KV.
 * Events must live in the AuditLedger DO only.
 */
function guardKvEventStorage(kvBinding: any, name: string): void {
  if (kvBinding && typeof kvBinding === 'object' && kvBinding.put) {
    const originalPut = kvBinding.put
    try {
      kvBinding.put = async (key: string, value: any, options?: any) => {
        if (typeof key === 'string' && key.startsWith('audit:')) {
          throw new Error(
            `🚨 KV event storage is FORBIDDEN on ${name}. ` +
            `Tried to write key '${key.substring(0, 60)}...'. ` +
            'Events must be stored in the AuditLedger Durable Object.'
          )
        }
        return originalPut.call(kvBinding, key, value, options)
      }
    } catch {
      // Binding may be frozen — guard silently skipped
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
// Dashboard route — must be BEFORE tenant middleware to avoid tenant resolution
app.get('/dashboard', async (c) => {
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(dashboardHtml)
})

app.use('*', async (c, next) => {
  // This middleware is idempotent — patching a frozen binding is a no-op
  guardKvList((c.env as any)?.TENANT_KV, 'TENANT_KV')
  guardKvList((c.env as any)?.ARTIFACT_KV, 'ARTIFACT_KV')
  guardKvList((c.env as any)?.TELEMETRY_KV, 'TELEMETRY_KV')
  guardKvEventStorage((c.env as any)?.TENANT_KV, 'TENANT_KV')
  guardKvEventStorage((c.env as any)?.TELEMETRY_KV, 'TELEMETRY_KV')
  await next()
})

// 2. TENANT RESOLVER — always first after guard
app.use('*', tenantResolver)
app.use('*', tenantContextResolver)

// 2. RATE LIMITER
async function rateLimitHandler(c: any, next: any) {
  const tenant = (c as any).get('tenant') as TenantConfig | undefined

  if (!tenant) {
    // No tenant resolved (admin/agent endpoints) — skip rate limiting
    return next()
  }

  const ip = c.req.header('cf-connecting-ip') || 'unknown'
  const path = c.req.path

  // Key = tenantId only (per-tenant bucket, shared across all paths)
  const key = tenant.tenantId
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
app.use('/admin/kb/*', adminAuth)
app.use('/admin/rules/*', adminAuth)
app.use('/admin/site/*', adminAuth)
app.use('/admin/blueprints/*', adminAuth)
app.use('/admin/factory/*', adminAuth)
app.use('/admin/drift/*', adminAuth)
app.use('/admin/packs/*', adminAuth)
app.use('/api/v1/admin/audit/*', adminAuth)

// ═══════════════════════════════════════════════════════════════════════════
// Health Check — zero dependency endpoint
// ═══════════════════════════════════════════════════════════════════════════

app.get('/healthz', (c) => {
  return c.text('ok')
})

// ═══════════════════════════════════════════════════════════════════════════
// Webhook Endpoint — receives hot lead dispatch from cron
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/webhook/leads', adminAuth, async (c) => {
  try {
    const body = await c.req.json()
    const eventId = crypto.randomUUID()
    const tenantId = body.tenantId || 'unknown'

    console.log(JSON.stringify({ event: 'webhook_received', eventId, ...body }))

    // Persist to D1 for audit trail
    const rawDb = (c.env as any)?.DB
    if (rawDb && typeof rawDb.prepare === 'function') {
      const db = guardDB(rawDb)
      const ctx = { tenantId }
      c.executionCtx.waitUntil(
        db.insert(ctx, 'webhook_events', {
          id: eventId,
          event_type: 'hot_lead',
          submission_id: body.submissionId || '',
          payload: JSON.stringify(body),
        }).catch(() => {})
      )
    }

    return c.json({ received: true, eventId })
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Public Leads Feed — unauthenticated hot alert data for the glass dashboard
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/leads/feed', adminAuth, async (c) => {
  const rawKv = (c.env as any)?.TENANT_KV
  if (!rawKv) return c.json({ alerts: [] })

  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const ctx = { tenantId }
  const kv = guardKV(rawKv)
  const indexKey = `tenant:${tenantId}:alerts:hot:index`
  const raw = await kv.get(indexKey, ctx)
  if (!raw) return c.json({ alerts: [] })

  let ids: string[]
  try { ids = JSON.parse(raw) } catch { return c.json({ alerts: [] }) }
  if (!Array.isArray(ids)) return c.json({ alerts: [] })

  const results = await Promise.allSettled(
    ids.map((id: string) =>
      kv.get(`tenant:${tenantId}:alert:hot:${id}`, ctx).then((r: string | null) => {
        if (!r) return null
        const p = JSON.parse(r)
        return { submissionId: id, tenantId, score: p.score ?? 0, rationale: p.rationale ?? '', timestamp: p.ts ?? null }
      })
    )
  )
  const alerts = results.map((r: any) => r.status === 'fulfilled' ? r.value : null).filter(Boolean)
  return c.json({ alerts })
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
app.route('/admin/kb', adminRouter)
app.route('/admin/rules', adminRulesRouter)
app.route('/admin/site', adminSiteRouter)
app.route('/admin/blueprints', adminBlueprintsRouter)
app.route('/admin/factory', adminFactoryRouter)
app.route('/admin/drift', adminDriftRouter)
app.route('/admin/packs', adminPacksRouter)
app.route('/embed', embedRouter)





// Serve static widget script from public/ with version pinning
// Serve static widget script from public/ with version pinning
// v1.0.0 redirects to v1.1.0 for cache-busting
app.get('/public/widget.v1.0.0.js', async (c) => {
  return c.redirect(`/public/widget.v1.1.0.js`, 302)
})

app.get('/public/widget.v1.1.0.js', async (c) => {
  const script = `(function(){'use strict';try{
var st=document.currentScript||document.querySelector('script[data-tenant]');
if(!st)return;
var tid=st.getAttribute('data-tenant');
if(!tid)return;
var base=(st.src||'').split('/public/')[0]||window.location.origin;

if(document.getElementById('gde-chat'))return;

// Inject chat CSS (scoped to #gde-chat)
var css=document.createElement('style');
css.textContent='#gde-chat{display:flex;flex-direction:column;position:fixed;bottom:20px;right:20px;width:380px;height:600px;background:#0d1117;border-radius:12px;border:1px solid #2d3140;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;color:#e1e4e8}#gde-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#1c2128;border-bottom:1px solid #2d3140;cursor:move;flex-shrink:0;user-select:none}#gde-header h1{font-size:14px;color:#f0f6fc;font-weight:600;pointer-events:none}#gde-header .hdr-btns{display:flex;gap:2px}#gde-header .hdr-btns button{background:none;border:none;color:#8b949e;cursor:pointer;padding:4px 8px;font-size:14px;line-height:1;border-radius:4px}#gde-header .hdr-btns button:hover{color:#e1e4e8;background:#2d3140}#gde-body{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;min-height:0;background:#0d1117}#message-list{flex:1}#message-list .welcome{font-size:12px;color:#8b949e;border-bottom:1px solid #2d3140;padding-bottom:8px;margin-bottom:8px}.msg{margin-bottom:8px;animation:fadeIn 0.2s ease}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.msg-label{font-size:11px;display:block;margin-bottom:2px}.msg-user .msg-bubble{background:#2d3140;border-bottom-right-radius:2px}.msg-bot .msg-bubble{background:#1c2128;border:1px solid #2d3140;border-bottom-left-radius:2px}.msg-bubble{padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.4;word-wrap:break-word}#chat-input-area{padding:8px 12px;border-top:1px solid #2d3140;flex-shrink:0;display:flex;gap:6px;align-items:center}#gde-chat input{padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;outline:none;flex:1}#gde-chat input:focus{border-color:#58a6ff}#gde-chat #chat-send-btn{padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#1c2128;color:#58a6ff;cursor:pointer;font-size:16px;line-height:1}#gde-chat .typing-indicator{display:inline-flex;gap:4px;padding:4px 0}.typing-indicator span{width:6px;height:6px;border-radius:50%;background:#8b949e;animation:bounce 1.4s ease-in-out infinite}.typing-indicator span:nth-child(2){animation-delay:0.2s}.typing-indicator span:nth-child(3){animation-delay:0.4s}@keyframes bounce{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}.resize-handle{position:absolute;z-index:10}.rh-nw{top:-3px;left:-3px;width:10px;height:10px;cursor:nw-resize}.rh-n{top:-3px;left:3px;right:3px;height:6px;cursor:n-resize}.rh-ne{top:-3px;right:-3px;width:10px;height:10px;cursor:ne-resize}.rh-e{right:-3px;top:3px;bottom:3px;width:6px;cursor:e-resize}.rh-se{bottom:-3px;right:-3px;width:10px;height:10px;cursor:se-resize}.rh-s{bottom:-3px;left:3px;right:3px;height:6px;cursor:s-resize}.rh-sw{bottom:-3px;left:-3px;width:10px;height:10px;cursor:sw-resize}.rh-w{left:-3px;top:3px;bottom:3px;width:6px;cursor:w-resize}.resize-grip{position:absolute;bottom:2px;right:2px;width:12px;height:12px;cursor:se-resize;z-index:10}.resize-grip::after{content:\\'\\';position:absolute;bottom:2px;right:2px;width:8px;height:8px;border-right:2px solid #4a4d55;border-bottom:2px solid #4a4d55}';
document.head.appendChild(css);

// Inject chat HTML
var root=document.createElement('div');root.id='edgegde-chat-root';
document.body.appendChild(root);
root.innerHTML='<div id="gde-chat"><div id="gde-header"><h1>AFIRMICO Finance</h1><div class="hdr-btns"><button id="gde-close-btn" title="Close">&#x2715;</button></div></div><div id="gde-body"><div id="message-list"><div class="welcome">Welcome! Let&#39;s get started with your application. What is your full name?</div></div><div id="chat-input-area"><input type="hidden" id="chat-session-id" value=""><input type="hidden" id="chat-tenant-id" value="'+tid+'"><input type="hidden" id="chat-guest-name" value=""><input type="text" id="chat-text-input" placeholder="Type a message..." autocomplete="off"><button id="chat-send-btn">&#x2192;</button></div></div><div class="resize-handle rh-nw"></div><div class="resize-handle rh-n"></div><div class="resize-handle rh-ne"></div><div class="resize-handle rh-e"></div><div class="resize-handle rh-se"></div><div class="resize-handle rh-s"></div><div class="resize-handle rh-sw"></div><div class="resize-handle rh-w"></div><div class="resize-grip"></div></div>';

// Inlined widget runtime (avoids CDN caching issues)
(function(){try{
console.log("EdgeGDE Widget v1.1.0");
/**
 * EdgeGDE — Chat Widget Runtime (client-side)
 * Loaded by /embed/chat endpoint. Handles drag, resize, streaming, label updates.
 *
 * @packageDocumentation
 */

(function() {
  'use strict';
  var baseUrl = window.location.origin;
  var tenantId = document.getElementById('chat-tenant-id')?.value || '';
  var sid = '';
  var chat = document.getElementById('gde-chat');
  var header = document.getElementById('gde-header');
  var body = document.getElementById('gde-body');
  var ml = document.getElementById('message-list');
  var tx = document.getElementById('chat-text-input');
  var gn = document.getElementById('chat-guest-name');
  var closeBtn = document.getElementById('gde-close-btn');

  // Initialize session if not already set
  var sidInput = document.getElementById('chat-session-id');
  if (sidInput && sidInput.value) {
    sid = sidInput.value;
  } else if (tenantId) {
    fetch(baseUrl + '/api/v1/chat/init?tenant=' + tenantId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.sessionId) {
        sid = d.sessionId;
        if (sidInput) sidInput.value = d.sessionId;
      }
    }).catch(function() { /* non-blocking */ });
  }

  // Send guard — prevents sending while a stream is in progress
  var isStreaming = false;
  var sendBtn = document.getElementById('chat-send-btn');

  function getDisplayName() {
    if (gn && gn.value) return gn.value;
    return 'You';
  }

  // ═══ DRAG ═══
  var isDragging = false, dragOffX = 0, dragOffY = 0;
  header.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    var rect = chat.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    chat.style.position = 'fixed';
    chat.style.top = rect.top + 'px';
    chat.style.left = rect.left + 'px';
    chat.style.width = rect.width + 'px';
    chat.style.height = rect.height + 'px';
    chat.style.bottom = 'auto';
    chat.style.right = 'auto';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = parseInt(chat.style.width) || chat.offsetWidth;
    var h = parseInt(chat.style.height) || chat.offsetHeight;
    var nx = Math.max(0, Math.min(vw - w, e.clientX - dragOffX));
    var ny = Math.max(0, Math.min(vh - h, e.clientY - dragOffY));
    chat.style.left = nx + 'px';
    chat.style.top = ny + 'px';
    chat.style.right = 'auto';
    chat.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', function() { isDragging = false; });

  // ═══ RESIZE ═══
  var isResizing = false, resizeEdge = '', resizeStart = {};
  document.querySelectorAll('.resize-handle, .resize-grip').forEach(function(h) {
    h.addEventListener('mousedown', function(e) {
      isResizing = true;
      resizeEdge = h.className.indexOf('rh-nw')>=0?'nw':h.className.indexOf('rh-n')>=0&&h.className.indexOf('rh-ne')<0?'n':
                  h.className.indexOf('rh-ne')>=0?'ne':h.className.indexOf('rh-e')>=0?'e':
                  h.className.indexOf('rh-se')>=0||h.className.indexOf('grip')>=0?'se':
                  h.className.indexOf('rh-s')>=0?'s':h.className.indexOf('rh-sw')>=0?'sw':
                  h.className.indexOf('rh-w')>=0?'w':'se';
      var rect = chat.getBoundingClientRect();
      resizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, l: rect.left, t: rect.top };
      e.preventDefault();
    });
  });
  document.addEventListener('mousemove', function(e) {
    if (!isResizing) return;
    var dx = e.clientX - resizeStart.x, dy = e.clientY - resizeStart.y;
    var minW = 260, minH = 300;
    var nw = resizeStart.w, nh = resizeStart.h, nl = resizeStart.l, nt = resizeStart.t;
    if (resizeEdge.indexOf('e')>=0) { nw = Math.max(minW, resizeStart.w + dx); }
    if (resizeEdge.indexOf('s')>=0) { nh = Math.max(minH, resizeStart.h + dy); }
    if (resizeEdge.indexOf('w')>=0) {
      var rw = Math.max(minW, resizeStart.w - dx);
      nl = resizeStart.l + resizeStart.w - rw;
      nw = rw;
    }
    if (resizeEdge.indexOf('n')>=0) {
      var rh = Math.max(minH, resizeStart.h - dy);
      nt = resizeStart.t + resizeStart.h - rh;
      nh = rh;
    }
    chat.style.position = 'fixed';
    chat.style.left = nl + 'px'; chat.style.top = nt + 'px';
    chat.style.width = nw + 'px'; chat.style.height = nh + 'px';
    chat.style.right = 'auto'; chat.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', function() { isResizing = false; });

  // ═══ MINIMIZE / CLOSE ═══
  // Close hides the chat window, shows reopen icon.
  // Reopen icon click restores the chat.
  var reopenBtn = null;
  function showReopen() {
    if (reopenBtn) { reopenBtn.style.display = 'flex'; return; }
    reopenBtn = document.createElement('div');
    reopenBtn.textContent = '💬';
    reopenBtn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:52px;height:52px;border-radius:50%;background:#3b82f6;color:white;font-size:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
    document.body.appendChild(reopenBtn);
    reopenBtn.onclick = function() {
      reopenBtn.style.display = 'none';
      chat.style.display = 'flex';
    };
  }
  closeBtn.addEventListener('click', function() {
    chat.style.display = 'none';
    showReopen();
  });

  // ═══ SESSION INIT ═══
  function initSession() {
    fetch(baseUrl + '/api/v1/chat/view?tenant=' + tenantId)
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var input = doc.getElementById('chat-session-id');
        if (input) sid = input.value;
        if (sid) document.getElementById('chat-session-id').value = sid;
      }).catch(function() {});
  }

  // ═══ SEND ═══
  function chatSend() {
    if (isStreaming) return;
    isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;
    var msg = tx.value.trim();
    if (!msg) return;
    tx.value = '';

    var label = getDisplayName();
    ml.insertAdjacentHTML('beforeend',
      '<div class=msg msg-user><span class=msg-label style=color:#FFBF00>' + label.replace(/</g,'&lt;') + '</span><div class=msg-bubble>' + msg.replace(/</g,'&lt;') + '</div></div>');

    var typingId = 'typing-' + Date.now();
    ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot id=' + typingId + '><span class=msg-label style=color:#58a6ff>AFIRMICO</span><div class=msg-bubble><span class=typing-indicator><span></span><span></span><span></span></span></div></div>');
    if (body) body.scrollTop = body.scrollHeight;

    var isDebug = window.location.search.indexOf('debug=true') >= 0;
    var streamUrl = baseUrl + '/api/v1/chat/stream?tenant=' + tenantId + (isDebug ? '&debug=true' : '');
    var streamAborted = false;
    var streamTimeout = setTimeout(function() {
      streamAborted = true;
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
      var te = document.getElementById(typingId);
      if (te) { te.remove(); }
      ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot><span class=msg-label style=color:#da3633>AFIRMICO</span><div class=msg-bubble style=color:#da3633>\\u26a0 Service temporarily unavailable. Please try again.</div></div>');
      if (body) body.scrollTop = body.scrollHeight;
    }, 30000);
    fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'session_id=' + encodeURIComponent(sid) + '&text=' + encodeURIComponent(msg)
    }).then(function(r) {
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var responseText = '';
      var typingEl = document.getElementById(typingId);

      function read() {
        reader.read().then(function(result) {
          clearTimeout(streamTimeout);
          if (result.done) {
            isStreaming = false;
            if (sendBtn) sendBtn.disabled = false;
            var te2 = document.getElementById(typingId);
            if (te2) {
              var bubble2 = te2.querySelector('.msg-bubble');
              if (bubble2) bubble2.textContent = responseText || '';
            }
            if (responseText) {
              try {
                var d = JSON.parse(responseText);
                if (d && d.firstName && gn && !gn.value) {
                  gn.value = d.firstName;
                  var labels = ml.querySelectorAll('.msg-user .msg-label');
                  for (var ui = 0; ui < labels.length; ui++) {
                    if (labels[ui].textContent === 'You') labels[ui].textContent = d.firstName;
                  }
                } else if (d && d.fullName && gn && !gn.value) {
                  var fn = d.fullName.split(' ')[0];
                  if (fn.length > 1) { gn.value = fn;
                    var labels = ml.querySelectorAll('.msg-user .msg-label');
                    for (var ui = 0; ui < labels.length; ui++) {
                      if (labels[ui].textContent === 'You') labels[ui].textContent = fn;
                    }
                  }
                }
                if (isDebug && d && d.debug) {
                  try {
                    window.parent.postMessage({ type: 'debug', payload: d.debug }, '*');
                    var tmpl = document.getElementById('debug-data');
                    if (tmpl) tmpl.textContent = JSON.stringify(d.debug);
                  } catch(e) {}
                }
                if (gn && !gn.value && d.state && d.state.completedFields) {
                  var cf = d.state.completedFields;
                  if (cf.indexOf('firstName') >= 0) {
                    var nw = msg.split(' ')[0];
                    if (nw.length > 1) gn.value = nw;
                  }
                }
              } catch(e) {}
            }
            return;
          }
          var chunk = decoder.decode(result.value, { stream: true });
          var lines = chunk.split(/\n/);
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            try {
              var parsed = JSON.parse(line);
              if (parsed.token !== undefined) {
                responseText += parsed.token;
                if (typingEl) {
                  var bubble = typingEl.querySelector('.msg-bubble');
                  if (bubble) bubble.textContent = responseText;
                }
                if (body) body.scrollTop = body.scrollHeight;
              }
              if (parsed.final) {
                responseText = parsed.final;
                if (typingEl) {
                  var bubble = typingEl.querySelector('.msg-bubble');
                  if (bubble) bubble.textContent = responseText;
                }
              }
              if (parsed.done) {
                // Use message from done event if available (pre-LLM validation errors, final responses)
                if (parsed.message && typingEl) {
                  var bubble = typingEl.querySelector('.msg-bubble');
                  if (bubble) bubble.textContent = parsed.message;
                }
                if (parsed.firstName && gn && !gn.value) {
                  gn.value = parsed.firstName;
                  var labels = ml.querySelectorAll('.msg-user .msg-label');
                  for (var ui = 0; ui < labels.length; ui++) {
                    if (labels[ui].textContent === 'You') labels[ui].textContent = parsed.firstName;
                  }
                }
                // Render option pills if present
                if (parsed.options && parsed.options.length > 0 && typingEl) {
                  var pillContainer = document.createElement('div');
                  pillContainer.className = 'option-pills';
                  pillContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
                  for (var oi = 0; oi < parsed.options.length; oi++) {
                    (function(opt) {
                      var pill = document.createElement('button');
                      pill.textContent = opt;
                      pill.className = 'option-pill';
                      pill.style.cssText = 'background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:16px;padding:6px 14px;cursor:pointer;font-size:13px;transition:all 0.15s';
                      pill.addEventListener('mouseenter', function() { this.style.background = '#334155'; });
                      pill.addEventListener('mouseleave', function() { this.style.background = '#1e293b'; });
                      pill.addEventListener('click', function() {
                        tx.value = opt;
                        chatSend();
                      });
                      pillContainer.appendChild(pill);
                    })(parsed.options[oi]);
                  }
                  typingEl.querySelector('.msg-bubble').after(pillContainer);
                }
                if (isDebug && parsed.debug) {
                  try {
                    window.parent.postMessage({ type: 'debug', payload: parsed.debug }, '*');
                    var tmpl = document.getElementById('debug-data');
                    if (tmpl) tmpl.textContent = JSON.stringify(parsed.debug);
                  } catch(e) {}
                }
              }
            } catch(e) {}
          }
          read();
        });
      }
      read();
    }).catch(function() {
      clearTimeout(streamTimeout);
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
      var te = document.getElementById(typingId);
      if (te) { te.remove(); }
      ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot><span class=msg-label style=color:#da3633>AFIRMICO</span><div class=msg-bubble style=color:#da3633>\\u26a0 Network error. Please check your connection and try again.</div></div>');
      if (body) body.scrollTop = body.scrollHeight;
    });
  }

  document.getElementById('chat-send-btn').addEventListener('click', chatSend);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && document.activeElement === tx) {
      e.preventDefault();
      chatSend();
    }
  });

  // ═══ INIT ═══
  initSession();
  window.chatSend = chatSend;
})();
}catch(e){console.error('[EdgeGDE]',e&&e.message?e.message:e)}})();

}catch(e){console.error('[EdgeGDE]',e&&e.message?e.message:e)}})();`
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=3600')
  return c.body(script.trim())
})

app.route('/api/v1', scoringTenantRouter)
app.route('/api/v1/admin', reportAdminRouter)
app.route('/api/v1', reportCronHandler)
app.route('/api/v1', stagingRouter)

// Document Vault (admin auth applied within vaultRouter)
app.route('/api/v1/vault', vaultRouter)

// Conversational Chat (tool auth applied within chatRouter)
app.route('/api/v1', chatRouter)

// Workspace Origination (Phase 18-20)
app.use('/api/v1/chat/*', tenantQueryAuth)
app.use('/api/v1/workspace/*', adminAuth)
app.route('/api/v1', workspaceRouter)

// MCP Swarm Intelligence Ingress (Phase 21)
app.route('/api/v1', swarmRouter)

// Chat Widget Views + Identity (Phase 2.7)
app.route('/api/v1', chatViewsRouter)

// OCR Processing (Phase 1)
app.route('/api/v1', ocrRouter)

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4B — Site Provisioning: renders tenant site at /sites/:slug
// ═══════════════════════════════════════════════════════════════════════════

/** Site page names for validation */
const SITE_PAGES = ['home', 'about', 'services', 'calculators', 'media', 'contact'] as const

/** Shared site renderer — loads config from KV and returns the full multi-page HTML */
async function renderSite(slug: string, activePage: string, rawKv: any, isHtmx = false): Promise<{ html: string; error?: string }> {
  if (!rawKv) return { html: '', error: 'KV not available' }
  try {
    const siteRaw = await rawKv.get('tenant:' + slug + ':site', 'json')
    if (!siteRaw) return { html: '', error: 'Site not found' }

    const config = typeof siteRaw === 'string' ? JSON.parse(siteRaw) : siteRaw
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')
    const title = esc(config.title || slug)
    const tenant = esc(config.tenant || slug)
    const primaryColor = esc(config.primary_color || '#2563eb')

    const theme = config.theme || 'default'
    const darkMode = theme.startsWith('dark-')
    const bg = darkMode ? '#0f172a' : '#f8fafc'
    const fg = darkMode ? '#e2e8f0' : '#1e293b'
    const cardBg = darkMode ? '#1e293b' : '#ffffff'
    const cardShadow = darkMode ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)'
    const headerBg = darkMode ? '#0f172a' : primaryColor
    const headerBorder = darkMode ? '1px solid #334155' : 'none'

    const pages = (config.pages || {}) as Record<string, { title?: string; content?: string }>
    const pageContent = {
      home: pages.home?.content || '<h2>Welcome</h2><p>Welcome to our site.</p>',
      about: pages.about?.content || '<h2>About</h2><p>About us content coming soon.</p>',
      services: pages.services?.content || '<h2>Services</h2><p>Our services coming soon.</p>',
      calculators: pages.calculators?.content || '<h2>Calculators</h2><p>Calculators coming soon.</p>',
      media: pages.media?.content || '<h2>Media</h2><p>Media content coming soon.</p>',
      contact: pages.contact?.content || '<h2>Contact</h2><p>Contact form coming soon.</p>',
    }

    const navItems = SITE_PAGES.map(p => ({
      id: p,
      label: p.charAt(0).toUpperCase() + p.slice(1),
      active: p === activePage,
      url: p === 'home' ? `/sites/${slug}` : `/sites/${slug}/${p}`,
    }))

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} &mdash; ${navItems.find(n => n.active)?.label || 'Home'}</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: ${bg}; color: ${fg}; }
    nav { background: ${headerBg}; ${headerBorder ? 'border-bottom: ' + headerBorder + ';' : ''} }
    nav ul { list-style: none; display: flex; gap: 0; max-width: 800px; margin: 0 auto; padding: 0 24px; overflow-x: auto; }
    nav ul li a { display: block; padding: 14px 20px; color: #94a3b8; text-decoration: none; font-size: 0.9rem; font-weight: 500; transition: color 0.15s, border-bottom 0.15s; border-bottom: 2px solid transparent; white-space: nowrap; }
    nav ul li a:hover { color: #60a5fa; }
    nav ul li a.active { color: #60a5fa; border-bottom-color: #60a5fa; }
    header { background: ${headerBg}; color: #f8fafc; padding: 32px 24px 24px; text-align: center; }
    header h1 { font-size: 1.5rem; font-weight: 700; }
    header p { color: #94a3b8; font-size: 0.9rem; margin-top: 6px; }
    main { max-width: 800px; margin: 32px auto; padding: 0 24px; }
    .page { display: none; animation: fadeIn 0.2s ease; }
    .page.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .card { background: ${cardBg}; border-radius: 12px; padding: 24px; box-shadow: ${cardShadow}; margin-bottom: 16px; }
    .card h2 { font-size: 1.2rem; margin-bottom: 12px; color: #60a5fa; }
    .card p { line-height: 1.7; color: ${fg}; margin-bottom: 10px; }
    .card ul { list-style: none; display: grid; gap: 10px; }
    .card ul li { background: ${darkMode ? '#0f172a' : '#f1f5f9'}; border-radius: 8px; padding: 14px; line-height: 1.5; }
    .card ul li strong { color: #60a5fa; }
    .logo-icon { width: 48px; height: 48px; background: #3b82f6; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; font-size: 1.5rem; font-weight: 700; color: white; }
    footer { text-align: center; color: #64748b; font-size: 0.8rem; padding: 24px; border-top: 1px solid #1e293b; margin-top: 48px; }
    @media (max-width: 600px) {
      nav ul { padding: 0 12px; }
      nav ul li a { padding: 12px 14px; font-size: 0.8rem; }
      header { padding: 24px 16px 20px; }
      main { padding: 0 16px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-icon">A</div>
    <h1>${title}</h1>
    <p>Your trusted mortgage partner</p>
  </header>
  <nav>
    <ul>
      ${navItems.map(n => `<li><a href="${n.url}"${n.active ? ' class="active"' : ''} hx-get="${n.url}" hx-target="#main-content" hx-push-url="true">${n.label}</a></li>`).join('')}
    </ul>
  </nav>
  <main id="main-content">
    ${SITE_PAGES.map(p => `<div class="page${p === activePage ? ' active' : ''}" id="page-${p}"><div class="card">${pageContent[p]}</div></div>`).join('')}
  </main>
  <footer>
    <p>${title} &mdash; Australian Credit Licence in progress &bull; ABN 00 000 000 000</p>
  </footer>
  <script src="/public/widget.v1.1.0.js?v=3" data-tenant="${tenant}"></script>
</body>
</html>`

    // HTMX partial: return only the main content + nav active state + title
    if (isHtmx) {
      const partialHtml = `<title>${title} &mdash; ${navItems.find(n => n.active)?.label || 'Home'}</title>
<nav>
  <ul>
    ${navItems.map(n => `<li><a href="${n.url}"${n.active ? ' class="active"' : ''} hx-get="${n.url}" hx-target="#main-content" hx-push-url="true">${n.label}</a></li>`).join('')}
  </ul>
</nav>
${SITE_PAGES.map(p => `<div class="page${p === activePage ? ' active' : ''}" id="page-${p}"><div class="card">${pageContent[p]}</div></div>`).join('')}`
      return { html: partialHtml }
    }

    return { html }
  } catch {
    return { html: '', error: 'Internal error' }
  }
}

// Site routes — each page gets its own URL path, supports HTMX partial swaps
app.get('/sites/:slug/about', async (c) => {
  const isHtmx = c.req.header('HX-Request') === 'true'
  const { html, error } = await renderSite(c.req.param('slug'), 'about', (c.env as any)?.TENANT_KV, isHtmx)
  if (error) return c.text(error, error === 'Site not found' ? 404 : 500)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

app.get('/sites/:slug/services', async (c) => {
  const isHtmx = c.req.header('HX-Request') === 'true'
  const { html, error } = await renderSite(c.req.param('slug'), 'services', (c.env as any)?.TENANT_KV, isHtmx)
  if (error) return c.text(error, error === 'Site not found' ? 404 : 500)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

app.get('/sites/:slug/calculators', async (c) => {
  const isHtmx = c.req.header('HX-Request') === 'true'
  const { html, error } = await renderSite(c.req.param('slug'), 'calculators', (c.env as any)?.TENANT_KV, isHtmx)
  if (error) return c.text(error, error === 'Site not found' ? 404 : 500)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

app.get('/sites/:slug/media', async (c) => {
  const isHtmx = c.req.header('HX-Request') === 'true'
  const { html, error } = await renderSite(c.req.param('slug'), 'media', (c.env as any)?.TENANT_KV, isHtmx)
  if (error) return c.text(error, error === 'Site not found' ? 404 : 500)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

app.get('/sites/:slug/contact', async (c) => {
  const isHtmx = c.req.header('HX-Request') === 'true'
  const { html, error } = await renderSite(c.req.param('slug'), 'contact', (c.env as any)?.TENANT_KV, isHtmx)
  if (error) return c.text(error, error === 'Site not found' ? 404 : 500)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

// Home page — must be last so sub-routes match first
app.get('/sites/:slug', async (c) => {
  const isHtmx = c.req.header('HX-Request') === 'true'
  const { html, error } = await renderSite(c.req.param('slug'), 'home', (c.env as any)?.TENANT_KV, isHtmx)
  if (error) return c.text(error, error === 'Site not found' ? 404 : 500)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

// Tenant provisioning (admin)
app.route('/api/tenants', tenantRouter)

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/tenants/:slug — update tenant config (admin only)
// ═══════════════════════════════════════════════════════════════════════════

app.put('/api/tenants/:slug', adminAuth, async (c) => {
  const slug = c.req.param('slug')
  const rawKv = (c.env as any)?.TENANT_KV
  if (!rawKv) return c.json({ error: 'TENANT_KV not available' }, 500)

  const kv = guardKV(rawKv)
  const existing = await kv.getJson(`tenant:${slug}`, { tenantId: slug })
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

  await kv.put(`tenant:${slug}`, JSON.stringify(updated), { tenantId: slug })

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
    const db = guardDB((c.env as any)?.DB)
    const ctx = { tenantId }

    const rows = await db.all(ctx, `
      SELECT id, tenant_id, form_id, lead_score, deterministic_score,
             score_band, score_rationale, contact_id, current_stage, created_at
      FROM form_submissions
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset])

    return c.json({ leads: rows })
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

  const rawKv = (c.env as any)?.TENANT_KV
  if (!rawKv) return c.text('TENANT_KV not available', 500)

  const kv = guardKV(rawKv)
  const tenantId = tenant.tenantId
  const ctx = { tenantId }

  try {
    // ── 1. Layout (memory → KV) ──────────────────────────────────────────
    const layoutTool = c.req.query('tool') || 'default'
    const queryEnv = c.req.query('env')
    const isStaging = queryEnv === 'staging' || queryEnv === 'local'
    const layoutCacheKey = `${tenantId}:${layoutTool}:${isStaging ? 'staging' : 'prod'}`
    let layout: any = getCachedLayout(layoutCacheKey)
    if (!layout) {
      const layoutSuffix = layoutTool === 'gallery' ? 'gallery' : layoutTool === 'budget' ? 'budget' : layoutTool === 'metrics' ? 'metrics' : 'latest'
      const envSuffix = isStaging ? ':staging' : ''
      const layoutKvKey = `tenant:${tenantId}:layout:${layoutSuffix}${envSuffix}`
      layout = await kv.getJson(layoutKvKey, ctx)
      if (layout) setCachedLayout(layoutCacheKey, layout)
    }

    // Also determine env for badge/compiled cache (reuse isStaging from above)
    const envBadgeText = isStaging ? 'STAGING' : ''

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
      const designMd = await kv.get(`tenant:${tenantId}:design`, ctx)
      const { parseDesignMd } = await import('./lib/design-parser')
      design = parseDesignMd(designMd || '')
      setCachedDesign(tenantId, design)
    }

    // ── EDR CSS accumulator (injected in <head> so it survives HTMX swaps) ─
    let edrCss = ''

    // ── Metrics: fire-and-forget counter ────────────────────────────────
    incrementRequest(rawKv, tenantId, layoutTool || 'default', false)

    // ── 3. Compiled HTML cache (KV, 120s + jitter) ────────────────────────
    const cacheKey = `tenant:${tenantId}:compiled:${layoutTool}:${isStaging ? 'staging' : 'prod'}`
    let html = await kv.get(cacheKey, ctx)

    if (!html) {
      try {
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
        } else {
          // Legacy OpenPencil pipeline
          html = compileLayout(layout, design)
        }
        // FIX #3: 3600s + jitter (was 120s) — 30× reduction in cache re-write churn
        // SSE stream pushes updates, so 1h TTL is safe for compiled config
        const ttl = 3600 + Math.floor(Math.random() * 600)
        await kv.put(cacheKey, html, ctx, { expirationTtl: ttl })
      } catch (compileErr) {
        // ══════════════════════════════════════════════════════════════════
        // CIRCUIT BREAKER: compilation failed — serve stale cache or safe default
        // ══════════════════════════════════════════════════════════════════
        console.warn(`[circuit-breaker] compileLayout failed for ${cacheKey}:`, compileErr)
        html = await kv.get(cacheKey, ctx)
        if (!html) {
          html = `<div class="p-4 text-red-600">Temporary service degradation — please refresh.</div>`
        }
      }
    }

    // Generate EDR CSS for <head> injection (always runs, even on cache hit)
    // CSS must survive HTMX fragment swaps, so it lives in <head>, not in <main>
    if (layout && layout.root && !edrCss) {
      const edrDef: import('./edr/compiler/engine').EDR = {
        components: layout.edr?.components || {},
        global: layout.edr?.global || {},
      }
      const { generateCSS } = await import('./lib/generateCSS')
      edrCss = generateCSS(edrDef, layout.edrHash || 'default')
    }

    // ── Environment badge ───────────────────────────────────────────────
    // Only show for non-production environments
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

    /* Staging badge glow — active polling state */
    .badge-live {
      box-shadow: 0 0 12px rgba(34,197,94,0.5), 0 0 24px rgba(34,197,94,0.2);
      animation: pulse-glow 2s ease-in-out infinite;
    }
    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 12px rgba(34,197,94,0.5), 0 0 24px rgba(34,197,94,0.2); }
      50% { box-shadow: 0 0 18px rgba(34,197,94,0.7), 0 0 36px rgba(34,197,94,0.3); }
    }
    .badge-idle {
      box-shadow: 0 0 6px rgba(251,191,36,0.3);
    }

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
  ${edrCss ? `<style>${edrCss}</style>` : ''}
</head>
<body class="min-h-screen bg-[#0b1326]">
  <header class="bg-[#0b1326]/90 border-b border-white/10 backdrop-blur-2xl">
    <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
      <span class="text-lg font-semibold text-white">${tenant.name}</span>
      ${envBadgeText ? `<span id="env-badge" class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-400 uppercase tracking-wider">${envBadgeText}</span>` : ''}
      ${isStaging ? `
      <div style="display:flex;gap:4px;align-items:center">
        <button hx-post="/api/staging/undo" hx-target="body" hx-swap="innerHTML" style="padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);font-size:11px;cursor:pointer" title="Undo last change">&#8617;</button>
        <button hx-post="/api/staging/redo" hx-target="body" hx-swap="innerHTML" style="padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);font-size:11px;cursor:pointer" title="Redo">&#8618;</button>
        <button hx-post="/api/staging/save-version" hx-target="body" hx-swap="beforeend" style="padding:4px 10px;border-radius:6px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);color:#818CF8;font-size:11px;cursor:pointer" title="Save current version as a named snapshot">Save</button>
        <button hx-get="/api/staging/versions" hx-target="#version-panel" hx-swap="innerHTML" style="padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);font-size:11px;cursor:pointer" title="Browse saved versions">Versions</button>
        <button hx-post="/api/staging/promote" hx-target="body" hx-swap="beforeend" style="padding:4px 12px;border-radius:6px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);color:#22C55E;font-size:11px;font-weight:600;cursor:pointer" title="Promote staging layout to production">Go Live</button>
      </div>` : ''}
    </div>
  </header>
  <main id="app-root"
        class="max-w-4xl mx-auto"
        hx-get="/api/fragment/render-root${layoutTool !== 'default' ? `?tool=${layoutTool}` : ''}${isStaging ? `${layoutTool !== 'default' ? '&' : '?'}env=staging` : ''}"
        hx-trigger="ui-schema-mutated from:body"
        hx-swap="innerHTML">
    ${html}
  </main>
  <script src="/public/widget.v1.1.0.js?v=3" data-tenant="au-mortgage-broker-afirmico"></script>
  ${isStaging ? `<div id="version-panel" style="position:fixed;top:60px;right:16px;width:320px;max-height:60vh;overflow-y:auto;background:rgba(15,15,26,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px;display:none;z-index:1000;backdrop-filter:blur(12px)"></div>` : ''}
  ${isStaging ? `
  <div id="dev-sentinel"
       hx-get="/api/fragment/dev-hash${isStaging ? '?env=staging' : ''}"
       hx-trigger="every 0.5s"
       hx-swap="outerHTML"
       hx-headers='{"X-Current-Hash": "${await getLatestHash({ kv: rawKv, dev: true, manifestKey: isStaging ? 'staging:latest_ast_manifest' : 'latest_ast_manifest' })}"}'>
  </div>` : ''}
  ${isStaging ? `
  <script>
    (function() {
      const SENTINEL_ID = 'dev-sentinel'
      const IDLE_MS = 30 * 60 * 1000
      let pollTimer = null, isActive = true

      function setPolling(active) {
        isActive = active
        const el = document.getElementById(SENTINEL_ID)
        const badge = document.getElementById('env-badge')
        if (!el) return
        el.setAttribute('hx-trigger', active ? 'every 0.5s' : 'click from:body delay:500ms')
        if (window.htmx) htmx.process(el)
        if (badge) {
          badge.classList.toggle('badge-live', active)
          badge.classList.toggle('badge-idle', !active)
        }
        if (active) resetIdleTimer()
      }

      function resetIdleTimer() {
        if (pollTimer) clearTimeout(pollTimer)
        pollTimer = setTimeout(() => setPolling(false), IDLE_MS)
      }

      document.addEventListener('click', function onAnyClick() {
        if (isActive) { resetIdleTimer(); return }
        setPolling(true)
      })

      // Pause polling when tab is hidden, resume when visible
      document.addEventListener('visibilitychange', () => {
        const el = document.getElementById(SENTINEL_ID)
        if (!el) return
        if (document.hidden) {
          el.setAttribute('hx-trigger', 'never')
          if (window.htmx) htmx.process(el)
        } else if (isActive) {
          el.setAttribute('hx-trigger', 'every 0.5s')
          if (window.htmx) htmx.process(el)
        }
      })

      // Version panel toggle
      document.querySelector('[hx-get=\"/api/staging/versions\"]')?.addEventListener('click', function(e) {
        const panel = document.getElementById('version-panel')
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
      })

      setPolling(true)
    })()
  </script>` : ''}
  <!-- EdgeGDE Chat Widget -->
  <script>
    (function() {
      function setupWidget() {
        var w = document.getElementById('gde-chat');
        if (!w) return;
        // Minimize
        var minBtn = document.getElementById('gde-minimize-btn');
        var body = document.getElementById('gde-chat-body');
        if (minBtn && body) {
          minBtn.onclick = function(e) {
            e.stopPropagation();
            body.style.display = body.style.display === 'none' ? 'block' : 'none';
          };
        }
        // Close
        var closeBtn = document.getElementById('gde-close-btn');
        if (closeBtn) {
          closeBtn.onclick = function(e) {
            e.stopPropagation();
            w.style.display = 'none';
          };
        }
        // Drag
        var header = document.getElementById('gde-chat-header');
        if (header) {
          var dx = 0, dy = 0, mx = 0, my = 0;
          header.onmousedown = function(e) {
            e.preventDefault();
            dx = e.clientX; dy = e.clientY;
            mx = w.offsetLeft || 0; my = w.offsetTop || 0;
            document.onmousemove = function(ev) {
              w.style.left = Math.max(0, Math.min(window.innerWidth - 100, mx + ev.clientX - dx)) + 'px';
              w.style.top = Math.max(0, Math.min(window.innerHeight - 50, my + ev.clientY - dy)) + 'px';
              w.style.right = 'auto'; w.style.bottom = 'auto';
            };
            document.onmouseup = function() { document.onmousemove = null; document.onmouseup = null; };
          };
        }
        // Resize
        var handles = w.querySelectorAll('.resize-handle');
        var rx = 0, ry = 0, rw = 0, rh = 0, rt = 0, rl = 0;
        handles.forEach(function(h) {
          h.addEventListener('mousedown', function(e) {
            e.preventDefault();
            var rect = w.getBoundingClientRect();
            rx = e.clientX; ry = e.clientY;
            rw = w.offsetWidth; rh = w.offsetHeight;
            rt = rect.top; rl = rect.left;
            w.style.width = rw + 'px'; w.style.height = rh + 'px'; w.style.maxHeight = 'none';
            var cls = h.className;
            document.onmousemove = function(ev) {
              var dx = ev.clientX - rx, dy = ev.clientY - ry;
              if (cls.indexOf('resize-e') >= 0 || cls.indexOf('resize-se') >= 0 || cls.indexOf('resize-ne') >= 0) w.style.width = Math.max(200, rw + dx) + 'px';
              if (cls.indexOf('resize-w') >= 0 || cls.indexOf('resize-sw') >= 0 || cls.indexOf('resize-nw') >= 0) { w.style.width = Math.max(200, rw - dx) + 'px'; w.style.left = Math.max(0, rl + dx) + 'px'; w.style.right = ''; }
              if (cls.indexOf('resize-s') >= 0 || cls.indexOf('resize-se') >= 0 || cls.indexOf('resize-sw') >= 0) w.style.height = Math.max(200, rh + dy) + 'px';
              if (cls.indexOf('resize-n') >= 0 || cls.indexOf('resize-ne') >= 0 || cls.indexOf('resize-nw') >= 0) { w.style.height = Math.max(200, rh - dy) + 'px'; w.style.top = Math.max(0, rt + dy) + 'px'; w.style.bottom = ''; }
            };
            document.onmouseup = function() { document.onmousemove = null; document.onmouseup = null; };
          });
        });
      }
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

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx)
  },

  async queue(batch: any, env: any, ctx: ExecutionContext): Promise<void> {
    try {
      console.warn('[queue] batch received', { size: batch.messages.length })
      for (const msg of batch.messages) {
        const body = msg.body
        if (body?.type === 'kb_ingest') {
          const { handleKbIngest } = await import('./queues/kb-ingest')
          await handleKbIngest(body, env)
        }
      }
      await leadScorer.queue(batch, env, ctx)
    } catch (err) {
      console.error('[queue] fatal handler failure:', err)
    }
  },

  async scheduled(_event: any, env: any, _ctx: ExecutionContext): Promise<void> {
    console.log('[cron] dispatcher triggered')
    await runDispatcher(env)
    // Flush any accumulated metrics to KV before the isolate is reclaimed
  // eslint-disable-next-line local/no-raw-storage-access
    try { await flushMetrics(env.TENANT_KV) } catch { /* non-blocking */ }
  },
}
export { RateLimiter } from './objects/RateLimiter'
export { AuditLedger } from './objects/AuditLedger'
export { ChatSession_DO } from './do/chat-session.do'

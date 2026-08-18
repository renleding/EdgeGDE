/**
 * EdgeGDE — Admin Chat Config UI + API
 *
 * Admin-only control plane for global and tenant chat config.
 * - JSON API enforces Zod validation and fail-closed persistence.
 * - HTML routes provide HTMX-friendly single-page editing forms.
 * - Tenant dashboard remains the gatekeeper for tenant-specific edits.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  formatZodIssues,
  loadGlobalChatConfig,
  loadTenantChatConfig,
  mergeChatConfig,
  parseChatConfig,
  saveChatConfig,
  type ChatConfig,
} from '../lib/chat-config'

const adminChatConfigRouter = new Hono()
const adminChatConfigTenantRouter = new Hono()
const adminChatConfigApiRouter = new Hono()

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

function pageLayout(title: string, body: string, token?: string): string {
  const qs = token ? `?token=${encodeURIComponent(token)}` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — AFIRMICO Admin</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
    .nav{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;gap:24px;align-items:center;flex-wrap:wrap}
    .nav h1{font-size:16px;color:#f0f6fc;margin-right:12px}
    .nav a{font-size:13px;padding:4px 8px;border-radius:4px;color:#8b949e}
    .nav a.active{background:#1c2128;color:#f0f6fc}
    .container{max-width:1180px;margin:0 auto;padding:24px}
    .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
    .card h3{font-size:15px;color:#f0f6fc;margin-bottom:10px}
    .card .meta{font-size:11px;color:#8b949e;margin-bottom:8px}
    .grid{display:grid;gap:16px}
    .grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
    .grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .btn{display:inline-block;padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500;background:#161b22;color:#e1e4e8;text-decoration:none}
    .btn-primary{background:#238636;color:#fff;border-color:#238636}
    .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
    .btn-warning{background:#d29922;color:#fff;border-color:#d29922}
    .btn-sm{padding:3px 8px;font-size:10px}
    .btn:hover{opacity:0.85}
    .btn:disabled{opacity:0.4;cursor:not-allowed}
    input,textarea,select{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px}
    textarea{min-height:120px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;white-space:pre}
    label{font-size:12px;color:#8b949e;display:block;margin-bottom:4px}
    .muted{color:#8b949e}
    .success{background:#122a1c;border:1px solid #238636;color:#7ee787;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px}
    .error{background:#2a1216;border:1px solid #da3633;color:#ffb4b8;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;white-space:pre-wrap}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{padding:10px 8px;border-bottom:1px solid #2d3140;text-align:left;vertical-align:top}
    th{color:#8b949e;font-weight:500}
    .row-actions{display:flex;gap:6px;flex-wrap:wrap}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;background:#2d3140;color:#c9d1d9}
    .badge-live{background:#238636;color:#fff}
    .badge-empty{background:#2d3140;color:#8b949e}
    .empty{color:#4a4d55;text-align:center;padding:24px;font-size:13px}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#1c2128;color:#8b949e;font-size:11px;margin-right:6px}
    pre{background:#0f1117;border:1px solid #2d3140;border-radius:6px;padding:12px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
    @media(max-width:800px){.grid.two,.grid.three{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <nav class="nav">
    <h1>AFIRMICO Admin</h1>
    <a href="/admin/tenants${qs}">Tenants</a>
    <a href="/admin/chat-config/global${qs}">Chat Config</a>
    <a href="/admin/kb${qs}">Knowledge Base</a>
    <a href="/admin/rules${qs}">Rules</a>
    <a href="/admin/site${qs}">Site</a>
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

async function resolveTenant(c: Context, tenantIdOrSlug: string): Promise<{ tenantId: string; slug: string; name: string }> {
  const db = (c.env as any)?.DB
  if (!db || typeof db.prepare !== 'function') {
    return { tenantId: tenantIdOrSlug, slug: tenantIdOrSlug, name: tenantIdOrSlug }
  }

  try {
    const { results } = await db.prepare(
      `SELECT tenant_id, slug, name FROM tenants WHERE tenant_id = ? OR slug = ? LIMIT 1`
    ).bind(tenantIdOrSlug, tenantIdOrSlug).all()
    const row = (results as any[])?.[0]
    if (row?.tenant_id) {
      return { tenantId: row.tenant_id, slug: row.slug, name: row.name || row.slug }
    }
  } catch {}

  return { tenantId: tenantIdOrSlug, slug: tenantIdOrSlug, name: tenantIdOrSlug }
}

async function listTenants(c: Context, query = ''): Promise<any[]> {
  const db = (c.env as any)?.DB
  if (!db || typeof db.prepare !== 'function') return []

  const q = `%${query.trim()}%`
  const { results } = await db.prepare(
    `SELECT tenant_id, slug, name, plan, created_at
     FROM tenants
     WHERE ? = '' OR slug LIKE ? OR name LIKE ? OR tenant_id LIKE ?
     ORDER BY name COLLATE NOCASE, slug COLLATE NOCASE
     LIMIT 100`
  ).bind(query.trim(), q, q, q).all()
  return (results as any[]) || []
}

async function loadEditConfig(kv: any, scope: 'global' | 'tenant', tenantId?: string): Promise<ChatConfig> {
  if (scope === 'global') return loadGlobalChatConfig(kv)

  const globalConfig = await loadGlobalChatConfig(kv)
  const tenantConfig = tenantId ? await loadTenantChatConfig(kv, tenantId) : null
  return mergeChatConfig(globalConfig, tenantConfig)
}

function parseJsonField(value: string | null, label: string): unknown {
  if (!value || !value.trim()) {
    throw new Error(`${label} must be valid JSON`)
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function parseConfigFromForm(fd: FormData): { config?: ChatConfig; error?: string } {
  try {
    const fields = parseJsonField(fd.get('fields') as string | null, 'Fields')
    const rules = parseJsonField(fd.get('rules') as string | null, 'Rules')
    const topics = String(fd.get('topics') || '')
      .split('\n')
      .map(v => v.trim())
      .filter(Boolean)

    const config = parseChatConfig({
      schemaVersion: 1,
      objective: String(fd.get('objective') || '').trim(),
      fields,
      priorityOrder: String(fd.get('priorityOrder') || '').split('\n').map(v => v.trim()).filter(Boolean),
      rules,
      knowledgeBase: {
        topics,
        systemInstructions: String(fd.get('systemInstructions') || '').trim(),
      },
      ui: {
        title: String(fd.get('title') || '').trim(),
        greeting: String(fd.get('greeting') || '').trim(),
        colorAccent: String(fd.get('colorAccent') || '').trim(),
      },
    })
    return { config }
  } catch (err: any) {
    return { error: err.message }
  }
}

async function parseJsonBody(c: Context): Promise<ChatConfig> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new Error('Invalid JSON body')
  }
  return parseChatConfig(raw)
}

async function saveConfig(
  c: Context,
  scope: 'global' | 'tenant',
  tenantId: string,
  config: ChatConfig,
): Promise<{ key: string; hash: string; snapshotKey: string; bytes: number }> {
  const kv = (c.env as any)?.TENANT_KV
  return saveChatConfig(kv, scope, tenantId, config)
}

async function appendChatConfigAudit(
  c: Context,
  tenantId: string,
  scope: 'global' | 'tenant',
  result: { key: string; hash: string; snapshotKey: string; bytes: number },
  config: ChatConfig,
): Promise<void> {
  const auditDo = (c.env as any)?.AUDIT_LEDGER
  if (!auditDo || typeof auditDo.idFromName !== 'function') {
    throw new Error('AUDIT_LEDGER binding required')
  }

  const doId = auditDo.idFromName(`tenant:${tenantId}`)
  const stub = auditDo.get(doId)
  const response = await stub.fetch('http://do/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'chat_config_updated',
      actor: 'user',
      tenantId,
      idempotency_key: `chat-config:${scope}:${tenantId}:${result.hash}:${Date.now()}`,
      data: {
        scope,
        key: result.key,
        snapshotKey: result.snapshotKey,
        hash: result.hash,
        bytes: result.bytes,
        fields: config.fields.length,
        topics: config.knowledgeBase.topics.length,
        rules: config.rules.length,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`AuditLedger rejected chat_config_updated event: ${text}`)
  }
}

function renderErrors(errors: Array<{ path: string; message: string }>): string {
  if (!errors.length) return ''
  return `<div class="error">Validation failed:\n${errors.map(e => `• ${escapeHtml(e.path)}: ${escapeHtml(e.message)}`).join('\n')}</div>`
}

function renderMessage(message: string): string {
  return message ? `<div class="success">${escapeHtml(message)}</div>` : ''
}

function renderTenantDashboard(tenants: any[], query = '', error?: string): string {
  const rows = tenants.length
    ? tenants.map(t => {
        const tenantId = escapeAttr(t.tenant_id)
        const slug = escapeAttr(t.slug)
        const name = escapeHtml(t.name || t.slug)
        return `<tr>
          <td><strong>${name}</strong><div class="muted">${slug}</div></td>
          <td>${escapeHtml(t.plan || 'unknown')}</td>
          <td><span class="badge badge-live">active</span></td>
          <td class="row-actions">
            <a class="btn btn-sm" href="/?tenant=${slug}" target="_blank">Open Site</a>
            <a class="btn btn-sm" href="/admin/rules?tenant=${tenantId}">Open Rules</a>
            <a class="btn btn-sm btn-primary" href="/admin/tenants/${tenantId}/config">Open Chat Config</a>
            <a class="btn btn-sm" href="/embed/chat?tenant=${slug}" target="_blank">Preview Widget</a>
          </td>
        </tr>`
      }).join('')
    : `<tr><td colspan="5"><div class="empty">No tenants found</div></td></tr>`

  return `
    <div class="card">
      <h3>Tenant Dashboard</h3>
      <div class="meta">Tenant list is the gatekeeper for tenant-specific chat config edits.</div>
      <form class="grid two" style="margin-bottom:12px" method="get" action="/admin/tenants">
        <div>
          <label>Search tenants</label>
          <input name="q" value="${escapeAttr(query)}" placeholder="name, slug, or tenant id">
        </div>
        <div style="display:flex;align-items:end">
          <button class="btn btn-primary" type="submit" style="width:100%">Search</button>
        </div>
      </form>
      <table>
        <thead><tr><th>Tenant</th><th>Plan</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  `
}

function renderConfigPage(
  scope: 'global' | 'tenant',
  config: ChatConfig,
  tenant?: { tenantId: string; slug: string; name: string },
  message = '',
  errors: Array<{ path: string; message: string }> = [],
): string {
  const isTenant = scope === 'tenant'
  const title = isTenant ? `Chat Config — ${tenant?.name || tenant?.tenantId}` : 'Global Chat Config'
  const formAction = isTenant ? `/admin/tenants/${encodeURIComponent(tenant!.tenantId)}/config` : '/admin/chat-config/global'
  const tenantMeta = isTenant
    ? `<div class="pill">${escapeHtml(tenant!.slug)}</div><div class="pill">${escapeHtml(tenant!.tenantId)}</div>`
    : '<div class="pill">global baseline</div>'

  const fieldsJson = JSON.stringify(config.fields, null, 2)
  const rulesJson = JSON.stringify(config.rules, null, 2)
  const topicsText = config.knowledgeBase.topics.join('\n')

  return `
    <div class="card">
      <h3>${escapeHtml(title)}</h3>
      <div class="meta">${tenantMeta}</div>
      ${renderMessage(message)}
      ${renderErrors(errors)}
      <form method="post" action="${formAction}">
        <div class="grid two">
          <div>
            <label>UI Title</label>
            <input name="title" value="${escapeAttr(config.ui.title)}">
          </div>
          <div>
            <label>Accent Color</label>
            <input name="colorAccent" value="${escapeAttr(config.ui.colorAccent)}" pattern="#[0-9a-fA-F]{6}">
          </div>
        </div>
        <div style="margin-top:12px">
          <label>Greeting</label>
          <input name="greeting" value="${escapeAttr(config.ui.greeting)}">
        </div>
        <div style="margin-top:12px">
          <label>Objective</label>
          <textarea name="objective">${escapeHtml(config.objective)}</textarea>
        </div>
        <div class="grid two" style="margin-top:12px">
          <div>
            <label>Topic Labels</label>
            <textarea name="topics" style="min-height:160px">${escapeHtml(topicsText)}</textarea>
            <div class="muted" style="font-size:11px;margin-top:4px">One topic label per line. Existing KB entries remain in tenant KB.</div>
          </div>
          <div>
            <label>System Instructions</label>
            <textarea name="systemInstructions" style="min-height:160px">${escapeHtml(config.knowledgeBase.systemInstructions ?? '')}</textarea>
            <div class="muted" style="font-size:11px;margin-top:4px">Instructional only. No embeddings, files, or document management.</div>
          </div>
        </div>
        <div style="margin-top:12px">
          <label>Fields JSON</label>
          <textarea name="fields" style="min-height:260px">${escapeHtml(fieldsJson)}</textarea>
          <div class="muted" style="font-size:11px;margin-top:4px">Allowed field types: text, number, select, email, phone. Select fields require options.</div>
        </div>
        <div style="margin-top:12px">
          <label>Rules JSON</label>
          <textarea name="rules" style="min-height:220px">${escapeHtml(rulesJson)}</textarea>
          <div class="muted" style="font-size:11px;margin-top:4px">Deterministic only: fieldName &lt;|&gt;|&lt;=|&gt;=|==|!= value. Complex logic belongs in RulePack.</div>
        </div>
        <div style="margin-top:12px">
          <label>Priority Order</label>
          <textarea name="priorityOrder" style="min-height:120px">${escapeHtml(config.priorityOrder.join('\n'))}</textarea>
          <div class="muted" style="font-size:11px;margin-top:4px">One fieldName per line. Must include every field exactly once.</div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit">Validate & Save</button>
          <a class="btn" href="${isTenant ? `/admin/tenants` : `/admin/chat-config/global`}">Cancel</a>
        </div>
      </form>
    </div>
  `
}

async function handleConfigPost(c: Context, scope: 'global' | 'tenant', tenantId: string, tenantMeta?: { tenantId: string; slug: string; name: string }): Promise<Response> {
  const fd = await c.req.formData()
  const parsed = parseConfigFromForm(fd)
  if (!parsed.config) {
    const config = await loadEditConfig((c.env as any)?.TENANT_KV, scope, tenantId)
    return c.html(pageLayout('Chat Config', renderConfigPage(scope, config, tenantMeta, '', [{ path: '$', message: parsed.error || 'Validation failed' }])), 400)
  }

  try {
    const result = await saveConfig(c, scope, tenantId, parsed.config)
    await appendChatConfigAudit(c, tenantId, scope, result, parsed.config)
    const config = await loadEditConfig((c.env as any)?.TENANT_KV, scope, tenantId)
    return c.html(pageLayout('Chat Config', renderConfigPage(scope, config, tenantMeta, `Saved ${scope} chat config. Hash: ${result.hash}`)))
  } catch (err: any) {
    const config = await loadEditConfig((c.env as any)?.TENANT_KV, scope, tenantId)
    const status = err.status || 500
    return c.html(pageLayout('Chat Config', renderConfigPage(scope, config, tenantMeta, '', [{ path: '$', message: err.message }])), status)
  }
}

async function handleApiPost(c: Context, scope: 'global' | 'tenant', tenantId: string): Promise<Response> {
  let config: ChatConfig
  try {
    config = await parseJsonBody(c)
    const result = await saveConfig(c, scope, tenantId, config)
    await appendChatConfigAudit(c, tenantId, scope, result, config)
    return c.json({ success: true, scope, tenantId, ...result })
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return c.json({ error: 'Validation failed', details: formatZodIssues(err) }, 400)
    }
    return c.json({ error: err.message || 'Save failed', status: err.status }, err.status || 500)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HTML routes
// ═══════════════════════════════════════════════════════════════════════════

// NOTE: tenant dashboard listing is served by the tracked adminTenantRouter
// at /admin/tenants (admin-tenant-admin.ts) — not duplicated here.
// This router only carries the per-tenant chat-config edit surface.
// adminChatConfigTenantRouter.get('/tenants', ...)

adminChatConfigTenantRouter.get('/:tenantId/config', async (c) => {
  const resolved = await resolveTenant(c, c.req.param('tenantId'))
  const kv = (c.env as any)?.TENANT_KV
  const config = await loadEditConfig(kv, 'tenant', resolved.tenantId)
  return c.html(pageLayout('Chat Config', renderConfigPage('tenant', config, resolved)))
})

adminChatConfigTenantRouter.post('/:tenantId/config', async (c) => {
  const resolved = await resolveTenant(c, c.req.param('tenantId'))
  return handleConfigPost(c, 'tenant', resolved.tenantId, resolved)
})

adminChatConfigRouter.get('/global', async (c) => {
  const config = await loadEditConfig((c.env as any)?.TENANT_KV, 'global')
  return c.html(pageLayout('Chat Config', renderConfigPage('global', config)))
})

adminChatConfigRouter.post('/global', async (c) => {
  return handleConfigPost(c, 'global', 'global')
})

// ═══════════════════════════════════════════════════════════════════════════
// JSON API routes
// ═══════════════════════════════════════════════════════════════════════════

adminChatConfigApiRouter.get('/global', async (c) => {
  try {
    return c.json({ scope: 'global', config: await loadEditConfig((c.env as any)?.TENANT_KV, 'global') })
  } catch (err: any) {
    return c.json({ error: err.message || 'Load failed' }, 500)
  }
})

adminChatConfigApiRouter.post('/global', async (c) => {
  return handleApiPost(c, 'global', 'global')
})

adminChatConfigApiRouter.get('/tenant/:tenantId', async (c) => {
  const resolved = await resolveTenant(c, c.req.param('tenantId'))
  const kv = (c.env as any)?.TENANT_KV
  const config = await loadEditConfig(kv, 'tenant', resolved.tenantId)
  return c.json({ scope: 'tenant', tenantId: resolved.tenantId, slug: resolved.slug, config })
})

adminChatConfigApiRouter.post('/tenant/:tenantId', async (c) => {
  const resolved = await resolveTenant(c, c.req.param('tenantId'))
  return handleApiPost(c, 'tenant', resolved.tenantId)
})

adminChatConfigApiRouter.get('/effective/:tenantId', async (c) => {
  const resolved = await resolveTenant(c, c.req.param('tenantId'))
  const kv = (c.env as any)?.TENANT_KV
  const globalConfig = await loadGlobalChatConfig(kv)
  const tenantConfig = await loadTenantChatConfig(kv, resolved.tenantId)
  return c.json({
    scope: 'effective',
    tenantId: resolved.tenantId,
    slug: resolved.slug,
    config: mergeChatConfig(globalConfig, tenantConfig),
  })
})

export { adminChatConfigRouter, adminChatConfigTenantRouter, adminChatConfigApiRouter }

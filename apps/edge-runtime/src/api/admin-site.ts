/**
 * EdgeGDE — Admin Site/Layout UI (HTMX control plane)
 * View staging/production layout status, manage versions, promote to production.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { guardKV } from '../lib/kv'
import { envFromContext } from '../lib/env'

const adminSiteRouter = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// Page layout (shared with KB + Rules look)
// ═══════════════════════════════════════════════════════════════════════════

const pageLayout = (title: string, body: string, tenantId?: string, token?: string) => {
  const qs = (tenantId ? `?tenant=${tenantId}` : '') + (token ? `&token=${token}` : '')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — AFIRMICO Admin</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
    .nav{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;gap:24px;align-items:center}
    .nav h1{font-size:16px;color:#f0f6fc}
    .nav a{font-size:13px;padding:4px 8px;border-radius:4px}
    .nav a.active{background:#1c2128;color:#f0f6fc}
    .container{max-width:960px;margin:0 auto;padding:24px}
    .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
    .card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}
    .card .meta{font-size:11px;color:#8b949e;margin-bottom:8px}
    .stat{display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap}
    .stat-item{flex:1;min-width:180px;background:#1c2128;border:1px solid #2d3140;border-radius:8px;padding:14px;text-align:center}
    .stat-item .val{font-size:22px;font-weight:600;margin-bottom:4px}
    .stat-item .label{font-size:11px;color:#8b949e;text-transform:uppercase}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
    .badge-live{background:#238636;color:#fff}
    .badge-empty{background:#2d3140;color:#8b949e}
    .badge-staging{background:#d29922;color:#fff}
    .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500;display:inline-block;text-decoration:none}
    .btn-primary{background:#238636;color:#fff;border-color:#238636}
    .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
    .btn-warning{background:#d29922;color:#fff;border-color:#d29922}
    .btn:hover{opacity:0.85}
    .btn:disabled{opacity:0.4;cursor:not-allowed}
    input{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
    label{font-size:12px;color:#8b949e;display:block;margin-bottom:2px}
  </style>
</head>
<body>
  <nav class="nav">
    <h1>AFIRMICO Admin</h1>
    <a href="/admin/kb${qs}">Knowledge Base</a>
    <a href="/admin/rules${qs}">Rules</a>
    <a href="/admin/site${qs}" class="active">Site</a>
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/site — main site/layout admin page
// ═══════════════════════════════════════════════════════════════════════════

adminSiteRouter.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }

  // Check staging layout
  let stagingStatus = '<span class="badge badge-empty">No staging layout</span>'
  let prodStatus = '<span class="badge badge-empty">No production layout</span>'
  let stagingExists = false
  let prodExists = false

  try {
    const staging = await kv.getJson(`tenant:${tenantId}:layout:staging`, ctx)
    if (staging) {
      stagingStatus = '<span class="badge badge-staging">Staging version</span>'
      stagingExists = true
    }
  } catch {}

  // No compiled cache — all pages are server-rendered
  prodStatus = '<span class="badge badge-live">Live (server-rendered)</span>'

  // Get versions index
  let versionsHtml = '<div class="empty" style="color:#4a4d55;text-align:center;padding:16px;font-size:13px">No saved versions</div>'
  try {
    const indexRaw = await kv.get(`tenant:${tenantId}:staging:versions:index`, ctx)
    if (indexRaw) {
      const index = JSON.parse(indexRaw)
      if (index.length > 0) {
        versionsHtml = index.slice().reverse().map((v: any) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1c2128;border-radius:8px;margin-bottom:4px">
            <span style="flex:1;color:#e1e4e8;font-size:13px">${escapeHtml(v.label || v.id)}</span>
            <span style="color:#8b949e;font-size:11px">${v.named ? '&#9733;' : ''} ${formatTimestamp(v.timestamp)}</span>
          </div>`).join('')
      }
    }
  } catch {}

  const body = `
    <div class="stat">
      <div class="stat-item">
        <div class="val" style="color:#d29922">${stagingExists ? '✓' : '—'}</div>
        <div class="label">Staging</div>
        <div style="margin-top:6px;font-size:12px">${stagingStatus}</div>
      </div>
      <div class="stat-item">
        <div class="val" style="color:#3fb950">${prodExists ? '✓' : '—'}</div>
        <div class="label">Production</div>
        <div style="margin-top:6px;font-size:12px">${prodStatus}</div>
      </div>
      <div class="stat-item">
        <div class="val">${escapeHtml(tenantId)}</div>
        <div class="label">Tenant</div>
        <div style="margin-top:6px;font-size:12px;color:#8b949e">au-mortgage-broker-afirmico</div>
      </div>
    </div>

    <div style="display:flex;gap:24px">
      <div style="flex:1">
        <div class="card">
          <h3>Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div>
              <label>Save Version</label>
              <div style="display:flex;gap:8px">
                <input type="text" id="version-label" placeholder="Version label (optional)" style="flex:1;margin-bottom:0">
                <button class="btn btn-primary" hx-post="/admin/site/save-version?tenant=${escapeHtml(tenantId)}"
                        hx-vals="js:{label: document.getElementById('version-label').value}"
                        hx-target="#version-result" hx-swap="innerHTML">Save</button>
              </div>
              <div id="version-result" style="margin-top:6px;font-size:12px"></div>
            </div>
            <hr style="border-color:#2d3140;margin:8px 0">
            <div style="display:flex;gap:8px">
              <button class="btn btn-warning" hx-post="/admin/site/promote?tenant=${escapeHtml(tenantId)}"
                      hx-target="#promote-result" hx-swap="innerHTML"
                      ${stagingExists ? '' : 'disabled'}>🚀 Promote to Production</button>
              <div id="promote-result" style="margin-top:6px;font-size:12px;flex:1"></div>
            </div>
          </div>
        </div>
      </div>
      <div style="flex:1">
        <div class="card">
          <h3>Saved Versions</h3>
          <div id="versions-list" hx-get="/admin/site/versions?tenant=${escapeHtml(tenantId)}" hx-trigger="load, every 30s">
            ${versionsHtml}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Widget Embed</h3>
      <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Copy this script tag into any website to embed the chat widget:</p>
      <pre style="background:#0f1117;border:1px solid #2d3140;border-radius:6px;padding:12px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#3fb950">&lt;script src="https://edgegde-calculator.renleding.workers.dev/public/widget.v1.0.0.js" data-tenant="${escapeHtml(tenantId)}"&gt;&lt;/script&gt;</pre>
      <div style="margin-top:8px">
        <a class="btn btn-primary" href="https://edgegde-calculator.renleding.workers.dev/embed/chat?tenant=${escapeHtml(tenantId)}" target="_blank">Preview Widget</a>
        <a class="btn" href="https://edgegde-calculator.renleding.workers.dev/?tenant=${escapeHtml(tenantId)}" target="_blank" style="margin-left:8px">Open Site</a>
      </div>
    </div>`

  const token = c.req.query('token')
  return c.html(pageLayout('Site', body, tenantId, token))
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/site/promote — promote staging to production
// ═══════════════════════════════════════════════════════════════════════════

adminSiteRouter.post('/promote', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }

  try {
    const staging = await kv.getJson(`tenant:${tenantId}:layout:staging`, ctx)
    if (!staging) {
      return c.html('<div style="color:#da3633;font-size:13px">No staging layout to promote</div>')
    }

    await kv.put(`tenant:${tenantId}:layout:latest`, JSON.stringify(staging), ctx)

    return c.html('<div style="color:#3fb950;font-size:13px">✅ Promoted to production</div>')
  } catch (err: any) {
    return c.html(`<div style="color:#da3633;font-size:13px">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/site/save-version — save current staging as a named version
// ═══════════════════════════════════════════════════════════════════════════

adminSiteRouter.post('/save-version', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }

  try {
    const fd = await c.req.formData()
    const label = (fd.get('label') as string || '').trim()

    const staging = await kv.getJson(`tenant:${tenantId}:layout:staging`, ctx)
    if (!staging) {
      return c.html('<div style="color:#da3633;font-size:13px">No staging layout to save</div>')
    }

    // Read or create versions index
    let index: any[] = []
    const indexRaw = await kv.get(`tenant:${tenantId}:staging:versions:index`, ctx)
    if (indexRaw) {
      try { index = JSON.parse(indexRaw) } catch {}
    }

    const nextNum = index.length > 0
      ? Math.max(...index.map((i: any) => parseInt((i.id || '').replace('v', '')) || 0)) + 1
      : 1
    const id = `v${nextNum}`

    await kv.put(`tenant:${tenantId}:staging:versions:v${nextNum}`, JSON.stringify(staging), ctx)
    index.push({ id, label: label || `Version ${nextNum}`, timestamp: Date.now(), named: label.length > 0 })
    await kv.put(`tenant:${tenantId}:staging:versions:index`, JSON.stringify(index), ctx)

    return c.html(`<div style="color:#3fb950;font-size:13px">✅ Saved as ${escapeHtml(label || `Version ${nextNum}`)}</div>`)
  } catch (err: any) {
    return c.html(`<div style="color:#da3633;font-size:13px">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/site/versions — HTMX fragment listing saved versions
// ═══════════════════════════════════════════════════════════════════════════

adminSiteRouter.get('/versions', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }

  try {
    const indexRaw = await kv.get(`tenant:${tenantId}:staging:versions:index`, ctx)
    if (!indexRaw) {
      return c.html('<div class="empty" style="color:#4a4d55;text-align:center;padding:16px;font-size:13px">No saved versions</div>')
    }

    const index = JSON.parse(indexRaw)
    if (!index.length) {
      return c.html('<div class="empty" style="color:#4a4d55;text-align:center;padding:16px;font-size:13px">No saved versions</div>')
    }

    const html = index.slice().reverse().map((v: any) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1c2128;border-radius:8px;margin-bottom:4px">
        <span style="flex:1;color:#e1e4e8;font-size:13px">${escapeHtml(v.label || v.id)}</span>
        <span style="color:#8b949e;font-size:11px">${v.named ? '&#9733;' : ''}</span>
      </div>`).join('')

    return c.html(html)
  } catch {
    return c.html('<div class="empty" style="color:#4a4d55;text-align:center;padding:16px;font-size:13px">Error loading versions</div>')
  }
})

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export { adminSiteRouter }
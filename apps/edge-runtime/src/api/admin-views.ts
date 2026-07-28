/**
 * EdgeGDE — Admin KB UI (HTMX control plane)
 * File upload, URL ingest, approve/reject, delete entries.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { guardKV } from '../lib/kv'
import { rebuildTenantConfig } from '../lib/config-inheritance'

const adminRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Layout helpers
// ═══════════════════════════════════════════════════════════════════════════

const pageLayout = (title: string, body: string, tenantId?: string, token?: string) => {
  const qs = (tenantId ? `?tenant=${tenantId}` : '') + (token ? `&token=${token}` : '')
  const nav = (href: string, label: string, active: boolean) =>
    `<a href="${href}${qs}"${active ? ' class="active"' : ''}>${label}</a>`
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
    .entry{padding:8px 0;border-bottom:1px solid #1c2128;font-size:13px}
    .entry:last-child{border:none}
    .entry .val{color:#e1e4e8;margin-bottom:2px}
    .entry .key{font-size:11px;color:#8b949e}
    .entry .actions{display:flex;gap:4px;margin-top:4px}
    .empty{color:#4a4d55;text-align:center;padding:24px;font-size:13px}
    .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500}
    .btn-primary{background:#238636;color:#fff;border-color:#238636}
    .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
    .btn-sm{padding:3px 8px;font-size:10px}
    .btn:hover{opacity:0.85}
    .tabs{display:flex;gap:0;border-bottom:1px solid #2d3140;margin-bottom:16px}
    .tab{padding:8px 16px;cursor:pointer;font-size:13px;color:#8b949e;border-bottom:2px solid transparent}
    .tab.active{color:#f0f6fc;border-bottom-color:#58a6ff}
    .tab:hover{color:#e1e4e8}
    .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:4px}
    .badge-pending{background:#d29922;color:#fff}
    .badge-approved{background:#238636;color:#fff}
    .badge-rejected{background:#da3633;color:#fff}
    .file-input{width:100%;padding:6px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
    .file-input::file-selector-button{padding:4px 10px;border-radius:4px;border:1px solid #2d3140;background:#1c2128;color:#e1e4e8;cursor:pointer;font-size:11px}
    .file-input::file-selector-button:hover{background:#2d3140}
  </style>
</head>
<body>
  <nav class="nav">
    <h1>AFIRMICO Admin</h1>
    ${nav('/admin/kb', 'Knowledge Base', title === 'Knowledge Base')}
    ${nav('/admin/config', 'Config', title === 'Agent Config')}
    ${nav('/admin/rules', 'Rules', title === 'Rules')}
    ${nav('/admin/site', 'Site', title === 'Site')}
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// Renders
// ═══════════════════════════════════════════════════════════════════════════

function renderPendingEntries(entries: any[], topic: string, sourceRef: string, tid: string, token?: string): string {
  const t = token ? `&token=${token}` : ''
  if (!entries || entries.length === 0) return '<div class="empty">No pending entries for this topic</div>'
  const items = entries.map((e: any) => `
    <div class="entry">
      <div class="val">${escapeHtml(e.value || '')}</div>
      <div class="key">type: ${escapeHtml(e.type || '?')} · id: ${escapeHtml(e.id || '')}${e.trigger ? ` · trigger: ${escapeHtml(e.trigger)}` : ''}</div>
      <div class="actions">
        <button class="btn btn-danger btn-sm" hx-post="/admin/kb/delete-entry?tenant=${escapeHtml(tid)}&topic=${escapeHtml(topic)}&entryId=${escapeHtml(e.id)}&state=pending${t}" hx-swap="outerHTML" hx-target="closest .entry">Delete</button>
      </div>
    </div>`).join('')
  return `
    <div class="card">
      <h3>${escapeHtml(topic)}</h3>
      <div class="meta">Source: ${escapeHtml(sourceRef || 'unknown')}</div>
      ${items}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" hx-post="/admin/kb/approve?topic=${escapeHtml(topic)}&tenant=${escapeHtml(tid)}${t}" hx-swap="outerHTML" hx-target="closest .card">Approve</button>
        <button class="btn btn-danger" hx-post="/admin/kb/reject?topic=${escapeHtml(topic)}&tenant=${escapeHtml(tid)}${t}" hx-swap="outerHTML" hx-target="closest .card">Reject All</button>
        <button class="btn btn-sm" hx-post="/admin/kb/delete-topic?topic=${escapeHtml(topic)}&tenant=${escapeHtml(tid)}&state=pending${t}" hx-swap="outerHTML" hx-target="closest .card" style="color:#8b949e">Discard</button>
      </div>
    </div>`
}

function renderApprovedEntries(entries: any[], topic: string, tid: string, token?: string): string {
  const t = token ? `&token=${token}` : ''
  if (!entries || entries.length === 0) return '<div class="empty">No approved entries for this topic</div>'
  const items = entries.map((e: any) => `
    <div class="entry">
      <div class="val">${escapeHtml(e.value || '')}</div>
      <div class="key">type: ${escapeHtml(e.type || '?')} · id: ${escapeHtml(e.id || '')}</div>
      <div class="actions">
        <button class="btn btn-danger btn-sm" hx-post="/admin/kb/delete-entry?tenant=${escapeHtml(tid)}&topic=${escapeHtml(topic)}&entryId=${escapeHtml(e.id)}&state=approved${t}" hx-swap="outerHTML" hx-target="closest .entry">Delete</button>
      </div>
    </div>`).join('')
  return `
    <div class="card">
      <h3 style="display:flex;justify-content:space-between;align-items:center">
        <span>${escapeHtml(topic)}</span>
        <button class="btn btn-danger btn-sm" hx-post="/admin/kb/delete-topic?tenant=${escapeHtml(tid)}&topic=${escapeHtml(topic)}&state=approved${t}" hx-swap="outerHTML" hx-target="closest .card">Delete All</button>
      </h3>
      ${items}
    </div>`
}

function renderRejectedEntries(entries: any[], topic: string, tid: string, token?: string): string {
  const t = token ? `&token=${token}` : ''
  if (!entries || entries.length === 0) return '<div class="empty">No rejected entries</div>'
  const items = entries.map((e: any) => `
    <div class="entry">
      <div class="val">${escapeHtml(e.value || '')}</div>
      <div class="key">type: ${escapeHtml(e.type || '?')} · id: ${escapeHtml(e.id || '')}</div>
      <div class="actions">
        <button class="btn btn-danger btn-sm" hx-post="/admin/kb/delete-entry?tenant=${escapeHtml(tid)}&topic=${escapeHtml(topic)}&entryId=${escapeHtml(e.id)}&state=rejected${t}" hx-swap="outerHTML" hx-target="closest .entry">Delete</button>
      </div>
    </div>`).join('')
  return `
    <div class="card">
      <h3 style="display:flex;justify-content:space-between;align-items:center">
        <span>${escapeHtml(topic)} (rejected)</span>
        <button class="btn btn-danger btn-sm" hx-post="/admin/kb/delete-topic?tenant=${escapeHtml(tid)}&topic=${escapeHtml(topic)}&state=rejected${t}" hx-swap="outerHTML" hx-target="closest .card">Delete All</button>
      </h3>
      ${items}
    </div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/kb
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }

  const token = c.req.query('token')
  const t = token ? `&token=${token}` : ''
  const pendingKeys = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const pendingSections: string[] = []

  for (const topic of pendingKeys) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        pendingSections.push(renderPendingEntries(parsed.entries || [], topic, parsed.source_ref || '', tenantId, token))
      }
    } catch {}
  }

  const pendingHtml = pendingSections.length > 0
    ? pendingSections.join('\n')
    : '<div class="empty">No pending entries. Submit a URL or upload a file.</div>'

  const topicSelect = `<select name="topic" style="padding:6px 10px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:12px">
    <option value="">Auto-detect</option>
    <option value="rates">Rates</option>
    <option value="products">Products</option>
    <option value="policy">Policy</option>
    <option value="fees">Fees</option>
    <option value="compliance">Compliance</option>
    <option value="general">General</option>
  </select>`

  const body = `
    <div class="tabs">
      <span class="tab active" hx-get="/admin/kb/pending?tenant=${escapeHtml(tenantId)}${t}" hx-target="#kb-content" hx-trigger="load, every 10s">Pending</span>
      <span class="tab" hx-get="/admin/kb/list?tenant=${escapeHtml(tenantId)}${t}" hx-target="#kb-content">Approved</span>
      <span class="tab" hx-get="/admin/kb/rejected?tenant=${escapeHtml(tenantId)}${t}" hx-target="#kb-content">Rejected</span>
    </div>
    <div id="kb-content">${pendingHtml}</div>

    <div style="margin-top:24px;display:flex;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:280px;padding:16px;background:#161b22;border:1px solid #2d3140;border-radius:8px">
        <h3 style="font-size:14px;color:#f0f6fc;margin-bottom:8px">🌐 Ingest URL</h3>
        <form hx-post="/admin/kb/ingest-url?tenant=${escapeHtml(tenantId)}${t}" hx-swap="outerHTML" hx-target="#ingest-result">
          <input type="url" name="url" placeholder="https://example.com/rates" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px">
          <div style="display:flex;gap:8px;align-items:center">${topicSelect}<button type="submit" class="btn btn-primary">Ingest</button></div>
        </form>
        <div id="ingest-result" style="margin-top:8px;font-size:12px"></div>
      </div>
      <div style="flex:1;min-width:280px;padding:16px;background:#161b22;border:1px solid #2d3140;border-radius:8px">
        <h3 style="font-size:14px;color:#f0f6fc;margin-bottom:8px">📄 Upload File</h3>
        <p style="font-size:11px;color:#8b949e;margin-bottom:8px">Supported: .html, .htm, .txt, .pdf — max 10MB</p>
        <form hx-post="/admin/kb/upload-file?tenant=${escapeHtml(tenantId)}${t}" hx-swap="outerHTML" hx-target="#upload-result" enctype="multipart/form-data">
          <input type="file" name="file" accept=".html,.htm,.txt,.pdf" required class="file-input">
          <div style="display:flex;gap:8px;align-items:center">${topicSelect}<button type="submit" class="btn btn-primary">Upload</button></div>
        </form>
        <div id="upload-result" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>`

  return c.html(pageLayout('Knowledge Base', body, tenantId, token))
})

// ═══════════════════════════════════════════════════════════════════════════
// Tab endpoints
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.get('/pending', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const token = c.req.query('token')
  const topics = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const sections: string[] = []
  for (const topic of topics) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        sections.push(renderPendingEntries(parsed.entries || [], topic, parsed.source_ref || '', tenantId, token))
      }
    } catch {}
  }
  return c.html(sections.join('\n') || '<div class="empty">No pending entries</div>')
})

adminRouter.get('/list', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const token = c.req.query('token')
  const topics = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const sections: string[] = []
  for (const topic of topics) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        sections.push(renderApprovedEntries(parsed.entries || [], topic, tenantId, token))
      }
    } catch {}
  }
  return c.html(sections.join('\n') || '<div class="empty">No approved entries yet</div>')
})

adminRouter.get('/rejected', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const token = c.req.query('token')
  const topics = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const sections: string[] = []
  for (const topic of topics) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb_rejected:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        sections.push(renderRejectedEntries(parsed.entries || [], topic, tenantId, token))
      }
    } catch {}
  }
  return c.html(sections.join('\n') || '<div class="empty">No rejected entries</div>')
})

// ═══════════════════════════════════════════════════════════════════════════
// Approve / Reject
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/approve', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const topic = c.req.query('topic')
  if (!topic) return c.html('<div class="empty">Missing topic</div>')
  const rawKV = envFromContext(c).TENANT_KV
  if (!rawKV) return c.html('<div class="empty">KV binding not available</div>')
  try {
    const kv = guardKV(rawKV)
    const ctx = { tenantId, env: c.env }
    const pendingRaw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
    if (!pendingRaw) return c.html('<div class="empty">No pending data for this topic</div>')
    const pending = JSON.parse(pendingRaw)
    const existingRaw = await kv.get(`tenant:${tenantId}:kb:${topic}`, ctx)
    let existingEntries: any[] = []
    if (existingRaw) { try { existingEntries = JSON.parse(existingRaw).entries || [] } catch {} }
    const merged = new Map<string, any>()
    for (const e of existingEntries) merged.set(e.id, e)
    for (const e of (pending.entries || [])) merged.set(e.id, e)
    await kv.put(`tenant:${tenantId}:kb:${topic}`, JSON.stringify({ entries: Array.from(merged.values()), updated_at: Date.now(), source_ref: pending.source_ref || '' }), ctx)
    await rawKV.delete(`tenant:${tenantId}:kb_pending:${topic}`)
    const env = envFromContext(c)
    await rebuildTenantConfig(env.TENANT_KV, env, tenantId)
    return c.html(`<div class="card" style="border-color:#238636"><h3>${escapeHtml(topic)}</h3><div style="color:#3fb950;font-size:12px;margin-top:4px">✅ Approved · ${merged.size} entries · config rebuilt</div></div>`)
  } catch (err: any) {
    return c.html(`<div class="empty" style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

adminRouter.post('/reject', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const topic = c.req.query('topic')
  if (!topic) return c.html('<div class="empty">Missing topic</div>')
  const rawKV = envFromContext(c).TENANT_KV
  if (!rawKV) return c.html('<div class="empty">KV binding not available</div>')
  try {
    const kv = guardKV(rawKV)
    const ctx = { tenantId, env: c.env }
    const pendingRaw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
    if (!pendingRaw) return c.html('<div class="empty">No pending data for this topic</div>')
    const pending = JSON.parse(pendingRaw)
    await kv.put(`tenant:${tenantId}:kb_rejected:${topic}`, JSON.stringify({ entries: pending.entries || [], source_ref: pending.source_ref || '', rejected_at: Date.now() }), ctx)
    await rawKV.delete(`tenant:${tenantId}:kb_pending:${topic}`)
    const env = envFromContext(c)
    await rebuildTenantConfig(env.TENANT_KV, env, tenantId)
    return c.html(`<div class="card" style="border-color:#da3633"><h3>${escapeHtml(topic)}</h3><div style="color:#f85149;font-size:12px;margin-top:4px">❌ Rejected · config rebuilt</div></div>`)
  } catch (err: any) {
    return c.html(`<div class="empty" style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Ingest URL
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/ingest-url', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  try {
    const fd = await c.req.formData()
    const url = (fd.get('url') as string || '').trim()
    const topic = (fd.get('topic') as string || '').trim() || undefined
    if (!url) return c.html('<div style="color:#da3633">URL required</div>')
    const queue = envFromContext(c).LEAD_SCORING_QUEUE
    if (queue?.send) {
      await queue.send({ type: 'kb_ingest', tenantId, url, topic, sourceRef: url })
      return c.html('<div style="color:#3fb950">✅ Queued for ingestion. Refresh pending tab.</div>')
    }
    const { handleKbIngest } = await import('../queues/kb-ingest')
    c.executionCtx.waitUntil(handleKbIngest({ tenantId, url, topic, sourceRef: url }, c.env).catch(() => {}))
    return c.html('<div style="color:#3fb950">✅ Processing. Refresh pending tab shortly.</div>')
  } catch (err: any) {
    return c.html(`<div style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Upload File
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/upload-file', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  try {
    const fd = await c.req.formData()
    const file = fd.get('file') as File | null
    const topic = (fd.get('topic') as string || '').trim() || undefined
    if (!file || file.size === 0) return c.html('<div style="color:#da3633">File required</div>')
    if (file.size > 10 * 1024 * 1024) return c.html('<div style="color:#da3633">File too large (max 10MB)</div>')

    const buffer = await file.arrayBuffer()
    const fileName = file.name || 'uploaded_file'
    const isTxt = fileName.toLowerCase().endsWith('.txt')
    const isPdf = fileName.toLowerCase().endsWith('.pdf')

    let rawText: string
    if (isPdf) {
      const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false })
      rawText = decoder.decode(buffer)
      rawText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
                       .replace(/\(([^)]*)\)/g, '$1 ')
                       .replace(/[^\w\s.,;:!?%$€£¥\/()-]/g, ' ')
                       .replace(/\s+/g, ' ').trim()
      if (rawText.length < 20) rawText = `[PDF uploaded: ${fileName}]`
      rawText = `<html><body>${rawText}</body></html>`
    } else if (isTxt) {
      const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false })
      const text = decoder.decode(buffer)
      rawText = `<html><body>${escapeHtml(text)}</body></html>`
    } else {
      const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false })
      rawText = decoder.decode(buffer)
    }

    if (!rawText || rawText.length < 10) return c.html('<div style="color:#da3633">File appears empty</div>')

    // Store in R2
    let r2Key = ''
    const r2 = envFromContext(c).VAULT_BUCKET
    if (r2) {
      const hashArr = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).slice(0, 8)
      const hash = hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
      r2Key = `tenant/${tenantId}/kb_sources/${hash}_${fileName}`
      await r2.put(r2Key, buffer)
    }

    // Process via ingest handler
    const { handleKbIngest } = await import('../queues/kb-ingest')
    c.executionCtx.waitUntil(handleKbIngest({ tenantId, topic, sourceRef: r2Key || fileName, r2Key: r2Key || undefined }, c.env).catch(() => {}))
    return c.html(`<div style="color:#3fb950">✅ File "${escapeHtml(fileName)}" uploaded and processing. Refresh pending tab.</div>`)

  } catch (err: any) {
    return c.html(`<div style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Delete endpoints
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/delete-entry', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const topic = c.req.query('topic')
  const entryId = c.req.query('entryId')
  const state = c.req.query('state') || 'pending'
  if (!topic || !entryId) return c.html('<div style="color:#da3633">Missing topic or entryId</div>')
  const rawKV = envFromContext(c).TENANT_KV
  if (!rawKV) return c.html('<div style="color:#da3633">KV binding not available</div>')
  try {
    const kv = guardKV(rawKV)
    const ctx = { tenantId, env: c.env }
    let key: string
    if (state === 'approved') key = `tenant:${tenantId}:kb:${topic}`
    else if (state === 'rejected') key = `tenant:${tenantId}:kb_rejected:${topic}`
    else key = `tenant:${tenantId}:kb_pending:${topic}`
    const raw = await kv.get(key, ctx)
    if (!raw) return c.html('<div style="color:#da3633">Data not found</div>')
    const data = JSON.parse(raw)
    const filtered = (data.entries || []).filter((e: any) => e.id !== entryId)
    if (filtered.length === 0) {
      await rawKV.delete(key)
      return c.html('')
    }
    data.entries = filtered
    await kv.put(key, JSON.stringify(data), ctx)
    return c.html('')
  } catch (err: any) {
    return c.html(`<div style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

adminRouter.post('/delete-topic', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const topic = c.req.query('topic')
  const state = c.req.query('state') || 'approved'
  if (!topic) return c.html('<div style="color:#da3633">Missing topic</div>')
  const rawKV = envFromContext(c).TENANT_KV
  if (!rawKV) return c.html('<div style="color:#da3633">KV binding not available</div>')
  try {
    let key: string
    if (state === 'approved') key = `tenant:${tenantId}:kb:${topic}`
    else if (state === 'rejected') key = `tenant:${tenantId}:kb_rejected:${topic}`
    else key = `tenant:${tenantId}:kb_pending:${topic}`
    await rawKV.delete(key)
    return c.html('<div class="empty">Deleted</div>')
  } catch (err: any) {
    return c.html(`<div style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

export { adminRouter }
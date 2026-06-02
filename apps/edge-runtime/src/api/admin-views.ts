/**
 * EdgeGDE — Admin KB UI (HTMX control plane)
 * Binary approve/reject KB ingestion review surface.
 * No editing, no client state, server-rendered only.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { guardKV } from '../lib/kv'

const adminRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Layout helpers
// ═══════════════════════════════════════════════════════════════════════════

const pageLayout = (title: string, body: string) => `<!DOCTYPE html>
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
    .empty{color:#4a4d55;text-align:center;padding:24px;font-size:13px}
    .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500}
    .btn-primary{background:#238636;color:#fff;border-color:#238636}
    .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
    .btn:hover{opacity:0.85}
    .tabs{display:flex;gap:0;border-bottom:1px solid #2d3140;margin-bottom:16px}
    .tab{padding:8px 16px;cursor:pointer;font-size:13px;color:#8b949e;border-bottom:2px solid transparent}
    .tab.active{color:#f0f6fc;border-bottom-color:#58a6ff}
    .tab:hover{color:#e1e4e8}
    .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:4px}
    .badge-pending{background:#d29922;color:#fff}
    .badge-approved{background:#238636;color:#fff}
    .badge-rejected{background:#da3633;color:#fff}
  </style>
</head>
<body>
  <nav class="nav">
    <h1>AFIRMICO Admin</h1>
    <a href="/admin/kb" class="active">Knowledge Base</a>
    <a href="/admin/rules">Rules</a>
    <a href="/admin/site">Site</a>
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`

function renderPendingEntries(entries: any[], topic: string, sourceRef: string): string {
  if (!entries || entries.length === 0) return '<div class="empty">No pending entries for this topic</div>'
  const items = entries.map((e: any) => `
    <div class="entry">
      <div class="val">${escapeHtml(e.value || '')}</div>
      <div class="key">type: ${escapeHtml(e.type || '?')} · id: ${escapeHtml(e.id || '')}${e.trigger ? ` · trigger: ${escapeHtml(e.trigger)}` : ''}</div>
    </div>`).join('')
  return `
    <div class="card">
      <h3>${escapeHtml(topic)}</h3>
      <div class="meta">Source: ${escapeHtml(sourceRef || 'unknown')}</div>
      ${items}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" hx-post="/admin/kb/approve?topic=${escapeHtml(topic)}" hx-swap="outerHTML" hx-target="closest .card">Approve</button>
        <button class="btn btn-danger" hx-post="/admin/kb/reject?topic=${escapeHtml(topic)}" hx-swap="outerHTML" hx-target="closest .card">Reject</button>
      </div>
    </div>`
}

function renderApprovedEntries(entries: any[], topic: string): string {
  if (!entries || entries.length === 0) return '<div class="empty">No approved entries for this topic</div>'
  const items = entries.map((e: any) => `
    <div class="entry">
      <div class="val">${escapeHtml(e.value || '')}</div>
      <div class="key">type: ${escapeHtml(e.type || '?')} · id: ${escapeHtml(e.id || '')}</div>
    </div>`).join('')
  return `
    <div class="card">
      <h3>${escapeHtml(topic)}</h3>
      ${items}
    </div>`
}

function renderRejectedEntries(entries: any[], topic: string): string {
  if (!entries || entries.length === 0) return '<div class="empty">No rejected entries</div>'
  const items = entries.map((e: any) => `
    <div class="entry">
      <div class="val">${escapeHtml(e.value || '')}</div>
      <div class="key">type: ${escapeHtml(e.type || '?')} · id: ${escapeHtml(e.id || '')}</div>
    </div>`).join('')
  return `
    <div class="card">
      <h3>${escapeHtml(topic)} (rejected)</h3>
      ${items}
    </div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/kb — main KB admin page
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const kv = guardKV((c.env as any)?.TENANT_KV)
  const ctx = { tenantId, env: c.env }

  // Load pending topics
  const pendingKeys = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const pendingSections: string[] = []

  for (const topic of pendingKeys) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        pendingSections.push(renderPendingEntries(parsed.entries || [], topic, parsed.source_ref || ''))
      }
    } catch {}
  }

  const pendingHtml = pendingSections.length > 0
    ? pendingSections.join('\n')
    : '<div class="empty">No pending entries. Submit a URL to get started.</div>'

  const body = `
    <div class="tabs">
      <span class="tab active" hx-get="/admin/kb/pending?tenant=${escapeHtml(tenantId)}" hx-target="#kb-content" hx-trigger="load, every 10s">Pending</span>
      <span class="tab" hx-get="/admin/kb/list?tenant=${escapeHtml(tenantId)}" hx-target="#kb-content">Approved</span>
      <span class="tab" hx-get="/admin/kb/rejected?tenant=${escapeHtml(tenantId)}" hx-target="#kb-content">Rejected</span>
    </div>
    <div id="kb-content">
      ${pendingHtml}
    </div>
    <div style="margin-top:24px;padding:16px;background:#161b22;border:1px solid #2d3140;border-radius:8px">
      <h3 style="font-size:14px;color:#f0f6fc;margin-bottom:8px">Ingest New Source</h3>
      <form hx-post="/admin/kb/ingest-url?tenant=${escapeHtml(tenantId)}" hx-swap="outerHTML" hx-target="#ingest-result">
        <input type="url" name="url" placeholder="https://example.com/rates" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <select name="topic" style="padding:6px 10px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:12px">
            <option value="">Auto-detect</option>
            <option value="rates">Rates</option>
            <option value="products">Products</option>
            <option value="policy">Policy</option>
            <option value="fees">Fees</option>
            <option value="compliance">Compliance</option>
            <option value="general">General</option>
          </select>
          <button type="submit" class="btn btn-primary">Ingest</button>
        </div>
      </form>
      <div id="ingest-result" style="margin-top:8px;font-size:12px"></div>
    </div>`

  return c.html(pageLayout('Knowledge Base', body))
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/kb/pending — HTMX fragment for pending tab
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.get('/pending', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const kv = guardKV((c.env as any)?.TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const topics = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const sections: string[] = []

  for (const topic of topics) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        sections.push(renderPendingEntries(parsed.entries || [], topic, parsed.source_ref || ''))
      }
    } catch {}
  }

  return c.html(sections.join('\n') || '<div class="empty">No pending entries</div>')
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/kb/list — HTMX fragment for approved tab
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.get('/list', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const kv = guardKV((c.env as any)?.TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const topics = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const sections: string[] = []

  for (const topic of topics) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        sections.push(renderApprovedEntries(parsed.entries || [], topic))
      }
    } catch {}
  }

  return c.html(sections.join('\n') || '<div class="empty">No approved entries yet</div>')
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/kb/rejected — HTMX fragment for rejected tab
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.get('/rejected', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const kv = guardKV((c.env as any)?.TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const topics = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
  const sections: string[] = []

  for (const topic of topics) {
    try {
      const raw = await kv.get(`tenant:${tenantId}:kb_rejected:${topic}`, ctx)
      if (raw) {
        const parsed = JSON.parse(raw)
        sections.push(renderRejectedEntries(parsed.entries || [], topic))
      }
    } catch {}
  }

  return c.html(sections.join('\n') || '<div class="empty">No rejected entries</div>')
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/kb/approve — approve pending → kb
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/approve', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const topic = c.req.query('topic')
  if (!topic) return c.html('<div class="empty">Missing topic</div>')

  const rawKV = (c.env as any)?.TENANT_KV
  if (!rawKV) return c.html('<div class="empty">KV binding not available</div>')

  try {
    const kv = guardKV(rawKV)
    const ctx = { tenantId, env: c.env }

    // Read pending
    const pendingRaw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
    if (!pendingRaw) return c.html('<div class="empty">No pending data for this topic</div>')

    const pending = JSON.parse(pendingRaw)

    // Read existing kb (if any — for dedup merge)
    const existingRaw = await kv.get(`tenant:${tenantId}:kb:${topic}`, ctx)
    let existingEntries: any[] = []
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw)
        existingEntries = existing.entries || []
      } catch {}
    }

    // Merge with dedup by id
    const merged = new Map<string, any>()
    for (const e of existingEntries) merged.set(e.id, e)
    for (const e of (pending.entries || [])) merged.set(e.id, e)

    // Write to kb
    await kv.put(
      `tenant:${tenantId}:kb:${topic}`,
      JSON.stringify({
        entries: Array.from(merged.values()),
        updated_at: Date.now(),
        source_ref: pending.source_ref || '',
      }),
      ctx
    )

    // Delete pending
    await rawKV.delete(`tenant:${tenantId}:kb_pending:${topic}`)

    return c.html(`<div class="card" style="border-color:#238636">
      <h3>${escapeHtml(topic)}</h3>
      <div style="color:#3fb950;font-size:12px;margin-top:4px">✅ Approved · ${merged.size} entries</div>
    </div>`)
  } catch (err: any) {
    return c.html(`<div class="empty" style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/kb/reject — reject pending → kb_rejected
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/reject', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const topic = c.req.query('topic')
  if (!topic) return c.html('<div class="empty">Missing topic</div>')

  const rawKV = (c.env as any)?.TENANT_KV
  if (!rawKV) return c.html('<div class="empty">KV binding not available</div>')

  try {
    const kv = guardKV(rawKV)
    const ctx = { tenantId, env: c.env }

    // Read pending
    const pendingRaw = await kv.get(`tenant:${tenantId}:kb_pending:${topic}`, ctx)
    if (!pendingRaw) return c.html('<div class="empty">No pending data for this topic</div>')

    const pending = JSON.parse(pendingRaw)

    // Write to kb_rejected
    await kv.put(
      `tenant:${tenantId}:kb_rejected:${topic}`,
      JSON.stringify({
        entries: pending.entries || [],
        source_ref: pending.source_ref || '',
        rejected_at: Date.now(),
      }),
      ctx
    )

    // Delete pending
    await rawKV.delete(`tenant:${tenantId}:kb_pending:${topic}`)

    return c.html(`<div class="card" style="border-color:#da3633">
      <h3>${escapeHtml(topic)}</h3>
      <div style="color:#f85149;font-size:12px;margin-top:4px">❌ Rejected</div>
    </div>`)
  } catch (err: any) {
    return c.html(`<div class="empty" style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/kb/ingest-url — submit URL for KB extraction
// ═══════════════════════════════════════════════════════════════════════════

adminRouter.post('/ingest-url', async (c) => {
  const tenantId = c.req.query('tenant') || 'afirmico'
  const rawKV = (c.env as any)?.TENANT_KV
  if (!rawKV) return c.html('<div style="color:#da3633">KV binding not available</div>')

  try {
    const fd = await c.req.formData()
    const url = (fd.get('url') as string || '').trim()
    const topic = (fd.get('topic') as string || '').trim() || undefined

    if (!url) return c.html('<div style="color:#da3633">URL required</div>')

    // Enqueue the job
    const queue = (c.env as any)?.LEAD_SCORING_QUEUE
    if (queue?.send) {
      await queue.send({
        type: 'kb_ingest',
        tenantId,
        url,
        topic,
        sourceRef: url,
      })
      return c.html('<div style="color:#3fb950">✅ Queued for ingestion. Refresh pending tab in a few seconds.</div>')
    }

    // Fallback: run inline
    const { handleKbIngest } = await import('../queues/kb-ingest')
    c.executionCtx.waitUntil(handleKbIngest({ tenantId, url, topic, sourceRef: url }, c.env).catch((err) => {
      console.error('[admin-kb] Inline ingest failed:', err)
    }))
    return c.html('<div style="color:#3fb950">✅ Processing. Refresh pending tab shortly.</div>')

  } catch (err: any) {
    return c.html(`<div style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

export { adminRouter }

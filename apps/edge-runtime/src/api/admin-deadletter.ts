/**
 * EdgeGDE — Admin Dead Letter Queue (HTMX)
 *
 * View and replay form submissions that failed D1 persistence.
 * Data is stored in TENANT_KV under dead-letter keys.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { guardKV } from '../lib/kv'
import { deadLetterIndexKey, deadLetterKey } from '../lib/kv-keys'

const router = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * GET /admin/deadletter — list dead-letter entries for a tenant.
 */
router.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const TENANT_KV = envFromContext(c).TENANT_KV
  if (!TENANT_KV || typeof TENANT_KV.get !== 'function') {
    return c.html('<div class="card"><p style="color:#da3633">TENANT_KV not available</p></div>')
  }
  const kv = guardKV(TENANT_KV)
  const ctx = { tenantId }

  const indexRaw = await kv.get(deadLetterIndexKey(tenantId), ctx)
  const ids: string[] = indexRaw ? JSON.parse(indexRaw) : []

  let rows = ''
  if (ids.length === 0) {
    rows = '<tr><td colspan="3" style="text-align:center;color:#4a4d55;padding:24px">No dead-letter entries</td></tr>'
  } else {
    for (const id of ids) {
      const raw = await kv.get(deadLetterKey(tenantId, id), ctx)
      let payload = ''
      let preview = ''
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          payload = escapeHtml(raw.length > 500 ? raw.substring(0, 500) + '...' : raw)
          preview = escapeHtml(JSON.stringify(parsed).substring(0, 100))
        } catch {
          payload = escapeHtml(raw.substring(0, 200))
        }
      }
      rows += `<tr>
        <td style="font-family:monospace;font-size:11px">${escapeHtml(id)}</td>
        <td style="font-size:12px;font-family:monospace;max-width:300px;overflow:hidden;text-overflow:ellipsis">${preview || payload}</td>
        <td style="font-size:12px">
          <button hx-post="/admin/deadletter/replay/${encodeURIComponent(id)}?tenant=${encodeURIComponent(tenantId)}"
                  hx-target="#result-${escapeHtml(id)}"
                  class="btn-sm" style="padding:4px 8px;background:#238636;color:#fff;border:none;border-radius:4px;cursor:pointer">
            Replay
          </button>
          <span id="result-${escapeHtml(id)}" style="margin-left:8px;font-size:11px"></span>
        </td>
      </tr>`
    }
  }

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dead Letter Queue — Admin</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
  a{color:#58a6ff;text-decoration:none}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #2d3140;font-weight:500}
  td{padding:8px;border-bottom:1px solid #1c2128}
  .container{max-width:900px;margin:24px auto;padding:0 16px}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
  .badge-ok{background:#23863620;color:#3fb950;border:1px solid #238636}
  .badge-empty{background:#2d314020;color:#8b949e;border:1px solid #2d3140}
</style>
</head>
<body>
  <div class="container">
    <div style="margin-bottom:16px">
      <h2 style="font-size:16px;color:#f0f6fc;margin-bottom:4px">📋 Dead Letter Queue</h2>
      <p style="font-size:12px;color:#8b949e">Form submissions that failed D1 persistence — stored in KV for replay</p>
    </div>
    <div class="card">
      <div style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
        <span style="font-size:12px;color:#8b949e">Tenant:</span>
        <span class="badge ${ids.length > 0 ? 'badge-ok' : 'badge-empty'}" style="font-size:12px">${escapeHtml(tenantId)}</span>
        <span style="font-size:12px;color:#8b949e;margin-left:auto">${ids.length} pending</span>
      </div>
      <table>
        <thead><tr><th style="width:30%">ID</th><th>Payload Preview</th><th style="width:100px">Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`)
})

/**
 * POST /admin/deadletter/replay/:id — re-insert a dead-letter entry into D1.
 */
router.post('/replay/:id', async (c) => {
  const id = c.req.param('id')
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const TENANT_KV = envFromContext(c).TENANT_KV
  const DB = envFromContext(c).DB

  if (!TENANT_KV || !DB || typeof DB.prepare !== 'function') {
    return c.html('<span style="color:#da3633">DB not available</span>')
  }

  try {
    const kv = guardKV(TENANT_KV)
    const ctx = { tenantId }
    const raw = await kv.get(deadLetterKey(tenantId, id), ctx)
    if (!raw) {
      return c.html('<span style="color:#da3633">Entry not found</span>')
    }
    const parsed = JSON.parse(raw)

    // Re-insert into D1
    await DB.prepare(
      'INSERT OR IGNORE INTO form_submissions (id, tenant_id, form_id, payload) VALUES (?, ?, ?, ?)'
    ).bind(id, tenantId, parsed.formId || 'unknown', raw).run()

    // Remove from dead-letter KV
    await kv.del(deadLetterKey(tenantId, id), ctx)

    // Update index
    const indexRaw = await kv.get(deadLetterIndexKey(tenantId), ctx)
    const ids: string[] = indexRaw ? JSON.parse(indexRaw) : []
    const updated = ids.filter((x: string) => x !== id)
    if (updated.length > 0) {
      await kv.put(deadLetterIndexKey(tenantId), JSON.stringify(updated), ctx)
    } else {
      await kv.del(deadLetterIndexKey(tenantId), ctx)
    }

    return c.html('<span style="color:#3fb950">✅ Replayed</span>')
  } catch (err: any) {
    return c.html(`<span style="color:#da3633">❌ ${escapeHtml(err.message)}</span>`)
  }
})

export { router as adminDeadLetterRouter }

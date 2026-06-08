/**
 * EdgeGDE — Admin Drift UI (HTMX)
 * Shows config drift between deployed tenant and its blueprint baseline.
 */

import { Hono } from 'hono'
import { guardKV } from '../lib/kv'
import { detectConfigDrift } from '../factory/drift/drift.detector'

const router = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function jsonDisplay(v: unknown): string {
  if (v === undefined || v === null) return '<span style="color:#4a4d55">undefined</span>'
  return escapeHtml(typeof v === 'string' ? v : JSON.stringify(v))
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/drift — drift report for a tenant
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const token = c.req.query('token')
  const kv = guardKV((c.env as any)?.TENANT_KV)
  const ctx = { tenantId, env: c.env }
  const qs = (token ? `?token=${token}` : '') + (tenantId ? `&tenant=${tenantId}` : '')

  let driftRows = '<tr><td colspan="3" style="text-align:center;color:#4a4d55;padding:24px">No drift data</td></tr>'
  let summary = ''

  try {
    // Load tenant's blueprint reference
    const bpRef = await kv.get(`tenant:${tenantId}:blueprint_ref`, ctx)
    if (!bpRef) {
      summary = '<div style="color:#d29922;font-size:12px">⚠ No blueprint reference found for this tenant. It may have been created before the factory system.</div>'
    } else {
      const ref = typeof bpRef === 'string' ? JSON.parse(bpRef) : bpRef
      // Load the actual blueprint
      const blueprint = await kv.get(`blueprint:${ref.id}:latest`, ctx)
      if (!blueprint) {
        summary = `<div style="color:#da3633;font-size:12px">Blueprint "${escapeHtml(ref.id)}" not found</div>`
      } else {
        // Load tenant chat config
        const tenantConfig = await kv.get(`tenant:${tenantId}:chat:config`, ctx)
        if (!tenantConfig) {
          summary = '<div style="color:#da3633;font-size:12px">Tenant has no chat config</div>'
        } else {
          // Detect drift
          const drift = detectConfigDrift(blueprint, typeof tenantConfig === 'string' ? JSON.parse(tenantConfig) : tenantConfig)

          if (drift.length === 0) {
            summary = '<div style="color:#3fb950;font-size:12px">✅ No drift detected — tenant matches blueprint</div>'
          } else {
            summary = `<div style="color:#d29922;font-size:12px">⚠ ${drift.length} drift difference(s) found</div>`
            driftRows = drift.map(d => `
              <tr>
                <td style="font-family:monospace;font-size:11px">${escapeHtml(d.path)}</td>
                <td style="font-size:12px">${jsonDisplay(d.expected)}</td>
                <td style="font-size:12px;color:#d29922">${jsonDisplay(d.actual)}</td>
              </tr>`).join('')
          }
        }
      }
    }
  } catch (err: any) {
    summary = `<div style="color:#da3633;font-size:12px">Error: ${escapeHtml(err.message)}</div>`
  }

  const body = `
    <div class="card" style="background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px">
      <h3 style="font-size:14px;color:#f0f6fc;margin-bottom:12px">🔍 Drift Report: ${escapeHtml(tenantId)}</h3>
      ${summary}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">
        <thead><tr><th style="text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #2d3140">Field</th><th style="text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #2d3140">Expected</th><th style="text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #2d3140">Actual</th></tr></thead>
        <tbody>${driftRows}</tbody>
      </table>
      <div style="margin-top:12px;font-size:12px;color:#8b949e">
        Blueprint baseline is compiled with Zod defaults applied — default values do not count as drift.
      </div>
    </div>`

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drift — AFIRMICO Admin</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
  a{color:#58a6ff;text-decoration:none}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #2d3140;font-weight:500}
  td{padding:8px;border-bottom:1px solid #1c2128}
  .container{max-width:800px;margin:24px auto;padding:0 16px}
</style>
</head>
<body>
  <div class="container">
    <div style="margin-bottom:16px">
      <a href="/admin/blueprints${qs}" style="font-size:12px;color:#58a6ff">← Blueprints</a>
      <span style="margin:0 8px;color:#2d3140">|</span>
      <a href="/admin/kb?tenant=${escapeHtml(tenantId)}${token ? '&token=' + token : ''}" style="font-size:12px;color:#58a6ff">KB Admin</a>
    </div>
    ${body}
  </div>
</body>
</html>`)
})

export { router as adminDriftRouter }
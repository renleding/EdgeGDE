/**
 * EdgeGDE — Admin Factory UI (HTMX)
 * 1-click tenant creation from a blueprint.
 * Runs compileBlueprint → persists tenant + chat config + packs.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { guardKV } from '../lib/kv'
import { compileBlueprint } from '../factory/factory/factory.engine'
import { logAuditEvent } from '../lib/audit'

const router = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/factory — factory form pre-filled from blueprint
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (c) => {
  const token = c.req.query('token')
  const bpId = c.req.query('blueprint')
  const kv = guardKV((c.env as any)?.TENANT_KV)

  let bpJson = ''
  let bpInfo = '<div style="color:#4a4d55;font-size:12px">No blueprint selected</div>'

  if (bpId) {
    try {
      const raw = await kv.getJson(`blueprint:${bpId}:latest`)
      if (raw) {
        bpJson = JSON.stringify(raw, null, 2)
        bpInfo = `
          <div style="font-size:12px;color:#8b949e;margin-bottom:8px">
            Blueprint: ${escapeHtml(raw.id)} v${escapeHtml(raw.version || '?')} ·
            ${(raw.fields || []).length} fields ·
            ${raw.packs?.rule_pack ? 'rule pack: ' + escapeHtml(raw.packs.rule_pack) : 'no rule pack'} ·
            ${raw.packs?.compliance_pack ? 'compliance pack: ' + escapeHtml(raw.packs.compliance_pack) : 'no compliance pack'}
          </div>`
      }
    } catch {}
  }

  const body = `
    <div style="max-width:600px;margin:0 auto">
      <div class="card" style="background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px">
        <h3 style="font-size:14px;color:#f0f6fc;margin-bottom:12px">🏭 Create Tenant from Blueprint</h3>
        ${bpInfo}
        <form hx-post="/admin/factory/create?token=${escapeHtml(token || '')}" hx-target="#factory-result" hx-swap="innerHTML">
          <label>Blueprint ID</label>
          <input type="text" name="blueprintId" value="${escapeHtml(bpId || '')}" required placeholder="mortgage-broker">
          <label>Tenant Slug</label>
          <input type="text" name="slug" required placeholder="my-mortgage-broker">
          <label>Tenant Name (optional)</label>
          <input type="text" name="name" placeholder="My Mortgage Broker">
          <label>Overrides (optional JSON)</label>
          <textarea name="overrides" rows="4" placeholder='{"ui":{"title":"Custom Title"}}'></textarea>
          <button type="submit" class="btn btn-primary" style="margin-top:8px">🚀 Create Tenant</button>
        </form>
        <div id="factory-result" style="margin-top:12px;font-size:12px"></div>
      </div>
      ${bpJson ? `<div class="card" style="margin-top:16px"><h3 style="font-size:13px;color:#8b949e">Blueprint Preview</h3><pre style="font-size:11px;color:#3fb950;overflow-x:auto;white-space:pre-wrap">${escapeHtml(bpJson)}</pre></div>` : ''}
    </div>`

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Factory — AFIRMICO Admin</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
  a{color:#58a6ff;text-decoration:none}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500;display:inline-block;text-decoration:none}
  .btn-primary{background:#238636;color:#fff;border-color:#238636}
  .btn:hover{opacity:0.85}
  input,textarea{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
  label{font-size:12px;color:#8b949e;display:block;margin-bottom:2px}
  pre{background:#0f1117;border:1px solid #2d3140;border-radius:6px;padding:12px;font-size:11px;overflow-x:auto}
</style>
</head>
<body>
  <div style="max-width:600px;margin:24px auto">
    <a href="/admin/blueprints${token ? '?token=' + token : ''}" style="font-size:12px;color:#58a6ff;margin-bottom:16px;display:inline-block">← Back to Blueprints</a>
    ${body}
  </div>
</body>
</html>`)
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/factory/create — execute factory
// ═══════════════════════════════════════════════════════════════════════════

router.post('/create', async (c) => {
  try {
    const fd = await c.req.formData()
    const blueprintId = (fd.get('blueprintId') as string || '').trim()
    const slug = (fd.get('slug') as string || '').trim()
    const name = (fd.get('name') as string || '').trim() || slug
    const overridesRaw = (fd.get('overrides') as string || '').trim()

    if (!blueprintId || !slug) {
      return c.html('<div style="color:#da3633">Blueprint ID and slug required</div>')
    }

    const rawKV = (c.env as any)?.TENANT_KV
    if (!rawKV) return c.html('<div style="color:#da3633">KV binding not available</div>')

    const rawStr = await rawKV.get('blueprint:' + blueprintId + ':latest')
    if (!rawStr) {
      return c.html(`<div style="color:#da3633">Blueprint "${escapeHtml(blueprintId)}" not found</div>`)
    }

    let overrides: Record<string, unknown> | undefined
    if (overridesRaw) {
      try { overrides = JSON.parse(overridesRaw) } catch {
        return c.html('<div style="color:#da3633">Invalid JSON in overrides</div>')
      }
    }

    // Parse blueprint
    const blueprint = typeof rawStr === 'string' ? JSON.parse(rawStr) : rawStr

    // Generate tenant ID
    const tenantId = crypto.randomUUID()

    // Create tenant record using raw KV
    await rawKV.put('tenant:' + slug, JSON.stringify({
      tenantId,
      slug,
      name,
      createdAt: new Date().toISOString(),
      plan: 'free',
    }))

    // Run factory
    const result = await compileBlueprint(
      { blueprint: blueprint, overrides, tenantId, slug, tenantName: name },
      c.env,
    )

    // Audit: log factory event
    const db = (c.env as any)?.DB
    logAuditEvent(db, tenantId, 'factory', 'tenant_created', {
      blueprint: blueprintId,
      slug,
      rulesInstalled: result.packs.rulesInstalled,
      complianceInstalled: result.packs.complianceInstalled,
    }).catch(() => {})

    return c.html(`<div style="color:#3fb950">
      <div style="font-size:14px;font-weight:500;margin-bottom:8px">✅ Tenant created successfully</div>
      <div style="font-size:12px">
        Tenant: ${escapeHtml(slug)}<br>
        ID: ${escapeHtml(tenantId)}<br>
        Rules installed: ${result.packs.rulesInstalled}<br>
        Compliance entries: ${result.packs.complianceInstalled}<br>
        <a href="/admin/kb?tenant=${escapeHtml(slug)}&token=${escapeHtml(c.req.query('token') || '')}" style="color:#58a6ff;margin-top:8px;display:inline-block">→ Open KB Admin</a>
        <a href="/admin/rules?tenant=${escapeHtml(slug)}&token=${escapeHtml(c.req.query('token') || '')}" style="color:#58a6ff;margin-left:12px">→ Open Rules</a>
      </div>
    </div>`)

  } catch (err: any) {
    return c.html('<div style="color:#da3633">' + escapeHtml(err.message) + '<br><pre style="font-size:10px;margin-top:4px;color:#f85149">' + escapeHtml(err.stack || '') + '</pre></div>')
  }
})

export { router as adminFactoryRouter }
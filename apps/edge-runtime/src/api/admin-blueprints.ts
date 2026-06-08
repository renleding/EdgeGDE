/**
 * EdgeGDE — Admin Blueprints UI
 * List/nav-only for the factory system.
 */

import { Hono } from 'hono'
import { guardKV } from '../lib/kv'
import { listAllPacks } from '../factory/packs/pack.registry'

const router = new Hono()

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/blueprints
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const token = c.req.query('token') || ''
  const kv = guardKV((c.env as any)?.TENANT_KV)

  const q = '?tenant=' + tenantId + (token ? '&token=' + token : '')

  // Read blueprint index
  let bpRows = '<tr><td colspan="4" style="color:#4a4d55;text-align:center;padding:24px">No blueprints</td></tr>'
  try {
    const idxRaw = await kv.get('blueprint:index')
    const idx: string[] = idxRaw ? JSON.parse(idxRaw) : []
    if (idx.length > 0) {
      const items: string[] = []
      for (const id of idx) {
        const raw = await kv.get('blueprint:' + id + ':latest')
        if (raw) {
          const bp = JSON.parse(raw)
          items.push('<tr><td>' + esc(bp.id) + '</td><td>v' + esc(bp.version) + '</td><td>' + (bp.fields || []).length + ' fields</td>'
            + '<td><a class="btn" href="/admin/factory?blueprint=' + esc(bp.id) + '&tenant=' + tenantId + '&token=' + token + '">Create</a>'
            + ' <a class="btn" href="/admin/drift?tenant=' + tenantId + '&token=' + token + '">Drift</a></td></tr>')
        }
      }
      if (items.length > 0) bpRows = items.join('\n')
    }
  } catch {}

  // Read pack index
  let packHtml = '<div style="color:#4a4d55;font-size:12px">No packs registered</div>'
  try {
    const packs = await listAllPacks(kv)
    if (packs.length > 0) {
      packHtml = packs.map(p =>
        '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1c2128">'
        + '<span>' + esc(p.name) + '</span>'
        + '<span>' + p.type + ' (' + p.entryCount + ' entries)</span></div>'
      ).join('')
    }
  } catch {}

  const body = `<div style="display:flex;gap:24px;flex-wrap:wrap">
    <div style="flex:2;min-width:400px">
      <div class="card"><h3>Blueprints</h3><table><thead><tr><th>ID</th><th>Version</th><th>Fields</th><th></th></tr></thead><tbody>${bpRows}</tbody></table></div>
      <div class="card"><h3>Available Packs</h3>${packHtml}</div>
    </div>
    <div style="flex:1;min-width:300px">
      <div class="card">
        <h3>Create Blueprint</h3>
        <form hx-post="/admin/blueprints/create?token=${token}" hx-target="#bp-result" hx-swap="innerHTML">
          <label>ID</label><input type="text" name="id" placeholder="mortgage-broker" required>
          <label>Version</label><input type="text" name="version" value="1.0.0" required>
          <label>Fields (JSON)</label><textarea name="fields" rows="4" required>[{"fieldName":"fullName","label":"Full Name","fieldType":"text","validation":{"required":true}}]</textarea>
          <label>Priority Order (csv)</label><input type="text" name="priorityOrder" placeholder="fullName,email" required>
          <label>Rule Pack Name</label><input type="text" name="rulePackName" placeholder="au_mortgage">
          <label>Rule Pack Version</label><input type="text" name="rulePackVersion" value="v1">
          <label>Compliance Pack Name</label><input type="text" name="compliancePackName" placeholder="au_nccp">
          <label>Compliance Pack Version</label><input type="text" name="compliancePackVersion" value="v1">
          <button type="submit" class="btn btn-primary">Create Blueprint</button>
        </form>
        <div id="bp-result" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>
  </div>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blueprints — AFIRMICO Admin</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
  a{color:#58a6ff;text-decoration:none}
  .nav{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;gap:24px;align-items:center}
  .nav h1{font-size:16px;color:#f0f6fc}
  .nav a{font-size:13px;padding:4px 8px;border-radius:4px}
  .container{max-width:960px;margin:0 auto;padding:24px}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  .card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}
  .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500;display:inline-block;text-decoration:none}
  .btn-primary{background:#238636;color:#fff;border-color:#238636}
  .btn:hover{opacity:0.85}
  input,textarea,select{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
  label{font-size:12px;color:#8b949e;display:block;margin-bottom:2px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px;color:#8b949e;font-weight:500;border-bottom:1px solid #2d3140}
  td{padding:8px;border-bottom:1px solid #1c2128}
</style>
</head>
<body>
<nav class="nav">
<h1>AFIRMICO Admin</h1>
<a href="/admin/kb${q}">KB</a>
<a href="/admin/rules${q}">Rules</a>
<a href="/admin/site${q}">Site</a>
<a href="/admin/blueprints${q}" style="background:#1c2128;color:#f0f6fc">Blueprints</a>
</nav>
<div class="container">${body}</div>
</body>
</html>`

  return c.html(html)
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/blueprints/create
// ═══════════════════════════════════════════════════════════════════════════

router.post('/create', async (c) => {
  const kv = guardKV((c.env as any)?.TENANT_KV)
  try {
    const fd = await c.req.formData()
    const id = (fd.get('id') as string || '').trim()
    const version = (fd.get('version') as string || '1.0.0').trim()
    const fieldsRaw = (fd.get('fields') as string || '[]').trim()
    const priorityRaw = (fd.get('priorityOrder') as string || '').trim()
    const rulePackName = (fd.get('rulePackName') as string || '').trim()
    const rulePackVer = (fd.get('rulePackVersion') as string || '').trim()
    const compliancePackName = (fd.get('compliancePackName') as string || '').trim()
    const compliancePackVer = (fd.get('compliancePackVersion') as string || '').trim()

    if (!id || !fieldsRaw || !priorityRaw) {
      return c.html('<div style="color:#da3633">ID, fields, and priorityOrder required</div>')
    }

    let fields: any[]
    try { fields = JSON.parse(fieldsRaw) } catch {
      return c.html('<div style="color:#da3633">Invalid JSON in fields</div>')
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      return c.html('<div style="color:#da3633">At least one field required</div>')
    }

    const priorityOrder = priorityRaw.split(',').map((s: string) => s.trim())
    const blueprint: Record<string, unknown> = { id, version, fields, priorityOrder, packs: {} }
    if (rulePackName && rulePackVer) (blueprint.packs as Record<string, unknown>).rule_pack = { name: rulePackName, version: rulePackVer }
    if (compliancePackName && compliancePackVer) (blueprint.packs as Record<string, unknown>).compliance_pack = { name: compliancePackName, version: compliancePackVer }

    // Immutable: write versioned key + update latest pointer
    const rawKV = (c.env as any)?.TENANT_KV
    await rawKV.put('blueprint:' + id + ':v' + version, JSON.stringify(blueprint))
    await rawKV.put('blueprint:' + id + ':latest', JSON.stringify(blueprint))

    const idxRaw = await kv.get('blueprint:index')
    const idx: string[] = idxRaw ? JSON.parse(idxRaw) : []
    if (!idx.includes(id)) {
      idx.push(id)
      await rawKV.put('blueprint:index', JSON.stringify(idx))
    }

    return c.html('<div style="color:#3fb950">Created blueprint: ' + esc(id) + ' v' + esc(version) + '</div>')
  } catch (err: any) {
    return c.html('<div style="color:#da3633">' + esc(err.message) + '</div>')
  }
})

export { router as adminBlueprintsRouter }
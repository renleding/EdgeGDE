/**
 * EdgeGDE — Admin Packs UI (HTMX)
 * List packs, view tenant pack versions, dry-run diff, execute upgrade/rollback.
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { loadRulePack, loadCompliancePack, listAllPacks } from '../factory/packs/pack.registry'
import { dryRunUpgrade, executeUpgrade, rollbackUpgrade } from '../factory/upgrade/upgrade.engine'

const router = new Hono()

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// ═══════════════════════════════════════════════════════════════════════════
// Shared layout
// ═══════════════════════════════════════════════════════════════════════════

function shell(title: string, body: string, tenantId?: string, token?: string): string {
  const q = (tenantId ? '?tenant=' + tenantId : '') + (token ? '&token=' + token : '')
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — AFIRMICO Admin</title>
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
  .card .meta{font-size:11px;color:#8b949e}
  .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500;display:inline-block;text-decoration:none}
  .btn-primary{background:#238636;color:#fff;border-color:#238636}
  .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
  .btn-warning{background:#d29922;color:#fff;border-color:#d29922}
  .btn:hover{opacity:0.85}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px}
  .badge-low{background:#238636;color:#fff}
  .badge-med{background:#d29922;color:#fff}
  .badge-high{background:#da3633;color:#fff}
  input,select{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
  label{font-size:12px;color:#8b949e;display:block;margin-bottom:2px}
  pre{background:#0f1117;border:1px solid #2d3140;border-radius:6px;padding:12px;font-size:11px;overflow-x:auto;white-space:pre-wrap;font-family:monospace;color:#e1e4e8}
  .diff-add{color:#3fb950}
  .diff-rem{color:#f85149}
  .diff-mod{color:#d29922}
</style>
</head>
<body>
<nav class="nav"><h1>AFIRMICO Admin</h1>
<a href="/admin/kb${q}">KB</a><a href="/admin/rules${q}">Rules</a><a href="/admin/site${q}">Site</a><a href="/admin/blueprints${q}">Blueprints</a><a href="/admin/packs${q}" style="background:#1c2128;color:#f0f6fc">Packs</a>
</nav>
<div class="container">${body}</div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/packs — list packs + upgrade form
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const token = c.req.query('token') || ''
  const kv = envFromContext(c).TENANT_KV

  // Current pack versions
  let currentVersions = '<div style="color:#4a4d55">No pack versions loaded</div>'
  try {
    const configRaw = await kv.get('tenant:' + tenantId + ':chat:config')
    if (configRaw) {
      const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw
      if (config.pack_versions) {
        currentVersions = Object.entries(config.pack_versions).map(([k, v]) =>
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1c2128">'
          + '<span>' + esc(k) + '</span><span>' + esc(v as string) + '</span></div>'
        ).join('')
      }
    }
  } catch {}

  const body = `<div style="display:flex;gap:24px;flex-wrap:wrap">
    <div style="flex:1;min-width:300px">
      <div class="card"><h3>Current Pack Versions</h3>${currentVersions}</div>
    </div>
    <div style="flex:1;min-width:300px">
      <div class="card">
        <h3>Upgrade Pack</h3>
        <form hx-post="/admin/packs/dry-run?tenant=${esc(tenantId)}&token=${token}" hx-target="#diff-result" hx-swap="innerHTML">
          <label>Tenant ID</label><input type="text" name="tenantId" value="${esc(tenantId)}">
          <label>New Pack Name</label><input type="text" name="packName" placeholder="au_mortgage_v1">
          <button type="submit" class="btn btn-warning">🔍 Dry Run</button>
        </form>
        <div id="diff-result" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>
    <div style="flex:1;min-width:300px">
      <div class="card">
        <h3>Rollback</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Rollback requires a snapshot. Snapshots are created automatically during upgrade.</p>
        <form hx-post="/admin/packs/rollback?tenant=${esc(tenantId)}&token=${token}" hx-target="#rollback-result" hx-swap="innerHTML">
          <label>Tenant ID</label><input type="text" name="tenantId" value="${esc(tenantId)}">
          <label>Pack Name (from snapshot)</label><input type="text" name="packName" placeholder="au_mortgage_v1">
          <button type="submit" class="btn btn-danger">↩ Rollback</button>
        </form>
        <div id="rollback-result" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>
    <div style="flex:1;min-width:300px">
      <div class="card">
        <h3>🌱 Seed Test Packs</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Creates au_mortgage_v1 (rules) + au_nccp_v1 (compliance) with sample data.</p>
        <button class="btn btn-warning" hx-post="/admin/packs/seed-test?token=${esc(token)}" hx-swap="innerHTML" hx-target="#seed-result">Seed Test Packs</button>
        <div id="seed-result" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>
  </div>`

  return c.html(shell('Pack Manager', body, tenantId, token))
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/packs/dry-run — compatibility + diff
// ═══════════════════════════════════════════════════════════════════════════

router.post('/dry-run', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  try {
    const fd = await c.req.formData()
    const packName = (fd.get('packName') as string || '').trim()
    if (!packName) return c.html('<div style="color:#da3633">Pack name required</div>')

    const kv = envFromContext(c).TENANT_KV
    if (!kv) return c.html('<div style="color:#da3633">KV not available</div>')

    // Load existing rules as old state
    const db = envFromContext(c).DB
    let oldRules: any[] = []
    if (db) {
      try {
        const { results } = await db.prepare('SELECT * FROM rules WHERE tenant_id = ?').bind(tenantId).all()
        oldRules = results || []
      } catch {}
    }

    // Load existing compliance
    let oldCompliance: any[] = []
    try {
      const raw = await kv.get('tenant:' + tenantId + ':kb:compliance')
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        oldCompliance = parsed.entries || []
      }
    } catch {}

    // Get blueprint fields for validation
    const bpRefRaw = await kv.get('tenant:' + tenantId + ':blueprint_ref')
    let blueprintFields: string[] = []
    if (bpRefRaw) {
      try {
        const bpRef = typeof bpRefRaw === 'string' ? JSON.parse(bpRefRaw) : bpRefRaw
        const bpRaw = await kv.get('blueprint:' + bpRef.id + ':latest')
        if (bpRaw) {
          const bp = typeof bpRaw === 'string' ? JSON.parse(bpRaw) : bpRaw
          blueprintFields = (bp.fields || []).map((f: any) => f.fieldName)
        }
      } catch {}
    }

    const plan = await dryRunUpgrade(kv, tenantId, packName, blueprintFields, oldRules, oldCompliance)

    if (!plan.compatible) {
      return c.html('<div style="color:#da3633"><strong>⛔ Upgrade blocked</strong><br>' + plan.errors.map(e => '• ' + esc(e)).join('<br>') + '</div>')
    }

    const d = plan.diff!
    const scoreBadge = d.impactScore === 'HIGH' ? 'badge-high' : d.impactScore === 'MEDIUM' ? 'badge-med' : 'badge-low'

    const diffHtml = `
      <div style="margin-top:8px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <span class="badge ${scoreBadge}">${d.impactScore} IMPACT</span>
          <span style="font-size:12px;color:#8b949e">${d.impactStatements.join(' · ')}</span>
        </div>
        ${d.rulesAdded.length > 0 ? '<div style="margin-bottom:4px"><span style="color:#3fb950">+ Added:</span> ' + d.rulesAdded.map(r => '<div class="diff-add">' + esc(r) + '</div>').join('') + '</div>' : ''}
        ${d.rulesRemoved.length > 0 ? '<div style="margin-bottom:4px"><span style="color:#f85149">− Removed:</span> ' + d.rulesRemoved.map(r => '<div class="diff-rem">' + esc(r) + '</div>').join('') + '</div>' : ''}
        ${d.rulesModified.length > 0 ? '<div style="margin-bottom:4px"><span style="color:#d29922">~ Modified:</span> ' + d.rulesModified.map(r => '<div class="diff-mod">' + esc(r.condition) + ': ' + esc(r.oldOutput) + ' → ' + esc(r.newOutput) + '</div>').join('') + '</div>' : ''}
        ${d.complianceAdded.length > 0 ? '<div style="margin-bottom:4px;color:#3fb950">+ ' + d.complianceAdded.length + ' disclosure(s) added</div>' : ''}
        ${d.complianceRemoved.length > 0 ? '<div style="margin-bottom:4px;color:#f85149">− ' + d.complianceRemoved.length + ' disclosure(s) removed</div>' : ''}
        ${d.rulesAdded.length === 0 && d.rulesRemoved.length === 0 && d.rulesModified.length === 0 && d.complianceAdded.length === 0 && d.complianceRemoved.length === 0 ? '<div style="color:#3fb950">✓ No changes detected — packs are identical</div>' : ''}
        ${plan.warnings.length > 0 ? '<div style="margin-top:8px;color:#d29922">⚠ Warnings:<br>' + plan.warnings.map(w => '• ' + esc(w)).join('<br>') + '</div>' : ''}
        <form hx-post="/admin/packs/execute?tenant=${esc(tenantId)}&token=${esc(c.req.query('token') || '')}" hx-target="#execute-result" hx-swap="innerHTML" style="margin-top:12px">
          <input type="hidden" name="packName" value="${esc(packName)}">
          <button type="submit" class="btn btn-primary">🚀 Execute Upgrade</button>
        </form>
        <div id="execute-result" style="margin-top:8px"></div>
      </div>`

    return c.html(diffHtml)
  } catch (err: any) {
    return c.html('<div style="color:#da3633">Error: ' + esc(err.message) + '</div>')
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/packs/execute — run upgrade
// ═══════════════════════════════════════════════════════════════════════════

router.post('/execute', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  try {
    const fd = await c.req.formData()
    const packName = (fd.get('packName') as string || '').trim()
    if (!packName) return c.html('<div style="color:#da3633">Pack name required</div>')

    const result = await executeUpgrade(c.env, tenantId, packName, packName, packName)

    return c.html('<div style="color:#3fb950">'
      + '✅ Upgrade complete<br>'
      + 'Rules installed: ' + result.rulesInstalled + '<br>'
      + 'Compliance entries: ' + result.complianceInstalled + '<br>'
      + '<a href="/admin/packs?tenant=' + esc(tenantId) + '&token=' + esc(c.req.query('token') || '') + '" style="color:#58a6ff">Refresh pack versions</a>'
      + '</div>')
  } catch (err: any) {
    return c.html('<div style="color:#da3633">Error: ' + esc(err.message) + '</div>')
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/packs/rollback — rollback from snapshot
// ═══════════════════════════════════════════════════════════════════════════

router.post('/rollback', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  try {
    const fd = await c.req.formData()
    const packName = (fd.get('packName') as string || '').trim()
    if (!packName) return c.html('<div style="color:#da3633">Pack name required</div>')

    const result = await rollbackUpgrade(c.env, tenantId, packName, packName, packName)

    return c.html('<div style="color:#3fb950">'
      + '✅ Rollback complete<br>'
      + 'Rules restored: ' + result.rulesInstalled + '<br>'
      + 'Compliance entries restored: ' + result.complianceInstalled + '<br>'
      + '<a href="/admin/packs?tenant=' + esc(tenantId) + '&token=' + esc(c.req.query('token') || '') + '" style="color:#58a6ff">Refresh</a>'
      + '</div>')
  } catch (err: any) {
    return c.html('<div style="color:#da3633">Error: ' + esc(err.message) + '</div>')
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/packs/seed-test — seed test pack data
// ═══════════════════════════════════════════════════════════════════════════

router.post('/seed-test', async (c) => {
  const kv = envFromContext(c).TENANT_KV
  if (!kv) return c.html('<div style="color:#da3633">KV not available</div>')

  try {
    // Seed au_mortgage_v1 — test rules
    const mortgageRules = [
      { condition: 'loanAmount / propertyValue > 0.8', output: 'stage=blocked flags=[high_lvr]', priority: 90 },
      { condition: 'annualIncome < 30000', output: 'stage=blocked flags=[low_income]', priority: 80 },
      { condition: 'employmentType == "Self-Employed"', output: 'flags=[needs_bas]', priority: 70 },
      { condition: 'isFirstHomeBuyer == "Yes" AND loanAmount > 700000', output: 'flags=[needs_lmi]', priority: 60 },
      { condition: 'loanPurpose == "Investment"', output: 'stage=qualified flags=[investment_loan]', priority: 50 },
      { condition: 'hasExistingLoan == "Yes" AND loanAmount > propertyValue * 0.8', output: 'stage=blocked flags=[high_lvr_existing]', priority: 85 },
    ]
    await kv.put('pack:au_mortgage_v1:rules', JSON.stringify(mortgageRules))

    // Update pack index
    const idxRaw = await kv.get('pack:index:rules')
    const idx: any[] = idxRaw ? (typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw) : []
    if (!idx.find((p: any) => p.name === 'au_mortgage_v1')) {
      idx.push({ name: 'au_mortgage_v1', type: 'rules', entryCount: mortgageRules.length, description: 'AU lending rules (test)' })
      await kv.put('pack:index:rules', JSON.stringify(idx))
    }

    // Seed au_nccp_v1 — test compliance disclosures
    const nccpEntries = [
      { value: 'This is a Credit Guide. You have the right to receive a Credit Guide before signing any agreement.', trigger: 'always' },
      { value: 'Comparison rate: 5.72% p.a. Warning: This comparison rate is true only for the examples given and may not include all fees and charges.', trigger: 'rate_or_deposit_related' },
      { value: 'Target Market Determination (TMD) available on request. This product is designed for owner-occupier residential lending.', trigger: 'always' },
      { value: 'Lender Mortgage Insurance (LMI) may apply if your deposit is less than 20%.', trigger: 'rate_or_deposit_related' },
    ]
    await kv.put('pack:au_nccp_v1:compliance', JSON.stringify(nccpEntries))

    const idxCompRaw = await kv.get('pack:index:compliance')
    const idxComp: any[] = idxCompRaw ? (typeof idxCompRaw === 'string' ? JSON.parse(idxCompRaw) : idxCompRaw) : []
    if (!idxComp.find((p: any) => p.name === 'au_nccp_v1')) {
      idxComp.push({ name: 'au_nccp_v1', type: 'compliance', entryCount: nccpEntries.length, description: 'AU NCCP compliance disclosures (test)' })
      await kv.put('pack:index:compliance', JSON.stringify(idxComp))
    }

    return c.html('<div style="color:#3fb950">✅ Seeded au_mortgage_v1 (' + mortgageRules.length + ' rules) and au_nccp_v1 (' + nccpEntries.length + ' disclosures)</div>')
  } catch (err: any) {
    return c.html('<div style="color:#da3633">Error: ' + esc(err.message) + '</div>')
  }
})

export { router as adminPacksRouter }
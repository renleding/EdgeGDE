/**
 * EdgeGDE — Admin Policy Rules UI (HTMX control plane)
 * Create, update, toggle, test deterministic policy rules.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { guardDB } from '../lib/db'
import { rebuildTenantConfig } from '../lib/config-inheritance'
import { evaluateCondition, parseRuleOutput, simulateRules, type Rule, validateConditionSyntax } from '../lib/rule-engine'
import type { Env } from '../lib/env'

const adminRulesRouter = new Hono<{ Bindings: Env }>()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/rules — main rules admin page
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const db = guardDB(c.env.DB)
  const ctx = { tenantId, env: c.env }

  // eslint-disable-next-line local/no-raw-storage-access
  const { results: rulesRaw } = await c.env.DB.prepare('SELECT * FROM rules WHERE tenant_id = ? ORDER BY priority DESC, created_at DESC').bind(tenantId).all()
  const rules: Rule[] = (rulesRaw || []) as unknown as Rule[]

  const rows = rules.map(r => `
    <tr id="rule-${escapeHtml(r.id)}">
      <td style="padding:8px;color:#8b949e">${r.priority}</td>
      <td style="padding:8px">${escapeHtml(r.condition)}</td>
      <td style="padding:8px">${escapeHtml(r.output)}</td>
      <td style="padding:8px">
        <button class="btn ${r.active ? 'btn-active' : 'btn-inactive'}" hx-post="/admin/rules/toggle?id=${escapeHtml(r.id)}&tenant=${escapeHtml(tenantId)}" hx-swap="outerHTML" hx-target="#rule-${escapeHtml(r.id)}">
          ${r.active ? '✅ Active' : '⏸ Inactive'}
        </button>
      </td>
      <td style="padding:8px">
        <button class="btn" hx-get="/admin/rules/edit?id=${escapeHtml(r.id)}&tenant=${escapeHtml(tenantId)}" hx-target="#edit-panel" hx-swap="innerHTML">Edit</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#4a4d55">No rules yet. Create your first rule below.</td></tr>'

  const body = `
    <link rel="stylesheet" href="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js" crossorigin>
    <style>
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{text-align:left;padding:8px;color:#8b949e;font-weight:500;border-bottom:1px solid #2d3140}
      td{border-bottom:1px solid #1c2128}
      .btn{padding:4px 10px;border-radius:4px;border:1px solid #2d3140;cursor:pointer;font-size:11px;background:#1c2128;color:#e1e4e8}
      .btn-active{background:#238636;color:#fff;border-color:#238636}
      .btn-inactive{background:#da3633;color:#fff;border-color:#da3633}
      .btn-primary{background:#238636;color:#fff;border-color:#238636}
      .btn:hover{opacity:0.85}
      .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
      .card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}
      input,select,textarea{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
      textarea{font-family:monospace;font-size:12px;min-height:60px}
      label{font-size:12px;color:#8b949e;display:block;margin-bottom:2px}
      .sim-result{padding:8px 12px;border-radius:4px;margin:4px 0;font-size:12px}
      .sim-hit{background:#1a2e1a;border:1px solid #238636;color:#3fb950}
      .sim-miss{background:#1c2128;border:1px solid #2d3140;color:#8b949e}
    </style>
    <div style="display:flex;gap:24px">
      <div style="flex:2">
        <div class="card">
          <h3>Policy Rules</h3>
          <table>
            <thead><tr><th>Priority</th><th>Condition</th><th>Output</th><th>Active</th><th></th></tr></thead>
            <tbody id="rule-list" hx-get="/admin/rules/list?tenant=${escapeHtml(tenantId)}" hx-trigger="load, every 10s">
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
      <div style="flex:1">
        <div class="card">
          <h3>${'Create Rule'}</h3>
          <div id="edit-panel">
            <form hx-post="/admin/rules/create?tenant=${escapeHtml(tenantId)}" hx-target="#edit-panel" hx-swap="innerHTML">
              <label>Condition</label>
              <input type="text" name="condition" placeholder="income < 30000" required>
              <label>Output</label>
              <input type="text" name="output" placeholder="stage=blocked" required>
              <label>Priority</label>
              <input type="number" name="priority" value="50" required style="width:120px">
              <button type="submit" class="btn btn-primary">Create</button>
            </form>
            <hr style="border-color:#2d3140;margin:16px 0">
            <h3 style="font-size:13px;color:#f0f6fc;margin-bottom:8px">Test Conditions</h3>
            <form hx-post="/admin/rules/test?tenant=${escapeHtml(tenantId)}" hx-target="#sim-results" hx-swap="innerHTML">
              <label>Condition</label>
              <input type="text" name="condition" placeholder="income < 30000">
              <label>Mock State (JSON)</label>
              <textarea name="mock_state">{"income": 25000}</textarea>
              <button type="submit" class="btn">Test</button>
            </form>
            <div id="sim-results"></div>
          </div>
        </div>
      </div>
    </div>`

  const token = c.req.query('token')
  const qs = (tenantId ? `?tenant=${tenantId}` : '') + (token ? `&token=${token}` : '')
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rules — AFIRMICO Admin</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
  a{color:#58a6ff;text-decoration:none}
  .nav{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;gap:24px;align-items:center}
  .nav h1{font-size:16px;color:#f0f6fc}
  .nav a{font-size:13px;padding:4px 8px;border-radius:4px}
  .container{max-width:1200px;margin:0 auto;padding:24px}
</style>
</head>
<body>
  <nav class="nav">
    <h1>AFIRMICO Admin</h1>
    <a href="/admin/kb${qs}">Knowledge Base</a>
    <a href="/admin/rules${qs}" style="background:#1c2128;color:#f0f6fc">Rules</a>
    <a href="/admin/site${qs}">Site</a>
  </nav>
  <div class="container">${body}</div>
</body>
</html>`)
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/rules/list — sorted rule list fragment (polled)
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.get('/list', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const db = guardDB(c.env.DB)
  const ctx = { tenantId, env: c.env }

  // eslint-disable-next-line local/no-raw-storage-access
  const { results: rulesRaw } = await c.env.DB.prepare('SELECT * FROM rules WHERE tenant_id = ? ORDER BY priority DESC, created_at DESC').bind(tenantId).all()
  const rules: Rule[] = (rulesRaw || []) as unknown as Rule[]

  const rows = rules.map(r => `
    <tr id="rule-${escapeHtml(r.id)}">
      <td style="padding:8px;color:#8b949e">${r.priority}</td>
      <td style="padding:8px">${escapeHtml(r.condition)}</td>
      <td style="padding:8px">${escapeHtml(r.output)}</td>
      <td style="padding:8px">
        <button class="btn ${r.active ? 'btn-active' : 'btn-inactive'}" hx-post="/admin/rules/toggle?id=${escapeHtml(r.id)}&tenant=${escapeHtml(tenantId)}" hx-swap="outerHTML" hx-target="#rule-${escapeHtml(r.id)}">
          ${r.active ? '✅ Active' : '⏸ Inactive'}
        </button>
      </td>
      <td style="padding:8px">
        <button class="btn" hx-get="/admin/rules/edit?id=${escapeHtml(r.id)}&tenant=${escapeHtml(tenantId)}" hx-target="#edit-panel" hx-swap="innerHTML">Edit</button>
      </td>
    </tr>`)

  return c.html(rows.join('\n') || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#4a4d55">No rules</td></tr>')
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/rules/create
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.post('/create', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const db = guardDB(c.env.DB)
  const ctx = { tenantId, env: c.env }

  const fd = await c.req.formData()
  const condition = (fd.get('condition') as string || '').trim()
  const output = (fd.get('output') as string || '').trim()
  const priority = parseInt((fd.get('priority') as string) || '50', 10)

  if (!condition || !output) return c.html('<div style="color:#da3633;font-size:13px">Condition and output required</div>')

  // Validate deterministic grammar before persistence.
  try {
    validateConditionSyntax(condition)
  } catch {
    return c.html('<div style="color:#da3633;font-size:13px">Invalid condition syntax</div>')
  }

  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await db.insert(ctx, 'rules', { id, tenant_id: tenantId, condition, output, priority, active: 1, created_at: now })
  await rebuildTenantConfig(c.env.TENANT_KV, c.env, tenantId)

  return c.html(`<div style="color:#3fb950;font-size:13px">✅ Rule created · config rebuilt. <a href="/admin/rules?tenant=${escapeHtml(tenantId)}" style="color:#58a6ff">Refresh list</a></div>`)
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/rules/update
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.post('/update', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const db = guardDB(c.env.DB)
  const ctx = { tenantId, env: c.env }

  const fd = await c.req.formData()
  const id = (fd.get('id') as string || '').trim()
  const condition = (fd.get('condition') as string || '').trim()
  const output = (fd.get('output') as string || '').trim()
  const priority = parseInt((fd.get('priority') as string) || '50', 10)

  if (!id || !condition || !output) return c.html('<div style="color:#da3633;font-size:13px">All fields required</div>')

  try {
    validateConditionSyntax(condition)
  } catch {
    return c.html('<div style="color:#da3633;font-size:13px">Invalid condition syntax</div>')
  }

  await db.update(ctx, 'rules', { condition, output, priority }, 'id = ?', [id])
  await rebuildTenantConfig(c.env.TENANT_KV, c.env, tenantId)

  return c.html(`<div style="color:#3fb950;font-size:13px">✅ Rule updated · config rebuilt. <a href="/admin/rules?tenant=${escapeHtml(tenantId)}" style="color:#58a6ff">Back to rules</a></div>`)
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/rules/edit — returns edit form fragment
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.get('/edit', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const id = c.req.query('id')
  if (!id) return c.html('<div style="color:#da3633">Missing id</div>')

  const db = guardDB(c.env.DB)
  const ctx = { tenantId, env: c.env }

  const rule = await db.first<Rule>(ctx, 'SELECT * FROM rules WHERE id = ?', [id])
  if (!rule) return c.html('<div style="color:#da3633">Rule not found</div>')

  return c.html(`
    <form hx-post="/admin/rules/update?tenant=${escapeHtml(tenantId)}" hx-target="#edit-panel" hx-swap="innerHTML">
      <input type="hidden" name="id" value="${escapeHtml(rule.id)}">
      <label>Condition</label>
      <input type="text" name="condition" value="${escapeHtml(rule.condition)}">
      <label>Output</label>
      <input type="text" name="output" value="${escapeHtml(rule.output)}">
      <label>Priority</label>
      <input type="number" name="priority" value="${rule.priority}" style="width:120px">
      <button type="submit" class="btn btn-primary">Update</button>
      <a href="/admin/rules?tenant=${escapeHtml(tenantId)}" class="btn" style="display:inline-block;margin-left:8px;padding:4px 10px;color:#8b949e;text-decoration:none">Cancel</a>
    </form>
    <hr style="border-color:#2d3140;margin:16px 0">
    <form hx-post="/admin/rules/test?tenant=${escapeHtml(tenantId)}" hx-target="#sim-results" hx-swap="innerHTML">
      <h3 style="font-size:13px;color:#f0f6fc;margin-bottom:8px">Test Condition</h3>
      <input type="hidden" name="condition" value="${escapeHtml(rule.condition)}">
      <label>Mock State (JSON)</label>
      <textarea name="mock_state">{"income": 25000}</textarea>
      <button type="submit" class="btn">Test</button>
    </form>
    <div id="sim-results"></div>
  `)
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/rules/toggle — toggle rule active/inactive
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.post('/toggle', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const id = c.req.query('id')
  if (!id) return c.html('<div style="color:#da3633">Missing id</div>')

  const db = guardDB(c.env.DB)
  const ctx = { tenantId, env: c.env }

  const rule = await db.first<Rule>(ctx, 'SELECT * FROM rules WHERE id = ?', [id])
  if (!rule) return c.html('<div style="color:#da3633">Rule not found</div>')

  const newActive = rule.active ? 0 : 1
  await db.update(ctx, 'rules', { active: newActive }, 'id = ?', [id])
  await rebuildTenantConfig(c.env.TENANT_KV, c.env, tenantId)

  return c.html(`
    <tr id="rule-${escapeHtml(rule.id)}">
      <td style="padding:8px;color:#8b949e">${rule.priority}</td>
      <td style="padding:8px">${escapeHtml(rule.condition)}</td>
      <td style="padding:8px">${escapeHtml(rule.output)}</td>
      <td style="padding:8px">
        <button class="btn ${newActive ? 'btn-active' : 'btn-inactive'}" hx-post="/admin/rules/toggle?id=${escapeHtml(rule.id)}&tenant=${escapeHtml(tenantId)}" hx-swap="outerHTML" hx-target="#rule-${escapeHtml(rule.id)}">
          ${newActive ? '✅ Active' : '⏸ Inactive'}
        </button>
      </td>
      <td style="padding:8px">
        <button class="btn" hx-get="/admin/rules/edit?id=${escapeHtml(rule.id)}&tenant=${escapeHtml(tenantId)}" hx-target="#edit-panel" hx-swap="innerHTML">Edit</button>
      </td>
    </tr>`)
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/rules/test — simulate a condition against mock state
// ═══════════════════════════════════════════════════════════════════════════

adminRulesRouter.post('/test', async (c) => {
  const fd = await c.req.formData()
  const condition = (fd.get('condition') as string || '').trim()
  const mockRaw = (fd.get('mock_state') as string || '{}').trim()

  let mockState: Record<string, unknown> = {}
  try { mockState = JSON.parse(mockRaw) } catch { return c.html('<div style="color:#da3633;font-size:13px">Invalid JSON</div>') }

  if (!condition) return c.html('<div style="color:#da3633;font-size:13px">Condition required</div>')

  try {
    const result = evaluateCondition(condition, mockState)
    const output = result ? parseRuleOutput(condition.includes('=') ? condition : 'flag=matched') : undefined

    return c.html(`
      <div class="sim-result ${result ? 'sim-hit' : 'sim-miss'}">
        ${result ? '✅ TRIGGERED' : '❌ Not triggered'}: ${escapeHtml(condition)}
        ${output ? `<br>Output: stage=${escapeHtml(output.stage || '—')}, flags: [${output.flags.join(', ') || '—'}]` : ''}
      </div>`)
  } catch (err: any) {
    return c.html(`<div class="sim-result sim-miss" style="color:#da3633">Error: ${escapeHtml(err.message)}</div>`)
  }
})

export { adminRulesRouter }

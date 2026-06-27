/**
 * EdgeGDE — Admin Landing Page (HTMX)
 *
 * Unified admin landing page at /admin/ with tenant picker and
 * cards linking to all admin tools.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

const router = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════════════════
// Nav bar (shared across admin pages)
// ═══════════════════════════════════════════════════════════════════════════

function navBar(tenantId: string, token: string, current: string): string {
  const qs = `?tenant=${encodeURIComponent(tenantId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  const items: Array<{ href: string; label: string; icon: string }> = [
    { href: '/admin', label: 'Dashboard', icon: '🏠' },
    { href: '/admin/kb', label: 'KB', icon: '📚' },
    { href: '/admin/drift', label: 'Drift', icon: '🔍' },
    { href: '/admin/deadletter', label: 'Dead Letter', icon: '📋' },
    { href: '/admin/blueprints', label: 'Blueprints', icon: '📐' },
    { href: '/admin/rules', label: 'Rules', icon: '⚙️' },
    { href: '/admin/site', label: 'Site', icon: '🌐' },
    { href: '/admin/factory', label: 'Factory', icon: '🏭' },
    { href: '/admin/analytics', label: 'Analytics', icon: '📊' },
    { href: '/admin/packs', label: 'Packs', icon: '📦' },
    { href: '/admin/tenants', label: 'Tenants', icon: '👥' },
  ]

  return `
<nav style="background:#161b22;border-bottom:1px solid #2d3140;padding:8px 16px">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="font-size:15px;font-weight:600;color:#f0f6fc;margin-right:8px">EdgeGDE</span>
    ${items.map(i => `<a href="${i.href}${qs}"
      style="font-size:12px;padding:4px 8px;border-radius:4px;color:${current === i.href ? '#f0f6fc' : '#8b949e'};background:${current === i.href ? '#1c2128' : 'transparent'};text-decoration:none;white-space:nowrap"
    >${i.icon} ${i.label}</a>`).join('\n    ')}
    <span style="margin-left:auto;font-size:11px;color:#4a4d55">${escapeHtml(tenantId)}</span>
  </div>
</nav>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Page layout (replaces admin-views pageLayout for consistency)
// ═══════════════════════════════════════════════════════════════════════════

export function adminPageLayout(title: string, body: string, tenantId: string = 'au-mortgage-broker-afirmico', token: string = '', current: string = '/admin'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — EdgeGDE Admin</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
    .container{max-width:960px;margin:0 auto;padding:24px}
    .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
    .card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}
    .card a{display:block;font-size:13px;padding:6px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
    .badge-green{background:#23863620;color:#3fb950;border:1px solid #238636}
    .badge-yellow{background:#d2992220;color:#d29922;border:1px solid #d29922}
    .badge-red{background:#da363320;color:#da3633;border:1px solid #da3633}
    .stat{font-size:28px;font-weight:700;color:#f0f6fc;margin-bottom:2px}
    .stat-label{font-size:11px;color:#8b949e;text-transform:uppercase}
    .tenant-selector{background:#0d1117;border:1px solid #2d3140;border-radius:6px;padding:4px 8px;color:#e1e4e8;font-size:12px}
  </style>
</head>
<body>
  ${navBar(tenantId, token, current)}
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin — Landing page
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const token = c.req.query('token') || ''
  const qs = `?tenant=${encodeURIComponent(tenantId)}${token ? `&token=${token}` : ''}`

  // Tenant selector
  const tenantSelector = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <label for="tenant-select" style="font-size:12px;color:#8b949e">Tenant:</label>
      <select id="tenant-select" class="tenant-selector"
        onchange="window.location.href=window.location.pathname+'?tenant='+this.value+'${token ? `&token=${token}` : ''}'">
        <option value="au-mortgage-broker-afirmico" ${tenantId === 'au-mortgage-broker-afirmico' ? 'selected' : ''}>AFIRMICO</option>
        <option value="alpha-broker-01" ${tenantId === 'alpha-broker-01' ? 'selected' : ''}>Alpha Broker 01</option>
        <option value="alpha-broker-02" ${tenantId === 'alpha-broker-02' ? 'selected' : ''}>Alpha Broker 02</option>
      </select>
    </div>`

  // Stats section
  const statsCard = `
    <div class="card">
      <h3>📊 Overview</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;margin-top:12px">
        <div><div class="stat">28</div><div class="stat-label">Calculators</div></div>
        <div><div class="stat">313</div><div class="stat-label">Tests</div></div>
        <div><div class="stat">0</div><div class="stat-label">Typecheck Errors</div></div>
        <div><div class="stat">15</div><div class="stat-label">Deployments</div></div>
      </div>
    </div>`

  // Tool cards
  const toolCards = `
    <div class="grid">
      <div class="card">
        <h3>📚 KB Admin</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Manage knowledge base entries, approve/reject, upload</p>
        <a href="/admin/kb${qs}">Open KB Admin →</a>
      </div>
      <div class="card">
        <h3>🔍 Drift Report</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">View config drift between tenant and blueprint baseline</p>
        <span class="badge badge-green">Live</span>
        <a href="/admin/drift${qs}" style="margin-top:8px">Open Drift →</a>
      </div>
      <div class="card">
        <h3>📋 Dead Letter Queue</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">View and replay failed form submissions</p>
        <a href="/admin/deadletter${qs}">Open Dead Letter →</a>
      </div>
      <div class="card">
        <h3>📐 Blueprints</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Manage tenant blueprint templates and factory config</p>
        <a href="/admin/blueprints${qs}">Open Blueprints →</a>
      </div>
      <div class="card">
        <h3>⚙️ Rules</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Manage scoring rulesets and automation config</p>
        <a href="/admin/rules${qs}">Open Rules →</a>
      </div>
      <div class="card">
        <h3>🌐 Site</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">View and manage tenant site layouts, promote to production</p>
        <a href="/admin/site${qs}">Open Site →</a>
      </div>
      <div class="card">
        <h3>🏭 Factory</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Tenant factory management and configuration inheritance</p>
        <a href="/admin/factory${qs}">Open Factory →</a>
      </div>
      <div class="card">
        <h3>📊 Analytics</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">View metrics, forecasting, and dashboard analytics</p>
        <a href="/admin/analytics${qs}">Open Analytics →</a>
      </div>
      <div class="card">
        <h3>📦 Packs</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Manage MCP tool packs and provider configurations</p>
        <a href="/admin/packs${qs}">Open Packs →</a>
      </div>
      <div class="card">
        <h3>👥 Tenants</h3>
        <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Tenant admin management and permission settings</p>
        <a href="/admin/tenants${qs}">Open Tenants →</a>
      </div>
    </div>`

  const body = `${tenantSelector}${statsCard}${toolCards}`
  const html = adminPageLayout('Dashboard', body, tenantId, token, '/admin')
  return c.html(html)
})

export { router as adminLandingRouter }

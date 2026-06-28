/**
 * EdgeGDE — Tenant Dashboard (HTMX)
 *
 * Protected dashboard page at /tenant/dashboard.
 * Shows tenant overview, API key management, webhook config, usage stats.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { requireSession } from '../middleware/session'
import { hashPassword } from '../lib/password'

const router = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PAGE_STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
  a{color:#58a6ff;text-decoration:none}
  .container{max-width:720px;margin:0 auto;padding:24px}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  .card h2{font-size:15px;color:#f0f6fc;margin-bottom:8px}
  .card p{font-size:13px;color:#8b949e;margin-bottom:4px}
  .label{font-size:11px;color:#4a4d55;text-transform:uppercase;margin-bottom:2px}
  .value{font-size:14px;color:#e1e4e8;margin-bottom:8px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1c2128}
  .row:last-child{border-bottom:none}
  .btn{padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;border:none;cursor:pointer;display:inline-block}
  .btn-primary{background:#238636;color:#fff}
  .btn-primary:hover{background:#2ea043}
  .btn-danger{background:#da3633;color:#fff}
  .btn-danger:hover{background:#f85149}
  .btn-secondary{background:#1c2128;color:#e1e4e8;border:1px solid #2d3140}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
  .badge-green{background:#23863620;color:#3fb950;border:1px solid #238636}
  .badge-yellow{background:#d2992220;color:#d29922;border:1px solid #d29922}
  .topbar{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;align-items:center;gap:12px}
  .topbar h1{font-size:16px;color:#f0f6fc}
  .topbar a{margin-left:auto;font-size:12px}
`

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — EdgeGDE</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${PAGE_STYLES}</style>
</head>
<body>
  <div class="topbar">
    <h1>EdgeGDE</h1>
    <a href="/onboarding?step=3">Getting Started</a>
    <form action="/logout" method="POST" style="display:inline">
      <button type="submit" class="btn btn-secondary">Log out</button>
    </form>
  </div>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /tenant/dashboard
// ═══════════════════════════════════════════════════════════════════════════

router.get('/dashboard', requireSession(), async (c) => {
  const session = (c as any).get('tenantSession') as any
  const slug = session.slug
  const TENANT_KV = (c.env as any)?.TENANT_KV

  if (!TENANT_KV) {
    return c.html(layout('Dashboard', '<div class="card"><p>Tenant storage unavailable</p></div>'))
  }

  const tenant: any = await TENANT_KV.get(`tenant:${slug}`, 'json')
  if (!tenant) {
    return c.html(layout('Dashboard', '<div class="card"><p>Tenant not found</p></div>'))
  }

  // Load credentials (mask the key)
  const creds: any = await TENANT_KV.get(`tenant:${slug}:credentials`, 'json')
  const keyHash = creds?.apiKeyHash || ''
  const maskedKey = keyHash.length > 8 ? `${keyHash.slice(0, 4)}....${keyHash.slice(-4)}` : 'Not configured'

  // Load webhook config
  const webhook: any = await TENANT_KV.get(`tenant:${slug}:webhook`, 'json')
  const webhookUrl = webhook?.url || 'Not configured'
  const webhookEnabled = webhook?.enabled ?? false

  const planBadge = tenant.plan === 'pro'
    ? '<span class="badge badge-green">Pro</span>'
    : '<span class="badge badge-yellow">Free</span>'

  const body = `
    <div class="card">
      <h2>📋 Overview</h2>
      <div class="row"><span class="label">Name</span><span class="value">${escapeHtml(tenant.name)}</span></div>
      <div class="row"><span class="label">Slug</span><span class="value">${escapeHtml(slug)}</span></div>
      <div class="row"><span class="label">Plan</span><span class="value">${planBadge}</span></div>
      <div class="row"><span class="label">Created</span><span class="value">${new Date(tenant.createdAt).toLocaleDateString()}</span></div>
      <div class="row"><span class="label">Tenant ID</span><span class="value" style="font-family:monospace;font-size:12px">${escapeHtml(tenant.tenantId)}</span></div>
    </div>

    <div class="card">
      <h2>🔑 API Key</h2>
      <p style="font-family:monospace;font-size:13px;padding:8px;background:#0d1117;border-radius:6px;margin-bottom:8px">${escapeHtml(maskedKey)}</p>
      <button class="btn btn-secondary" hx-post="/tenant/api-key/regenerate" hx-confirm="This will invalidate the current key. Continue?" hx-target="#api-key-result">Regenerate</button>
      <span id="api-key-result" style="margin-left:8px;font-size:12px"></span>
    </div>

    <div class="card">
      <h2>📊 Usage (7 days)</h2>
      <div class="row"><span class="label">API calls</span><span class="value">—</span></div>
      <div class="row"><span class="label">Active missions</span><span class="value">—</span></div>
      <div class="row"><span class="label">Calculators used</span><span class="value">—</span></div>
      <p style="font-size:11px;color:#4a4d55;margin-top:8px">Usage tracking will appear here once data is available.</p>
    </div>

    <div class="card">
      <h2>🔗 Webhook</h2>
      <div class="row"><span class="label">URL</span><span class="value" style="font-family:monospace;font-size:12px">${escapeHtml(webhookUrl)}</span></div>
      <div class="row"><span class="label">Status</span><span class="value">${webhookEnabled ? '<span style="color:#3fb950">Enabled</span>' : '<span style="color:#8b949e">Disabled</span>'}</span></div>
      <button class="btn btn-secondary" style="margin-top:8px" onclick="window.location.href='/admin?tenant=${encodeURIComponent(slug)}'">Configure in Admin →</button>
    </div>

    <div class="card" style="border-color:#da3633">
      <h2 style="color:#da3633">⚠ Danger Zone</h2>
      <p style="font-size:12px;color:#8b949e;margin-bottom:8px">Deleting your tenant is permanent and cannot be undone.</p>
      <button class="btn btn-danger" hx-post="/tenant/delete" hx-confirm="This will permanently delete your tenant and all its data. Are you absolutely sure?" hx-target="#delete-result">Delete Tenant</button>
      <span id="delete-result" style="margin-left:8px;font-size:12px"></span>
    </div>`

  return c.html(layout('Dashboard', body))
})

/**
 * POST /tenant/api-key/regenerate — Generate a new API key (protected).
 * Returns the new key exactly once via HTMX fragment.
 */
router.post('/api-key/regenerate', requireSession(), async (c) => {
  const session = (c as any).get('tenantSession') as any
  const slug = session.slug
  const TENANT_KV = (c.env as any)?.TENANT_KV

  if (!TENANT_KV) {
    return c.html('<span style="color:#da3633">Tenant storage unavailable</span>')
  }

  const newKey = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const apiKeyHash = await hashPassword(newKey)

  // Load existing credentials to preserve password hash
  const existing: any = await TENANT_KV.get(`tenant:${slug}:credentials`, 'json')
  const credentials = {
    passwordHash: existing?.passwordHash || '',
    apiKeyHash,
    apiKeyPlaintext: newKey, // shown once
    createdAt: existing?.createdAt || new Date().toISOString(),
    regeneratedAt: new Date().toISOString(),
  }
  await TENANT_KV.put(`tenant:${slug}:credentials`, JSON.stringify(credentials))

  // Return the key as an HTMX fragment
  return c.html(`<div style="margin-top:8px;padding:8px;background:#0d1117;border:1px solid #3fb950;border-radius:6px">
    <p style="font-size:11px;color:#3fb950;margin-bottom:4px">New API key (shown once):</p>
    <code style="font-size:13px;font-family:monospace;word-break:break-all">${newKey}</code>
    <button class="btn btn-secondary" style="margin-top:4px" onclick="navigator.clipboard.writeText('${newKey}')">Copy</button>
  </div>`)
})

export { router as tenantDashboardRouter }

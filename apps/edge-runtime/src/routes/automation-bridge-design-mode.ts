/**
 * EdgeGDE — Automation Bridge Design Mode Route
 *
 * Serves the Design Mode page at GET /admin/automation-bridge.
 * Injects the Automation Bridge Design Mode client JS.
 *
 * Contract: IDD-016 v2.0.0
 */

import { Hono } from 'hono'
import { requireSession, SessionContext } from '../middleware/session'
import { envFromContext } from '../lib/env'

const router = new Hono()

// Design Mode page — visual element picker for admin console
router.get('/admin/automation-bridge', requireSession(), async (c: SessionContext) => {
  const session = c.get('tenantSession')
  const env = envFromContext(c)

  // Check if tenant has access to Design Mode (admin-only feature)
  const slug = session.slug
  const TENANT_KV = env.TENANT_KV

  if (!TENANT_KV) {
    return c.html(renderErrorPage('Tenant storage unavailable'))
  }

  const tenant: any = await TENANT_KV.get(`tenant:${slug}`, 'json')
  if (!tenant) {
    return c.html(renderErrorPage('Tenant not found'))
  }

  // Only allow on pro plan or explicit feature flag
  const hasAccess = tenant.plan === 'pro' || tenant.features?.automation_bridge_design_mode === true

  if (!hasAccess) {
    return c.html(renderErrorPage('Design Mode requires Pro plan or explicit feature flag'))
  }

  return c.html(renderDesignModePage(slug))
})

function renderDesignModePage(slug: string): string {
  const qs = `?tenant=${slug}`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Automation Bridge Design Mode — EdgeGDE Admin</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d1117;
      color: #e1e4e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      min-height: 100vh;
    }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav {
      background: #161b22;
      border-bottom: 1px solid #2d3140;
      padding: 12px 24px;
      display: flex; align-items: center; gap: 24px;
    }
    .nav h1 { font-size: 16px; color: #f0f6fc; }
    .nav a { font-size: 13px; padding: 4px 8px; border-radius: 4px; }
    .nav a.active { background: #1c2128; color: #f0f6fc; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .card { background: #161b22; border: 1px solid #2d3140; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card h2 { font-size: 15px; color: #f0f6fc; margin-bottom: 12px; }
    .card p { font-size: 13px; color: #8b949e; margin-bottom: 8px; }
    .btn { padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; display: inline-block; }
    .btn-primary { background: #238636; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary { background: #1c2128; color: #e1e4e8; border: 1px solid #2d3140; }
    .btn-secondary:hover { background: #2d3140; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
    .badge-green { background: #23863620; color: #3fb950; border: 1px solid #238636; }
    .badge-blue { background: #58a6ff20; color: #58a6ff; border: 1px solid #58a6ff; }
    .status { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #da3633; }
    .status-dot.connected { background: #238636; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1c2128; font-size: 13px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #8b949e; }
    .info-value { color: #e1e4e8; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
    .shortcut { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: #1c2128; border-radius: 4px; font-size: 11px; color: #8b949e; }
    .shortcut kbd { background: #0d1117; padding: 1px 4px; border-radius: 3px; border: 1px solid #2d3140; }
  </style>
</head>
<body>
  <nav class="nav">
    <h1>Automation Bridge Design Mode</h1>
    <a href="/tenant/dashboard${qs}">← Dashboard</a>
    <a href="/admin/automation-bridge${qs}" class="active">Design Mode</a>
  </nav>
  <div class="container">
    <div class="card">
      <h2>Visual Element Picker</h2>
      <p>Click the toggle below to enter Design Mode. Then click any element on the page to capture it and resolve against the live page via the Hermes State Engine Resolver.</p>

      <div class="status">
        <span class="status-dot" id="resolver-status"></span>
        <span id="resolver-status-text">Checking resolver…</span>
        <span class="badge badge-blue" id="resolver-port">Port: 9110</span>
      </div>

      <div class="grid">
        <div class="card">
          <h3>How it works</h3>
          <div class="info-row"><span class="info-label">1. Toggle</span><span class="info-value">Click "Design Mode: OFF" button (bottom-right)</span></div>
          <div class="info-row"><span class="info-label">2. Hover</span><span class="info-value">Move mouse — element highlights with blue border</span></div>
          <div class="info-row"><span class="info-label">3. Click</span><span class="info-value">Click element — captured via raw CDP (backendDOMNodeId)</span></div>
          <div class="info-row"><span class="info-label">4. Resolve</span><span class="info-value">Sent to resolver (MCP → HTTP fallback)</span></div>
          <div class="info-row"><span class="info-label">5. Result</span><span class="info-value">Confidence, fallback match, bug flags, verdict shown in panel</span></div>
        </div>
        <div class="card">
          <h3>Keyboard Shortcuts</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            <span class="shortcut"><kbd>Esc</kbd> Exit Design Mode</span>
            <span class="shortcut"><kbd>Space</kbd> Toggle Design Mode</span>
            <span class="shortcut"><kbd>C</kbd> Capture at cursor</span>
            <span class="shortcut"><kbd>R</kbd> Re-run last capture</span>
          </div>
          <div class="info-row" style="margin-top:12px;"><span class="info-label">Resolver</span><span class="info-value">http://127.0.0.1:9110 (MCP) / /api/v1/resolver/resolve (HTTP)</span></div>
          <div class="info-row"><span class="info-label">Contract</span><span class="info-value">IDD-016 v2.0.0</span></div>
          <div class="info-row"><span class="info-label">Tier</span><span class="info-value">T0.5 (Design Mode pick)</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Features</h3>
        <ul style="margin-left: 16px; color: #8b949e; line-height: 1.8; font-size: 13px;">
          <li>Exact <code>backendDOMNodeId</code> capture — confidence 1.0 on live nodes</li>
          <li>Structural fallback with <code>fallback_match</code> metadata when node is stale</li>
          <li>Radix portal support (portal elements captured correctly)</li>
          <li>Known-bug flags: <code>radix_portal_block</code>, <code>react_props_fallback</code>, <code>false_positive_save</code></li>
          <li>State-diff verification — success = state changed, not selector presence</li>
          <li>Idempotent replay via <code>request_id</code> (60s cache)</li>
          <li>Transport failover: MCP (streamable-HTTP) → direct HTTP with backoff</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- Automation Bridge Design Mode client JS -->
  <script src="/js/automation-bridge-design-mode.js"></script>
  <script>
    // Check resolver connectivity on load
    async function checkResolver() {
      const dot = document.getElementById('resolver-status')
      const text = document.getElementById('resolver-status-text')
      try {
        const res = await fetch('http://127.0.0.1:9110/health', { method: 'GET', signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          dot.classList.add('connected')
          text.textContent = 'Resolver connected'
        } else {
          text.textContent = 'Resolver responded with error'
        }
      } catch (e) {
        text.textContent = 'Resolver unreachable (start state-engine on :9110)'
      }
    }
    checkResolver()
    setInterval(checkResolver, 30000)
  </script>
</body>
</html>`
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Error — EdgeGDE</title>
<style>body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,sans-serif;padding:40px;text-align:center}
.card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:32px;max-width:400px;margin:0 auto}
.btn{padding:8px 16px;border-radius:6px;background:#238636;color:#fff;border:none;cursor:pointer;font-size:13px}
</style></head><body>
<div class="card"><h2 style="margin-bottom:16px;color:#f85149">Access Denied</h2>
<p style="margin-bottom:24px;color:#8b949e">${escapeHtml(message)}</p>
<a href="/tenant/dashboard" class="btn">← Back to Dashboard</a></div></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"')
}

export { router as automationBridgeDesignModeRouter }
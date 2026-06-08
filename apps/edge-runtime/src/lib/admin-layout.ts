/**
 * EdgeGDE — Shared Admin UI Helpers
 * Single source of truth for admin nav links.
 * Every admin page that renders nav must use this to prevent token/tenant drift.
 */

export function adminNav(tenantId?: string, token?: string, active?: string): string {
  const q = (tenantId ? '?tenant=' + encodeURIComponent(tenantId) : '') + (token ? '&token=' + encodeURIComponent(token) : '')
  const links = [
    { href: '/admin/kb' + q, label: 'Knowledge Base', id: 'kb' },
    { href: '/admin/rules' + q, label: 'Rules', id: 'rules' },
    { href: '/admin/site' + q, label: 'Site', id: 'site' },
    { href: '/admin/blueprints' + q, label: 'Blueprints', id: 'blueprints' },
  ]
  return links.map(l =>
    '<a href="' + l.href + '"' + (l.id === active ? ' style="background:#1c2128;color:#f0f6fc"' : '') + '>' + l.label + '</a>'
  ).join('')
}

export function pageShell(title: string, body: string, navHtml: string): string {
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
  .nav h1{font-size:16px;color:#f0f6fc;margin-right:8px}
  .nav a{font-size:13px;padding:4px 8px;border-radius:4px}
  .container{max-width:960px;margin:0 auto;padding:24px}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  .card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}
  .card .meta{font-size:11px;color:#8b949e}
  .empty{color:#4a4d55;text-align:center;padding:24px;font-size:13px}
  .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500}
  .btn-primary{background:#238636;color:#fff;border-color:#238636}
  .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
  .btn-sm{padding:3px 8px;font-size:10px}
  .btn:hover{opacity:0.85}
  label{font-size:12px;color:#8b949e;display:block;margin-bottom:2px}
  input,textarea,select{width:100%;padding:8px 12px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px;color:#8b949e;font-weight:500;border-bottom:1px solid #2d3140}
  td{padding:8px;border-bottom:1px solid #1c2128}
</style>
</head>
<body>
<nav class="nav"><h1>AFIRMICO Admin</h1>${navHtml}</nav>
<div class="container">${body}</div>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
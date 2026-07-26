/**
 * EdgeGDE — Admin Agent Config UI
 * Parent/child inheritance toggles, duplication, and effective config preview.
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { guardKV } from '../lib/kv'
import {
  cloneTenantConfig,
  ensureAgentProfile,
  getAgentProfile,
  getChildren,
  getEffectiveConfig,
  listActiveParents,
  propagateParent,
  rebuildTenantConfig,
  renderConfigPage,
  setChildInheritance,
  setParentInheritance,
} from '../lib/config-inheritance'

const configRouter = new Hono()

function pageLayout(title: string, body: string, tenantId: string, token?: string): string {
  const qs = `${tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''}${token ? `${tenantId ? '&' : '?'}token=${encodeURIComponent(token)}` : ''}`
  const nav = (href: string, label: string, active: boolean) =>
    `<a href="${href}${qs}"${active ? ' class="active"' : ''}>${label}</a>`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — EdgeGDE Admin</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
    .nav{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;gap:24px;align-items:center}
    .nav h1{font-size:16px;color:#f0f6fc}
    .nav a{font-size:13px;padding:4px 8px;border-radius:4px}
    .nav a.active{background:#1c2128;color:#f0f6fc}
    .container{max-width:960px;margin:0 auto;padding:24px}
    .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
    .card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}
    .card h4{font-size:13px;color:#f0f6fc;margin:12px 0 8px}
    .meta{font-size:11px;color:#8b949e;margin-bottom:8px}
    .entry{padding:8px 0;border-bottom:1px solid #1c2128;font-size:13px}
    .entry:last-child{border:none}
    .entry .val{color:#e1e4e8;margin-bottom:2px}
    .entry .key{font-size:11px;color:#8b949e}
    .empty{color:#4a4d55;text-align:center;padding:24px;font-size:13px}
    .btn{padding:6px 14px;border-radius:6px;border:1px solid #2d3140;cursor:pointer;font-size:12px;font-weight:500}
    .btn-primary{background:#238636;color:#fff;border-color:#238636}
    .btn-danger{background:#da3633;color:#fff;border-color:#da3633}
    .btn-sm{padding:3px 8px;font-size:10px}
    .btn:hover{opacity:.85}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    input[type=text], select{width:100%;padding:6px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e1e4e8;margin-top:6px}
    code{color:#f0f6fc;background:#0d1117;padding:1px 4px;border-radius:4px}
  </style>
</head>
<body>
  <nav class="nav">
    <h1>EdgeGDE Admin</h1>
    ${nav('/admin/kb', 'Knowledge Base', title === 'Agent Config')}
    ${nav('/admin/config', 'Config', title === 'Agent Config')}
    ${nav('/admin/rules', 'Rules', title === 'Rules')}
    ${nav('/admin/site', 'Site', title === 'Site')}
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

function errorHtml(message: string): string {
  return `<div class="card" style="border-color:#da3633"><h3>Config error</h3><div style="color:#f85149">${message}</div></div>`
}

function redirectUrl(c: any, tenantId: string): string {
  const token = c.req.query('token')
  return `/admin/config?tenant=${encodeURIComponent(tenantId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
}

configRouter.get('/', async (c) => {
  const tenantId = c.req.query('tenant') || 'alpha-broker-01'
  const token = c.req.query('token')
  const kv = guardKV(envFromContext(c).TENANT_KV)
  if (!kv) return c.html(errorHtml('KV binding not available'), 500)
  try {
    const profile = await ensureAgentProfile(kv, tenantId)
    const parents = await listActiveParents(kv, tenantId)
    const children = await getChildren(kv, tenantId)
    const effective = await getEffectiveConfig(kv, tenantId)
    return c.html(pageLayout('Agent Config', renderConfigPage(profile, parents, children, effective, token), tenantId, token))
  } catch (err: any) {
    return c.html(errorHtml(err.message), 500)
  }
})

configRouter.post('/parent-toggle', async (c) => {
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.html(errorHtml('tenant query param required'), 400)
  const fd = await c.req.formData()
  const enabled = (fd.get('enabled') as string | null) === 'on' || c.req.query('enabled') === 'true'
  try {
    await setParentInheritance(envFromContext(c).TENANT_KV, tenantId, enabled)
    return c.redirect(redirectUrl(c, tenantId))
  } catch (err: any) {
    return c.html(errorHtml(err.message), 500)
  }
})

configRouter.post('/child-toggle', async (c) => {
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.html(errorHtml('tenant query param required'), 400)
  const fd = await c.req.formData()
  const enabled = (fd.get('enabled') as string | null) === 'on' || c.req.query('enabled') === 'true'
  const parentTenantId = (fd.get('parent') as string | null) || c.req.query('parent') || undefined
  try {
    await setChildInheritance(envFromContext(c).TENANT_KV, tenantId, enabled, parentTenantId)
    return c.redirect(redirectUrl(c, tenantId))
  } catch (err: any) {
    return c.html(errorHtml(err.message), 500)
  }
})

configRouter.post('/clone', async (c) => {
  const fd = await c.req.formData()
  const sourceTenantId = (fd.get('sourceTenant') as string | null) || c.req.query('sourceTenant') || ''
  const targetTenantId = (fd.get('tenant') as string | null) || c.req.query('tenant') || ''
  const targetName = (fd.get('name') as string | null) || undefined
  const parentLink = ['on', 'true', '1', 'yes'].includes(((fd.get('parentLink') as string | null) || '').toLowerCase())
  if (!sourceTenantId || !targetTenantId) return c.html(errorHtml('sourceTenant and tenant are required'), 400)
  try {
    const result = await cloneTenantConfig(envFromContext(c).TENANT_KV, envFromContext(c), {
      sourceTenantId,
      targetTenantId,
      targetName,
      parentLink,
    })
    return c.html(pageLayout('Agent Config', `
      <div class="card" style="border-color:#238636">
        <h3>Cloned config</h3>
        <div class="entry"><div class="key">source</div><div class="val">${sourceTenantId}</div></div>
        <div class="entry"><div class="key">target</div><div class="val">${targetTenantId}</div></div>
        <div class="entry"><div class="key">parentLink</div><div class="val">${parentLink ? 'yes' : 'no'}</div></div>
        <div class="entry"><div class="key">KB topics copied</div><div class="val">${result.kbTopicsCopied}</div></div>
        <div class="entry"><div class="key">rules copied</div><div class="val">${result.rulesCopied}</div></div>
        <div class="entry"><div class="key">effectiveRevision</div><div class="val">${result.effectiveRevision}</div></div>
      </div>
      <p><a href="${redirectUrl(c, targetTenantId)}">Open ${targetTenantId} config</a></p>
    `, targetTenantId, c.req.query('token')))
  } catch (err: any) {
    return c.html(errorHtml(err.message), 500)
  }
})

configRouter.post('/rebuild', async (c) => {
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.html(errorHtml('tenant query param required'), 400)
  try {
    const result = await rebuildTenantConfig(envFromContext(c).TENANT_KV, envFromContext(c), tenantId)
    return c.html(pageLayout('Agent Config', `
      <div class="card" style="border-color:#238636"><h3>Rebuilt config</h3>
      <div class="entry"><div class="key">tenant</div><div class="val">${tenantId}</div></div>
      <div class="entry"><div class="key">effectiveRevision</div><div class="val">${result.effectiveRevision}</div></div>
      <div class="entry"><div class="key">propagatedChildren</div><div class="val">${result.propagatedChildren.length}</div></div></div>
    `, tenantId, c.req.query('token')))
  } catch (err: any) {
    return c.html(errorHtml(err.message), 500)
  }
})

configRouter.post('/propagate', async (c) => {
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.html(errorHtml('tenant query param required'), 400)
  try {
    const result = await propagateParent(envFromContext(c).TENANT_KV, envFromContext(c), tenantId)
    return c.html(pageLayout('Agent Config', `
      <div class="card" style="border-color:#238636"><h3>Propagated parent</h3>
      <div class="entry"><div class="key">parent</div><div class="val">${tenantId}</div></div>
      <div class="entry"><div class="key">children</div><div class="val">${result.propagatedChildren.length}</div></div></div>
    `, tenantId, c.req.query('token')))
  } catch (err: any) {
    return c.html(errorHtml(err.message), 500)
  }
})

configRouter.get('/json', async (c) => {
  const tenantId = c.req.query('tenant')
  if (!tenantId) return c.json({ error: 'tenant query param required' }, 400)
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const profile = await getAgentProfile(kv, tenantId)
  const effective = await getEffectiveConfig(kv, tenantId)
  const children = await getChildren(kv, tenantId)
  return c.json({ profile, effective, children })
})

export { configRouter }

/**
 * EdgeGDE — Multi-Tenant Admin Dashboard API
 *
 * Tenant list, detail, sync, and soft-delete endpoints.
 * Integrates with the config inheritance system (PR #6, #9).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { guardKV } from '../lib/kv'
import { guardDB } from '../lib/db'
import {
  getAgentProfile,
  getChildren,
  getEffectiveConfig,
  getConfigOverrides,
  listActiveParents,
  propagateParent,
  rebuildTenantConfig,
  setParentInheritance,
} from '../lib/config-inheritance'
import { adminNav, pageShell } from '../lib/admin-layout'

export const adminTenantRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface TenantSummary {
  id: string
  name: string
  slug: string
  hasParent: boolean
  parentTenantId?: string | null
  childCount: number
  createdAt: string
  plan: string
  status: 'active' | 'inactive' | 'needs-sync'
  parentInheritanceEnabled: boolean
  childInheritanceEnabled: boolean
}

interface TenantDetail extends TenantSummary {
  config: Record<string, any>
  parentConfig: Record<string, any> | null
  inheritedFields: string[]
  children: Array<{
    tenantId: string
    name: string
    childInheritanceEnabled: boolean
  }>
  parentProfile: {
    tenantId: string
    name: string
  } | null
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function escapeHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function statusBadge(status: string): string {
  const labels: Record<string, string> = {
    active: '<span class="badge badge-active">active</span>',
    inactive: '<span class="badge badge-inactive">inactive</span>',
    'needs-sync': '<span class="badge badge-needs-sync">needs-sync</span>',
  }
  return labels[status] || `<span class="badge badge-inactive">${escapeHtml(status)}</span>`
}

function tenantListHtml(tenants: TenantSummary[], token?: string): string {
  const t = token ? `&token=${token}` : ''
  if (!tenants.length) return '<div class="empty">No tenants found.</div>'

  const filterInput = `
    <div class="filters" style="margin-bottom:12px">
      <input type="text" id="tenant-search" placeholder="Search by name or id..." class="search-input">
      <select id="status-filter" class="search-input" style="width:auto">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="needs-sync">Needs Sync</option>
      </select>
      <span class="btn btn-primary" id="sync-all-btn" onclick="syncAllTenants()">🔄 Sync All</span>
    </div>
    <div id="sync-all-result" style="font-size:12px;margin-bottom:8px"></div>`

  const rows = tenants.map(t => {
    const syncBtn = t.status === 'needs-sync' || t.parentInheritanceEnabled
      ? `<span class="btn btn-warning btn-sm sync-btn" data-tenant="${escapeHtml(t.id)}">Sync</span>`
      : ''
    return `<tr class="tenant-row" data-status="${escapeHtml(t.status)}" data-search="${(t.name + ' ' + t.id + ' ' + t.slug).toLowerCase()}">
      <td><a href="/admin/tenants/${escapeHtml(t.id)}?token=${escapeHtml(token || '')}">${escapeHtml(t.name)}</a></td>
      <td><code>${escapeHtml(t.id)}</code></td>
      <td>${escapeHtml(t.slug)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.hasParent ? `<span class="parent-badge">${escapeHtml(t.parentTenantId || '')}</span>` : '<span class="muted">—</span>'}</td>
      <td>${t.childCount}</td>
      <td>${new Date(t.createdAt).toLocaleDateString()}</td>
      <td style="display:flex;gap:4px">
        <a class="btn btn-sm" href="/admin/tenants/${escapeHtml(t.id)}?token=${escapeHtml(token || '')}">View</a>
        <a class="btn btn-sm" href="/admin/tenants/${escapeHtml(t.id)}/config?token=${escapeHtml(token || '')}">Config</a>
        ${syncBtn}
      </td>
    </tr>`
  }).join('\n')

  return `
    ${filterInput}
    <div class="card" style="overflow-x:auto">
      <table id="tenant-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Slug</th>
            <th>Status</th>
            <th>Parent</th>
            <th>Children</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <script>
      // Client-side search/filter
      var searchInput = document.getElementById('tenant-search');
      var statusFilter = document.getElementById('status-filter');
      if (searchInput && statusFilter) {
        function filterTable() {
          var q = (searchInput.value || '').toLowerCase();
          var st = statusFilter.value;
          document.querySelectorAll('.tenant-row').forEach(function(row) {
            var match = !q || row.dataset.search.indexOf(q) !== -1;
            var matchStatus = !st || row.dataset.status === st;
            row.style.display = match && matchStatus ? '' : 'none';
          });
        }
        searchInput.addEventListener('input', filterTable);
        statusFilter.addEventListener('change', filterTable);
      }

      // Sync individual tenant
      document.querySelectorAll('.sync-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var tid = this.dataset.tenant;
          var row = this.closest('tr');
          this.textContent = '...';
          fetch('/admin/tenants/' + encodeURIComponent(tid) + '/sync?token=${escapeHtml(token || '')}', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) { alert('Sync error: ' + data.error); }
              else {
                btn.textContent = '✔';
                btn.style.borderColor = '#238636';
                var badge = row.querySelector('.badge');
                if (badge) { badge.textContent = 'active'; badge.className = 'badge badge-active'; }
                row.dataset.status = 'active';
              }
            })
            .catch(function(e) { btn.textContent = '✗'; alert('Sync failed: ' + e.message); });
        });
      });

      // Sync all tenants
      window.syncAllTenants = function() {
        var btns = document.querySelectorAll('.sync-btn');
        if (btns.length === 0) {
          document.getElementById('sync-all-result').textContent = 'No tenants need sync.';
          return;
        }
        var result = document.getElementById('sync-all-result');
        result.textContent = 'Syncing ' + btns.length + ' tenant(s)...';
        var done = 0, fail = 0;
        btns.forEach(function(btn) {
          var tid = btn.dataset.tenant;
          fetch('/admin/tenants/' + encodeURIComponent(tid) + '/sync?token=${escapeHtml(token || '')}', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) { fail++; }
              else { done++; btn.textContent = '✔'; btn.style.borderColor = '#238636'; }
              result.textContent = 'Synced ' + done + ', failed ' + fail + ' / ' + btns.length;
            })
            .catch(function() { fail++; result.textContent = 'Synced ' + done + ', failed ' + fail + ' / ' + btns.length; });
        });
      };
    </script>`
}

function tenantDetailHtml(detail: TenantDetail, token?: string): string {
  const t = token ? `&token=${token}` : ''
  const configKeys = detail.config ? Object.keys(detail.config).filter(k => k !== 'effectiveRevision' && k !== 'updatedAt') : []
  const parentConfigKeys = detail.parentConfig ? Object.keys(detail.parentConfig).filter(k => k !== 'effectiveRevision' && k !== 'updatedAt') : []

  const childrenHtml = detail.children.length
    ? `<ul>${detail.children.map(c => `<li><a href="/admin/tenants/${escapeHtml(c.tenantId)}?token=${escapeHtml(token || '')}">${escapeHtml(c.name)} (${escapeHtml(c.tenantId)})</a></li>`).join('')}</ul>`
    : '<div class="empty">No children</div>'

  const inheritedHtml = detail.inheritedFields.length
    ? `<ul>${detail.inheritedFields.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>`
    : '<div class="empty">No inherited fields</div>'

  return `
    <div class="card">
      <h3>${escapeHtml(detail.name)}</h3>
      <div class="meta">ID: <code>${escapeHtml(detail.id)}</code> · Slug: <code>${escapeHtml(detail.slug)}</code></div>
      <div class="meta">Status: ${statusBadge(detail.status)}</div>
      <div class="meta">Plan: ${escapeHtml(detail.plan)} · Created: ${new Date(detail.createdAt).toLocaleString()}</div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <span class="btn btn-primary" onclick="syncTenant()">🔄 Sync Now</span>
        <span class="btn btn-danger" onclick="deleteTenant()">🗑️ Delete Tenant</span>
      </div>
      <div id="detail-action-result" style="margin-top:8px;font-size:12px"></div>
    </div>

    <div class="card">
      <h3>Parent config</h3>
      ${detail.parentProfile
        ? `<div class="meta">Parent: <a href="/admin/tenants/${escapeHtml(detail.parentProfile.tenantId)}?token=${escapeHtml(token || '')}">${escapeHtml(detail.parentProfile.name)} (${escapeHtml(detail.parentProfile.tenantId)})</a></div>`
        : '<div class="empty">No parent configured</div>'}
      <h4 style="margin-top:12px;font-size:13px">Parent config keys</h4>
      ${parentConfigKeys.length
        ? `<ul>${parentConfigKeys.map(k => `<li><code>${escapeHtml(k)}</code></li>`).join('')}</ul>`
        : '<div class="empty">No parent config</div>'}
    </div>

    <div class="card">
      <h3>Inheritance</h3>
      <div class="meta">Parent inheritance: ${detail.parentInheritanceEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
      <div class="meta">Child inheritance: ${detail.childInheritanceEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
      <h4 style="margin-top:12px;font-size:13px">Inherited fields from parent</h4>
      ${inheritedHtml}
    </div>

    <div class="card">
      <h3>Children (${detail.children.length})</h3>
      ${childrenHtml}
    </div>

    <div class="card">
      <h3>Effective config</h3>
      <div class="meta">effectiveRevision: <code>${escapeHtml(detail.config?.effectiveRevision || '—')}</code></div>
      ${configKeys.length
        ? `<pre style="background:#0f1117;padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;margin-top:8px">${escapeHtml(JSON.stringify(detail.config, null, 2).slice(0, 4000))}</pre>`
        : '<div class="empty">No config</div>'}
    </div>

    <script>
      function syncTenant() {
        var result = document.getElementById('detail-action-result');
        result.textContent = 'Syncing...';
        result.style.color = '#8b949e';
        fetch('/admin/tenants/${escapeHtml(detail.id)}/sync?token=${escapeHtml(token || '')}', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) { result.textContent = 'Error: ' + data.error; result.style.color = '#da3633'; }
            else { result.textContent = '✅ Sync complete (revision: ' + data.effectiveRevision + ', children: ' + (data.propagatedChildren || []).length + ')'; result.style.color = '#3fb950'; }
          })
          .catch(function(e) { result.textContent = 'Error: ' + e.message; result.style.color = '#da3633'; });
      }
      function deleteTenant() {
        if (!confirm('Are you sure you want to soft-delete tenant "${escapeHtml(detail.name)}"?')) return;
        var result = document.getElementById('detail-action-result');
        result.textContent = 'Deleting...';
        result.style.color = '#8b949e';
        fetch('/admin/tenants/${escapeHtml(detail.id)}?token=${escapeHtml(token || '')}', { method: 'DELETE' })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) { result.textContent = 'Error: ' + data.error; result.style.color = '#da3633'; }
            else { result.textContent = '✅ Tenant deleted'; result.style.color = '#f85149'; window.location.href = '/admin/tenants?token=${escapeHtml(token || '')}'; }
          })
          .catch(function(e) { result.textContent = 'Error: ' + e.message; result.style.color = '#da3633'; });
      }
    </script>`
}

// ═══════════════════════════════════════════════════════════════════════════
// KV-backed tenant discovery helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List all tenant IDs by scanning D1 (preferred) or falling back to agent profiles in KV.
 */
async function discoverTenantIds(kv: ReturnType<typeof guardKV>, db: any): Promise<string[]> {
  // Try D1 first
  if (db && typeof db.prepare === 'function') {
    try {
      const { results } = await db.prepare(
        'SELECT slug, tenant_id FROM tenants ORDER BY created_at DESC'
      ).all() as { results?: Array<{ slug: string; tenant_id: string }> }
      if (results && results.length > 0) {
        return results.map(r => r.tenant_id || r.slug)
      }
    } catch { /* fall through to KV */ }
  }

  // Fallback: scan KV for agent profiles (expensive but works without D1)
  // We use the parent index + individual profile reads
  const parentIds = ((await kv.get('global:agent-parent-index', 'json')) || []) as string[]
  const allIds = new Set<string>(parentIds)

  // Try to find more tenants by scanning child indices
  for (const pid of parentIds) {
    const childIds = ((await kv.get(`global:agent-children-index:${pid}`, 'json')) || []) as string[]
    for (const cid of childIds) allIds.add(cid)
  }

  return Array.from(allIds)
}

/**
 * Build a TenantSummary from a tenant ID by reading KV agent profile + tenant record.
 */
async function buildTenantSummary(
  kv: ReturnType<typeof guardKV>,
  tenantId: string,
): Promise<TenantSummary> {
  const profile = await getAgentProfile(kv, tenantId)
  const children = profile?.parentInheritanceEnabled ? await getChildren(kv, tenantId) : []

  // Determine status
  let status: TenantSummary['status'] = 'active'
  if (!profile) {
    status = 'inactive'
  } else if (profile.childInheritanceEnabled && profile.parentTenantId) {
    // Check if parent config has changed — needs sync
    const parentProfile = await getAgentProfile(kv, profile.parentTenantId)
    if (parentProfile && !parentProfile.parentInheritanceEnabled) {
      status = 'needs-sync'
    }
  }

  return {
    id: tenantId,
    name: profile?.name || tenantId,
    slug: tenantId,
    hasParent: !!(profile?.childInheritanceEnabled && profile?.parentTenantId),
    parentTenantId: profile?.parentTenantId || null,
    childCount: children.length,
    createdAt: new Date().toISOString(),
    plan: 'free',
    status,
    parentInheritanceEnabled: profile?.parentInheritanceEnabled || false,
    childInheritanceEnabled: profile?.childInheritanceEnabled || false,
  }
}

function computeInheritedFields(config: Record<string, any>, parentConfig: Record<string, any> | null): string[] {
  if (!parentConfig) return []
  const inherited: string[] = []
  for (const key of Object.keys(parentConfig)) {
    if (key === 'effectiveRevision' || key === 'updatedAt') continue
    if (JSON.stringify(config[key]) === JSON.stringify(parentConfig[key])) {
      inherited.push(key)
    }
  }
  return inherited
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/tenants — list all tenants
// ═══════════════════════════════════════════════════════════════════════════

adminTenantRouter.get('/', async (c) => {
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const db = envFromContext(c).DB
  const token = c.req.query('token')

  try {
    const tenantIds = await discoverTenantIds(kv, db)
    const summaries: TenantSummary[] = []

    for (const id of tenantIds) {
      try {
        const summary = await buildTenantSummary(kv, id)
        summaries.push(summary)
      } catch {
        // Skip tenants that fail to load
      }
    }

    // If no tenants found via index, try reading known tenant IDs from D1
    if (summaries.length === 0 && db && typeof db.prepare === 'function') {
      try {
        const { results } = await db.prepare(
          `SELECT slug, tenant_id, name, plan, created_at FROM tenants ORDER BY created_at DESC`
        ).all() as { results?: Array<{ slug: string; tenant_id: string; name: string; plan: string; created_at: string }> }
        if (results) {
          for (const row of results) {
            const tid = row.tenant_id || row.slug
            const profile = await getAgentProfile(kv, tid)
            summaries.push({
              id: tid,
              name: row.name || tid,
              slug: row.slug,
              hasParent: !!(profile?.childInheritanceEnabled && profile?.parentTenantId),
              parentTenantId: profile?.parentTenantId || null,
              childCount: profile?.parentInheritanceEnabled ? (await getChildren(kv, tid)).length : 0,
              createdAt: row.created_at || new Date().toISOString(),
              plan: row.plan || 'free',
              status: profile ? 'active' : 'inactive',
              parentInheritanceEnabled: profile?.parentInheritanceEnabled || false,
              childInheritanceEnabled: profile?.childInheritanceEnabled || false,
            })
          }
        }
      } catch { /* give up */ }
    }

    const accept = c.req.header('Accept') || ''
    const wantsJson = accept.includes('application/json') || c.req.query('format') === 'json'

    if (wantsJson) {
      return c.json({ tenants: summaries })
    }

    const body = `
      <h2 style="margin-bottom:12px">Tenant Management</h2>
      <p style="color:#8b949e;font-size:13px;margin-bottom:16px">
        ${summaries.length} tenant(s) · <a href="/admin/tenants?format=json${token ? `&token=${token}` : ''}">View as JSON</a>
      </p>
      ${tenantListHtml(summaries, token)}`

    const nav = adminNav(undefined, token, 'tenants') + `
      <a href="/admin/tenants?token=${escapeHtml(token || '')}" style="background:#1c2128;color:#f0f6fc">Tenants</a>`

    return c.html(pageShell('Tenants', body, nav))
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/tenants/:id — full tenant detail (JSON + HTML)
// ═══════════════════════════════════════════════════════════════════════════

adminTenantRouter.get('/:id', async (c) => {
  const tenantId = c.req.param('id')
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const token = c.req.query('token')

  try {
    const profile = await getAgentProfile(kv, tenantId)
    if (!profile) {
      return c.json({ error: `Tenant "${tenantId}" not found` }, 404)
    }

    const config = await getEffectiveConfig(kv, tenantId)
    const children = await getChildren(kv, tenantId)

    // Parent config and profile
    let parentProfile = null
    let parentConfig: Record<string, any> | null = null
    if (profile.childInheritanceEnabled && profile.parentTenantId) {
      parentProfile = await getAgentProfile(kv, profile.parentTenantId)
      parentConfig = parentProfile ? await getEffectiveConfig(kv, profile.parentTenantId) : null
    }

    const inheritedFields = computeInheritedFields(config, parentConfig)

    // Status
    let status: TenantSummary['status'] = 'active'
    if (profile.childInheritanceEnabled && profile.parentTenantId) {
      const pp = await getAgentProfile(kv, profile.parentTenantId)
      if (pp && !pp.parentInheritanceEnabled) {
        status = 'needs-sync'
      }
    }

    const detail: TenantDetail = {
      id: tenantId,
      name: profile.name,
      slug: tenantId,
      hasParent: !!(profile.childInheritanceEnabled && profile.parentTenantId),
      parentTenantId: profile.parentTenantId || null,
      childCount: children.length,
      createdAt: new Date().toISOString(),
      plan: 'free',
      status,
      parentInheritanceEnabled: profile.parentInheritanceEnabled,
      childInheritanceEnabled: profile.childInheritanceEnabled,
      config,
      parentConfig,
      inheritedFields,
      children: children.map(c => ({
        tenantId: c.tenantId,
        name: c.name,
        childInheritanceEnabled: c.childInheritanceEnabled,
      })),
      parentProfile: parentProfile
        ? { tenantId: parentProfile.tenantId, name: parentProfile.name }
        : null,
    }

    const accept = c.req.header('Accept') || ''
    const wantsJson = accept.includes('application/json') || c.req.query('format') === 'json'

    if (wantsJson) {
      return c.json({ tenant: detail })
    }

    const body = tenantDetailHtml(detail, token)
    const nav = adminNav(undefined, token, 'tenants') + `
      <a href="/admin/tenants?token=${escapeHtml(token || '')}">Tenants</a>
      <a href="/admin/tenants/${escapeHtml(tenantId)}?token=${escapeHtml(token || '')}" style="background:#1c2128;color:#f0f6fc">${escapeHtml(profile.name)}</a>`

    return c.html(pageShell(`Tenant: ${profile.name}`, body, nav))
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/tenants/:id/sync — trigger config sync from parent to children
// ═══════════════════════════════════════════════════════════════════════════

adminTenantRouter.post('/:id/sync', async (c) => {
  const tenantId = c.req.param('id')
  const kv = guardKV(envFromContext(c).TENANT_KV)

  try {
    const profile = await getAgentProfile(kv, tenantId)
    if (!profile) {
      return c.json({ error: `Tenant "${tenantId}" not found` }, 404)
    }

    // If this tenant is a parent, propagate to children
    let result
    const env = envFromContext(c)
    if (profile.parentInheritanceEnabled) {
      result = await propagateParent(kv, env, tenantId)
    } else if (profile.childInheritanceEnabled && profile.parentTenantId) {
      // Child: rebuild from parent
      result = await rebuildTenantConfig(kv, env, tenantId)
    } else {
      // Standalone: rebuild self
      result = await rebuildTenantConfig(kv, env, tenantId)
    }

    return c.json({
      success: true,
      tenantId,
      effectiveRevision: result.effectiveRevision,
      propagatedChildren: result.propagatedChildren || [],
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /admin/tenants/:id — soft-delete a tenant
// ═══════════════════════════════════════════════════════════════════════════

adminTenantRouter.delete('/:id', async (c) => {
  const tenantId = c.req.param('id')
  const rawKV = envFromContext(c).TENANT_KV
  if (!rawKV) return c.json({ error: 'TENANT_KV not available' }, 500)
  const kv = guardKV(rawKV)

  try {
    const profile = await getAgentProfile(kv, tenantId)
    if (!profile) {
      return c.json({ error: `Tenant "${tenantId}" not found` }, 404)
    }

    // Soft-delete: set a deleted marker in KV
    await kv.put(
      `tenant:${tenantId}:deleted`,
      JSON.stringify({
        deletedAt: Date.now(),
        tenantId,
        name: profile.name,
      }),
      { tenantId },
    )

    // Disable inheritance to detach from parent/child chains
    if (profile.parentInheritanceEnabled) {
      await setParentInheritance(rawKV, tenantId, false)
    }

    // Mark tenant record as deleted if D1 is available
    const db = envFromContext(c).DB
    if (db && typeof db.prepare === 'function') {
      try {
        await db.prepare(
          `UPDATE tenants SET plan = 'deleted', deleted_at = ? WHERE tenant_id = ?`
        ).bind(Math.floor(Date.now() / 1000), tenantId).run()
      } catch {
        // D1 update is best-effort
      }
    }

    return c.json({
      success: true,
      tenantId,
      deleted: true,
      message: `Tenant "${profile.name}" has been soft-deleted.`,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

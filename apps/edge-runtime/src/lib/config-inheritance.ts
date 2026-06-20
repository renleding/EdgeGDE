/**
 * EdgeGDE — Agent config inheritance and duplication service.
 *
 * Runtime reads tenant:{tenantId}:chat:config. This module keeps that key as
 * the effective merged config for independent, cloned, and child agents.
 */

import type { TenantCtx } from '../middleware/tenant-context'
import type { TenantConfig } from '../lib/tenant'
import { guardDB } from './db'
import { guardKV } from './kv'

export interface AgentProfile {
  tenantId: string
  name: string
  parentInheritanceEnabled: boolean
  childInheritanceEnabled: boolean
  parentTenantId?: string | null
  updatedAt: number
  sourceRef: string
}

export interface CloneOptions {
  sourceTenantId: string
  targetTenantId: string
  targetName?: string
  parentLink?: boolean
}

export interface RebuildResult {
  tenantId: string
  effectiveRevision: string
  parentTenantId?: string | null
  childInheritanceEnabled: boolean
  propagatedChildren: Array<{ tenantId: string; effectiveRevision: string }>
}

const DEFAULT_TOPICS = ['rates', 'products', 'policy', 'fees', 'compliance', 'general']
const PARENT_INDEX_KEY = 'global:agent-parent-index'
const CHILD_INDEX_PREFIX = 'global:agent-children-index:'

function tenantCtx(tenantId: string): TenantCtx {
  return { tenantId }
}

function tenantKey(tenantId: string, suffix: string): string {
  return `tenant:${tenantId}:${suffix}`
}

function now(): number {
  return Date.now()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepMerge(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...(base || {}) }
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined) continue
    if (isPlainObject(out[key]) && isPlainObject(value)) {
      out[key] = deepMerge(out[key], value)
    } else {
      out[key] = deepClone(value)
    }
  }
  return out
}

function titleFromTenant(tenantId: string): string {
  return tenantId
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function stableRevision(tenantId: string, effective: Record<string, any>): string {
  const str = JSON.stringify(effective)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return `${tenantId}:${Math.abs(hash).toString(36)}`
}

async function getJson(kv: ReturnType<typeof guardKV>, tenantId: string, suffix: string): Promise<any> {
  const raw = await kv.get(tenantKey(tenantId, suffix), tenantCtx(tenantId))
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

async function putJson(kv: ReturnType<typeof guardKV>, tenantId: string, suffix: string, value: string | object): Promise<void> {
  await kv.put(tenantKey(tenantId, suffix), typeof value === 'string' ? value : JSON.stringify(value), tenantCtx(tenantId))
}

async function deleteKey(kv: ReturnType<typeof guardKV>, tenantId: string, suffix: string): Promise<void> {
  await kv.del(tenantKey(tenantId, suffix), tenantCtx(tenantId))
}

async function getGlobalJson(kv: ReturnType<typeof guardKV>, key: string): Promise<any> {
  const raw = await kv.get(key)
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

async function putGlobalJson(kv: ReturnType<typeof guardKV>, key: string, value: string | object): Promise<void> {
  await kv.put(key, typeof value === 'string' ? value : JSON.stringify(value))
}

async function getTenantRecord(kv: ReturnType<typeof guardKV>, tenantId: string): Promise<TenantConfig | null> {
  return getJson(kv, tenantId, '')
}

async function ensureTenantRecord(kv: ReturnType<typeof guardKV>, tenantId: string, name?: string): Promise<TenantConfig> {
  const existing = await getTenantRecord(kv, tenantId)
  if (existing) return existing
  const record: TenantConfig = {
    tenantId,
    slug: tenantId,
    name: name || titleFromTenant(tenantId),
    createdAt: new Date().toISOString(),
    plan: 'free',
  }
  await putJson(kv, tenantId, '', record)
  return record
}

export async function getAgentProfile(kv: ReturnType<typeof guardKV>, tenantId: string): Promise<AgentProfile | null> {
  return getJson(kv, tenantId, 'agent:profile')
}

export async function ensureAgentProfile(kv: ReturnType<typeof guardKV>, tenantId: string, name?: string): Promise<AgentProfile> {
  const existing = await getAgentProfile(kv, tenantId)
  if (existing) return existing
  const profile: AgentProfile = {
    tenantId,
    name: name || titleFromTenant(tenantId),
    parentInheritanceEnabled: false,
    childInheritanceEnabled: false,
    parentTenantId: null,
    updatedAt: now(),
    sourceRef: 'auto-created',
  }
  await putJson(kv, tenantId, 'agent:profile', profile)
  return profile
}

export async function getConfigOverrides(kv: ReturnType<typeof guardKV>, tenantId: string): Promise<Record<string, any>> {
  return (await getJson(kv, tenantId, 'config:overrides')) || {}
}

export async function getChatConfig(kv: ReturnType<typeof guardKV>, tenantId: string): Promise<Record<string, any>> {
  return (await getJson(kv, tenantId, 'chat:config')) || {}
}

export async function getEffectiveConfig(kv: ReturnType<typeof guardKV>, tenantId: string): Promise<Record<string, any>> {
  return (await getJson(kv, tenantId, 'config:effective')) || (await getChatConfig(kv, tenantId)) || {}
}

export async function rebuildEffectiveConfig(kv: ReturnType<typeof guardKV>, tenantId: string): Promise<Record<string, any>> {
  const profile = await ensureAgentProfile(kv, tenantId)
  let effective: Record<string, any>

  if (profile.childInheritanceEnabled && profile.parentTenantId) {
    const parentProfile = await getAgentProfile(kv, profile.parentTenantId)
    const parentConfig = parentProfile?.parentInheritanceEnabled ? await getEffectiveConfig(kv, profile.parentTenantId) : null
    if (parentConfig) {
      const overrides = await getConfigOverrides(kv, tenantId)
      effective = deepMerge(parentConfig, overrides)
    } else {
      effective = await getChatConfig(kv, tenantId)
    }
  } else {
    effective = await getChatConfig(kv, tenantId)
  }

  if (!effective || Object.keys(effective).length === 0) {
    effective = {}
  }

  const revision = stableRevision(tenantId, effective)
  await putJson(kv, tenantId, 'config:effective', { ...effective, effectiveRevision: revision, updatedAt: now() })
  await putJson(kv, tenantId, 'chat:config', { ...effective, effectiveRevision: revision, updatedAt: now() })
  return { ...effective, effectiveRevision: revision, updatedAt: now() }
}

export async function rebuildTenantConfig(rawKV: any, env: any, tenantId: string): Promise<RebuildResult> {
  const kv = guardKV(rawKV)
  const effective = await rebuildEffectiveConfig(kv, tenantId)
  const profile = await ensureAgentProfile(kv, tenantId)
  const propagatedChildren: Array<{ tenantId: string; effectiveRevision: string }> = []

  if (profile.parentInheritanceEnabled) {
    const children = await getChildren(kv, tenantId)
    for (const child of children) {
      const childEffective = await rebuildEffectiveConfig(kv, child.tenantId)
      propagatedChildren.push({
        tenantId: child.tenantId,
        effectiveRevision: String(childEffective.effectiveRevision || ''),
      })
    }
  }

  return {
    tenantId,
    effectiveRevision: String(effective.effectiveRevision || ''),
    parentTenantId: profile.parentTenantId || null,
    childInheritanceEnabled: profile.childInheritanceEnabled,
    propagatedChildren,
  }
}

async function updateParentIndex(kv: ReturnType<typeof guardKV>, tenantId: string, enabled: boolean): Promise<void> {
  const current = ((await getGlobalJson(kv, PARENT_INDEX_KEY)) || []) as string[]
  const next = enabled
    ? Array.from(new Set([...current, tenantId])).sort()
    : current.filter(id => id !== tenantId).sort()
  await putGlobalJson(kv, PARENT_INDEX_KEY, next)
}

async function updateChildrenIndex(kv: ReturnType<typeof guardKV>, tenantId: string, parentTenantId?: string | null): Promise<void> {
  if (!parentTenantId) return
  const key = `${CHILD_INDEX_PREFIX}${parentTenantId}`
  const current = ((await getGlobalJson(kv, key)) || []) as string[]
  await putGlobalJson(kv, key, Array.from(new Set([...current, tenantId])).sort())
}

export async function listActiveParents(kv: ReturnType<typeof guardKV>, excludeTenantId?: string): Promise<AgentProfile[]> {
  const ids = ((await getGlobalJson(kv, PARENT_INDEX_KEY)) || []) as string[]
  const parents: AgentProfile[] = []
  for (const id of ids) {
    if (id === excludeTenantId) continue
    const profile = await getAgentProfile(kv, id)
    if (profile?.parentInheritanceEnabled) parents.push(profile)
  }
  return parents.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getChildren(kv: ReturnType<typeof guardKV>, parentTenantId: string): Promise<AgentProfile[]> {
  const ids = ((await getGlobalJson(kv, `${CHILD_INDEX_PREFIX}${parentTenantId}`)) || []) as string[]
  const children: AgentProfile[] = []
  for (const id of ids) {
    const profile = await getAgentProfile(kv, id)
    if (profile?.childInheritanceEnabled && profile.parentTenantId === parentTenantId) children.push(profile)
  }
  return children.sort((a, b) => a.name.localeCompare(b.name))
}

export async function setParentInheritance(rawKV: any, tenantId: string, enabled: boolean): Promise<RebuildResult> {
  const kv = guardKV(rawKV)
  await ensureTenantRecord(kv, tenantId)
  const profile = await ensureAgentProfile(kv, tenantId)
  const next: AgentProfile = {
    ...profile,
    parentInheritanceEnabled: enabled,
    updatedAt: now(),
    sourceRef: 'admin-parent-toggle',
  }
  await putJson(kv, tenantId, 'agent:profile', next)
  await updateParentIndex(kv, tenantId, enabled)

  if (enabled) {
    const children = await getChildren(kv, tenantId)
    for (const child of children) {
      await rebuildEffectiveConfig(kv, child.tenantId)
    }
  }

  return rebuildTenantConfig(rawKV, undefined, tenantId)
}

export async function setChildInheritance(rawKV: any, tenantId: string, enabled: boolean, parentTenantId?: string): Promise<RebuildResult> {
  const kv = guardKV(rawKV)
  await ensureTenantRecord(kv, tenantId)
  const profile = await ensureAgentProfile(kv, tenantId)

  if (!enabled) {
    const currentEffective = await getEffectiveConfig(kv, tenantId)
    await putJson(kv, tenantId, 'chat:config', currentEffective)
    const next: AgentProfile = {
      ...profile,
      childInheritanceEnabled: false,
      parentTenantId: null,
      updatedAt: now(),
      sourceRef: 'admin-child-toggle-off',
    }
    await putJson(kv, tenantId, 'agent:profile', next)
    await updateChildrenIndex(kv, tenantId, profile.parentTenantId || null)
    return rebuildTenantConfig(rawKV, undefined, tenantId)
  }

  if (!parentTenantId) throw new Error('Parent tenant is required when child inheritance is enabled')
  const parentProfile = await ensureAgentProfile(kv, parentTenantId)
  if (!parentProfile.parentInheritanceEnabled) throw new Error(`Parent ${parentTenantId} is not enabled for inheritance`)

  const next: AgentProfile = {
    ...profile,
    childInheritanceEnabled: true,
    parentTenantId,
    updatedAt: now(),
    sourceRef: `parent:${parentTenantId}`,
  }
  await putJson(kv, tenantId, 'agent:profile', next)
  await updateChildrenIndex(kv, tenantId, parentTenantId)
  return rebuildTenantConfig(rawKV, undefined, tenantId)
}

async function cloneRules(rawKV: any, env: any, sourceTenantId: string, targetTenantId: string): Promise<number> {
  const dbRaw = env?.DB
  if (!dbRaw?.prepare) return 0
  const db = guardDB(dbRaw)
  const rows = await db.all({ tenantId: sourceTenantId }, 'SELECT * FROM rules WHERE tenant_id = ? ORDER BY priority, id', [sourceTenantId])
  const insertedAt = Math.floor(Date.now() / 1000)
  let count = 0
  for (const row of rows.results || []) {
    const id = crypto.randomUUID()
    await db.insert({ tenantId: targetTenantId }, 'rules', {
      id,
      tenant_id: targetTenantId,
      condition: row.condition,
      output: row.output,
      priority: row.priority,
      active: row.active,
      created_at: insertedAt,
    })
    count++
  }
  return count
}

export async function cloneTenantConfig(rawKV: any, env: any, options: CloneOptions): Promise<RebuildResult & { sourceTenantId: string; rulesCopied: number; kbTopicsCopied: number }> {
  const kv = guardKV(rawKV)
  const { sourceTenantId, targetTenantId, targetName, parentLink = false } = options
  const sourceProfile = await ensureAgentProfile(kv, sourceTenantId)
  const sourceConfig = await getEffectiveConfig(kv, sourceTenantId)
  const name = targetName || titleFromTenant(targetTenantId)

  await ensureTenantRecord(kv, targetTenantId, name)
  const targetProfile: AgentProfile = {
    tenantId: targetTenantId,
    name,
    parentInheritanceEnabled: false,
    childInheritanceEnabled: parentLink,
    parentTenantId: parentLink ? sourceTenantId : null,
    updatedAt: now(),
    sourceRef: `clone:${sourceTenantId}`,
  }
  await putJson(kv, targetTenantId, 'agent:profile', targetProfile)

  const identityOverrides = {
    tenantId: targetTenantId,
    name,
    objective: `${name} — Customer intake`,
    ui: {
      title: name,
      greeting: `Welcome to ${name}! Let's get started with your application. What is your full name?`,
    },
  }
  const targetConfig = deepMerge(deepClone(sourceConfig), identityOverrides)
  await putJson(kv, targetTenantId, 'config:overrides', identityOverrides)
  await putJson(kv, targetTenantId, 'config:effective', targetConfig)
  await putJson(kv, targetTenantId, 'chat:config', targetConfig)

  const topics = ((sourceConfig.knowledgeBase?.topics || DEFAULT_TOPICS) as string[]).filter(Boolean)
  let kbTopicsCopied = 0
  for (const topic of topics) {
    const sourceRaw = await kv.get(tenantKey(sourceTenantId, `kb:${topic}`), tenantCtx(sourceTenantId))
    if (sourceRaw) {
      await kv.put(tenantKey(targetTenantId, `kb:${topic}`), sourceRaw, tenantCtx(targetTenantId))
      kbTopicsCopied++
    }
  }

  let layoutCopied = false
  for (const suffix of ['layout:staging', 'layout:latest', 'site']) {
    const sourceRaw = await kv.get(tenantKey(sourceTenantId, suffix), tenantCtx(sourceTenantId))
    if (sourceRaw) {
      const targetRaw = suffix === 'site' && typeof sourceRaw === 'string'
        ? JSON.stringify({ ...JSON.parse(sourceRaw), title: name, tenant: targetTenantId })
        : sourceRaw
      await kv.put(tenantKey(targetTenantId, suffix), targetRaw, tenantCtx(targetTenantId))
      layoutCopied = true
    }
  }

  const rulesCopied = await cloneRules(rawKV, env, sourceTenantId, targetTenantId)

  if (parentLink && sourceProfile.parentInheritanceEnabled) {
    await updateParentIndex(kv, sourceTenantId, true)
  }
  await updateChildrenIndex(kv, targetTenantId, parentLink ? sourceTenantId : null)

  const rebuilt = await rebuildTenantConfig(rawKV, env, targetTenantId)
  return {
    ...rebuilt,
    sourceTenantId,
    rulesCopied,
    kbTopicsCopied,
  }
}

export async function propagateParent(rawKV: any, env: any, parentTenantId: string): Promise<RebuildResult> {
  const kv = guardKV(rawKV)
  const children = await getChildren(kv, parentTenantId)
  const propagatedChildren: Array<{ tenantId: string; effectiveRevision: string }> = []
  for (const child of children) {
    const childEffective = await rebuildEffectiveConfig(kv, child.tenantId)
    propagatedChildren.push({
      tenantId: child.tenantId,
      effectiveRevision: String(childEffective.effectiveRevision || ''),
    })
  }
  const parentEffective = await rebuildEffectiveConfig(kv, parentTenantId)
  return {
    tenantId: parentTenantId,
    effectiveRevision: String(parentEffective.effectiveRevision || ''),
    parentTenantId: null,
    childInheritanceEnabled: false,
    propagatedChildren,
  }
}

export function renderConfigPage(profile: AgentProfile, parents: AgentProfile[], children: AgentProfile[], effective: Record<string, any>, token?: string): string {
  const qs = token ? `&token=${encodeURIComponent(token)}` : ''
  const parentOptions = parents.map(p =>
    `<option value="${escapeHtml(p.tenantId)}"${profile.parentTenantId === p.tenantId ? ' selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.tenantId)})</option>`
  ).join('')

  const childrenHtml = children.length
    ? `<ul>${children.map(child => `<li>${escapeHtml(child.name)} — ${escapeHtml(child.tenantId)} — last sync ${escapeHtml(String(effective.updatedAt || 'unknown'))}</li>`).join('')}</ul>`
    : '<div class="empty">No active children.</div>'

  return `
    <div class="card">
      <h3>Agent Config — ${escapeHtml(profile.name)}</h3>
      <div class="meta">tenant: ${escapeHtml(profile.tenantId)}</div>
      <p style="color:#8b949e;margin-top:8px">Runtime reads <code>tenant:${escapeHtml(profile.tenantId)}:chat:config</code> as the effective merged config.</p>
    </div>

    <div class="card" style="border-color:${profile.parentInheritanceEnabled ? '#238636' : '#30363d'}">
      <h3>Parent config</h3>
      <div class="meta">Child count: ${children.length}</div>
      <form hx-post="/admin/config/parent-toggle?tenant=${escapeHtml(profile.tenantId)}${qs}" hx-target="closest .card" hx-swap="outerHTML">
        <label style="display:flex;align-items:center;gap:8px;margin:12px 0">
          <input type="checkbox" name="enabled" ${profile.parentInheritanceEnabled ? 'checked' : ''}>
          Parent inheritance enabled
        </label>
        <button class="btn btn-primary" type="submit">Save parent toggle</button>
      </form>
      <hr style="border-color:#30363d;margin:16px 0">
      <h4 style="font-size:13px;margin-bottom:8px">Children</h4>
      ${childrenHtml}
    </div>

    <div class="card" style="border-color:${profile.childInheritanceEnabled ? '#238636' : '#30363d'}">
      <h3>Child config</h3>
      <form hx-post="/admin/config/child-toggle?tenant=${escapeHtml(profile.tenantId)}${qs}" hx-target="closest .card" hx-swap="outerHTML">
        <label style="display:flex;align-items:center;gap:8px;margin:12px 0">
          <input type="checkbox" name="enabled" ${profile.childInheritanceEnabled ? 'checked' : ''}>
          Use parent config
        </label>
        ${profile.childInheritanceEnabled || parents.length ? `<label style="display:block;margin:12px 0;color:#8b949e;font-size:12px">Parent<select name="parent" style="width:100%;margin-top:6px;padding:6px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e1e4e8">${parentOptions || '<option value="">Select parent</option>'}</select></label>` : ''}
        <button class="btn btn-primary" type="submit">Save child toggle</button>
      </form>
      <p style="color:#8b949e;font-size:12px;margin-top:8px">When enabled, parent selection lists only tenants with Parent inheritance enabled.</p>
    </div>

    <div class="card">
      <h3>Effective config summary</h3>
      <div class="entry"><div class="key">effectiveRevision</div><div class="val">${escapeHtml(String(effective.effectiveRevision || '—'))}</div></div>
      <div class="entry"><div class="key">objective</div><div class="val">${escapeHtml(String(effective.objective || '—'))}</div></div>
      <div class="entry"><div class="key">ui.title</div><div class="val">${escapeHtml(String(effective.ui?.title || effective.title || '—'))}</div></div>
      <div class="entry"><div class="key">knowledgeBase.topics</div><div class="val">${escapeHtml(JSON.stringify(effective.knowledgeBase?.topics || []))}</div></div>
    </div>
  `
}

/**
 * EdgeGDE — Agent config inheritance & duplication (src/lib/config-inheritance.ts) Test Suite
 *
 * guardDB and guardKV are stubbed via vi.mock (identity wrappers) so the module's
 * own logic runs against an in-memory KV store. Covers:
 *   - profile / config getters with defaults
 *   - rebuildEffectiveConfig: own config, parent merge, empty fallback, revisions
 *   - rebuildTenantConfig child propagation
 *   - parent / child inheritance toggles (incl. validation errors)
 *   - cloneTenantConfig: rules, KB topics, layout/site copy, parentLink
 *   - propagateParent and listActiveParents / getChildren index filtering
 *   - renderConfigPage HTML output, escaping and empty states
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest'
import {
  getAgentProfile,
  ensureAgentProfile,
  getConfigOverrides,
  getChatConfig,
  getEffectiveConfig,
  rebuildEffectiveConfig,
  rebuildTenantConfig,
  listActiveParents,
  getChildren,
  setParentInheritance,
  setChildInheritance,
  cloneTenantConfig,
  propagateParent,
  renderConfigPage,
  type AgentProfile,
} from '../../../src/lib/config-inheritance'

// Stub guard wrappers — identity, so the module uses the fake KV/DB objects directly.
vi.mock('../../../src/lib/kv', () => ({
  guardKV: (raw: any) => raw,
}))
vi.mock('../../../src/lib/db', () => ({
  guardDB: (raw: any) => raw,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tenantKey = (tenantId: string, suffix: string) => `tenant:${tenantId}:${suffix}`

/** In-memory KV; seed values must be JSON strings (module stores them via JSON.stringify). */
function makeKV(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed))
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    put: vi.fn(async (key: string, value: any) => { store.set(key, value) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
  } as any // guardKV is stubbed to identity via vi.mock — runtime type is the fake
}

function profileJson(p: Partial<AgentProfile> & { tenantId: string }): string {
  return JSON.stringify({
    name: p.tenantId,
    parentInheritanceEnabled: false,
    childInheritanceEnabled: false,
    parentTenantId: null,
    updatedAt: 1,
    sourceRef: 'seed',
    ...p,
  })
}

const chatConfigJson = (config: Record<string, any>) => JSON.stringify(config)

// ---------------------------------------------------------------------------
// Profile & config getters
// ---------------------------------------------------------------------------

describe('profile & config getters', () => {
  it('getAgentProfile returns parsed profile or null', async () => {
    const kv = makeKV({ [tenantKey('t1', 'agent:profile')]: profileJson({ tenantId: 't1', name: 'Tenant One' }) })
    const profile = await getAgentProfile(kv, 't1')
    expect(profile).toMatchObject({ tenantId: 't1', name: 'Tenant One' })
    await expect(getAgentProfile(kv, 'missing')).resolves.toBeNull()
  })

  it('ensureAgentProfile returns existing profile unchanged', async () => {
    const kv = makeKV({ [tenantKey('t1', 'agent:profile')]: profileJson({ tenantId: 't1', name: 'Existing' }) })
    const profile = await ensureAgentProfile(kv, 't1')
    expect(profile.name).toBe('Existing')
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('ensureAgentProfile auto-creates a profile with title-cased name and auto sourceRef', async () => {
    const kv = makeKV()
    const profile = await ensureAgentProfile(kv, 'acme-bank')
    expect(profile).toMatchObject({
      tenantId: 'acme-bank',
      name: 'Acme Bank',
      parentInheritanceEnabled: false,
      childInheritanceEnabled: false,
      parentTenantId: null,
      sourceRef: 'auto-created',
    })
    expect(profile.updatedAt).toEqual(expect.any(Number))
    const stored = JSON.parse(kv.store.get(tenantKey('acme-bank', 'agent:profile'))!)
    expect(stored.name).toBe('Acme Bank')
  })

  it('ensureAgentProfile honors an explicit name', async () => {
    const kv = makeKV()
    const profile = await ensureAgentProfile(kv, 't1', 'Custom Name')
    expect(profile.name).toBe('Custom Name')
  })

  it('getConfigOverrides and getChatConfig default to {}', async () => {
    const kv = makeKV()
    await expect(getConfigOverrides(kv, 't1')).resolves.toEqual({})
    await expect(getChatConfig(kv, 't1')).resolves.toEqual({})
  })

  it('getEffectiveConfig prefers config:effective, falls back to chat:config, then {}', async () => {
    const kv = makeKV({
      [tenantKey('both', 'config:effective')]: chatConfigJson({ a: 1 }),
      [tenantKey('both', 'chat:config')]: chatConfigJson({ a: 2 }),
      [tenantKey('chatOnly', 'chat:config')]: chatConfigJson({ b: 2 }),
    })
    await expect(getEffectiveConfig(kv, 'both')).resolves.toEqual({ a: 1 })
    await expect(getEffectiveConfig(kv, 'chatOnly')).resolves.toEqual({ b: 2 })
    await expect(getEffectiveConfig(kv, 'none')).resolves.toEqual({})
  })
})

// ---------------------------------------------------------------------------
// rebuildEffectiveConfig
// ---------------------------------------------------------------------------

describe('rebuildEffectiveConfig', () => {
  it('uses own chat config when child inheritance is off', async () => {
    const kv = makeKV({
      [tenantKey('t1', 'agent:profile')]: profileJson({ tenantId: 't1' }),
      [tenantKey('t1', 'chat:config')]: chatConfigJson({ objective: 'Intake' }),
    })
    const out = await rebuildEffectiveConfig(kv, 't1')
    expect(out.objective).toBe('Intake')
    expect(out.effectiveRevision).toEqual(expect.stringMatching(/^t1:[0-9a-z]+$/))
    expect(out.updatedAt).toEqual(expect.any(Number))

    // Both keys written with revision + timestamp
    const stored = JSON.parse(kv.store.get(tenantKey('t1', 'chat:config'))!)
    expect(stored.effectiveRevision).toBe(out.effectiveRevision)
    expect(stored.updatedAt).toEqual(expect.any(Number))
    const storedEffective = JSON.parse(kv.store.get(tenantKey('t1', 'config:effective'))!)
    expect(storedEffective.effectiveRevision).toBe(out.effectiveRevision)
  })

  it('writes an empty effective config when nothing exists', async () => {
    const kv = makeKV({ [tenantKey('t1', 'agent:profile')]: profileJson({ tenantId: 't1' }) })
    const out = await rebuildEffectiveConfig(kv, 't1')
    expect(out).toMatchObject({ effectiveRevision: expect.stringMatching(/^t1:/) })
    expect(JSON.parse(kv.store.get(tenantKey('t1', 'chat:config'))!)).toMatchObject({})
  })

  it('merges parent effective config with own overrides (deep merge)', async () => {
    const kv = makeKV({
      [tenantKey('parent', 'agent:profile')]: profileJson({ tenantId: 'parent', parentInheritanceEnabled: true }),
      [tenantKey('parent', 'config:effective')]: chatConfigJson({
        greeting: 'hi',
        ui: { title: 'P' },
        nested: { a: 1, b: 2 },
      }),
      [tenantKey('child', 'agent:profile')]: profileJson({
        tenantId: 'child', childInheritanceEnabled: true, parentTenantId: 'parent',
      }),
      [tenantKey('child', 'config:overrides')]: chatConfigJson({
        ui: { title: 'C' },
        nested: { b: 3, c: 4 },
        undefinedKey: undefined,
      }),
    })
    const out = await rebuildEffectiveConfig(kv, 'child')
    expect(out.greeting).toBe('hi')
    expect(out.ui).toEqual({ title: 'C' })
    expect(out.nested).toEqual({ a: 1, b: 3, c: 4 })
    // undefined override values are skipped
    expect('undefinedKey' in out).toBe(false)
  })

  it('falls back to own chat config when parent profile disables inheritance', async () => {
    const kv = makeKV({
      [tenantKey('parent', 'agent:profile')]: profileJson({ tenantId: 'parent', parentInheritanceEnabled: false }),
      [tenantKey('child', 'agent:profile')]: profileJson({
        tenantId: 'child', childInheritanceEnabled: true, parentTenantId: 'parent',
      }),
      [tenantKey('child', 'chat:config')]: chatConfigJson({ objective: 'Own' }),
    })
    const out = await rebuildEffectiveConfig(kv, 'child')
    expect(out.objective).toBe('Own')
  })

  it('falls back to own chat config when parent profile is missing', async () => {
    const kv = makeKV({
      [tenantKey('child', 'agent:profile')]: profileJson({
        tenantId: 'child', childInheritanceEnabled: true, parentTenantId: 'ghost-parent',
      }),
      [tenantKey('child', 'chat:config')]: chatConfigJson({ objective: 'Own' }),
    })
    const out = await rebuildEffectiveConfig(kv, 'child')
    expect(out.objective).toBe('Own')
  })

  it('produces stable revisions for identical config and different revisions for changed config', async () => {
    const seed = {
      [tenantKey('t1', 'agent:profile')]: profileJson({ tenantId: 't1' }),
      [tenantKey('t1', 'chat:config')]: chatConfigJson({ objective: 'Same' }),
    }
    const kvA = makeKV(seed)
    const kvB = makeKV(seed)
    const a = await rebuildEffectiveConfig(kvA, 't1')
    const b = await rebuildEffectiveConfig(kvB, 't1')
    expect(a.effectiveRevision).toBe(b.effectiveRevision)

    const kvC = makeKV({
      ...seed,
      [tenantKey('t1', 'chat:config')]: chatConfigJson({ objective: 'Different' }),
    })
    const c = await rebuildEffectiveConfig(kvC, 't1')
    expect(c.effectiveRevision).not.toBe(a.effectiveRevision)
  })
})

// ---------------------------------------------------------------------------
// rebuildTenantConfig
// ---------------------------------------------------------------------------

describe('rebuildTenantConfig', () => {
  it('returns a RebuildResult for a plain tenant', async () => {
    const kv = makeKV({
      [tenantKey('t1', 'agent:profile')]: profileJson({ tenantId: 't1' }),
      [tenantKey('t1', 'chat:config')]: chatConfigJson({ objective: 'X' }),
    })
    const result = await rebuildTenantConfig(kv, undefined, 't1')
    expect(result).toEqual({
      tenantId: 't1',
      effectiveRevision: expect.stringMatching(/^t1:/),
      parentTenantId: null,
      childInheritanceEnabled: false,
      propagatedChildren: [],
    })
  })

  it('propagates rebuild to children when parent inheritance is enabled', async () => {
    const kv = makeKV({
      [tenantKey('parent1', 'agent:profile')]: profileJson({ tenantId: 'parent1', parentInheritanceEnabled: true }),
      [tenantKey('parent1', 'chat:config')]: chatConfigJson({ objective: 'Shared' }),
      'global:agent-children-index:parent1': JSON.stringify(['child1', 'stale-child']),
      [tenantKey('child1', 'agent:profile')]: profileJson({
        tenantId: 'child1', name: 'Child One', childInheritanceEnabled: true, parentTenantId: 'parent1',
      }),
      // stale: not enabled for child inheritance → filtered out of getChildren
      [tenantKey('stale-child', 'agent:profile')]: profileJson({
        tenantId: 'stale-child', name: 'Stale', childInheritanceEnabled: false, parentTenantId: 'parent1',
      }),
    })
    const result = await rebuildTenantConfig(kv, undefined, 'parent1')
    expect(result.propagatedChildren).toHaveLength(1)
    expect(result.propagatedChildren[0].tenantId).toBe('child1')
    expect(result.propagatedChildren[0].effectiveRevision).toEqual(expect.stringMatching(/^child1:/))
  })
})

// ---------------------------------------------------------------------------
// listActiveParents / getChildren
// ---------------------------------------------------------------------------

describe('listActiveParents', () => {
  it('lists only parents with inheritance enabled, sorted by name, minus exclude', async () => {
    const kv = makeKV({
      'global:agent-parent-index': JSON.stringify(['zebra', 'alpha', 'excluded', 'inactive']),
      [tenantKey('zebra', 'agent:profile')]: profileJson({ tenantId: 'zebra', name: 'Zebra Co', parentInheritanceEnabled: true }),
      [tenantKey('alpha', 'agent:profile')]: profileJson({ tenantId: 'alpha', name: 'Alpha Co', parentInheritanceEnabled: true }),
      [tenantKey('excluded', 'agent:profile')]: profileJson({ tenantId: 'excluded', name: 'Excluded Co', parentInheritanceEnabled: true }),
      [tenantKey('inactive', 'agent:profile')]: profileJson({ tenantId: 'inactive', name: 'Inactive Co', parentInheritanceEnabled: false }),
    })
    const parents = await listActiveParents(kv, 'excluded')
    expect(parents.map(p => p.tenantId)).toEqual(['alpha', 'zebra'])
  })

  it('returns [] when the index is missing', async () => {
    const kv = makeKV()
    await expect(listActiveParents(kv)).resolves.toEqual([])
  })
})

describe('getChildren', () => {
  it('returns only enabled children linked to the parent, sorted by name', async () => {
    const kv = makeKV({
      'global:agent-children-index:parent1': JSON.stringify(['b-child', 'a-child', 'foreign']),
      [tenantKey('a-child', 'agent:profile')]: profileJson({ tenantId: 'a-child', name: 'A Child', childInheritanceEnabled: true, parentTenantId: 'parent1' }),
      [tenantKey('b-child', 'agent:profile')]: profileJson({ tenantId: 'b-child', name: 'B Child', childInheritanceEnabled: true, parentTenantId: 'parent1' }),
      // linked to a different parent → excluded
      [tenantKey('foreign', 'agent:profile')]: profileJson({ tenantId: 'foreign', name: 'Foreign', childInheritanceEnabled: true, parentTenantId: 'other' }),
    })
    const children = await getChildren(kv, 'parent1')
    expect(children.map(c => c.tenantId)).toEqual(['a-child', 'b-child'])
  })
})

// ---------------------------------------------------------------------------
// setParentInheritance
// ---------------------------------------------------------------------------

describe('setParentInheritance', () => {
  it('enables parent inheritance, updates the parent index and rebuilds', async () => {
    const kv = makeKV({ [tenantKey('p', 'chat:config')]: chatConfigJson({ objective: 'P' }) })
    const result = await setParentInheritance(kv, 'p', true)
    expect(result.tenantId).toBe('p')
    // Tenant record auto-created
    expect(JSON.parse(kv.store.get(tenantKey('p', ''))!)).toMatchObject({ tenantId: 'p', plan: 'free' })
    // Profile updated with admin source
    const profile = JSON.parse(kv.store.get(tenantKey('p', 'agent:profile'))!)
    expect(profile).toMatchObject({ tenantId: 'p', parentInheritanceEnabled: true, sourceRef: 'admin-parent-toggle' })
    // Parent index contains the tenant
    expect(JSON.parse(kv.store.get('global:agent-parent-index')!)).toEqual(['p'])
  })

  it('rebuilds children when enabling parent inheritance', async () => {
    const kv = makeKV({
      'global:agent-children-index:p': JSON.stringify(['c1']),
      [tenantKey('c1', 'agent:profile')]: profileJson({
        tenantId: 'c1', childInheritanceEnabled: true, parentTenantId: 'p',
      }),
      [tenantKey('c1', 'chat:config')]: chatConfigJson({ objective: 'Child' }),
    })
    await setParentInheritance(kv, 'p', true)
    // child rebuilt → chat:config now carries a revision
    const childConfig = JSON.parse(kv.store.get(tenantKey('c1', 'chat:config'))!)
    expect(childConfig.effectiveRevision).toEqual(expect.stringMatching(/^c1:/))
  })

  it('disabling removes the tenant from the parent index', async () => {
    const kv = makeKV({
      'global:agent-parent-index': JSON.stringify(['p', 'other']),
      [tenantKey('p', 'agent:profile')]: profileJson({ tenantId: 'p', parentInheritanceEnabled: true }),
    })
    await setParentInheritance(kv, 'p', false)
    const profile = JSON.parse(kv.store.get(tenantKey('p', 'agent:profile'))!)
    expect(profile.parentInheritanceEnabled).toBe(false)
    expect(profile.sourceRef).toBe('admin-parent-toggle')
    expect(JSON.parse(kv.store.get('global:agent-parent-index')!)).toEqual(['other'])
  })
})

// ---------------------------------------------------------------------------
// setChildInheritance
// ---------------------------------------------------------------------------

describe('setChildInheritance', () => {
  it('disabling pins the current effective config and clears the parent link', async () => {
    const kv = makeKV({
      [tenantKey('c', 'agent:profile')]: profileJson({
        tenantId: 'c', name: 'C', childInheritanceEnabled: true, parentTenantId: 'parent1',
      }),
      [tenantKey('c', 'config:effective')]: chatConfigJson({ objective: 'Effective' }),
    })
    const result = await setChildInheritance(kv, 'c', false)
    expect(result.childInheritanceEnabled).toBe(false)
    // chat:config pinned to the effective config
    expect(JSON.parse(kv.store.get(tenantKey('c', 'chat:config'))!)).toMatchObject({ objective: 'Effective' })
    const profile = JSON.parse(kv.store.get(tenantKey('c', 'agent:profile'))!)
    expect(profile).toMatchObject({
      childInheritanceEnabled: false,
      parentTenantId: null,
      sourceRef: 'admin-child-toggle-off',
    })
  })

  it('throws when enabling without a parent tenant', async () => {
    const kv = makeKV()
    await expect(setChildInheritance(kv, 'c', true)).rejects.toThrow(
      'Parent tenant is required when child inheritance is enabled',
    )
  })

  it('throws when the parent is not enabled for inheritance', async () => {
    const kv = makeKV({
      [tenantKey('parent1', 'agent:profile')]: profileJson({ tenantId: 'parent1', parentInheritanceEnabled: false }),
    })
    await expect(setChildInheritance(kv, 'c', true, 'parent1')).rejects.toThrow(
      'Parent parent1 is not enabled for inheritance',
    )
  })

  it('enabling links the child, updates the children index and rebuilds', async () => {
    const kv = makeKV({
      [tenantKey('parent1', 'agent:profile')]: profileJson({ tenantId: 'parent1', parentInheritanceEnabled: true }),
      [tenantKey('parent1', 'chat:config')]: chatConfigJson({ objective: 'Parent Config' }),
      [tenantKey('c', 'chat:config')]: chatConfigJson({ objective: 'Own' }),
    })
    const result = await setChildInheritance(kv, 'c', true, 'parent1')
    expect(result.childInheritanceEnabled).toBe(true)
    expect(result.parentTenantId).toBe('parent1')

    const profile = JSON.parse(kv.store.get(tenantKey('c', 'agent:profile'))!)
    expect(profile).toMatchObject({
      childInheritanceEnabled: true,
      parentTenantId: 'parent1',
      sourceRef: 'parent:parent1',
    })
    expect(JSON.parse(kv.store.get('global:agent-children-index:parent1')!)).toEqual(['c'])
    // Child effective config merged from parent
    const childEffective = JSON.parse(kv.store.get(tenantKey('c', 'config:effective'))!)
    expect(childEffective.objective).toBe('Parent Config')
  })
})

// ---------------------------------------------------------------------------
// cloneTenantConfig
// ---------------------------------------------------------------------------

describe('cloneTenantConfig', () => {
  const fakeDb = () => ({
    prepare: vi.fn(),
    all: vi.fn(async () => ({
      results: [
        { condition: 'income > 5000', output: 'approve', priority: 1, active: 1 },
        { condition: 'age > 65', output: 'review', priority: 2, active: 0 },
      ],
    })),
    insert: vi.fn(async () => {}),
  })

  it('clones profile, config, kb topics, layouts and rules', async () => {
    const db = fakeDb()
    const kv = makeKV({
      [tenantKey('src', 'agent:profile')]: profileJson({ tenantId: 'src', name: 'Source Co' }),
      [tenantKey('src', 'chat:config')]: chatConfigJson({
        objective: 'Source',
        ui: { title: 'Source' },
        knowledgeBase: { topics: ['rates', 'general', ''] },
      }),
      [tenantKey('src', 'kb:rates')]: JSON.stringify({ entries: [] }),
      [tenantKey('src', 'kb:general')]: JSON.stringify({ entries: [] }),
      [tenantKey('src', 'layout:staging')]: JSON.stringify({ v: 1 }),
      [tenantKey('src', 'layout:latest')]: JSON.stringify({ v: 2 }),
      [tenantKey('src', 'site')]: JSON.stringify({ title: 'Old', kb_blocks: [] }),
    })

    const result = await cloneTenantConfig(kv, { DB: db }, {
      sourceTenantId: 'src',
      targetTenantId: 'target-co',
      targetName: 'Target Co',
    })

    expect(result).toMatchObject({
      tenantId: 'target-co',
      sourceTenantId: 'src',
      rulesCopied: 2,
      kbTopicsCopied: 2,
      parentTenantId: null,
      childInheritanceEnabled: false,
    })

    // Target profile written
    const profile = JSON.parse(kv.store.get(tenantKey('target-co', 'agent:profile'))!)
    expect(profile).toMatchObject({ tenantId: 'target-co', name: 'Target Co', sourceRef: 'clone:src' })

    // Target config has identity overrides merged over source
    const targetConfig = JSON.parse(kv.store.get(tenantKey('target-co', 'chat:config'))!)
    expect(targetConfig.objective).toBe('Target Co — Customer intake')
    expect(targetConfig.ui).toEqual({
      title: 'Target Co',
      greeting: "Welcome to Target Co! Let's get started with your application. What is your full name?",
    })
    expect(targetConfig.knowledgeBase.topics).toEqual(['rates', 'general', ''])

    // KB topics copied (empty-string topic filtered out of copying loop)
    expect(kv.store.has(tenantKey('target-co', 'kb:rates'))).toBe(true)
    expect(kv.store.has(tenantKey('target-co', 'kb:general'))).toBe(true)

    // Layout keys copied
    expect(JSON.parse(kv.store.get(tenantKey('target-co', 'layout:staging'))!)).toEqual({ v: 1 })
    expect(JSON.parse(kv.store.get(tenantKey('target-co', 'layout:latest'))!)).toEqual({ v: 2 })

    // Site key rewritten with title + tenant
    expect(JSON.parse(kv.store.get(tenantKey('target-co', 'site'))!)).toEqual({
      title: 'Target Co',
      tenant: 'target-co',
      kb_blocks: [],
    })

    // Rules copied via DB insert (uuid ids)
    expect(db.all).toHaveBeenCalledWith(
      { tenantId: 'src' },
      'SELECT * FROM rules WHERE tenant_id = ? ORDER BY priority, id',
      ['src'],
    )
    expect(db.insert).toHaveBeenCalledTimes(2)
    const insertCalls = db.insert.mock.calls as unknown as [any, string, any][]
    const [firstInsertCtx, table, row] = insertCalls[0]
    expect(table).toBe('rules')
    expect(firstInsertCtx).toEqual({ tenantId: 'target-co' })
    expect(row).toMatchObject({ tenant_id: 'target-co', condition: 'income > 5000', output: 'approve', priority: 1, active: 1 })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.created_at).toEqual(expect.any(Number))
  })

  it('copies 0 rules when env.DB is unavailable', async () => {
    const kv = makeKV({
      [tenantKey('src', 'agent:profile')]: profileJson({ tenantId: 'src' }),
      [tenantKey('src', 'chat:config')]: chatConfigJson({ objective: 'Source' }),
    })
    const result = await cloneTenantConfig(kv, {}, {
      sourceTenantId: 'src',
      targetTenantId: 'tgt',
    })
    expect(result.rulesCopied).toBe(0)
    expect(result.kbTopicsCopied).toBe(0)
  })

  it('uses DEFAULT_TOPICS when source config has no knowledgeBase topics', async () => {
    const kv = makeKV({
      [tenantKey('src', 'agent:profile')]: profileJson({ tenantId: 'src' }),
      [tenantKey('src', 'chat:config')]: chatConfigJson({ objective: 'Source' }),
      [tenantKey('src', 'kb:rates')]: JSON.stringify({ entries: [] }),
      [tenantKey('src', 'kb:products')]: JSON.stringify({ entries: [] }),
    })
    const result = await cloneTenantConfig(kv, {}, {
      sourceTenantId: 'src',
      targetTenantId: 'tgt',
    })
    // DEFAULT_TOPICS drives the copy loop — only topics that exist are copied
    expect(result.kbTopicsCopied).toBe(2) // rates + products exist; others absent
    // Source had no knowledgeBase, so the cloned config does not gain one
    const targetConfig = JSON.parse(kv.store.get(tenantKey('tgt', 'chat:config'))!)
    expect(targetConfig.knowledgeBase).toBeUndefined()
  })

  it('derives target name from tenantId when targetName is omitted', async () => {
    const kv = makeKV({
      [tenantKey('src', 'agent:profile')]: profileJson({ tenantId: 'src' }),
      [tenantKey('src', 'chat:config')]: chatConfigJson({ objective: 'Source' }),
    })
    const result = await cloneTenantConfig(kv, {}, { sourceTenantId: 'src', targetTenantId: 'my-new-tenant' })
    expect(result.childInheritanceEnabled).toBe(false)
    const profile = JSON.parse(kv.store.get(tenantKey('my-new-tenant', 'agent:profile'))!)
    expect(profile.name).toBe('My New Tenant')
  })

  it('creates a parent link and registers the target in the parent index when parentLink is set', async () => {
    const kv = makeKV({
      [tenantKey('src', 'agent:profile')]: profileJson({ tenantId: 'src', parentInheritanceEnabled: true }),
      [tenantKey('src', 'chat:config')]: chatConfigJson({ objective: 'Source' }),
    })
    const result = await cloneTenantConfig(kv, {}, {
      sourceTenantId: 'src',
      targetTenantId: 'child-co',
      parentLink: true,
    })
    expect(result.childInheritanceEnabled).toBe(true)
    expect(result.parentTenantId).toBe('src')

    const profile = JSON.parse(kv.store.get(tenantKey('child-co', 'agent:profile'))!)
    expect(profile.childInheritanceEnabled).toBe(true)
    expect(profile.parentTenantId).toBe('src')

    // Source registered in the global parent index (source has parentInheritanceEnabled)
    expect(JSON.parse(kv.store.get('global:agent-parent-index')!)).toEqual(['src'])
    // Child registered under source's children index
    expect(JSON.parse(kv.store.get('global:agent-children-index:src')!)).toEqual(['child-co'])
  })
})

// ---------------------------------------------------------------------------
// propagateParent
// ---------------------------------------------------------------------------

describe('propagateParent', () => {
  it('rebuilds children and parent, returning a fixed shape', async () => {
    const kv = makeKV({
      'global:agent-children-index:p': JSON.stringify(['c1']),
      [tenantKey('p', 'agent:profile')]: profileJson({ tenantId: 'p', parentInheritanceEnabled: true }),
      [tenantKey('p', 'chat:config')]: chatConfigJson({ objective: 'P' }),
      [tenantKey('c1', 'agent:profile')]: profileJson({
        tenantId: 'c1', childInheritanceEnabled: true, parentTenantId: 'p',
      }),
    })
    const result = await propagateParent(kv, undefined, 'p')
    expect(result).toEqual({
      tenantId: 'p',
      effectiveRevision: expect.stringMatching(/^p:/),
      parentTenantId: null,
      childInheritanceEnabled: false,
      propagatedChildren: [{ tenantId: 'c1', effectiveRevision: expect.stringMatching(/^c1:/) }],
    })
  })

  it('returns empty propagation when there are no children', async () => {
    const kv = makeKV({
      [tenantKey('p', 'agent:profile')]: profileJson({ tenantId: 'p' }),
      [tenantKey('p', 'chat:config')]: chatConfigJson({ objective: 'P' }),
    })
    const result = await propagateParent(kv, undefined, 'p')
    expect(result.propagatedChildren).toEqual([])
    expect(result.effectiveRevision).toEqual(expect.stringMatching(/^p:/))
  })
})

// ---------------------------------------------------------------------------
// renderConfigPage
// ---------------------------------------------------------------------------

describe('renderConfigPage', () => {
  const profile: AgentProfile = {
    tenantId: 'acme',
    name: 'Acme Bank',
    parentInheritanceEnabled: true,
    childInheritanceEnabled: false,
    parentTenantId: 'parentco',
    updatedAt: 123,
    sourceRef: 'seed',
  }

  it('renders profile name, tenant and effective config summary', () => {
    const html = renderConfigPage(profile, [], [], { effectiveRevision: 'r1', objective: 'Intake', ui: { title: 'Acme UI' }, knowledgeBase: { topics: ['rates'] } })
    expect(html).toContain('<h3>Agent Config — Acme Bank</h3>')
    expect(html).toContain('tenant: acme')
    expect(html).toContain('tenant:acme:chat:config')
    expect(html).toContain('r1')
    expect(html).toContain('Intake')
    expect(html).toContain('Acme UI')
    // JSON.stringify output is HTML-escaped (quotes → &quot;)
    expect(html).toContain('[&quot;rates&quot;]')
  })

  it('appends token to form actions when provided', () => {
    const withToken = renderConfigPage(profile, [], [], {}, 'tok en')
    // NOTE: the `&` in qs is inserted raw (not escaped)
    expect(withToken).toContain('parent-toggle?tenant=acme&token=tok%20en')
    expect(withToken).toContain('child-toggle?tenant=acme&token=tok%20en')

    const without = renderConfigPage(profile, [], [], {})
    expect(without).toContain('parent-toggle?tenant=acme"')
    expect(without).not.toContain('token=')
  })

  it('marks the matching parent option as selected', () => {
    const parents: AgentProfile[] = [
      { tenantId: 'parentco', name: 'Parent Co', parentInheritanceEnabled: true, childInheritanceEnabled: false, parentTenantId: null, updatedAt: 1, sourceRef: 's' },
      { tenantId: 'otherco', name: 'Other Co', parentInheritanceEnabled: true, childInheritanceEnabled: false, parentTenantId: null, updatedAt: 1, sourceRef: 's' },
    ]
    const html = renderConfigPage(profile, parents, [], {})
    expect(html).toContain('<option value="parentco" selected>Parent Co (parentco)</option>')
    expect(html).toContain('<option value="otherco">Other Co (otherco)</option>')
  })

  it('renders the empty state when there are no children', () => {
    const html = renderConfigPage(profile, [], [], {})
    expect(html).toContain('No active children.')
    expect(html).not.toContain('<ul>')
  })

  it('renders child list with last sync timestamp from effective.updatedAt', () => {
    const children: AgentProfile[] = [
      { tenantId: 'c1', name: 'Child One', parentInheritanceEnabled: false, childInheritanceEnabled: true, parentTenantId: 'acme', updatedAt: 1, sourceRef: 's' },
    ]
    const html = renderConfigPage(profile, [], children, { updatedAt: 987654 })
    expect(html).toContain('Child One — c1 — last sync 987654')
    expect(html).toContain('<ul>')
  })

  it('escapes HTML in names, ids and effective values', () => {
    const evilProfile: AgentProfile = { ...profile, name: '<script>alert(1)</script>', tenantId: 'x&y' }
    const html = renderConfigPage(evilProfile, [], [], { objective: '<b>bold</b>', title: '"quoted"' })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('tenant: x&amp;y')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    // fallbacks when fields are missing
    const empty = renderConfigPage(profile, [], [], {})
    expect(empty).toContain('—')
  })
})

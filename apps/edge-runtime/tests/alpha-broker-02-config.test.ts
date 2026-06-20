function assertEqual(actual: unknown, expected: unknown, message = 'Assertion failed') {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertDeepEqual(actual: unknown, expected: unknown, message = 'Assertion failed') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

import { guardKV } from '../src/lib/kv'
import { MemoryKvStore } from '../src/lib/publish'
import {
  cloneTenantConfig,
  getAgentProfile,
  getChildren,
  getEffectiveConfig,
  listActiveParents,
  propagateParent,
  rebuildTenantConfig,
  setChildInheritance,
  setParentInheritance,
} from '../src/lib/config-inheritance'

class JsonMemoryKvStore extends MemoryKvStore {
  override async get(key: string, type?: string): Promise<any> {
    const raw = await super.get(key)
    if (type === 'json' && raw) return JSON.parse(raw)
    return raw
  }
}

async function putJson(kvStore: JsonMemoryKvStore, tenantId: string, suffix: string, value: unknown) {
  const kv = guardKV(kvStore as any) as any
  await kv.put(`tenant:${tenantId}:${suffix}`, JSON.stringify(value), { tenantId })
}

async function putRaw(kvStore: JsonMemoryKvStore, tenantId: string, suffix: string, value: string) {
  const kv = guardKV(kvStore as any) as any
  await kv.put(`tenant:${tenantId}:${suffix}`, value, { tenantId })
}

async function createAlphaBroker01(kvStore: JsonMemoryKvStore) {
  const kv = guardKV(kvStore as any) as any
  await putJson(kvStore, 'alpha-broker-01', '', {
    tenantId: 'alpha-broker-01',
    slug: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    createdAt: '2026-06-20T00:00:00.000Z',
    plan: 'free',
  })
  await putJson(kvStore, 'alpha-broker-01', 'chat:config', {
    tenantId: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    objective: 'Alpha Broker 01 — Customer intake',
    fields: [{ fieldName: 'fullName', label: 'Full Name', fieldType: 'text' }],
    priorityOrder: ['fullName'],
    knowledgeBase: { topics: ['rates', 'products', 'policy', 'fees', 'compliance', 'general'] },
    ui: { title: 'Alpha Broker 01', greeting: 'Welcome to Alpha Broker 01', colorAccent: '#58a6ff' },
  })
  await putJson(kvStore, 'alpha-broker-01', 'kb:general', {
    entries: [{ id: 'general_parent', type: 'knowledge', value: 'Parent general fact', description: 'Parent general fact', source_ref: 'test', updated_at: 1 }],
    source_ref: 'test',
    updated_at: 1,
  })
  await putRaw(kvStore, 'alpha-broker-01', 'layout:latest', 'layout-json')
  await putJson(kvStore, 'alpha-broker-01', 'site', {
    title: 'Alpha Broker 01',
    tenant: 'alpha-broker-01',
    theme: 'dark-midnight',
    pages: { home: { content: '<p>Alpha Broker 01 site</p>' } },
  })
  await setParentInheritance(kvStore, 'alpha-broker-01', true)
  return kv
}

async function cloneAlphaBroker02(kvStore: JsonMemoryKvStore) {
  const result = await cloneTenantConfig(kvStore, {}, {
    sourceTenantId: 'alpha-broker-01',
    targetTenantId: 'alpha_broker_02',
    targetName: 'Alpha Broker 02',
    parentLink: true,
  })
  assertEqual(result.sourceTenantId, 'alpha-broker-01')
  assertEqual(result.kbTopicsCopied, 1)
  assertEqual(result.rulesCopied, 0)
}

async function main() {
  const kvStore = new JsonMemoryKvStore()
  const kv = guardKV(kvStore as any) as any
  await createAlphaBroker01(kvStore)
  await cloneAlphaBroker02(kvStore)

  const childProfile = await getAgentProfile(kv, 'alpha_broker_02')
  assertEqual(childProfile?.childInheritanceEnabled, true)
  assertEqual(childProfile?.parentTenantId, 'alpha-broker-01')

  const childEffective = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertEqual(childEffective.tenantId, 'alpha_broker_02')
  assertEqual(childEffective.name, 'Alpha Broker 02')
  assertEqual(childEffective.objective, 'Alpha Broker 02 — Customer intake')
  assertEqual(childEffective.ui.title, 'Alpha Broker 02')
  assertDeepEqual(childEffective.knowledgeBase.topics, ['rates', 'products', 'policy', 'fees', 'compliance', 'general'])

  const siteRaw = await kvStore.get('tenant:alpha_broker_02:site') as string
  const site = JSON.parse(siteRaw)
  assertEqual(site.title, 'Alpha Broker 02')
  assertEqual(site.tenant, 'alpha_broker_02')

  const parents = await listActiveParents(kv, 'alpha_broker_02')
  assertEqual(parents.length, 1)
  assertEqual(parents[0].tenantId, 'alpha-broker-01')

  const children = await getChildren(kv, 'alpha-broker-01')
  assertEqual(children.length, 1)
  assertEqual(children[0].tenantId, 'alpha_broker_02')

  await putJson(kvStore, 'alpha-broker-01', 'chat:config', {
    tenantId: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    objective: 'Alpha Broker 01 — Updated parent intake',
    fields: [
      { fieldName: 'fullName', label: 'Full Name', fieldType: 'text' },
      { fieldName: 'mobile', label: 'Mobile Number', fieldType: 'tel' },
      { fieldName: 'loanPurpose', label: 'Loan Purpose', fieldType: 'select' },
    ],
    priorityOrder: ['fullName', 'mobile', 'loanPurpose'],
    knowledgeBase: { topics: ['rates', 'products', 'policy', 'fees', 'compliance', 'general'] },
    ui: { title: 'Alpha Broker 01 Updated', greeting: 'Welcome to Alpha Broker 01 Updated', colorAccent: '#58a6ff' },
  })
  await rebuildTenantConfig(kvStore, {}, 'alpha-broker-01')

  const childAfterParentUpdate = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertDeepEqual(childAfterParentUpdate.priorityOrder, ['fullName', 'mobile', 'loanPurpose'])
  assertEqual(childAfterParentUpdate.objective, 'Alpha Broker 02 — Customer intake')
  assertEqual(childAfterParentUpdate.ui.title, 'Alpha Broker 02')

  await setChildInheritance(kvStore, 'alpha_broker_02', false)
  const detached = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertDeepEqual(detached.priorityOrder, ['fullName', 'mobile', 'loanPurpose'])
  assertEqual(detached.objective, 'Alpha Broker 02 — Customer intake')
  assertEqual(detached.ui.title, 'Alpha Broker 02')

  await putJson(kvStore, 'alpha-broker-01', 'chat:config', {
    tenantId: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    objective: 'Alpha Broker 01 — Detached parent update',
    fields: [{ fieldName: 'email', label: 'Email', fieldType: 'email' }],
    priorityOrder: ['email'],
    knowledgeBase: { topics: ['rates', 'products', 'policy', 'fees', 'compliance', 'general'] },
    ui: { title: 'Alpha Broker 01 Detached Update', greeting: 'Welcome', colorAccent: '#58a6ff' },
  })
  await propagateParent(kvStore, {}, 'alpha-broker-01')

  const childAfterDetachedParentUpdate = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertDeepEqual(childAfterDetachedParentUpdate.priorityOrder, ['fullName', 'mobile', 'loanPurpose'])
  assertEqual(childAfterDetachedParentUpdate.objective, 'Alpha Broker 02 — Customer intake')
  assertEqual(childAfterDetachedParentUpdate.ui.title, 'Alpha Broker 02')

  console.log('alpha-broker-02 config inheritance tests passed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

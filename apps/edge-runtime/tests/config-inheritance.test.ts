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
  ensureAgentProfile,
  getChildren,
  getEffectiveConfig,
  listActiveParents,
  rebuildTenantConfig,
  setChildInheritance,
  setParentInheritance,
} from '../src/lib/config-inheritance'

// Test-only helpers are exported from config-inheritance.test-support.ts.
async function putConfig(kv: any, tenantId: string, suffix: string, value: any) {
  const guarded = guardKV(kv)
  await guarded.put(`tenant:${tenantId}:${suffix}`, value, { tenantId })
}

class JsonMemoryKvStore extends MemoryKvStore {
  override async get(key: string, type?: string): Promise<any> {
    const raw = await super.get(key)
    if (type === 'json' && raw) return JSON.parse(raw)
    return raw
  }
}

async function main() {
  const kvStore = new JsonMemoryKvStore()
  const kv = guardKV(kvStore as any)

  await putConfig(kvStore, 'alpha-broker-01', '', {
    tenantId: 'alpha-broker-01',
    slug: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    createdAt: new Date().toISOString(),
    plan: 'free',
  })
  await putConfig(kvStore, 'alpha-broker-01', 'chat:config', {
    tenantId: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    objective: 'Alpha Broker 01 — Customer intake',
    fields: [{ fieldName: 'fullName', label: 'Full Name', fieldType: 'text' }],
    priorityOrder: ['fullName'],
    knowledgeBase: { topics: ['rates', 'compliance'] },
    ui: { title: 'Alpha Broker 01', greeting: 'Welcome to Alpha Broker 01', colorAccent: '#58a6ff' },
  })
  await putConfig(kvStore, 'alpha-broker-01', 'kb:rates', {
    entries: [{ id: 'parent_rate_fact', type: 'knowledge', value: 'Parent rate fact', description: 'Shared', source_ref: 'test', updated_at: Date.now() }],
    source_ref: 'test',
    updated_at: Date.now(),
  })

  await ensureAgentProfile(kv, 'alpha-broker-01')
  await setParentInheritance(kvStore as any, 'alpha-broker-01', true)

  const clone = await cloneTenantConfig(kvStore as any, {}, {
    sourceTenantId: 'alpha-broker-01',
    targetTenantId: 'alpha_broker_02',
    targetName: 'Alpha Broker 02',
    parentLink: true,
  })
  assertEqual(clone.sourceTenantId, 'alpha-broker-01')
  assertEqual(clone.kbTopicsCopied, 1)

  const childEffective = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertEqual(childEffective.ui.title, 'Alpha Broker 02')
  assertEqual(childEffective.objective, 'Alpha Broker 02 — Customer intake')
  assertDeepEqual(childEffective.knowledgeBase.topics, ['rates', 'compliance'])

  const parents = await listActiveParents(kv, 'alpha_broker_02')
  assertEqual(parents.length, 1)
  assertEqual(parents[0].tenantId, 'alpha-broker-01')

  const children = await getChildren(kv, 'alpha-broker-01')
  assertEqual(children.length, 1)
  assertEqual(children[0].tenantId, 'alpha_broker_02')

  await putConfig(kvStore, 'alpha-broker-01', 'chat:config', {
    ...childEffective,
    tenantId: 'alpha-broker-01',
    name: 'Alpha Broker 01',
    objective: 'Alpha Broker 01 — Updated parent intake',
    fields: [
      { fieldName: 'fullName', label: 'Full Name', fieldType: 'text' },
      { fieldName: 'mobile', label: 'Mobile Number', fieldType: 'tel' },
    ],
    priorityOrder: ['fullName', 'mobile'],
    ui: { ...childEffective.ui, title: 'Alpha Broker 01 Updated' },
  })
  await rebuildTenantConfig(kvStore as any, {}, 'alpha-broker-01')

  const childAfterParentUpdate = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertDeepEqual(childAfterParentUpdate.priorityOrder, ['fullName', 'mobile'])
  assertEqual(childAfterParentUpdate.objective, 'Alpha Broker 02 — Customer intake')
  assertEqual(childAfterParentUpdate.ui.title, 'Alpha Broker 02')

  await setChildInheritance(kvStore as any, 'alpha_broker_02', false)
  const detached = await getEffectiveConfig(kv, 'alpha_broker_02')
  assertDeepEqual(detached.priorityOrder, ['fullName', 'mobile'])
  assertEqual(detached.objective, 'Alpha Broker 02 — Customer intake')
  assertEqual(detached.ui.title, 'Alpha Broker 02')

  console.log('config-inheritance tests passed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

/**
 * EdgeGDE — Chat Config Production Tests
 *
 * Run: npx tsx tests/chat-config-production.test.ts
 */
let pass = 0
let fail = 0

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) throw new Error(message || `Expected ${actual} to equal ${expected}`)
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(message || `Expected ${a} to equal ${e}`)
}

function assertOk(condition: unknown, message = 'Expected condition to be truthy') {
  assert(condition, message)
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    fail++
    console.log(`  ✗ ${name}: ${err.message}`)
  }
}

function memoryKv() {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string) {
      return store.get(key) || null
    },
    async put(key: string, value: string | object) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    },
  }
}

function validConfig(overrides: Record<string, unknown> = {}): any {
  const config = {
    schemaVersion: 1,
    objective: 'Collect mortgage readiness information',
    fields: [
      { fieldName: 'fullName', label: 'Full Name', fieldType: 'text', validation: { required: true }, placeholder: 'Your full name' },
      { fieldName: 'income', label: 'Annual Income', fieldType: 'number', validation: { required: true, min: 0 }, placeholder: '0' },
      { fieldName: 'loanPurpose', label: 'Loan Purpose', fieldType: 'select', options: ['purchase', 'refinance'], validation: { required: true } },
    ],
    priorityOrder: ['fullName', 'income', 'loanPurpose'],
    rules: [
      { if: 'income >= 100000', set: { field: 'loanPurpose', value: 'refinance' } },
    ],
    knowledgeBase: {
      topics: ['rates', 'compliance'],
      systemInstructions: 'Use concise mortgage guidance.',
    },
    ui: { title: 'EdgeGDE Chat', greeting: "Welcome! Let's get started.", colorAccent: '#58a6ff' },
  }

  function merge(base: any, extra: Record<string, unknown>): any {
    const out = Array.isArray(base) ? [...base] : { ...base }
    for (const [key, value] of Object.entries(extra)) {
      out[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? merge(out[key] || {}, value as Record<string, unknown>)
        : value
    }
    return out
  }

  return merge(config, overrides)
}

async function run() {
  const {
    ChatConfigSchema,
    FALLBACK_CONFIG,
    formatZodIssues,
    getEffectiveChatConfig,
    loadGlobalChatConfig,
    loadTenantChatConfig,
    mergeChatConfig,
    parseChatConfig,
    saveChatConfig,
    tenantChatConfigKey,
    tenantChatSnapshotKey,
  } = await import('../src/lib/chat-config')

  console.log('\n── Chat Config Production Tests ──')

  await test('schema accepts valid chat config and defaults', async () => {
    const config = parseChatConfig({
      objective: 'Collect contact info',
      fields: [{ fieldName: 'email', label: 'Email Address', fieldType: 'email' }],
      priorityOrder: ['email'],
    })
    assertEqual(config.schemaVersion, 1)
    assertEqual(config.fields[0].fieldType, 'email')
    assertEqual(config.fields[0].validation.required, true)
    assertDeepEqual(config.rules, [])
    assertEqual(config.ui.colorAccent, '#58a6ff')
  })

  await test('schema rejects invalid select field', async () => {
    try {
      ChatConfigSchema.parse(validConfig({
        fields: [{ fieldName: 'purpose', label: 'Purpose', fieldType: 'select' }],
        priorityOrder: ['purpose'],
      }))
      throw new Error('expected ZodError')
    } catch (err: any) {
      assertOk(err.issues?.length, 'expected zod issues')
      assertOk(err.issues.some((issue: any) => issue.path.join('.') === 'fields.0.options'))
    }
  })

  await test('schema rejects non-deterministic rule', async () => {
    try {
      ChatConfigSchema.parse(validConfig({
        rules: [{ if: 'income > 100000 or fraud = true', set: { field: 'income', value: 0 } }],
      }))
      throw new Error('expected ZodError')
    } catch (err: any) {
      assertOk(err.issues?.some((issue: any) => issue.path.join('.') === 'rules.0.if'))
    }
  })

  await test('formatZodIssues returns path/message pairs', async () => {
    try {
      ChatConfigSchema.parse(validConfig({ priorityOrder: ['fullName'] }))
      throw new Error('expected ZodError')
    } catch (err: any) {
      const details = formatZodIssues(err)
      assertOk(details.some((d: any) => d.path === 'priorityOrder' || d.path === 'priorityOrder.0'))
      assertOk(details.every((d: any) => typeof d.message === 'string'))
    }
  })

  await test('saveChatConfig writes latest and snapshot keys', async () => {
    const kv = memoryKv()
    const config = validConfig()
    const result = await saveChatConfig(kv, 'tenant', 'tenant-a', config)

    assertEqual(result.key, tenantChatConfigKey('tenant-a'))
    assertEqual(result.snapshotKey, tenantChatSnapshotKey('tenant-a', result.hash))
    assertEqual(JSON.parse(kv.store.get(result.key)!).objective, config.objective)
    assertEqual(JSON.parse(kv.store.get(result.snapshotKey)!).ui.title, config.ui.title)
  })

  await test('loadGlobalChatConfig falls back on invalid persisted config', async () => {
    const kv = memoryKv()
    await kv.put('global:chat:config:latest', JSON.stringify({ objective: '', fields: [], priorityOrder: [] }))

    const config = await loadGlobalChatConfig(kv)
    assertDeepEqual(config, FALLBACK_CONFIG)
  })

  await test('loadTenantChatConfig ignores invalid tenant config', async () => {
    const kv = memoryKv()
    await kv.put(tenantChatConfigKey('tenant-a'), JSON.stringify(validConfig({ priorityOrder: ['fullName'] })))

    const config = await loadTenantChatConfig(kv, 'tenant-a')
    assertEqual(config, null)
  })

  await test('getEffectiveChatConfig merges global baseline with tenant overlay', async () => {
    const kv = memoryKv()
    await saveChatConfig(kv, 'global', 'global', validConfig({
      knowledgeBase: { topics: ['rates'], systemInstructions: 'Global instructions.' },
      ui: { title: 'Global Chat', greeting: 'Global greeting', colorAccent: '#238636' },
    }))
    await saveChatConfig(kv, 'tenant', 'tenant-a', validConfig({
      knowledgeBase: { topics: ['preapproval'], systemInstructions: 'Tenant instructions.' },
      ui: { title: 'Tenant Chat', greeting: 'Tenant greeting', colorAccent: '#3fb950' },
    }))

    const effective = await getEffectiveChatConfig(kv, 'tenant-a')
    assertDeepEqual(effective.knowledgeBase.topics, ['rates', 'preapproval'])
    assertEqual(effective.knowledgeBase.systemInstructions, 'Tenant instructions.')
    assertEqual(effective.ui.title, 'Tenant Chat')
    assertEqual(effective.ui.colorAccent, '#3fb950')
  })

  await test('getEffectiveChatConfig falls back to global when tenant config is invalid', async () => {
    const kv = memoryKv()
    await saveChatConfig(kv, 'global', 'global', validConfig({ ui: { title: 'Global Only' } }))
    await kv.put(tenantChatConfigKey('tenant-a'), JSON.stringify(validConfig({ priorityOrder: ['fullName'] })))

    const effective = await getEffectiveChatConfig(kv, 'tenant-a')
    assertEqual(effective.ui.title, 'Global Only')
  })

  await test('mergeChatConfig is deterministic and validates output', async () => {
    const globalConfig = validConfig({ knowledgeBase: { topics: ['rates'], systemInstructions: 'Global' }, ui: { title: 'Global' } })
    const tenantConfig = validConfig({ knowledgeBase: { topics: ['refi'], systemInstructions: 'Tenant' }, ui: { title: 'Tenant' } })

    const merged = mergeChatConfig(globalConfig, tenantConfig)
    assertDeepEqual(parseChatConfig(merged).knowledgeBase.topics, ['rates', 'refi'])
    assertEqual(parseChatConfig(merged).ui.title, 'Tenant')
  })

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) throw new Error(`${fail} test(s) failed`)
}

run().catch((err: any) => {
  console.error(err)
  throw err
})

/**
 * EdgeGDE — Unit Tests: Zod Schemas (Blueprint, PackRef, ChatConfig)
 * Tests schema validation rules, defaults, and determinism.
 *
 * Run: npx tsx tests/unit-schema.test.ts
 */
let pass = 0, fail = 0
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e: any) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}

async function run() {
  const { ChatConfigSchema } = await import('../src/lib/chat-config')
  const { BlueprintSchema, PackRefSchema, BlueprintFieldSchema } =
    await import('../src/factory/blueprint/blueprint.schema')

  console.log('\n── Schema Unit Tests ──')

  // ── ChatConfigSchema ──────────────────────────────────────────────

  await test('ChatConfigSchema: rejects empty objective', async () => {
    try {
      ChatConfigSchema.parse({
        objective: '',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: ['a'],
      })
      throw new Error('expected ZodError but parse succeeded')
    } catch (e: any) {
      if (!e.issues && !e.name?.includes('Zod')) {
        throw new Error(`unexpected error type: ${e.constructor?.name ?? typeof e}`)
      }
    }
  })

  await test('ChatConfigSchema: rejects empty fields array', async () => {
    try {
      ChatConfigSchema.parse({
        objective: 'test',
        fields: [],
        priorityOrder: ['a'],
      })
      throw new Error('expected ZodError but parse succeeded')
    } catch (e: any) {
      if (!e.issues && !e.name?.includes('Zod')) {
        throw new Error(`unexpected error type: ${e.constructor?.name ?? typeof e}`)
      }
    }
  })

  await test('ChatConfigSchema: rejects empty priorityOrder', async () => {
    try {
      ChatConfigSchema.parse({
        objective: 'test',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: [],
      })
      throw new Error('expected ZodError but parse succeeded')
    } catch (e: any) {
      if (!e.issues && !e.name?.includes('Zod')) {
        throw new Error(`unexpected error type: ${e.constructor?.name ?? typeof e}`)
      }
    }
  })

  await test('ChatConfigSchema: accepts valid config with defaults', async () => {
    const result = ChatConfigSchema.parse({
      objective: 'Collect contact info',
      fields: [{ fieldName: 'email', label: 'Email Address' }],
      priorityOrder: ['email'],
    })
    if (result.objective !== 'Collect contact info') throw new Error('objective mismatch')
    if (result.fields.length !== 1) throw new Error('expected 1 field')
    if (result.fields[0].fieldType !== 'text') throw new Error('expected default fieldType "text"')
    if (result.fields[0].validation.required !== true) throw new Error('expected default validation required=true')
    if (!Array.isArray(result.rules)) throw new Error('expected default rules array')
    if (!result.knowledgeBase || !Array.isArray(result.knowledgeBase.topics)) throw new Error('expected default knowledgeBase')
  })

  // ── BlueprintSchema ───────────────────────────────────────────────

  await test('BlueprintSchema: accepts valid blueprint with 2 fields + priorityOrder', async () => {
    const result = BlueprintSchema.parse({
      id: 'bp-loan',
      version: '1.0.0',
      fields: [
        { fieldName: 'income', label: 'Annual Income', fieldType: 'number' },
        { fieldName: 'name', label: 'Full Name', fieldType: 'text' },
      ],
      priorityOrder: ['income', 'name'],
    })
    if (result.id !== 'bp-loan') throw new Error('id mismatch')
    if (result.version !== '1.0.0') throw new Error('version mismatch')
    if (result.fields.length !== 2) throw new Error('expected 2 fields')
    if (result.priorityOrder.length !== 2) throw new Error('expected 2 priority entries')
  })

  await test('BlueprintSchema: rejects missing id', async () => {
    try {
      BlueprintSchema.parse({
        version: '1.0.0',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: ['a'],
      })
      throw new Error('expected ZodError but parse succeeded')
    } catch (e: any) {
      if (!e.issues && !e.name?.includes('Zod')) {
        throw new Error(`unexpected error type: ${e.constructor?.name ?? typeof e}`)
      }
    }
  })

  await test('BlueprintSchema: rejects missing version', async () => {
    try {
      BlueprintSchema.parse({
        id: 'bp-test',
        fields: [{ fieldName: 'a', label: 'A' }],
        priorityOrder: ['a'],
      })
      throw new Error('expected ZodError but parse succeeded')
    } catch (e: any) {
      if (!e.issues && !e.name?.includes('Zod')) {
        throw new Error(`unexpected error type: ${e.constructor?.name ?? typeof e}`)
      }
    }
  })

  // ── PackRefSchema ─────────────────────────────────────────────────

  await test('PackRefSchema: validates {name, version} object', async () => {
    const result = PackRefSchema.parse({ name: 'lvr-pack', version: '2.1.0' })
    if (result.name !== 'lvr-pack') throw new Error('name mismatch')
    if (result.version !== '2.1.0') throw new Error('version mismatch')
  })

  await test('PackRefSchema: rejects flat string', async () => {
    try {
      PackRefSchema.parse('lvr-pack')
      throw new Error('expected ZodError but parse succeeded')
    } catch (e: any) {
      if (!e.issues && !e.name?.includes('Zod')) {
        throw new Error(`unexpected error type: ${e.constructor?.name ?? typeof e}`)
      }
    }
  })

  // ── Determinism ───────────────────────────────────────────────────

  await test('Determinism: 5 identical parses produce identical output', async () => {
    const input = {
      id: 'bp-deter',
      version: '1.0.0',
      fields: [
        { fieldName: 'x', label: 'X', fieldType: 'text' },
        { fieldName: 'y', label: 'Y', fieldType: 'number' },
      ],
      priorityOrder: ['x', 'y'],
    }
    const first = BlueprintSchema.parse(input)
    for (let i = 0; i < 5; i++) {
      const result = BlueprintSchema.parse(input)
      if (JSON.stringify(result) !== JSON.stringify(first)) {
        throw new Error(`Non-deterministic result at iteration ${i}`)
      }
    }
  })

  // ═══ Projection invariant: all field properties survive full schema parse ═══
  test('ChatConfigSchema: preserves all field properties through parse', async () => {
    const input = {
      objective: 'Test invariant',
      fields: [
        { fieldName: 'test1', label: 'Test 1', fieldType: 'text', prompt: 'What is test 1?', options: ['A', 'B'], placeholder: 'Enter here', validation: { required: true } },
        { fieldName: 'test2', label: 'Test 2', fieldType: 'number', validation: { required: true } },
      ],
      priorityOrder: ['test1', 'test2'],
      knowledgeBase: { topics: [] },
    }
    const parsed = ChatConfigSchema.parse(input)
    const f = parsed.fields[0]
    if (f.fieldName !== 'test1') throw new Error('fieldName lost')
    if (f.label !== 'Test 1') throw new Error('label lost')
    if (f.prompt !== 'What is test 1?') throw new Error(`prompt lost or wrong: "${f.prompt}"`)
    if (!f.options || f.options.length !== 2) throw new Error('options lost')
    if (f.placeholder !== 'Enter here') throw new Error('placeholder lost')
    if (!f.validation?.required) throw new Error('validation lost')
  })

  // ═══ Summary ═══
  console.log('')
  if (fail > 0) {
    console.error(`❌ ${fail}/${pass + fail} schema tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ All ${pass} schema tests passed`)
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1) })

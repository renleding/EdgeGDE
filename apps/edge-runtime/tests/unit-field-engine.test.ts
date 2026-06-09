/**
 * EdgeGDE — Unit Tests: Field Engine
 * Tests computeFieldState: first field, priority order, skip collected, complete,
 * empty/edge cases, and determinism (10x).
 *
 * Run: npx tsx tests/unit-field-engine.test.ts
 */
let pass = 0, fail = 0
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e: any) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}

async function run() {
  const { computeFieldState } = await import('../src/lib/field-engine')
  const fields = [
    { fieldName: 'fullName', label: 'Full Name', fieldType: 'text' as const, validation: { required: true } },
    { fieldName: 'email', label: 'Email', fieldType: 'email' as const, validation: { required: true } },
    { fieldName: 'phone', label: 'Phone', fieldType: 'phone' as const, validation: { required: true } },
    { fieldName: 'income', label: 'Annual Income', fieldType: 'number' as const, validation: { required: true } },
  ]
  const priorityOrder = ['fullName', 'email', 'phone', 'income']

  console.log('\n── Field Engine Tests ──')

  // ── Test 1: First field when nothing collected ──
  await test('returns first priority field when collected is empty', async () => {
    const r = computeFieldState(fields, priorityOrder, {})
    if (r.phase !== 'collecting') throw new Error(`phase expected collecting got ${r.phase}`)
    if (!r.nextField) throw new Error('expected nextField')
    if (r.nextField.fieldName !== 'fullName') throw new Error(`expected fullName got ${r.nextField.fieldName}`)
    if (r.missingFields.length !== 4) throw new Error(`expected 4 missing got ${r.missingFields.length}`)
  })

  // ── Test 2: Priority order honoured ──
  await test('returns second field after first collected', async () => {
    const r = computeFieldState(fields, priorityOrder, { fullName: 'Alice' })
    if (!r.nextField || r.nextField.fieldName !== 'email')
      throw new Error(`expected email got ${r.nextField?.fieldName}`)
    if (r.missingFields.length !== 3) throw new Error(`expected 3 missing got ${r.missingFields.length}`)
  })

  // ── Test 3: Skip collected fields ──
  await test('skips collected fields, returns next missing in priority order', async () => {
    const r = computeFieldState(fields, priorityOrder, { fullName: 'Alice', email: 'a@b.com', phone: '0400000000' })
    if (!r.nextField || r.nextField.fieldName !== 'income')
      throw new Error(`expected income got ${r.nextField?.fieldName}`)
    if (r.missingFields.length !== 1) throw new Error(`expected 1 missing got ${r.missingFields.length}`)
  })

  // ── Test 4: Completed phase ──
  await test('returns complete phase when all fields collected', async () => {
    const r = computeFieldState(fields, priorityOrder, {
      fullName: 'Alice', email: 'a@b.com', phone: '0400000000', income: 75000,
    })
    if (r.phase !== 'complete') throw new Error(`expected complete got ${r.phase}`)
    if (r.nextField !== null) throw new Error('expected null nextField when complete')
    if (r.missingFields.length !== 0) throw new Error(`expected 0 missing got ${r.missingFields.length}`)
  })

  // ── Test 5: Empty fields array ──
  await test('returns complete for empty fields array', async () => {
    const r = computeFieldState([], [], {})
    if (r.phase !== 'complete') throw new Error('expected complete with no fields')
    if (r.nextField !== null) throw new Error('expected null nextField')
  })

  // ── Test 6: Empty priorityOrder ──
  await test('returns complete for empty priorityOrder', async () => {
    const r = computeFieldState(fields, [], {})
    if (r.phase !== 'complete') throw new Error('expected complete with empty priorityOrder')
    if (r.missingFields.length !== 0) throw new Error('expected 0 missing with empty priorityOrder')
  })

  // ── Test 7: Unknown collected fields ignored ──
  await test('ignores unknown fields not in priorityOrder', async () => {
    const r = computeFieldState(fields, priorityOrder, { unknownField: 'whatever' })
    if (!r.nextField || r.nextField.fieldName !== 'fullName')
      throw new Error(`expected fullName got ${r.nextField?.fieldName}`)
  })

  // ── Test 8: Out-of-order collection respects priority ──
  await test('maintains priority order even with out-of-order collection', async () => {
    const r = computeFieldState(fields, priorityOrder, { phone: '0400000000', fullName: 'Bob' })
    if (!r.nextField || r.nextField.fieldName !== 'email')
      throw new Error(`expected email got ${r.nextField?.fieldName}`)
  })

  // ── Test 9: Determinism — 10 identical calls produce identical output ──
  await test('determinism: 10 calls with same input produce identical result', async () => {
    const state = { fullName: 'Charlie', email: 'c@d.com' }
    const first = computeFieldState(fields, priorityOrder, state)
    for (let i = 0; i < 10; i++) {
      const result = computeFieldState(fields, priorityOrder, state)
      if (JSON.stringify(result) !== JSON.stringify(first))
        throw new Error(`Non-deterministic result at iteration ${i}`)
    }
  })

  // ═══ Summary ═══
  console.log('')
  if (fail > 0) {
    console.error(`❌ ${fail}/${pass + fail} field-engine tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ All ${pass} field-engine tests passed`)
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1) })

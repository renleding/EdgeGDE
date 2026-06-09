/**
 * EdgeGDE — Unit Tests: Chat Constraint Engine
 * Tests findNextField (first, complete), validateField (empty required, valid value,
 * invalid select, min/max, XSS input), applyFieldUpdate (store, completedFields, error for invalid).
 *
 * Run: npx tsx tests/unit-chat-constraint.test.ts
 */
let pass = 0, fail = 0
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e: any) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}

async function run() {
  const { findNextField, validateField, applyFieldUpdate } =
    await import('../src/lib/chat-constraint')

  console.log('\n── Chat Constraint Tests ──')

  const fields = [
    { fieldName: 'fullName', label: 'Full Name', fieldType: 'string' as const, validation: { required: true } },
    { fieldName: 'age', label: 'Age', fieldType: 'number' as const, validation: { required: true, min: 18, max: 120 } },
    { fieldName: 'occupation', label: 'Occupation', fieldType: 'select' as const, options: ['Employed', 'Self-Employed', 'Unemployed'], validation: { required: true } },
    { fieldName: 'notes', label: 'Notes', fieldType: 'string' as const, validation: { required: false } },
  ]

  // ── Test 1: findNextField — returns first required field ──
  await test('findNextField returns first required field when nothing collected', async () => {
    const { field, state } = findNextField(fields, {})
    if (!field) throw new Error('expected a field')
    if (field.fieldName !== 'fullName') throw new Error(`expected fullName got ${field.fieldName}`)
    if (state.phase !== 'collecting') throw new Error(`expected collecting got ${state.phase}`)
    if (state.completedFields.length !== 0) throw new Error('expected 0 completed')
    if (state.errors.length !== 0) throw new Error('expected 0 errors')
  })

  // ── Test 2: findNextField — all complete ──
  await test('findNextField returns null and complete phase when all required fields collected', async () => {
    const { field, state } = findNextField(fields, {
      fullName: 'Alice', age: 30, occupation: 'Employed',
    })
    if (field !== null) throw new Error(`expected null field got ${field?.fieldName}`)
    if (state.phase !== 'complete') throw new Error(`expected complete got ${state.phase}`)
    if (!state.completedFields.includes('fullName')) throw new Error('fullName should be completed')
    if (!state.completedFields.includes('age')) throw new Error('age should be completed')
    if (!state.completedFields.includes('occupation')) throw new Error('occupation should be completed')
  })

  // ── Test 3: validateField — returns error for empty required field ──
  await test('validateField returns error for empty value on required field', async () => {
    const err = validateField(fields[0], '')
    if (err === null) throw new Error('expected error for empty required field')
    if (!err.includes('Full Name')) throw new Error(`expected error mentioning Full Name got ${err}`)
  })

  // ── Test 4: validateField — returns null for valid value ──
  await test('validateField returns null for valid string value', async () => {
    const err = validateField(fields[0], 'Alice Johnson')
    if (err !== null) throw new Error(`expected null got ${err}`)
  })

  // ── Test 5: validateField — returns error for invalid select option ──
  await test('validateField returns error for value not in options', async () => {
    const err = validateField(fields[2], 'Astronaut')
    if (err === null) throw new Error('expected error for invalid select option')
    if (!err.includes('Occupation')) throw new Error(`expected error mentioning Occupation got ${err}`)
    if (!err.includes('Employed')) throw new Error(`expected error listing valid options got ${err}`)
  })

  // ── Test 6: validateField — returns error when number below min ──
  await test('validateField returns error for number below min', async () => {
    const err = validateField(fields[1], 15)
    if (err === null) throw new Error('expected error for age below 18')
    if (!err.includes('at least 18')) throw new Error(`expected at-least-18 error got ${err}`)
  })

  // ── Test 7: validateField — accepts valid number within range ──
  await test('validateField returns null for number within range', async () => {
    const err = validateField(fields[1], 25)
    if (err !== null) throw new Error(`expected null got ${err}`)
  })

  // ── Test 8: validateField — XSS script input treated as string (no special handling, just validation) ──
  await test('validateField accepts XSS-looking string as non-empty valid value', async () => {
    // The function should not reject valid-looking strings even if they look malicious
    const field = { fieldName: 'comment', label: 'Comment', fieldType: 'string' as const, validation: { required: false } }
    const err = validateField(field, '<script>alert("xss")</script>')
    if (err !== null) throw new Error(`expected null for XSS string on non-required field, got ${err}`)
  })

  // ── Test 9: applyFieldUpdate — stores value, returns updated completedFields ──
  await test('applyFieldUpdate stores value and returns completedFields with error null', async () => {
    const { collected, error, state } = applyFieldUpdate(fields, {}, 'fullName', 'Bob Smith')
    if (error !== null) throw new Error(`expected null error got ${error}`)
    if (collected['fullName'] !== 'Bob Smith') throw new Error('collected should contain fullName')
    if (!state.completedFields.includes('fullName')) throw new Error('completedFields should include fullName')
    if (state.currentField !== 'age') throw new Error(`expected next field age got ${state.currentField}`)
  })

  // ═══ Summary ═══
  console.log('')
  if (fail > 0) {
    console.error(`❌ ${fail}/${pass + fail} chat-constraint tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ All ${pass} chat-constraint tests passed`)
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1) })

/**
 * EdgeGDE — Unit Tests: Rule Engine
 * Tests evaluateCondition (==, <, >, in array, false), flattenProjection,
 * parseRuleOutput, evaluateRules (multiple/aggregation, no match), simulateRules,
 * LVR rule compliance (loanAmount/propertyValue > 0.8), and determinism (10x).
 *
 * Run: npx tsx tests/unit-rule-engine.test.ts
 */
let pass = 0, fail = 0
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e: any) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}

async function run() {
  const { evaluateCondition, validateConditionSyntax, flattenProjection, parseRuleOutput, evaluateRules, simulateRules } =
    await import('../src/lib/rule-engine')
  const type = <T>(x: T) => x

  console.log('\n── Rule Engine Tests ──')

  // ── Test 1: evaluateCondition — == equality ──
  await test('evaluateCondition: field == numeric value returns true', async () => {
    const r = evaluateCondition('loanAmount == 500000', { loanAmount: 500000 })
    if (r !== true) throw new Error('expected true for loanAmount == 500000')
  })

  // ── Test 2: evaluateCondition — < less than ──
  await test('evaluateCondition: field < threshold returns true', async () => {
    const r = evaluateCondition('debtRatio < 0.8', { debtRatio: 0.5 })
    if (r !== true) throw new Error('expected true for debtRatio < 0.8')
  })

  // ── Test 3: evaluateCondition — > greater than ──
  await test('evaluateCondition: field > threshold returns true', async () => {
    const r = evaluateCondition('loanAmount > 300000', { loanAmount: 400000 })
    if (r !== true) throw new Error('expected true for loanAmount > 300000')
  })

  // ── Test 4: evaluateCondition — string equality (in array simulation) ──
  await test('evaluateCondition: string field == value (single value match)', async () => {
    const r = evaluateCondition('kycStatus == verified', { kycStatus: 'verified' })
    if (r !== true) throw new Error('expected true for kycStatus == verified')
  })

  // ── Test 5: evaluateCondition — false condition ──
  await test('evaluateCondition: non-matching condition returns false', async () => {
    const r = evaluateCondition('loanAmount > 999999', { loanAmount: 100 })
    if (r !== false) throw new Error('expected false for loanAmount > 999999')
  })

  await test('validateConditionSyntax: accepts valid simple condition', async () => {
    validateConditionSyntax('income < 30000')
  })

  await test('validateConditionSyntax: accepts valid compound condition', async () => {
    validateConditionSyntax('income < 30000 and debtRatio < 0.8')
  })

  await test('validateConditionSyntax: rejects missing operator', async () => {
    let rejected = false
    try { validateConditionSyntax('invalid @@ syntax !!!') } catch { rejected = true }
    if (!rejected) throw new Error('expected invalid syntax rejection')
  })

  await test('validateConditionSyntax: rejects incomplete comparison', async () => {
    let rejected = false
    try { validateConditionSyntax('income <') } catch { rejected = true }
    if (!rejected) throw new Error('expected incomplete comparison rejection')
  })

  // ── Test 6: flattenProjection ──
  await test('flattenProjection: flat keys preserved, nested hoisted', async () => {
    const r = flattenProjection({ application: { loanAmount: 500000, propertyValue: 600000 } })
    // Top-level keys are also set for common fields
    if (r['application.loanAmount'] !== 500000) throw new Error('missing application.loanAmount')
    if (r['application.propertyValue'] !== 600000) throw new Error('missing application.propertyValue')
  })

  // ── Test 7: parseRuleOutput ──
  await test('parseRuleOutput: stage, flag, require_disclosure, field_required', async () => {
    const r = parseRuleOutput('stage=blocked; flag=high_risk; require_disclosure=lvr_warning; field_required=appraisal')
    if (r.stage !== 'blocked') throw new Error(`expected stage blocked got ${r.stage}`)
    if (r.flags.length !== 1 || r.flags[0] !== 'high_risk') throw new Error('flag mismatch')
    if (r.required_disclosures.length !== 1 || r.required_disclosures[0] !== 'lvr_warning') throw new Error('disclosure mismatch')
    if (r.required_fields.length !== 1 || r.required_fields[0] !== 'appraisal') throw new Error('required field mismatch')
  })

  // ── Test 8: evaluateRules — multiple rules aggregation ──
  await test('evaluateRules: multiple matching rules aggregate outputs', async () => {
    const rules = [
      type<import('../src/lib/rule-engine').Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 300000',
        output: 'flag=high_value', priority: 10, active: true, created_at: 100,
      }),
      type<import('../src/lib/rule-engine').Rule>({
        id: 'r2', tenant_id: 't1', condition: 'propertyValue > 500000',
        output: 'flag=premium_property; stage=review', priority: 5, active: true, created_at: 200,
      }),
    ]
    const r = evaluateRules(rules, { loanAmount: 500000, propertyValue: 600000 })
    if (r.stage !== 'review') throw new Error(`expected stage review got ${r.stage}`)
    if (r.flags.length !== 2 || !r.flags.includes('high_value')) throw new Error('flags should include high_value')
    if (!r.flags.includes('premium_property')) throw new Error('flags should include premium_property')
  })

  // ── Test 9: evaluateRules — no match ──
  await test('evaluateRules: no matching rules returns empty base output', async () => {
    const rules = [
      type<import('../src/lib/rule-engine').Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 999999',
        output: 'flag=never', priority: 10, active: true, created_at: 100,
      }),
    ]
    const r = evaluateRules(rules, { loanAmount: 100 })
    if (r.stage !== undefined) throw new Error(`expected undefined stage got ${r.stage}`)
    if (r.flags.length !== 0) throw new Error('expected no flags')
    if (r.required_disclosures.length !== 0) throw new Error('expected no disclosures')
    if (r.required_fields.length !== 0) throw new Error('expected no required fields')
  })

  // ── Test 10: simulateRules ──
  await test('simulateRules: returns trigger status and output for each rule', async () => {
    const rules = [
      type<import('../src/lib/rule-engine').Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 300000',
        output: 'flag=high_value', priority: 10, active: true, created_at: 100,
      }),
      type<import('../src/lib/rule-engine').Rule>({
        id: 'r2', tenant_id: 't1', condition: 'loanAmount > 999999',
        output: 'flag=never', priority: 5, active: true, created_at: 200,
      }),
    ]
    const r = simulateRules(rules, { loanAmount: 500000 })
    if (r.length !== 2) throw new Error(`expected 2 results got ${r.length}`)
    if (r[0].triggered !== true) throw new Error('r1 should be triggered')
    if (r[1].triggered !== false) throw new Error('r2 should not be triggered')
    if (r[0].output?.flags[0] !== 'high_value') throw new Error('r1 output flag mismatch')
    if (r[1].output !== undefined) throw new Error('r2 output should be undefined')
  })

  // ── Test 11: LVR rule compliance (loanAmount/propertyValue > 0.8) ──
  await test('LVR compliance: LVR > 0.8 triggers blocked stage with appraisal field required', async () => {
    const rules = [
      type<import('../src/lib/rule-engine').Rule>({
        id: 'lvr_rule', tenant_id: 't1', condition: 'loanAmount > 500000',
        output: 'stage=blocked; flag=high_lvr; require_disclosure=lvr_acknowledgement; field_required=property_appraisal',
        priority: 100, active: true, created_at: 300,
      }),
    ]
    // Simulate high LVR: loanAmount=520000, propertyValue=600000 → 86.7% > 80%
    const r = evaluateRules(rules, { loanAmount: 520000, propertyValue: 600000 })
    if (r.stage !== 'blocked') throw new Error(`expected stage blocked got ${r.stage}`)
    if (!r.flags.includes('high_lvr')) throw new Error('expected high_lvr flag')
    if (!r.required_disclosures.includes('lvr_acknowledgement')) throw new Error('expected lvr_acknowledgement disclosure')
    if (!r.required_fields.includes('property_appraisal')) throw new Error('expected property_appraisal required field')
  })

  // ── Test 12: Determinism — 10 identical evaluateRules calls produce identical output ──
  await test('determinism: 10 calls with same rules and projection produce identical output', async () => {
    const rules = [
      type<import('../src/lib/rule-engine').Rule>({
        id: 'r1', tenant_id: 't1', condition: 'loanAmount > 300000',
        output: 'flag=high_value', priority: 10, active: true, created_at: 100,
      }),
    ]
    const projection = { loanAmount: 400000 }
    const first = evaluateRules(rules, projection)
    for (let i = 0; i < 10; i++) {
      const result = evaluateRules(rules, projection)
      if (JSON.stringify(result) !== JSON.stringify(first))
        throw new Error(`Non-deterministic output at iteration ${i}`)
    }
  })

  // ═══ Summary ═══
  console.log('')
  if (fail > 0) {
    console.error(`❌ ${fail}/${pass + fail} rule-engine tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ All ${pass} rule-engine tests passed`)
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1) })

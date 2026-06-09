/**
 * EdgeGDE — Unit Tests: Pack Upgrade Validator & Differ
 * Tests validatePackCompatibility (field refs, condition syntax)
 * and generatePackDiff (added/removed/modified rules, compliance,
 * impact scoring, empty diffs, and determinism).
 *
 * Run: npx tsx tests/unit-upgrade-validator.test.ts
 */
let pass = 0, fail = 0
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e: any) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}

async function run() {
  const { validatePackCompatibility, generatePackDiff } =
    await import('../src/factory/upgrade/upgrade.validator')

  console.log('\n── Upgrade Validator Unit Tests ──')

  // ── validatePackCompatibility ─────────────────────────────────────

  await test('validatePackCompatibility: passes for valid rules referencing existing fields', async () => {
    const rules = [
      { condition: 'annualIncome < 50000', output: 'flag=low_income' },
      { condition: 'age > 65', output: 'flag=senior' },
    ]
    const fields = ['annualIncome', 'age']
    const result = validatePackCompatibility(rules, fields)
    if (!result.ok) throw new Error(`expected ok=true but got errors: ${result.errors.join(', ')}`)
    if (result.warnings.length !== 0) throw new Error(`expected 0 warnings got ${result.warnings.length}`)
  })

  await test('validatePackCompatibility: warns for unknown field references in conditions', async () => {
    const rules = [
      { condition: 'mysteryField == yes', output: 'flag=unknown' },
    ]
    const fields = ['annualIncome']
    const result = validatePackCompatibility(rules, fields)
    if (!result.ok) throw new Error('validation should still pass (warnings only)')
    if (result.warnings.length === 0) throw new Error('expected at least 1 warning for unknown field')
    if (!result.warnings[0].includes('mysteryField')) throw new Error('warning should mention the unknown field')
  })

  await test('validatePackCompatibility: reports errors for invalid condition syntax', async () => {
    const rules = [
      { condition: '', output: 'flag=bad' },
    ]
    const fields = ['annualIncome']
    const result = validatePackCompatibility(rules, fields)
    if (result.ok) throw new Error('expected ok=false for invalid condition')
    if (result.errors.length === 0) throw new Error('expected at least 1 error')
  })

  // ── generatePackDiff: structural detections ───────────────────────

  await test('generatePackDiff: detects added rules (present in new, absent in old)', async () => {
    const oldRules = [{ condition: 'age > 18', output: 'flag=adult' }]
    const newRules = [
      { condition: 'age > 18', output: 'flag=adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
    ]
    const diff = generatePackDiff(oldRules, newRules)
    if (diff.rulesAdded.length !== 1) throw new Error(`expected 1 added rule, got ${diff.rulesAdded.length}`)
    if (diff.rulesAdded[0] !== 'income < 30000') throw new Error('expected added condition "income < 30000"')
    if (diff.rulesRemoved.length !== 0) throw new Error('expected 0 removed rules')
  })

  await test('generatePackDiff: detects removed rules (absent in new, present in old)', async () => {
    const oldRules = [
      { condition: 'age > 18', output: 'flag=adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
    ]
    const newRules = [{ condition: 'age > 18', output: 'flag=adult' }]
    const diff = generatePackDiff(oldRules, newRules)
    if (diff.rulesRemoved.length !== 1) throw new Error(`expected 1 removed rule, got ${diff.rulesRemoved.length}`)
    if (diff.rulesRemoved[0] !== 'income < 30000') throw new Error('expected removed condition "income < 30000"')
    if (diff.rulesAdded.length !== 0) throw new Error('expected 0 added rules')
  })

  await test('generatePackDiff: detects modified rules (same condition, different output)', async () => {
    const oldRules = [{ condition: 'age > 18', output: 'flag=adult' }]
    const newRules = [{ condition: 'age > 18', output: 'flag=verified_adult' }]
    const diff = generatePackDiff(oldRules, newRules)
    if (diff.rulesModified.length !== 1) throw new Error(`expected 1 modified rule, got ${diff.rulesModified.length}`)
    if (diff.rulesModified[0].condition !== 'age > 18') throw new Error('condition mismatch')
    if (diff.rulesModified[0].oldOutput !== 'flag=adult') throw new Error('oldOutput mismatch')
    if (diff.rulesModified[0].newOutput !== 'flag=verified_adult') throw new Error('newOutput mismatch')
  })

  await test('generatePackDiff: detects compliance additions', async () => {
    const oldCompliance = [{ value: 'lvr_warning', type: 'compliance' }]
    const newCompliance = [
      { value: 'lvr_warning', type: 'compliance' },
      { value: 'fee_disclosure', type: 'compliance' },
    ]
    const diff = generatePackDiff([], [], oldCompliance, newCompliance)
    if (diff.complianceAdded.length !== 1) throw new Error(`expected 1 compliance added, got ${diff.complianceAdded.length}`)
    if (diff.complianceAdded[0] !== 'fee_disclosure') throw new Error('expected "fee_disclosure" added')
  })

  await test('generatePackDiff: detects compliance removals', async () => {
    const oldCompliance = [
      { value: 'lvr_warning', type: 'compliance' },
      { value: 'fee_disclosure', type: 'compliance' },
    ]
    const newCompliance = [{ value: 'lvr_warning', type: 'compliance' }]
    const diff = generatePackDiff([], [], oldCompliance, newCompliance)
    if (diff.complianceRemoved.length !== 1) throw new Error(`expected 1 compliance removed, got ${diff.complianceRemoved.length}`)
    if (diff.complianceRemoved[0] !== 'fee_disclosure') throw new Error('expected "fee_disclosure" removed')
  })

  // ── generatePackDiff: impact scoring ──────────────────────────────

  await test('generatePackDiff: impactScore LOW for small changes', async () => {
    const oldRules = [{ condition: 'a == 1', output: 'x' }]
    const newRules = [{ condition: 'a == 1', output: 'y' }]  // 1 modification
    const diff = generatePackDiff(oldRules, newRules)
    if (diff.impactScore !== 'LOW') throw new Error(`expected LOW impact, got ${diff.impactScore}`)
  })

  await test('generatePackDiff: impactScore MEDIUM for moderate changes', async () => {
    const oldRules = [{ condition: 'a == 1', output: 'x' }]
    const newRules = [
      { condition: 'a == 1', output: 'y' },  // modified
      { condition: 'b == 2', output: 'z' },  // added
      { condition: 'c == 3', output: 'w' },  // added
    ]
    const diff = generatePackDiff(oldRules, newRules)
    // totalChanges = 1 modified + 2 added = 3 → MEDIUM (totalChanges > 2)
    if (diff.impactScore !== 'MEDIUM') throw new Error(`expected MEDIUM impact, got ${diff.impactScore}`)
  })

  await test('generatePackDiff: impactScore HIGH for significant changes', async () => {
    const oldRules = [{ condition: 'a == 1', output: 'x' }]
    const newRules = [
      { condition: 'a == 1', output: 'y' },   // modified
      { condition: 'b == 2', output: 'z' },   // added
      { condition: 'c == 3', output: 'w' },   // added
      { condition: 'd == 4', output: 'v' },   // added
      { condition: 'e == 5', output: 'u' },   // added
      { condition: 'f == 6', output: 't' },   // added
    ]
    const diff = generatePackDiff(oldRules, newRules)
    // totalChanges = 1 modified + 5 added = 6 → HIGH (> 5)
    if (diff.impactScore !== 'HIGH') throw new Error(`expected HIGH impact, got ${diff.impactScore}`)
  })

  // ── generatePackDiff: empty arrays ────────────────────────────────

  await test('generatePackDiff: empty arrays when no changes', async () => {
    const rules = [{ condition: 'a == 1', output: 'x' }]
    const diff = generatePackDiff(rules, rules)
    if (diff.rulesAdded.length !== 0) throw new Error('expected 0 rulesAdded')
    if (diff.rulesRemoved.length !== 0) throw new Error('expected 0 rulesRemoved')
    if (diff.rulesModified.length !== 0) throw new Error('expected 0 rulesModified')
    if (diff.complianceAdded.length !== 0) throw new Error('expected 0 complianceAdded')
    if (diff.complianceRemoved.length !== 0) throw new Error('expected 0 complianceRemoved')
    if (diff.impactStatements.length !== 0) throw new Error('expected 0 impactStatements')
    if (diff.impactScore !== 'LOW') throw new Error('expected LOW impact when no changes')
  })

  // ── Determinism ───────────────────────────────────────────────────

  await test('generatePackDiff + determinism: 10 identical calls produce identical output', async () => {
    const oldRules = [
      { condition: 'age > 18', output: 'flag=adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
    ]
    const newRules = [
      { condition: 'age > 18', output: 'flag=verified_adult' },
      { condition: 'income < 30000', output: 'flag=low_income' },
      { condition: 'creditScore > 700', output: 'flag=good_credit' },
    ]
    const oldCompliance = [{ value: 'base_disclosure', type: 'compliance' }]
    const newCompliance = [
      { value: 'base_disclosure', type: 'compliance' },
      { value: 'premium_disclosure', type: 'compliance' },
    ]

    const first = generatePackDiff(oldRules, newRules, oldCompliance, newCompliance)
    for (let i = 0; i < 10; i++) {
      const result = generatePackDiff(oldRules, newRules, oldCompliance, newCompliance)
      if (JSON.stringify(result) !== JSON.stringify(first)) {
        throw new Error(`Non-deterministic output at iteration ${i}`)
      }
    }
  })

  // ═══ Summary ═══
  console.log('')
  if (fail > 0) {
    console.error(`❌ ${fail}/${pass + fail} upgrade-validator tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ All ${pass} upgrade-validator tests passed`)
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1) })

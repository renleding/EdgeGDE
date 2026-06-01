/**
 * EdgeGDE — FNS40821 Deterministic Scoring Engine Tests
 * Pure function tests. Exact assertions only.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { computeDeterministic } from '../src/lib/scoring-engine'

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Base Score
// ═════════════════════════════════════════════════════════════════════════════

run('base score is 30 with no inputs', () => {
  assert.strictEqual(computeDeterministic({}).score, 30)
})

run('missing inputs still returns base 30', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: undefined, loanAmount: undefined }).score, 30)
})

run('null and zero inputs are handled gracefully', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: 0, loanAmount: 0 }).score, 30)
})

// ═════════════════════════════════════════════════════════════════════════════
// LVR Scoring
// ═════════════════════════════════════════════════════════════════════════════

run('LVR <80%: base 30 + 20 = 50', () => {
  const r = computeDeterministic({ propertyValue: 1000000, loanAmount: 700000 })
  assert.strictEqual(r.score, 50)
  assert.ok(r.details.some(d => d.includes('LVR') && d.includes('< 80%')))
})

run('LVR exactly 79.9%: +20', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: 1000000, loanAmount: 799000 }).score, 50)
})

run('LVR exactly 80%: +10', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: 1000000, loanAmount: 800000 }).score, 40)
})

run('LVR 80-90%: base 30 + 10 = 40', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: 1000000, loanAmount: 850000 }).score, 40)
})

run('LVR 80-90% edge at 90%: +10', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: 1000000, loanAmount: 900000 }).score, 40)
})

run('LVR >90%: base 30 + 0 = 30', () => {
  assert.strictEqual(computeDeterministic({ propertyValue: 1000000, loanAmount: 950000 }).score, 30)
})

// ═════════════════════════════════════════════════════════════════════════════
// Employment Scoring
// ═════════════════════════════════════════════════════════════════════════════

run('PAYG: base 30 + 20 = 50', () => {
  assert.strictEqual(computeDeterministic({ employmentType: 'PAYG' }).score, 50)
})

run('payg lowercase: base 30 + 20 = 50', () => {
  assert.strictEqual(computeDeterministic({ employmentType: 'payg' }).score, 50)
})

run('full-time: base 30 + 20 = 50', () => {
  assert.strictEqual(computeDeterministic({ employmentType: 'full-time' }).score, 50)
})

run('part-time: base 30 + 20 = 50', () => {
  assert.strictEqual(computeDeterministic({ employmentType: 'part-time' }).score, 50)
})

run('Self-Employed: base 30 + 0 = 30', () => {
  assert.strictEqual(computeDeterministic({ employmentType: 'Self-Employed' }).score, 30)
})

run('self employed (no hyphen): base 30 + 0 = 30', () => {
  assert.strictEqual(computeDeterministic({ employmentType: 'self employed' }).score, 30)
})

// ═════════════════════════════════════════════════════════════════════════════
// Combined Scenarios
// ═════════════════════════════════════════════════════════════════════════════

run('LVR <80% + PAYG = max 70', () => {
  assert.strictEqual(computeDeterministic({
    propertyValue: 1000000,
    loanAmount: 100000,
    employmentType: 'PAYG',
  }).score, 70)
})

run('LVR <80% + Self-Employed = 50', () => {
  assert.strictEqual(computeDeterministic({
    propertyValue: 1000000,
    loanAmount: 700000,
    employmentType: 'Self-Employed',
  }).score, 50)
})

run('score never exceeds 70', () => {
  const r = computeDeterministic({
    propertyValue: 1000000,
    loanAmount: 1,
    employmentType: 'PAYG',
  })
  assert.ok(r.score <= 70)
  assert.strictEqual(r.score, 70)
})

// ═════════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════════

console.log('')
if (failed === 0) {
  console.log(`✅ All ${passed} scoring engine tests passed`)
  process.exit(0)
} else {
  console.error(`❌ ${failed}/${passed + failed} scoring engine tests failed`)
  process.exit(1)
}

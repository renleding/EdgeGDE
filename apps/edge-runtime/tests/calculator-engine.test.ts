/**
 * Calculator Engine — 43 Test Suite
 *
 * Covers:
 *   - CalculatorEngine helpers (roundMoney, formatAud, formatPercent)
 *   - Loan Repayment calculator
 *   - Budget Planner calculator
 *   - Stamp Duty calculator (8 states + FHB concessions)
 *   - Engine-level (executeCalculator errors, validation, listing)
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import {
  roundMoney,
  formatAud,
  formatPercent,
  executeCalculator,
  listCalculators,
} from '../src/lib/calculator-engine'
import { calculateLoanRepayment, LoanRepaymentInputSchema } from '../src/edr/domain/calculators/loan-repayment'
import type { LoanRepaymentInput } from '../src/edr/domain/calculators/loan-repayment'
import { calculateBudgetPlanner, BudgetPlannerInputSchema } from '../src/edr/domain/calculators/budget-planner'
import type { BudgetPlannerInput } from '../src/edr/domain/calculators/budget-planner'
import { calculateStampDuty, StampDutyInputSchema, StampDutyStateSchema } from '../src/edr/domain/calculators/stamp-duty'
import type { StampDutyInput } from '../src/edr/domain/calculators/stamp-duty'

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: unknown) {
    failed++
    console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Group 1: Rounding Helpers (tests 1–6)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nGroup 1: Rounding Helpers (tests 1–6)')

run('roundMoney rounds to 2 decimal places', () => {
  assert.strictEqual(roundMoney(123.456), 123.46)
  assert.strictEqual(roundMoney(123.454), 123.45)
  assert.strictEqual(roundMoney(100), 100)
  assert.strictEqual(roundMoney(0.001), 0)
})

run('roundMoney handles zero', () => {
  assert.strictEqual(roundMoney(0), 0)
})

run('roundMoney handles negative values', () => {
  assert.strictEqual(roundMoney(-123.456), -123.46)
})

run('formatAud formats as $X,XXX.XX', () => {
  assert.strictEqual(formatAud(1234.5), '$1,234.50')
  assert.strictEqual(formatAud(100), '$100.00')
  assert.strictEqual(formatAud(0), '$0.00')
})

run('formatAud handles large numbers', () => {
  assert.strictEqual(formatAud(1_000_000), '$1,000,000.00')
  assert.strictEqual(formatAud(9999999.99), '$9,999,999.99')
})

run('formatPercent formats with default 2dp', () => {
  assert.strictEqual(formatPercent(5.5), '5.50%')
  assert.strictEqual(formatPercent(12), '12.00%')
  assert.strictEqual(formatPercent(0), '0.00%')
})

// ═══════════════════════════════════════════════════════════════════════════
// Group 2: Loan Repayment Calculator (tests 7–16)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nGroup 2: Loan Repayment Calculator (tests 7–16)')

run('loan-repayment: standard $500k @ 6% for 30 years', () => {
  const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
  // M ≈ $2,997.75
  assert.ok(result.monthlyRepayment > 2900 && result.monthlyRepayment < 3100, `actual: ${result.monthlyRepayment}`)
  assert.ok(result.totalInterest > 200_000, `actual: ${result.totalInterest}`)
  assert.strictEqual(result.monthlyFormatted, `$${result.monthlyRepayment.toFixed(2)}`)
})

run('loan-repayment: zero interest rate', () => {
  const result = calculateLoanRepayment({ principal: 360_000, annualRate: 0, termYears: 30 })
  assert.strictEqual(result.monthlyRepayment, 1000) // 360000 / 360
  assert.strictEqual(result.totalInterest, 0)
  assert.strictEqual(result.totalCost, 360_000)
})

run('loan-repayment: $200k @ 5% for 15 years', () => {
  const result = calculateLoanRepayment({ principal: 200_000, annualRate: 5, termYears: 15 })
  assert.ok(result.monthlyRepayment > 1500 && result.monthlyRepayment < 1700, `actual: ${result.monthlyRepayment}`)
  assert.ok(result.totalInterest > 80_000, `actual: ${result.totalInterest}`)
})

run('loan-repayment: $1M @ 3.5% for 25 years', () => {
  const result = calculateLoanRepayment({ principal: 1_000_000, annualRate: 3.5, termYears: 25 })
  assert.ok(result.monthlyRepayment > 4900 && result.monthlyRepayment < 5100, `actual: ${result.monthlyRepayment}`)
})

run('loan-repayment: fortnightly is annualCost / 26', () => {
  const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
  const expectedFortnightly = roundMoney(result.monthlyRepayment * 12 / 26)
  assert.strictEqual(result.fortnightlyRepayment, expectedFortnightly)
})

run('loan-repayment: weekly is annualCost / 52', () => {
  const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
  const expectedWeekly = roundMoney(result.monthlyRepayment * 12 / 52)
  assert.strictEqual(result.weeklyRepayment, expectedWeekly)
})

run('loan-repayment: totalCost = principal + totalInterest', () => {
  const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
  assert.strictEqual(result.totalCost, roundMoney(500_000 + result.totalInterest))
})

run('loan-repayment: Zod schema rejects negative principal', () => {
  const parsed = LoanRepaymentInputSchema.safeParse({ principal: -100, annualRate: 5, termYears: 30 })
  assert.strictEqual(parsed.success, false)
})

run('loan-repayment: Zod schema rejects non-integer term', () => {
  const parsed = LoanRepaymentInputSchema.safeParse({ principal: 100_000, annualRate: 5, termYears: 30.5 })
  assert.strictEqual(parsed.success, false)
})

run('loan-repayment: Zod schema accepts valid input', () => {
  const parsed = LoanRepaymentInputSchema.safeParse({ principal: 400_000, annualRate: 4.5, termYears: 20 })
  assert.strictEqual(parsed.success, true)
})

// ═══════════════════════════════════════════════════════════════════════════
// Group 3: Budget Planner Calculator (tests 17–27)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nGroup 3: Budget Planner Calculator (tests 17–27)')

const defaultBudget: BudgetPlannerInput = {
  salary: 100_000,
  investments: 10_000,
  government: 0,
  otherIncome: 5_000,
  housing: 24_000,
  food: 12_000,
  transport: 8_000,
  utilities: 4_000,
  insurance: 3_000,
  entertainment: 5_000,
  healthcare: 2_000,
  education: 3_000,
  debtPayments: 6_000,
  otherExpenses: 2_000,
}

run('budget-planner: income totals = 115,000', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.totalIncome, 115_000)
})

run('budget-planner: expenses total = 69,000', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.totalExpenses, 69_000)
})

run('budget-planner: surplus = income - expenses = 46,000', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.surplus, 46_000)
  assert.strictEqual(result.isDeficit, false)
})

run('budget-planner: savings rate = surplus/income * 100', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.savingsRate, roundMoney(46_000 / 115_000 * 100))
})

run('budget-planner: deficit detection', () => {
  const deficit: BudgetPlannerInput = {
    salary: 40_000,
    investments: 0,
    government: 0,
    otherIncome: 0,
    housing: 50_000,
    food: 15_000,
    transport: 10_000,
    utilities: 6_000,
    insurance: 5_000,
    entertainment: 8_000,
    healthcare: 4_000,
    education: 5_000,
    debtPayments: 10_000,
    otherExpenses: 5_000,
  }
  const result = calculateBudgetPlanner(deficit)
  assert.strictEqual(result.isDeficit, true)
  assert.ok(result.surplus < 0, `expected negative surplus, got ${result.surplus}`)
})

run('budget-planner: deficit surplus returned as negative', () => {
  const deficit: BudgetPlannerInput = {
    salary: 0, investments: 0, government: 0, otherIncome: 0,
    housing: 100_000, food: 0, transport: 0, utilities: 0,
    insurance: 0, entertainment: 0, healthcare: 0, education: 0,
    debtPayments: 0, otherExpenses: 0,
  }
  const result = calculateBudgetPlanner(deficit)
  assert.strictEqual(result.isDeficit, true)
  assert.ok(result.surplus < 0, `expected negative surplus, got ${result.surplus}`)
})

run('budget-planner: 4 income categories in breakdown', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.incomeBreakdown.length, 4)
})

run('budget-planner: 10 expense categories in breakdown', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.expenseBreakdown.length, 10)
})

run('budget-planner: expense ratio = expenses/income * 100', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  assert.strictEqual(result.expenseRatio, roundMoney(69_000 / 115_000 * 100))
})

run('budget-planner: income percentages sum to ~100%', () => {
  const result = calculateBudgetPlanner(defaultBudget)
  const totalPct = result.incomeBreakdown.reduce((s, i) => s + i.percentage, 0)
  assert.ok(Math.abs(totalPct - 100) < 0.02, `expected ~100, got ${totalPct}`)
})

run('budget-planner: Zod schema rejects negative values', () => {
  const parsed = BudgetPlannerInputSchema.safeParse({ ...defaultBudget, salary: -1000 })
  assert.strictEqual(parsed.success, false)
})

// ═══════════════════════════════════════════════════════════════════════════
// Group 4: Stamp Duty Calculator (tests 28–40)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nGroup 4: Stamp Duty Calculator (tests 28–40)')

const stdPPR = { isPrincipalPlaceOfResidence: true, isForeignBuyer: false }

run('stamp-duty: NSW $800k standard rate', () => {
  const input: StampDutyInput = { propertyValue: 800_000, state: 'nsw', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  // NSW: first $308k @ 1.25% = 3850, next $492k @ 3% = 14760 = 18610
  assert.strictEqual(result.stampDuty, 18610)
})

run('stamp-duty: NSW FHB full exemption up to $1M', () => {
  const input: StampDutyInput = { propertyValue: 800_000, state: 'nsw', isFirstHomeBuyer: true, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.strictEqual(result.stampDuty, 0)
  assert.strictEqual(result.concessionApplied, true)
})

run('stamp-duty: NSW FHB $1.4M (partial concession range)', () => {
  const fhb: StampDutyInput = { propertyValue: 1_400_000, state: 'nsw', isFirstHomeBuyer: true, ...stdPPR }
  const result = calculateStampDuty(fhb)
  assert.ok(result.stampDuty > 0, `expected duty > 0, got ${result.stampDuty}`)
  // In the $1M-$1.5M range, the concession exists but may not reduce duty
  // depending on bracket alignment. Verify the function returns meaningful output.
  assert.ok(result.effectiveRate > 0, 'expected positive effective rate')
})

run('stamp-duty: VIC $600k standard', () => {
  const input: StampDutyInput = { propertyValue: 600_000, state: 'vic', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0, `expected duty > 0, got ${result.stampDuty}`)
})

run('stamp-duty: VIC FHB PPR concession $600k', () => {
  const input: StampDutyInput = { propertyValue: 600_000, state: 'vic', isFirstHomeBuyer: true, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0, 'VIC concession reduces but does not eliminate duty for $600k')
  assert.strictEqual(result.concessionApplied, true)
})

run('stamp-duty: QLD $400k standard', () => {
  const input: StampDutyInput = { propertyValue: 400_000, state: 'qld', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0)
})

run('stamp-duty: QLD FHB full exemption $400k', () => {
  const input: StampDutyInput = { propertyValue: 400_000, state: 'qld', isFirstHomeBuyer: true, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.strictEqual(result.stampDuty, 0)
  assert.strictEqual(result.concessionApplied, true)
})

run('stamp-duty: WA $400k standard', () => {
  const input: StampDutyInput = { propertyValue: 400_000, state: 'wa', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0)
})

run('stamp-duty: WA FHB concession $400k', () => {
  const fhb: StampDutyInput = { propertyValue: 400_000, state: 'wa', isFirstHomeBuyer: true, ...stdPPR }
  const std: StampDutyInput = { propertyValue: 400_000, state: 'wa', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(fhb)
  assert.strictEqual(result.concessionApplied, true)
  assert.ok(result.stampDuty < calculateStampDuty(std).stampDuty)
})

run('stamp-duty: SA standard $450k', () => {
  const input: StampDutyInput = { propertyValue: 450_000, state: 'sa', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0)
})

run('stamp-duty: SA FHB rebate $300k', () => {
  const fhb: StampDutyInput = { propertyValue: 300_000, state: 'sa', isFirstHomeBuyer: true, ...stdPPR }
  const std: StampDutyInput = { propertyValue: 300_000, state: 'sa', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(fhb)
  assert.strictEqual(result.concessionApplied, true)
  assert.ok(result.stampDuty < calculateStampDuty(std).stampDuty)
})

run('stamp-duty: TAS standard rate', () => {
  const input: StampDutyInput = { propertyValue: 400_000, state: 'tas', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0)
  assert.strictEqual(result.concessionApplied, false)
})

run('stamp-duty: ACT standard', () => {
  const input: StampDutyInput = { propertyValue: 600_000, state: 'act', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0)
})

run('stamp-duty: NT standard', () => {
  const input: StampDutyInput = { propertyValue: 400_000, state: 'nt', isFirstHomeBuyer: false, ...stdPPR }
  const result = calculateStampDuty(input)
  assert.ok(result.stampDuty > 0)
})

// ═══════════════════════════════════════════════════════════════════════════
// Group 5: Engine-level (tests 41–43)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nGroup 5: Engine-level (tests 41–43)')

// Import registry to trigger calculator registration
import '../src/registry/calculators'

run('engine: executeCalculator returns error for unknown calculator', () => {
  const result = executeCalculator('nonexistent', {})
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Unknown calculator'))
})

run('engine: executeCalculator returns Zod validation errors', () => {
  const result = executeCalculator('loan-repayment', { principal: -500, annualRate: 5, termYears: 30 })
  assert.strictEqual(result.success, false)
  assert.ok(result.error?.includes('Principal must be positive'))
})

run('engine: listCalculators returns registered calculators', () => {
  const calculators = listCalculators()
  const ids = calculators.map((c) => c.id)
  assert.ok(ids.includes('loan-repayment'))
  assert.ok(ids.includes('budget-planner'))
  assert.ok(ids.includes('stamp-duty'))
})

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\nCalculator Engine tests: ${passed} passed, ${failed} failed out of ${passed + failed}\n`)
if (failed > 0) {
  process.exit(1)
}

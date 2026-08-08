/**
 * EdgeGDE — Budget Calculator (src/edr/domain/budget.ts) Test Suite
 *
 * Pure, deterministic budget calculation engine.
 * Covers surplus / deficit / zero-income paths, rounding, breakdown percentages,
 * and the fixed disclaimer warning.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import { calculateBudget, type BudgetInput, type BudgetOutput } from '../../../src/edr/domain/budget'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function input(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    salary: 0,
    investments: 0,
    government: 0,
    otherIncome: 0,
    housing: 0,
    food: 0,
    transport: 0,
    utilities: 0,
    insurance: 0,
    entertainment: 0,
    healthcare: 0,
    education: 0,
    debtPayments: 0,
    otherExpenses: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('calculateBudget', () => {
  it('computes zero budget deterministically', () => {
    const out = calculateBudget(input())
    expect(out).toEqual({
      totalIncome: 0,
      totalExpenses: 0,
      surplus: 0,
      savingsRate: 0,
      expenseRatio: 0,
      incomeBreakdown: [
        { label: 'Employment / Salary', amount: 0, percentage: 0 },
        { label: 'Investments', amount: 0, percentage: 0 },
        { label: 'Government Benefits', amount: 0, percentage: 0 },
        { label: 'Other Income', amount: 0, percentage: 0 },
      ],
      expenseBreakdown: [
        { label: 'Housing / Rent', amount: 0, percentage: 0 },
        { label: 'Food & Groceries', amount: 0, percentage: 0 },
        { label: 'Transport / Fuel', amount: 0, percentage: 0 },
        { label: 'Utilities', amount: 0, percentage: 0 },
        { label: 'Insurance', amount: 0, percentage: 0 },
        { label: 'Entertainment', amount: 0, percentage: 0 },
        { label: 'Healthcare', amount: 0, percentage: 0 },
        { label: 'Education', amount: 0, percentage: 0 },
        { label: 'Debt Payments', amount: 0, percentage: 0 },
        { label: 'Other Expenses', amount: 0, percentage: 0 },
      ],
      isDeficit: false,
      warning: 'This budget is an estimate only. Actual figures may vary based on your individual circumstances. This is not financial advice.',
    })
  })

  it('totals all income sources', () => {
    const out = calculateBudget(input({ salary: 5000, investments: 1000, government: 500, otherIncome: 250 }))
    expect(out.totalIncome).toBe(6750)
  })

  it('totals all expense categories', () => {
    const out = calculateBudget(input({
      housing: 1500, food: 600, transport: 300, utilities: 250, insurance: 200,
      entertainment: 150, healthcare: 100, education: 80, debtPayments: 400, otherExpenses: 120,
    }))
    expect(out.totalExpenses).toBe(3700)
  })

  it('reports surplus, savings rate and expense ratio for a balanced plan', () => {
    const out = calculateBudget(input({ salary: 5000, housing: 1500, food: 600, transport: 300 }))
    expect(out.totalIncome).toBe(5000)
    expect(out.totalExpenses).toBe(2400)
    expect(out.surplus).toBe(2600)
    expect(out.savingsRate).toBe(52)
    expect(out.expenseRatio).toBe(48)
    expect(out.isDeficit).toBe(false)
  })

  it('rounds savings rate and expense ratio to 2dp', () => {
    const out = calculateBudget(input({ salary: 3333, housing: 1000 }))
    // 2333 / 3333 = 69.9969... → 70.0
    expect(out.savingsRate).toBe(70)
    // 1000 / 3333 = 30.0030... → 30.0
    expect(out.expenseRatio).toBe(30)
    expect(out.surplus).toBe(2333)
  })

  it('flags a deficit and returns the absolute surplus magnitude', () => {
    const out = calculateBudget(input({ salary: 3000, housing: 2500, food: 800 }))
    expect(out.totalIncome).toBe(3000)
    expect(out.totalExpenses).toBe(3300)
    expect(out.isDeficit).toBe(true)
    expect(out.surplus).toBe(300)
    expect(out.savingsRate).toBe(-10)
    expect(out.expenseRatio).toBe(110)
  })

  it('returns zero savings/expense ratios when income is zero', () => {
    const out = calculateBudget(input({ otherExpenses: 500 }))
    expect(out.totalIncome).toBe(0)
    expect(out.savingsRate).toBe(0)
    expect(out.expenseRatio).toBe(0)
    expect(out.isDeficit).toBe(true)
  })

  it('computes income breakdown percentages proportional to total income', () => {
    const out = calculateBudget(input({ salary: 4000, investments: 1000 }))
    expect(out.incomeBreakdown).toEqual([
      { label: 'Employment / Salary', amount: 4000, percentage: 80 },
      { label: 'Investments', amount: 1000, percentage: 20 },
      { label: 'Government Benefits', amount: 0, percentage: 0 },
      { label: 'Other Income', amount: 0, percentage: 0 },
    ])
  })

  it('computes expense breakdown percentages proportional to total expenses', () => {
    const out = calculateBudget(input({ salary: 1000, housing: 750, food: 250 }))
    expect(out.expenseBreakdown.slice(0, 2)).toEqual([
      { label: 'Housing / Rent', amount: 750, percentage: 75 },
      { label: 'Food & Groceries', amount: 250, percentage: 25 },
    ])
    // Remaining categories at 0%
    expect(out.expenseBreakdown.slice(2).every(l => l.amount === 0 && l.percentage === 0)).toBe(true)
  })

  it('rounds fractional amounts to 2dp', () => {
    const out = calculateBudget(input({ salary: 1000.005, housing: 333.333 }))
    expect(out.totalIncome).toBe(1000.01)
    expect(out.totalExpenses).toBe(333.33)
    expect(out.surplus).toBe(666.68)
  })

  it('returns the fixed disclaimer warning', () => {
    const out = calculateBudget(input({ salary: 1 }))
    expect(out.warning).toContain('This budget is an estimate only')
    expect(out.warning).toContain('not financial advice')
  })

  it('is deterministic — same input produces identical output', () => {
    const a = calculateBudget(input({ salary: 5000, housing: 1500, food: 600 }))
    const b = calculateBudget(input({ salary: 5000, housing: 1500, food: 600 }))
    expect(a).toEqual(b)
  })

  it('returns a BudgetOutput-shaped object (type-level contract)', () => {
    const out: BudgetOutput = calculateBudget(input())
    expect(out.incomeBreakdown).toHaveLength(4)
    expect(out.expenseBreakdown).toHaveLength(10)
    for (const line of [...out.incomeBreakdown, ...out.expenseBreakdown]) {
      expect(typeof line.label).toBe('string')
      expect(typeof line.amount).toBe('number')
      expect(typeof line.percentage).toBe('number')
    }
  })
})

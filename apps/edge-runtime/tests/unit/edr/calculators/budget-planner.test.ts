import { describe, it, expect } from 'vitest'
import {
  BudgetPlannerInputSchema,
  calculateBudgetPlanner,
} from '../../../../src/edr/domain/calculators/budget-planner'

const VALID = {
  salary: 8000,
  investments: 1000,
  government: 500,
  otherIncome: 500,
  housing: 2000,
  food: 800,
  transport: 300,
  utilities: 200,
  insurance: 150,
  entertainment: 200,
  healthcare: 100,
  education: 150,
  debtPayments: 800,
  otherExpenses: 300,
}

describe('BudgetPlannerInputSchema', () => {
  it('accepts a valid input', () => {
    expect(BudgetPlannerInputSchema.safeParse(VALID).success).toBe(true)
  })

  it('rejects missing required income categories', () => {
    const { salary, ...noSalary } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noSalary).success).toBe(false)
    const { investments, ...noInv } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noInv).success).toBe(false)
    const { government, ...noGov } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noGov).success).toBe(false)
    const { otherIncome, ...noOther } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noOther).success).toBe(false)
  })

  it('rejects missing required expense categories', () => {
    const { housing, ...noHousing } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noHousing).success).toBe(false)
    const { food, ...noFood } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noFood).success).toBe(false)
    const { otherExpenses, ...noOther } = VALID
    expect(BudgetPlannerInputSchema.safeParse(noOther).success).toBe(false)
  })

  it('rejects negative values in any category', () => {
    expect(BudgetPlannerInputSchema.safeParse({ ...VALID, salary: -1 }).success).toBe(false)
    expect(BudgetPlannerInputSchema.safeParse({ ...VALID, housing: -1 }).success).toBe(false)
    expect(BudgetPlannerInputSchema.safeParse({ ...VALID, debtPayments: -0.01 }).success).toBe(false)
  })

  it('rejects unknown keys (strict)', () => {
    expect(BudgetPlannerInputSchema.safeParse({ ...VALID, extra: 100 }).success).toBe(false)
  })
})

describe('calculateBudgetPlanner', () => {
  it('computes totals, surplus, ratios, and breakdown percentages', () => {
    const r = calculateBudgetPlanner(VALID)
    expect(r.totalIncome).toBe(10000)
    expect(r.totalExpenses).toBe(5000)
    expect(r.surplus).toBe(5000)
    expect(r.isDeficit).toBe(false)
    expect(r.savingsRate).toBe(50)
    expect(r.expenseRatio).toBe(50)

    expect(r.incomeBreakdown).toEqual([
      { label: 'Employment / Salary', amount: 8000, percentage: 80 },
      { label: 'Investments', amount: 1000, percentage: 10 },
      { label: 'Government Benefits', amount: 500, percentage: 5 },
      { label: 'Other Income', amount: 500, percentage: 5 },
    ])

    expect(r.expenseBreakdown).toEqual([
      { label: 'Housing / Rent', amount: 2000, percentage: 40 },
      { label: 'Food & Groceries', amount: 800, percentage: 16 },
      { label: 'Transport / Fuel', amount: 300, percentage: 6 },
      { label: 'Utilities', amount: 200, percentage: 4 },
      { label: 'Insurance', amount: 150, percentage: 3 },
      { label: 'Entertainment', amount: 200, percentage: 4 },
      { label: 'Healthcare', amount: 100, percentage: 2 },
      { label: 'Education', amount: 150, percentage: 3 },
      { label: 'Debt Payments', amount: 800, percentage: 16 },
      { label: 'Other Expenses', amount: 300, percentage: 6 },
    ])
  })

  it('handles all-zero income (percentages become 0, no division blowup)', () => {
    const r = calculateBudgetPlanner({
      salary: 0, investments: 0, government: 0, otherIncome: 0,
      housing: 0, food: 0, transport: 0, utilities: 0, insurance: 0,
      entertainment: 0, healthcare: 0, education: 0, debtPayments: 0, otherExpenses: 0,
    })
    expect(r.totalIncome).toBe(0)
    expect(r.totalExpenses).toBe(0)
    expect(r.surplus).toBe(0)
    expect(r.isDeficit).toBe(false)
    expect(r.savingsRate).toBe(0)
    expect(r.expenseRatio).toBe(0)
    for (const line of r.incomeBreakdown) expect(line.percentage).toBe(0)
    for (const line of r.expenseBreakdown) expect(line.percentage).toBe(0)
  })

  it('flags deficits and clamps savings rate to zero', () => {
    const r = calculateBudgetPlanner({
      salary: 3000, investments: 0, government: 0, otherIncome: 0,
      housing: 3000, food: 500, transport: 200, utilities: 100, insurance: 100,
      entertainment: 100, healthcare: 0, education: 0, debtPayments: 0, otherExpenses: 0,
    })
    expect(r.totalIncome).toBe(3000)
    expect(r.totalExpenses).toBe(4000)
    expect(r.surplus).toBe(-1000)
    expect(r.isDeficit).toBe(true)
    expect(r.savingsRate).toBe(0)
    expect(r.expenseRatio).toBe(133.33)
  })
})

/**
 * EdgeGDE — Domain: Budget Planner Calculator
 *
 * income - expenses = surplus/deficit
 * 4 income categories, 10 expense categories, savings rate
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const BudgetPlannerInputSchema = z
  .object({
    // Income categories
    salary: z.number().min(0, 'Salary cannot be negative'),
    investments: z.number().min(0, 'Investments cannot be negative'),
    government: z.number().min(0, 'Government benefits cannot be negative'),
    otherIncome: z.number().min(0, 'Other income cannot be negative'),

    // Expense categories (10)
    housing: z.number().min(0, 'Housing cannot be negative'),
    food: z.number().min(0, 'Food cannot be negative'),
    transport: z.number().min(0, 'Transport cannot be negative'),
    utilities: z.number().min(0, 'Utilities cannot be negative'),
    insurance: z.number().min(0, 'Insurance cannot be negative'),
    entertainment: z.number().min(0, 'Entertainment cannot be negative'),
    healthcare: z.number().min(0, 'Healthcare cannot be negative'),
    education: z.number().min(0, 'Education cannot be negative'),
    debtPayments: z.number().min(0, 'Debt payments cannot be negative'),
    otherExpenses: z.number().min(0, 'Other expenses cannot be negative'),
  })
  .strict()

export type BudgetPlannerInput = z.infer<typeof BudgetPlannerInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BudgetLine {
  label: string
  amount: number
  percentage: number
}

export interface BudgetPlannerOutput {
  totalIncome: number
  totalExpenses: number
  surplus: number
  isDeficit: boolean
  savingsRate: number
  expenseRatio: number
  incomeBreakdown: BudgetLine[]
  expenseBreakdown: BudgetLine[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

export function calculateBudgetPlanner(input: BudgetPlannerInput): BudgetPlannerOutput {
  const totalIncome = roundMoney(
    input.salary + input.investments + input.government + input.otherIncome,
  )

  const totalExpenses = roundMoney(
    input.housing + input.food + input.transport + input.utilities +
    input.insurance + input.entertainment + input.healthcare +
    input.education + input.debtPayments + input.otherExpenses,
  )

  const surplus = roundMoney(totalIncome - totalExpenses)
  const isDeficit = surplus < 0
  const savingsRate = totalIncome > 0 ? roundMoney((Math.max(0, surplus) / totalIncome) * 100) : 0
  const expenseRatio = totalIncome > 0 ? roundMoney((totalExpenses / totalIncome) * 100) : 0

  const incomeItems: { label: string; amount: number }[] = [
    { label: 'Employment / Salary', amount: input.salary },
    { label: 'Investments', amount: input.investments },
    { label: 'Government Benefits', amount: input.government },
    { label: 'Other Income', amount: input.otherIncome },
  ]

  const expenseItems: { label: string; amount: number }[] = [
    { label: 'Housing / Rent', amount: input.housing },
    { label: 'Food & Groceries', amount: input.food },
    { label: 'Transport / Fuel', amount: input.transport },
    { label: 'Utilities', amount: input.utilities },
    { label: 'Insurance', amount: input.insurance },
    { label: 'Entertainment', amount: input.entertainment },
    { label: 'Healthcare', amount: input.healthcare },
    { label: 'Education', amount: input.education },
    { label: 'Debt Payments', amount: input.debtPayments },
    { label: 'Other Expenses', amount: input.otherExpenses },
  ]

  const toLines = (items: { label: string; amount: number }[], total: number): BudgetLine[] =>
    items.map((i) => ({
      label: i.label,
      amount: roundMoney(i.amount),
      percentage: total > 0 ? roundMoney((i.amount / total) * 100) : 0,
    }))

  return {
    totalIncome,
    totalExpenses,
    surplus,
    isDeficit,
    savingsRate,
    expenseRatio,
    incomeBreakdown: toLines(incomeItems, totalIncome),
    expenseBreakdown: toLines(expenseItems, totalExpenses),
  }
}

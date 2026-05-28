/**
 * EdgeGDE EDR — Domain: Budget Calculator
 * v1.0: Pure, deterministic budget calculation engine.
 * Calculates income vs expenses, surplus/deficit, and savings rate.
 *
 * INVARIANTS:
 *   - must_be_pure_function
 *   - must_be_deterministic
 *   - must_not_depend_on_htmx
 *   - must_not_use_kv
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BudgetInput {
  // Income
  salary: number
  investments: number
  government: number
  otherIncome: number

  // Expenses
  housing: number
  food: number
  transport: number
  utilities: number
  insurance: number
  entertainment: number
  healthcare: number
  education: number
  debtPayments: number
  otherExpenses: number
}

export interface BudgetLine {
  label: string
  amount: number
  percentage: number
}

export interface BudgetOutput {
  totalIncome: number
  totalExpenses: number
  surplus: number
  savingsRate: number
  expenseRatio: number
  incomeBreakdown: BudgetLine[]
  expenseBreakdown: BudgetLine[]
  isDeficit: boolean
  warning: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

const round = (v: number) => Math.round(v * 100) / 100

/**
 * Calculate budget metrics from income and expense inputs.
 * Returns deterministic BudgetOutput with rounded (2dp) values.
 */
export function calculateBudget(input: BudgetInput): BudgetOutput {
  const totalIncome = round(
    input.salary + input.investments + input.government + input.otherIncome
  )
  const totalExpenses = round(
    input.housing + input.food + input.transport + input.utilities +
    input.insurance + input.entertainment + input.healthcare +
    input.education + input.debtPayments + input.otherExpenses
  )
  const surplus = round(totalIncome - totalExpenses)
  const savingsRate = totalIncome > 0 ? round((surplus / totalIncome) * 100) : 0
  const expenseRatio = totalIncome > 0 ? round((totalExpenses / totalIncome) * 100) : 0

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

  const makeLines = (items: { label: string; amount: number }[], total: number): BudgetLine[] =>
    items.map(i => ({
      label: i.label,
      amount: round(i.amount),
      percentage: total > 0 ? round((i.amount / total) * 100) : 0,
    }))

  const warning =
    'This budget is an estimate only. Actual figures may vary based on your ' +
    'individual circumstances. This is not financial advice.'

  return {
    totalIncome: round(totalIncome),
    totalExpenses: round(totalExpenses),
    surplus: round(Math.abs(surplus)),
    savingsRate,
    expenseRatio,
    incomeBreakdown: makeLines(incomeItems, totalIncome),
    expenseBreakdown: makeLines(expenseItems, totalExpenses),
    isDeficit: surplus < 0,
    warning,
  }
}

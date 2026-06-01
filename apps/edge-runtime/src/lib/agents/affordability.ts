/**
 * EdgeGDE — Affordability Agent
 * Deterministic math: income - expenses = disposable, loan/income*5 = debt ratio.
 * Pure function — no I/O, no randomness, no time dependency.
 */

export interface AffordabilityInput {
  income: number
  expenses: number
  targetLoanAmount: number
}

export interface AffordabilityOutput {
  affordabilityScore: number
  maxBorrowing: number
  debtRatio: number
}

export function computeAffordability(input: AffordabilityInput): AffordabilityOutput {
  const { income, expenses, targetLoanAmount } = input

  const disposableIncome = Math.max(0, income - expenses)
  const maxBorrowing = Math.round(income * 5)
  const debtRatio = income > 0 ? parseFloat(Math.min(targetLoanAmount / (income * 5), 1).toFixed(4)) : 0

  // affordability_score = disposable / income, clamped [0, 1]
  const affordabilityScore = income > 0
    ? parseFloat(Math.min(disposableIncome / income, 1).toFixed(4))
    : 0

  return {
    affordabilityScore: Math.max(0, Math.min(1, affordabilityScore)),
    maxBorrowing,
    debtRatio: Math.max(0, Math.min(1, debtRatio)),
  }
}

/**
 * EdgeGDE — Pure Math Engine
 * Phase 29: Zero-side-effect loan calculation functions.
 * No imports from form-registry, schemas, KV, or any runtime.
 * Pure functions only — deterministic, testable, isolated.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LoanInput {
  loanAmount: number
  interestRate: number
  termYears: number
  income?: number
  expenses?: number
}

export interface LoanMetrics {
  monthlyRepayment: number
  monthlyRepaymentFormatted: string
  totalRepayment: number
  totalRepaymentFormatted: string
  surplusIncome: number
  surplusIncomeFormatted: string
  isSurplusPositive: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const round = (n: number): number => Number(n.toFixed(2))

const formatMoney = (n: number): string =>
  '$' + n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

// ═══════════════════════════════════════════════════════════════════════════
// Pure compute
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate loan amortization metrics.
 * Guards against 0% interest (divide by zero).
 * All outputs are deterministic — no KV, no HTTP, no env.
 */
export function calculateLoanMetrics(data: LoanInput): LoanMetrics {
  const { loanAmount, interestRate, termYears } = data
  const income = data.income ?? 0
  const expenses = data.expenses ?? 0

  const totalMonths = termYears * 12
  const monthlyRate = interestRate / 100 / 12

  let monthlyRepayment: number
  if (interestRate === 0) {
    monthlyRepayment = loanAmount / totalMonths
  } else {
    const factor = Math.pow(1 + monthlyRate, totalMonths)
    monthlyRepayment = loanAmount * (monthlyRate * factor) / (factor - 1)
  }

  const monthlyRepaymentRounded = round(monthlyRepayment)
  const totalRepayment = round(monthlyRepaymentRounded * totalMonths)
  const surplusIncome = round((income / 12) - (expenses / 12) - monthlyRepaymentRounded)
  const isSurplusPositive = surplusIncome >= 0

  return {
    monthlyRepayment: monthlyRepaymentRounded,
    monthlyRepaymentFormatted: formatMoney(monthlyRepaymentRounded),
    totalRepayment,
    totalRepaymentFormatted: formatMoney(totalRepayment),
    surplusIncome,
    surplusIncomeFormatted: formatMoney(Math.abs(surplusIncome)),
    isSurplusPositive,
  }
}

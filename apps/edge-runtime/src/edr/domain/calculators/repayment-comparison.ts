/**
 * EdgeGDE — Domain: Repayment Comparison Calculator
 *
 * Compare standard loan repayment with an extra repayment strategy.
 * Extra repayments reduce the loan term and total interest paid.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const RepaymentComparisonInputSchema = z
  .object({
    loanAmount: z.number().positive('Loan amount must be positive'),
    interestRate: z.number().min(0, 'Interest rate must be >= 0').max(100, 'Interest rate must be <= 100'),
    termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
    extraRepayment: z.number().min(0, 'Extra repayment cannot be negative'),
    extraFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
  })
  .strict()

export type RepaymentComparisonInput = z.infer<typeof RepaymentComparisonInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface RepaymentComparisonOutput {
  standardMonthly: number
  standardTotalInterest: number
  standardTotalCost: number
  extraMonthly: number
  extraTotalInterest: number
  extraTotalCost: number
  monthsSaved: number
  interestSaved: number
  extraMonthsToRepay: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate standard monthly repayment: M = P * r * (1+r)^n / ((1+r)^n - 1)
 */
function calcMonthlyRepayment(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) {
    return principal / months
  }
  const onePlusR = 1 + monthlyRate
  const powR = Math.pow(onePlusR, months)
  return principal * (monthlyRate * powR) / (powR - 1)
}

/**
 * Calculate remaining balance after a given number of months.
 */
function calcRemainingBalance(
  principal: number,
  monthlyRate: number,
  monthsTotal: number,
  monthsPaid: number,
  monthlyPayment: number,
): number {
  if (monthlyRate === 0) {
    return Math.max(0, principal - monthlyPayment * monthsPaid)
  }
  const onePlusR = 1 + monthlyRate
  const balance =
    principal * Math.pow(onePlusR, monthsPaid) -
    monthlyPayment * (Math.pow(onePlusR, monthsPaid) - 1) / monthlyRate
  return Math.max(0, balance)
}

/**
 * Simulate how many months to repay with an extra repayment each month.
 */
function simulateExtraRepayment(
  principal: number,
  monthlyRate: number,
  standardMonthly: number,
  extraMonthlyAmount: number,
  maxMonths: number,
): { months: number; totalInterest: number } {
  let balance = principal
  let totalInterest = 0
  let months = 0
  const payment = standardMonthly + extraMonthlyAmount

  while (balance > 0 && months < maxMonths) {
    const interestThisMonth = balance * monthlyRate
    totalInterest += interestThisMonth
    const principalPaid = Math.min(payment, balance + interestThisMonth)
    balance = balance + interestThisMonth - principalPaid
    months++

    // Prevent infinite loop on tiny balances
    if (balance < 0.001) break
  }

  return { months, totalInterest: roundMoney(totalInterest) }
}

/**
 * Calculate and compare standard vs extra repayment strategy.
 *
 * @param input - validated repayment comparison input
 * @returns standard and extra repayment metrics
 */
export function calculateRepaymentComparison(input: RepaymentComparisonInput): RepaymentComparisonOutput {
  const { loanAmount, interestRate, termYears, extraRepayment, extraFrequency } = input

  const r = interestRate / 100 / 12
  const n = termYears * 12

  // Standard monthly repayment
  const standardMonthly = roundMoney(calcMonthlyRepayment(loanAmount, r, n))
  const standardTotalCost = roundMoney(standardMonthly * n)
  const standardTotalInterest = roundMoney(standardTotalCost - loanAmount)

  // Convert extra repayment to monthly equivalent
  let extraMonthlyAmount: number
  switch (extraFrequency) {
    case 'fortnightly':
      extraMonthlyAmount = roundMoney(extraRepayment * 26 / 12)
      break
    case 'weekly':
      extraMonthlyAmount = roundMoney(extraRepayment * 52 / 12)
      break
    default:
      extraMonthlyAmount = extraRepayment
  }

  const maxMonths = n * 2 // Cap at 2x the standard term
  const { months: extraMonths, totalInterest: extraTotalInterest } =
    simulateExtraRepayment(loanAmount, r, standardMonthly, extraMonthlyAmount, maxMonths)

  const extraMonthlyPayment = roundMoney(standardMonthly + extraMonthlyAmount)
  const extraTotalCost = roundMoney(loanAmount + extraTotalInterest)

  const monthsSaved = n - extraMonths
  const interestSaved = roundMoney(standardTotalInterest - extraTotalInterest)

  return {
    standardMonthly,
    standardTotalInterest,
    standardTotalCost,
    extraMonthly: extraMonthlyPayment,
    extraTotalInterest,
    extraTotalCost,
    monthsSaved: Math.max(0, monthsSaved),
    interestSaved: Math.max(0, interestSaved),
    extraMonthsToRepay: extraMonths,
  }
}

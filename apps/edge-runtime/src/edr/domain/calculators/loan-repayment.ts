/**
 * EdgeGDE — Domain: Loan Repayment Calculator
 *
 * Standard Australian mortgage formula:
 *   M = P * r * (1+r)^n / ((1+r)^n - 1)
 *
 * Outputs: monthly/fortnightly/weekly repayment, total interest, total cost
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const LoanRepaymentInputSchema = z
  .object({
    principal: z.number().positive('Principal must be positive'),
    annualRate: z.number().min(0, 'Annual rate must be >= 0').max(100, 'Annual rate must be <= 100'),
    termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  })
  .strict()

export type LoanRepaymentInput = z.infer<typeof LoanRepaymentInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface LoanRepaymentOutput {
  monthlyRepayment: number
  fortnightlyRepayment: number
  weeklyRepayment: number
  totalInterest: number
  totalCost: number
  monthlyFormatted: string
  fortnightlyFormatted: string
  weeklyFormatted: string
  totalInterestFormatted: string
  totalCostFormatted: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * M = P * r * (1+r)^n / ((1+r)^n - 1)
 *
 * P = principal
 * r = monthly interest rate = annualRate / 12 / 100
 * n = total monthly payments = termYears * 12
 */
export function calculateLoanRepayment(input: LoanRepaymentInput): LoanRepaymentOutput {
  const { principal, annualRate, termYears } = input
  const r = annualRate / 100 / 12
  const n = termYears * 12

  let monthlyRepayment: number
  if (annualRate === 0) {
    monthlyRepayment = principal / n
  } else {
    const onePlusR = 1 + r
    const powR = Math.pow(onePlusR, n)
    monthlyRepayment = principal * (r * powR) / (powR - 1)
  }

  monthlyRepayment = roundMoney(monthlyRepayment)
  const annualCost = monthlyRepayment * 12
  const fortnightlyRepayment = roundMoney(annualCost / 26)
  const weeklyRepayment = roundMoney(annualCost / 52)
  const totalRepayments = roundMoney(monthlyRepayment * n)
  const totalInterest = roundMoney(Math.max(0, totalRepayments - principal))
  const totalCost = roundMoney(principal + totalInterest)

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    monthlyRepayment,
    fortnightlyRepayment,
    weeklyRepayment,
    totalInterest,
    totalCost,
    monthlyFormatted: fmt(monthlyRepayment),
    fortnightlyFormatted: fmt(fortnightlyRepayment),
    weeklyFormatted: fmt(weeklyRepayment),
    totalInterestFormatted: fmt(totalInterest),
    totalCostFormatted: fmt(totalCost),
  }
}

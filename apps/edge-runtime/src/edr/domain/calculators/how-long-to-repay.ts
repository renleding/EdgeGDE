/**
 * EdgeGDE — Domain: How Long to Repay Calculator
 *
 * Calculate how long it will take to repay a loan given a fixed repayment
 * amount. Returns months/years to payoff and total interest paid.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

/** HowLongToRepayInputSchema. */
export const HowLongToRepayInputSchema = z.object({
  principal: z.number().positive('Principal must be positive'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  repaymentAmount: z.number().positive('Repayment amount must be positive'),
  repaymentFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
}).strict()

export type HowLongToRepayInput = z.input<typeof HowLongToRepayInputSchema>

export interface HowLongToRepayOutput {
  monthsToPayoff: number
  yearsToPayoff: number
  totalRepaid: number
  totalInterest: number
  monthsFormatted: string
  totalInterestFormatted: string
  totalRepaidFormatted: string
}

export function calculateHowLongToRepay(input: HowLongToRepayInput): HowLongToRepayOutput {
  const principal = input.principal ?? 0
  const interestRate = input.interestRate ?? 0
  const repaymentAmount = input.repaymentAmount ?? 0
  const repaymentFrequency = input.repaymentFrequency ?? 'monthly'

  const freq = repaymentFrequency === 'monthly' ? 12 : repaymentFrequency === 'fortnightly' ? 26 : 52
  const r = interestRate / 100 / freq
  const maxMonths = 600 // 50 years cap

  let balance = principal
  let totalRepaid = 0
  let months = 0

  while (balance > 0 && months < maxMonths) {
    const interest = balance * r
    const principalPaid = Math.min(repaymentAmount - interest, balance)
    balance -= principalPaid
    totalRepaid += repaymentAmount
    months++
    if (balance <= 0) break
  }

  // If repayment covers at least interest
  const totalInterest = roundMoney(totalRepaid - principal)
  const years = Math.floor(months / 12)
  const remainingMonths = months % 12

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    monthsToPayoff: months,
    yearsToPayoff: Math.round(months / 12 * 10) / 10,
    totalRepaid: roundMoney(totalRepaid),
    totalInterest,
    monthsFormatted: `${years}y ${remainingMonths}m`,
    totalInterestFormatted: fmt(totalInterest),
    totalRepaidFormatted: fmt(roundMoney(totalRepaid)),
  }
}

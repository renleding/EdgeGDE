/**
 * EdgeGDE — Domain: Lump Sum Repayment Calculator
 *
 * Calculate the impact of a lump sum payment on a loan.
 * Shows months saved, interest saved, and new payoff date.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const LumpSumRepaymentInputSchema = z.object({
  principal: z.number().positive('Principal must be positive'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  lumpSum: z.number().positive('Lump sum must be positive'),
  repaymentFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
}).strict()

export type LumpSumRepaymentInput = z.input<typeof LumpSumRepaymentInputSchema>

export interface LumpSumRepaymentOutput {
  standardPayment: number
  lumpSum: number
  monthsSaved: number
  interestSaved: number
  newTermMonths: number
  newTotalCost: number
  interestSavedFormatted: string
  monthsSavedFormatted: string
}

export function calculateLumpSumRepayment(input: LumpSumRepaymentInput): LumpSumRepaymentOutput {
  const principal = input.principal ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1
  const lumpSum = input.lumpSum ?? 0
  const repaymentFrequency = input.repaymentFrequency ?? 'monthly'

  const freq = repaymentFrequency === 'monthly' ? 12 : repaymentFrequency === 'fortnightly' ? 26 : 52
  const n = termYears * freq
  const r = interestRate / 100 / freq

  // Standard payment
  let standardPayment = 0
  if (r === 0) {
    standardPayment = principal / n
  } else {
    const onePlusR = 1 + r
    const powR = Math.pow(onePlusR, n)
    standardPayment = principal * (r * powR) / (powR - 1)
  }
  standardPayment = roundMoney(standardPayment)

  // Standard amortization
  let balance = principal
  let totalInterest = 0
  for (let i = 0; i < n; i++) {
    const interest = balance * r
    totalInterest += interest
    balance -= standardPayment - interest
    if (balance <= 0) break
  }
  const standardInterest = roundMoney(totalInterest)

  // With lump sum — apply lump sum to principal immediately
  let newBalance = Math.max(0, principal - lumpSum)
  let newTotalInterest = 0
  let months = 0

  while (newBalance > 0 && months < n) {
    const interest = newBalance * r
    newTotalInterest += interest
    newBalance -= standardPayment - interest
    months++
    if (newBalance <= 0) break
  }

  // If lump sum paid off the entire loan
  if (principal <= lumpSum) {
    months = 0
    newTotalInterest = 0
  }

  const interestSaved = roundMoney(standardInterest - newTotalInterest)
  const monthsSaved = n - months

  return {
    standardPayment,
    lumpSum,
    monthsSaved: Math.max(0, monthsSaved),
    interestSaved: Math.max(0, interestSaved),
    newTermMonths: months,
    newTotalCost: roundMoney(principal - lumpSum > 0 ? standardPayment * months + lumpSum : lumpSum),
    interestSavedFormatted: `$${Math.max(0, interestSaved).toFixed(2)}`,
    monthsSavedFormatted: `${Math.max(0, monthsSaved)} months`,
  }
}

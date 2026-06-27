/**
 * EdgeGDE — Domain: Extra Repayment Calculator
 *
 * Model the impact of additional repayments on a loan.
 * Shows months saved, interest saved, and new total cost.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const ExtraRepaymentInputSchema = z.object({
  principal: z.number().positive('Principal must be positive'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  extraRepayment: z.number().min(0, 'Extra repayment must be >= 0'),
  repaymentFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
}).strict()

export type ExtraRepaymentInput = z.input<typeof ExtraRepaymentInputSchema>

export interface ExtraRepaymentOutput {
  standardRepayment: number
  extraRepaymentAmount: number
  newRepayment: number
  monthsSaved: number
  yearsSaved: number
  interestSaved: number
  newTermMonths: number
  newTotalCost: number
  standardTotalInterest: number
  standardTotalCost: number
  standardRepaymentFormatted: string
  newRepaymentFormatted: string
  interestSavedFormatted: string
  monthsSavedFormatted: string
}

/** Calculate standard monthly amortization schedule. */
function amortize(principal: number, ratePerPeriod: number, n: number, payment: number): { totalInterest: number; actualTerm: number } {
  let balance = principal
  let totalInterest = 0
  let period = 0
  while (balance > 0 && period < n) {
    const interest = balance * ratePerPeriod
    const principalPaid = Math.min(payment - interest, balance)
    balance -= principalPaid
    totalInterest += interest
    period++
    if (balance <= 0) break
  }
  return { totalInterest: roundMoney(totalInterest), actualTerm: period }
}

export function calculateExtraRepayment(input: ExtraRepaymentInput): ExtraRepaymentOutput {
  const principal = input.principal ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1
  const extraRepayment = input.extraRepayment ?? 0
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
    standardPayment = principal * (r * Math.pow(onePlusR, n)) / (Math.pow(onePlusR, n) - 1)
  }
  standardPayment = roundMoney(standardPayment)

  // New payment with extra repayment
  const newPayment = roundMoney(standardPayment + extraRepayment)

  // Standard amortization
  const standard = amortize(principal, r, n, standardPayment)
  const standardTotalCost = roundMoney(principal + standard.totalInterest)

  // With extra repayment
  const extra = amortize(principal, r, n, newPayment)
  const newTotalCost = roundMoney(principal + extra.totalInterest)

  const monthsSaved = standard.actualTerm - extra.actualTerm
  const interestSaved = roundMoney(standard.totalInterest - extra.totalInterest)
  const yearsSaved = Math.floor(monthsSaved / 12)

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    standardRepayment: standardPayment,
    extraRepaymentAmount: extraRepayment,
    newRepayment: newPayment,
    monthsSaved,
    yearsSaved,
    interestSaved,
    newTermMonths: extra.actualTerm,
    newTotalCost,
    standardTotalInterest: standard.totalInterest,
    standardTotalCost,
    standardRepaymentFormatted: fmt(standardPayment),
    newRepaymentFormatted: fmt(newPayment),
    interestSavedFormatted: fmt(interestSaved),
    monthsSavedFormatted: `${monthsSaved} months (${yearsSaved} years)`,
  }
}

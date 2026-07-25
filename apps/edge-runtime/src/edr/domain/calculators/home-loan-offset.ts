/**
 * EdgeGDE — Domain: Home Loan Offset Calculator
 *
 * Estimate interest savings from an offset account.
 * Compares against a no-offset baseline.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

/** HomeLoanOffsetInputSchema. */
export const HomeLoanOffsetInputSchema = z.object({
  loanBalance: z.number().positive('Loan balance must be positive'),
  offsetBalance: z.number().min(0, 'Offset balance must be >= 0'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
}).strict()

export type HomeLoanOffsetInput = z.input<typeof HomeLoanOffsetInputSchema>

export interface HomeLoanOffsetOutput {
  noOffsetMonthly: number
  withOffsetMonthly: number
  interestSaved: number
  monthsSaved: number
  effectiveLoanBalance: number
  monthlySaving: number
  noOffsetTotalInterest: number
  withOffsetTotalInterest: number
  interestSavedFormatted: string
  monthlySavingFormatted: string
}

export function calculateHomeLoanOffset(input: HomeLoanOffsetInput): HomeLoanOffsetOutput {
  const loanBalance = input.loanBalance ?? 0
  const offsetBalance = input.offsetBalance ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1

  const r = interestRate / 100 / 12
  const n = termYears * 12
  const effectiveBalance = Math.max(0, loanBalance - offsetBalance)

  // No-offset baseline
  let noOffsetPayment = 0
  if (r === 0) {
    noOffsetPayment = loanBalance / n
  } else {
    const onePlusR = 1 + r
    const powR = Math.pow(onePlusR, n)
    noOffsetPayment = loanBalance * (r * powR) / (powR - 1)
  }
  noOffsetPayment = roundMoney(noOffsetPayment)

  // With offset — interest calculated on (loanBalance - offsetBalance) each period
  // Payment stays the same, but more goes to principal, so loan pays off faster
  let balance = loanBalance
  let offsetMonths = 0
  let withOffsetTotalInt = 0
  while (balance > 0 && offsetMonths < n) {
    const effectivePrincipal = Math.max(0, balance - offsetBalance)
    const interest = effectivePrincipal * r
    withOffsetTotalInt += interest
    const principalPaid = Math.min(noOffsetPayment - interest, balance)
    balance -= principalPaid
    offsetMonths++
  }

  const noOffsetTotalInt = roundMoney(noOffsetPayment * n - loanBalance)
  const withOffsetTotalIntRounded = roundMoney(withOffsetTotalInt)
  const interestSaved = roundMoney(noOffsetTotalInt - withOffsetTotalIntRounded)
  const monthsSaved = n - offsetMonths
  const withOffsetPayment = noOffsetPayment // Same payment, just allocates differently

  return {
    noOffsetMonthly: noOffsetPayment,
    withOffsetMonthly: withOffsetPayment,
    interestSaved,
    monthsSaved: Math.max(0, monthsSaved),
    effectiveLoanBalance: effectiveBalance,
    monthlySaving: roundMoney(noOffsetPayment - withOffsetPayment),
    noOffsetTotalInterest: noOffsetTotalInt,
    withOffsetTotalInterest: withOffsetTotalIntRounded,
    interestSavedFormatted: `$${interestSaved.toFixed(2)}`,
    monthlySavingFormatted: 'See interest saved above',
  }
}

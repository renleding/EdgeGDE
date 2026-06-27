/**
 * EdgeGDE — Domain: Income Annualisation Calculator
 *
 * Convert irregular or part-period income into annualized equivalent,
 * weekly equivalent, and monthly equivalent figures.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const IncomeAnnualisationInputSchema = z.object({
  incomeAmount: z.number().min(0, 'Income amount must be >= 0'),
  incomePeriod: z.enum(['weekly', 'fortnightly', 'monthly', 'yearly']).default('monthly'),
  weeksWorkedPerYear: z.number().int('Weeks must be whole').min(1, 'Weeks must be >= 1').max(52, 'Weeks must be <= 52').default(52),
  employmentType: z.enum(['full-time', 'part-time', 'casual', 'contract']).default('full-time'),
}).strict()

export type IncomeAnnualisationInput = z.input<typeof IncomeAnnualisationInputSchema>

export interface IncomeAnnualisationOutput {
  annualisedIncome: number
  weeklyEquivalent: number
  monthlyEquivalent: number
  annualisedFormatted: string
  weeklyFormatted: string
  monthlyFormatted: string
}

export function calculateIncomeAnnualisation(input: IncomeAnnualisationInput): IncomeAnnualisationOutput {
  const incomeAmount = input.incomeAmount ?? 0
  const incomePeriod = input.incomePeriod ?? 'monthly'
  const weeksWorkedPerYear = input.weeksWorkedPerYear ?? 52

  // Convert input to weekly rate first
  let weeklyRate = 0
  switch (incomePeriod) {
    case 'weekly':      weeklyRate = incomeAmount; break
    case 'fortnightly': weeklyRate = incomeAmount / 2; break
    case 'monthly':     weeklyRate = incomeAmount * 12 / 52; break
    case 'yearly':      weeklyRate = incomeAmount / 52; break
  }

  const annualisedIncome = roundMoney(weeklyRate * weeksWorkedPerYear)
  const weeklyEquivalent = roundMoney(weeklyRate)
  const monthlyEquivalent = roundMoney(weeklyRate * 52 / 12)

  return {
    annualisedIncome,
    weeklyEquivalent,
    monthlyEquivalent,
    annualisedFormatted: `$${annualisedIncome.toFixed(2)}`,
    weeklyFormatted: `$${weeklyEquivalent.toFixed(2)}`,
    monthlyFormatted: `$${monthlyEquivalent.toFixed(2)}`,
  }
}

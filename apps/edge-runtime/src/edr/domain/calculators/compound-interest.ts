/**
 * EdgeGDE — Domain: Compound Interest Calculator
 *
 * Project future value of an investment with regular contributions
 * and compound interest.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

/** CompoundInterestInputSchema. */
export const CompoundInterestInputSchema = z.object({
  principal: z.number().min(0, 'Principal must be >= 0'),
  regularContribution: z.number().min(0, 'Contribution must be >= 0').default(0),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(100, 'Rate must be <= 100'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  compoundingFrequency: z.enum(['monthly', 'quarterly', 'annually']).default('monthly'),
  contributionTiming: z.enum(['start', 'end']).default('start'),
}).strict()

export type CompoundInterestInput = z.input<typeof CompoundInterestInputSchema>

export interface CompoundInterestOutput {
  futureValue: number
  totalContributions: number
  interestEarned: number
  effectiveAnnualRate: number
  futureValueFormatted: string
  totalContributionsFormatted: string
  interestEarnedFormatted: string
}

export function calculateCompoundInterest(input: CompoundInterestInput): CompoundInterestOutput {
  const principal = input.principal ?? 0
  const regularContribution = input.regularContribution ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1
  const compoundingFrequency = input.compoundingFrequency ?? 'monthly'
  const contributionTiming = input.contributionTiming ?? 'start'

  const periodsPerYear = compoundingFrequency === 'monthly' ? 12 : compoundingFrequency === 'quarterly' ? 4 : 1
  const totalPeriods = termYears * periodsPerYear
  const ratePerPeriod = interestRate / 100 / periodsPerYear

  let balance = principal

  for (let i = 0; i < totalPeriods; i++) {
    if (contributionTiming === 'start') {
      balance += regularContribution
    }
    balance *= (1 + ratePerPeriod)
    if (contributionTiming === 'end') {
      balance += regularContribution
    }
  }

  const futureValue = roundMoney(balance)
  const totalContributions = roundMoney(principal + regularContribution * totalPeriods)
  const interestEarned = roundMoney(futureValue - totalContributions)
  const effectiveAnnualRate = roundMoney((Math.pow(1 + ratePerPeriod, periodsPerYear) - 1) * 100)

  return {
    futureValue,
    totalContributions,
    interestEarned,
    effectiveAnnualRate,
    futureValueFormatted: `$${futureValue.toFixed(2)}`,
    totalContributionsFormatted: `$${totalContributions.toFixed(2)}`,
    interestEarnedFormatted: `$${interestEarned.toFixed(2)}`,
  }
}

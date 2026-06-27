/**
 * EdgeGDE — Domain: Comparison Rate Calculator
 *
 * Estimate the true annualized cost of a loan including fees and charges.
 * Uses Newton-Raphson iteration to solve for the comparison rate.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const ComparisonRateInputSchema = z.object({
  principal: z.number().positive('Principal must be positive'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  upfrontFees: z.number().min(0, 'Upfront fees must be >= 0').default(0),
  ongoingAnnualFees: z.number().min(0, 'Ongoing annual fees must be >= 0').default(0),
  repaymentFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
}).strict()

export type ComparisonRateInput = z.input<typeof ComparisonRateInputSchema>

export interface ComparisonRateOutput {
  comparisonRate: number
  nominalRate: number
  totalFees: number
  effectiveAnnualCost: number
  comparisonRateFormatted: string
  nominalRateFormatted: string
}

export function calculateComparisonRate(input: ComparisonRateInput): ComparisonRateOutput {
  const principal = input.principal ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1
  const upfrontFees = input.upfrontFees ?? 0
  const ongoingAnnualFees = input.ongoingAnnualFees ?? 0
  const repaymentFrequency = input.repaymentFrequency ?? 'monthly'

  const freq = repaymentFrequency === 'monthly' ? 12 : repaymentFrequency === 'fortnightly' ? 26 : 52
  const n = termYears * freq

  // Calculate standard monthly payment at nominal rate
  const rNominal = interestRate / 100 / freq
  let standardPayment = 0
  if (rNominal === 0) {
    standardPayment = principal / n
  } else {
    const onePlusR = 1 + rNominal
    standardPayment = principal * (rNominal * Math.pow(onePlusR, n)) / (Math.pow(onePlusR, n) - 1)
  }

  // Total fees over loan term
  const totalFees = roundMoney(upfrontFees + ongoingAnnualFees * termYears)

  // Effective loan amount (principal minus upfront fees)
  const effectivePrincipal = principal - upfrontFees

  // Solve for comparison rate using Newton-Raphson
  // We need to find r such that:
  // effectivePrincipal * r * (1+r)^n / ((1+r)^n - 1) = standardPayment + (ongoingAnnualFees / freq)
  // The ongoing annual fee increases the periodic payment

  const feeAdjustedPayment = standardPayment + (ongoingAnnualFees / freq)

  // Newton-Raphson: f(r) = P*r*(1+r)^n/((1+r)^n-1) - payment
  // f'(r) = P*((1+r)^n*(1+r*n) - 1) / ((1+r)^n-1)^2

  let compRate = (interestRate + 1) / 100 / freq // Starting guess: nominal rate + 1%

  for (let iter = 0; iter < 50; iter++) {
    const onePlusR = 1 + compRate
    const powR = Math.pow(onePlusR, n)
    if (powR === 1) break

    const fVal = effectivePrincipal * compRate * powR / (powR - 1) - feeAdjustedPayment
    const deriv = effectivePrincipal * ((powR * (1 + compRate * n) - 1)) / ((powR - 1) * (powR - 1))

    if (Math.abs(deriv) < 1e-12) break
    const step = fVal / deriv
    compRate -= step

    if (Math.abs(step) < 1e-12) break
  }

  // Annualize the comparison rate
  const comparisonRate = roundMoney(compRate * freq * 100)

  // Effective annual cost = feeAdjustedPayment * n (total cost with fees)
  const effectiveAnnualCost = roundMoney(feeAdjustedPayment * n)

  const fmt = (v: number) => `${v.toFixed(2)}%`

  return {
    comparisonRate,
    nominalRate: interestRate,
    totalFees,
    effectiveAnnualCost,
    comparisonRateFormatted: fmt(comparisonRate),
    nominalRateFormatted: fmt(interestRate),
  }
}

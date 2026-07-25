/**
 * EdgeGDE — Domain: Split Loan Calculator
 *
 * Calculate loans split across fixed and variable portions.
 * Returns individual repayments, combined total, and weighted average rate.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

function calcMonthlyRepayment(principal: number, annualRate: number, termMonths: number): number {
  const r = annualRate / 100 / 12
  if (r === 0) return principal / termMonths
  const onePlusR = 1 + r
  const powR = Math.pow(onePlusR, termMonths)
  return principal * (r * powR) / (powR - 1)
}

/** SplitLoanInputSchema. */
export const SplitLoanInputSchema = z.object({
  totalPrincipal: z.number().positive('Total principal must be positive'),
  fixedPortion: z.number().positive('Fixed portion must be positive'),
  fixedRate: z.number().min(0, 'Fixed rate must be >= 0').max(25, 'Fixed rate must be <= 25'),
  fixedTermYears: z.number().int('Fixed term must be whole years').positive('Fixed term must be positive'),
  variableRate: z.number().min(0, 'Variable rate must be >= 0').max(25, 'Variable rate must be <= 25'),
  variableTermYears: z.number().int('Variable term must be whole years').positive('Variable term must be positive'),
}).strict()

export type SplitLoanInput = z.input<typeof SplitLoanInputSchema>

export interface SplitLoanOutput {
  fixedRepayment: number
  variableRepayment: number
  totalRepayment: number
  totalInterest: number
  weightedAverageRate: number
  fixedRepaymentFormatted: string
  variableRepaymentFormatted: string
  totalRepaymentFormatted: string
  weightedRateFormatted: string
}

export function calculateSplitLoan(input: SplitLoanInput): SplitLoanOutput {
  const totalPrincipal = input.totalPrincipal ?? 0
  const fixedPortion = input.fixedPortion ?? 0
  const fixedRate = input.fixedRate ?? 0
  const fixedTermYears = input.fixedTermYears ?? 1
  const variableRate = input.variableRate ?? 0
  const variableTermYears = input.variableTermYears ?? 1

  const variablePortion = roundMoney(totalPrincipal - fixedPortion)
  const fixedMonths = fixedTermYears * 12
  const variableMonths = variableTermYears * 12

  const fixedRepayment = roundMoney(calcMonthlyRepayment(fixedPortion, fixedRate, fixedMonths))
  const variableRepayment = roundMoney(calcMonthlyRepayment(variablePortion, variableRate, variableMonths))
  const totalRepayment = roundMoney(fixedRepayment + variableRepayment)
  const totalPaid = roundMoney(fixedRepayment * fixedMonths + variableRepayment * variableMonths)
  const totalInterest = roundMoney(totalPaid - totalPrincipal)
  const weightedAverageRate = totalPrincipal > 0
    ? roundMoney((fixedPortion * fixedRate + variablePortion * variableRate) / totalPrincipal)
    : 0

  return {
    fixedRepayment,
    variableRepayment,
    totalRepayment,
    totalInterest,
    weightedAverageRate,
    fixedRepaymentFormatted: `$${fixedRepayment.toFixed(2)}`,
    variableRepaymentFormatted: `$${variableRepayment.toFixed(2)}`,
    totalRepaymentFormatted: `$${totalRepayment.toFixed(2)}`,
    weightedRateFormatted: `${weightedAverageRate.toFixed(2)}%`,
  }
}

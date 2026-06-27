/**
 * EdgeGDE — Domain: Income Gross Up Calculator
 *
 * Convert net (after-tax) income to gross (pre-tax) equivalent
 * using a given tax rate or gross-up rate.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const IncomeGrossUpInputSchema = z.object({
  netIncome: z.number().min(0, 'Net income must be >= 0'),
  grossUpRate: z.number().min(0, 'Gross-up rate must be >= 0').max(100, 'Gross-up rate must be <= 100').optional(),
  taxRate: z.number().min(0, 'Tax rate must be >= 0').max(100, 'Tax rate must be <= 100').optional(),
  incomePeriod: z.enum(['weekly', 'fortnightly', 'monthly', 'yearly']).default('yearly'),
}).strict()

export type IncomeGrossUpInput = z.input<typeof IncomeGrossUpInputSchema>

export interface IncomeGrossUpOutput {
  grossIncome: number
  totalTax: number
  netIncome: number
  effectiveRate: number
  grossFormatted: string
  netFormatted: string
}

export function calculateIncomeGrossUp(input: IncomeGrossUpInput): IncomeGrossUpOutput {
  const netIncome = input.netIncome ?? 0
  const grossUpRate = input.grossUpRate
  const taxRate = input.taxRate
  const incomePeriod = input.incomePeriod ?? 'yearly'

  // If gross-up rate is provided, use it directly.
  // Otherwise, derive from tax rate.
  const effectiveRate = grossUpRate !== undefined
    ? grossUpRate
    : taxRate !== undefined ? taxRate : 30

  const grossIncome = roundMoney(netIncome / (1 - effectiveRate / 100))
  const totalTax = roundMoney(grossIncome - netIncome)

  return {
    grossIncome,
    totalTax,
    netIncome,
    effectiveRate,
    grossFormatted: `$${grossIncome.toFixed(2)}/${incomePeriod === 'yearly' ? 'yr' : incomePeriod === 'monthly' ? 'mo' : incomePeriod === 'fortnightly' ? 'fn' : 'wk'}`,
    netFormatted: `$${netIncome.toFixed(2)}/${incomePeriod === 'yearly' ? 'yr' : incomePeriod === 'monthly' ? 'mo' : incomePeriod === 'fortnightly' ? 'fn' : 'wk'}`,
  }
}

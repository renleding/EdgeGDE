/**
 * EdgeGDE — Domain: Leasing Calculator
 *
 * Estimate lease payments for an asset given price, residual value,
 * interest rate, term, and fees.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

/** LeasingInputSchema. */
export const LeasingInputSchema = z.object({
  assetPrice: z.number().positive('Asset price must be positive'),
  residualValue: z.number().min(0, 'Residual value must be >= 0'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  fees: z.number().min(0, 'Fees must be >= 0').default(0),
  paymentFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
}).strict()

export type LeasingInput = z.input<typeof LeasingInputSchema>

export interface LeasingOutput {
  leasePayment: number
  totalLeaseCost: number
  totalInterest: number
  capitalizedCost: number
  leasePaymentFormatted: string
  totalLeaseCostFormatted: string
  totalInterestFormatted: string
}

export function calculateLeasing(input: LeasingInput): LeasingOutput {
  const assetPrice = input.assetPrice ?? 0
  const residualValue = input.residualValue ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1
  const fees = input.fees ?? 0
  const paymentFrequency = input.paymentFrequency ?? 'monthly'

  const freq = paymentFrequency === 'monthly' ? 12 : paymentFrequency === 'fortnightly' ? 26 : 52
  const n = termYears * freq
  const r = interestRate / 100 / freq
  const capitalizedCost = roundMoney(assetPrice + fees)

  // Depreciation component: (capitalized cost - residual) / n
  const depreciation = (capitalizedCost - residualValue) / n

  // Interest component: (capitalized cost + residual) * r
  // Standard lease formula uses the average of the two
  const interestComponent = (capitalizedCost + residualValue) * r

  const leasePayment = roundMoney(depreciation + interestComponent)

  const totalLeaseCost = roundMoney(leasePayment * n)
  const totalInterest = roundMoney(totalLeaseCost - (capitalizedCost - residualValue))

  return {
    leasePayment,
    totalLeaseCost,
    totalInterest,
    capitalizedCost,
    leasePaymentFormatted: `$${leasePayment.toFixed(2)}/${paymentFrequency === 'monthly' ? 'mo' : paymentFrequency === 'fortnightly' ? 'fn' : 'wk'}`,
    totalLeaseCostFormatted: `$${totalLeaseCost.toFixed(2)}`,
    totalInterestFormatted: `$${totalInterest.toFixed(2)}`,
  }
}

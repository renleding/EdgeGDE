/**
 * EdgeGDE — Domain: Interest Only Mortgage Calculator
 *
 * Calculate interest-only repayments and compare with principal-and-interest
 * repayments over the full loan term.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const InterestOnlyInputSchema = z.object({
  principal: z.number().positive('Principal must be positive'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  interestOnlyYears: z.number().int('IO years must be whole').positive('IO years must be positive'),
  totalTermYears: z.number().int('Total term must be whole').positive('Total term must be positive'),
}).strict()

export type InterestOnlyInput = z.input<typeof InterestOnlyInputSchema>

export interface InterestOnlyOutput {
  interestOnlyRepayment: number
  principalAndInterestRepaymentAfterIo: number
  totalInterest: number
  totalRepayment: number
  extraCostVsPAndI: number
  ioRepaymentFormatted: string
  pAndIRepaymentFormatted: string
  totalInterestFormatted: string
  extraCostFormatted: string
}

export function calculateInterestOnly(input: InterestOnlyInput): InterestOnlyOutput {
  const principal = input.principal ?? 0
  const interestRate = input.interestRate ?? 0
  const interestOnlyYears = input.interestOnlyYears ?? 1
  const totalTermYears = input.totalTermYears ?? 1

  const r = interestRate / 100 / 12
  const ioMonths = interestOnlyYears * 12
  const remainingTermMonths = (totalTermYears - interestOnlyYears) * 12

  // Interest-only payment (interest only, no principal)
  const ioRepayment = roundMoney(principal * r)

  // After IO period, repay principal + interest over remaining term
  let pAndIRepayment = 0
  if (remainingTermMonths > 0) {
    if (r === 0) {
      pAndIRepayment = principal / remainingTermMonths
    } else {
      const onePlusR = 1 + r
      const powR = Math.pow(onePlusR, remainingTermMonths)
      pAndIRepayment = principal * (r * powR) / (powR - 1)
    }
  }
  pAndIRepayment = roundMoney(pAndIRepayment)

  // Total cost of interest-only loan
  const totalIoPayments = ioRepayment * ioMonths
  const totalPIPayments = pAndIRepayment * remainingTermMonths
  const totalRepayment = roundMoney(totalIoPayments + totalPIPayments)
  const totalInterest = roundMoney(totalRepayment - principal)

  // Standard P&I over full term for comparison
  const fullTermMonths = totalTermYears * 12
  let standardPAndI = 0
  if (fullTermMonths > 0) {
    if (r === 0) {
      standardPAndI = principal / fullTermMonths
    } else {
      const onePlusR = 1 + r
      const powR = Math.pow(onePlusR, fullTermMonths)
      standardPAndI = principal * (r * powR) / (powR - 1)
    }
  }
  standardPAndI = roundMoney(standardPAndI)
  const standardTotalCost = roundMoney(standardPAndI * fullTermMonths)
  const extraCostVsPAndI = roundMoney(totalRepayment - standardTotalCost)

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    interestOnlyRepayment: ioRepayment,
    principalAndInterestRepaymentAfterIo: pAndIRepayment,
    totalInterest,
    totalRepayment,
    extraCostVsPAndI,
    ioRepaymentFormatted: fmt(ioRepayment),
    pAndIRepaymentFormatted: fmt(pAndIRepayment),
    totalInterestFormatted: fmt(totalInterest),
    extraCostFormatted: fmt(extraCostVsPAndI),
  }
}

/**
 * EdgeGDE — Domain: Introductory Rate Loan Calculator
 *
 * Model a loan with an introductory (honeymoon) rate that reverts
 * to a standard rate after a fixed period.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const IntroductoryRateLoanInputSchema = z.object({
  principal: z.number().positive('Principal must be positive'),
  introductoryRate: z.number().min(0, 'Intro rate must be >= 0').max(25, 'Intro rate must be <= 25'),
  introductoryMonths: z.number().int('Intro months must be whole').positive('Intro months must be positive'),
  revertRate: z.number().min(0, 'Revert rate must be >= 0').max(25, 'Revert rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
}).strict()

export type IntroductoryRateLoanInput = z.input<typeof IntroductoryRateLoanInputSchema>

export interface IntroductoryRateLoanOutput {
  introductoryRepayment: number
  revertRepayment: number
  totalInterest: number
  averageRate: number
  introRepaymentFormatted: string
  revertRepaymentFormatted: string
  totalInterestFormatted: string
  averageRateFormatted: string
}

export function calculateIntroductoryRateLoan(input: IntroductoryRateLoanInput): IntroductoryRateLoanOutput {
  const principal = input.principal ?? 0
  const introductoryRate = input.introductoryRate ?? 0
  const introductoryMonths = input.introductoryMonths ?? 1
  const revertRate = input.revertRate ?? 0
  const termYears = input.termYears ?? 1

  const totalMonths = termYears * 12
  const revertMonths = totalMonths - introductoryMonths

  // Introductory payment (interest-only during intro period)
  const introR = introductoryRate / 100 / 12
  const introRepayment = roundMoney(principal * introR)

  // After intro period, recalculate P&I over remaining term
  // The balance is still the full principal (interest-only period doesn't reduce it)
  let revertRepayment = 0
  if (revertMonths > 0) {
    const revR = revertRate / 100 / 12
    if (revR === 0) {
      revertRepayment = principal / revertMonths
    } else {
      const onePlusR = 1 + revR
      const powR = Math.pow(onePlusR, revertMonths)
      revertRepayment = principal * (revR * powR) / (powR - 1)
    }
  }
  revertRepayment = roundMoney(revertRepayment)

  const introTotal = introRepayment * introductoryMonths
  const revertTotal = revertRepayment * revertMonths
  const totalRepaid = roundMoney(introTotal + revertTotal)
  const totalInterest = roundMoney(totalRepaid - principal)

  // Weighted average rate
  const averageRate = totalMonths > 0
    ? roundMoney((introductoryRate * introductoryMonths + revertRate * revertMonths) / totalMonths)
    : 0

  return {
    introductoryRepayment: introRepayment,
    revertRepayment,
    totalInterest,
    averageRate,
    introRepaymentFormatted: `$${introRepayment.toFixed(2)}`,
    revertRepaymentFormatted: `$${revertRepayment.toFixed(2)}`,
    totalInterestFormatted: `$${totalInterest.toFixed(2)}`,
    averageRateFormatted: `${averageRate.toFixed(2)}%`,
  }
}

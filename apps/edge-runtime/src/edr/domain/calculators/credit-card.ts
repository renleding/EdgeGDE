/**
 * EdgeGDE — Domain: Credit Card Calculator
 *
 * Estimate the time and cost to pay off a credit card balance.
 * Supports introductory rates and balance transfers.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const CreditCardInputSchema = z.object({
  balance: z.number().min(0, 'Balance must be >= 0'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(100, 'Rate must be <= 100'),
  monthlyPayment: z.number().positive('Monthly payment must be positive'),
  introRate: z.number().min(0, 'Intro rate must be >= 0').max(100, 'Intro rate must be <= 100').optional(),
  introMonths: z.number().int('Intro months must be whole').min(0, 'Intro months must be >= 0').default(0),
  transferFee: z.number().min(0, 'Transfer fee must be >= 0').default(0),
}).strict()

export type CreditCardInput = z.input<typeof CreditCardInputSchema>

export interface CreditCardOutput {
  monthsToPayoff: number
  totalInterest: number
  totalPaid: number
  finalPayment: number
  monthsFormatted: string
  totalInterestFormatted: string
  totalPaidFormatted: string
}

export function calculateCreditCard(input: CreditCardInput): CreditCardOutput {
  const balance = input.balance ?? 0
  const interestRate = input.interestRate ?? 0
  const monthlyPayment = input.monthlyPayment ?? 0
  const introMonths = input.introMonths ?? 0
  const transferFee = input.transferFee ?? 0
  const introRate = input.introRate

  const standardMonthlyRate = interestRate / 100 / 12
  const introMonthlyRate = introRate !== undefined ? introRate / 100 / 12 : standardMonthlyRate

  let currentBalance = balance + transferFee
  let totalInterest = 0
  let months = 0
  const maxMonths = 600

  while (currentBalance > 0 && months < maxMonths) {
    const rate = months < introMonths ? introMonthlyRate : standardMonthlyRate
    const interest = currentBalance * rate
    totalInterest += interest
    const principalPaid = Math.min(monthlyPayment - interest, currentBalance)
    currentBalance -= principalPaid
    months++
  }

  const finalPayment = currentBalance > 0
    ? roundMoney(monthlyPayment)
    : roundMoney(monthlyPayment)

  const totalPaid = roundMoney(balance + totalInterest + transferFee)

  return {
    monthsToPayoff: months,
    totalInterest: roundMoney(totalInterest),
    totalPaid,
    finalPayment,
    monthsFormatted: `${months} months (${Math.floor(months / 12)}y ${months % 12}m)`,
    totalInterestFormatted: `$${roundMoney(totalInterest).toFixed(2)}`,
    totalPaidFormatted: `$${totalPaid.toFixed(2)}`,
  }
}

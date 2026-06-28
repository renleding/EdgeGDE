/**
 * EdgeGDE — Domain: Reverse Mortgage Calculator
 *
 * Estimate reverse mortgage drawdown, projected loan balance,
 * and remaining equity over time.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const ReverseMortgageInputSchema = z.object({
  propertyValue: z.number().positive('Property value must be positive'),
  borrowerAge: z.number().int('Age must be whole').min(18, 'Borrower must be at least 18').max(120, 'Age must be <= 120'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  initialDrawdown: z.number().min(0, 'Initial drawdown must be >= 0').default(0),
  regularDrawdown: z.number().min(0, 'Regular drawdown must be >= 0').default(0),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
}).strict()

export type ReverseMortgageInput = z.input<typeof ReverseMortgageInputSchema>

export interface ReverseMortgageOutput {
  projectedLoanBalance: number
  remainingEquity: number
  drawdownTotal: number
  equityRemainingPercent: number
  ltvPercent: number
  loanBalanceFormatted: string
  remainingEquityFormatted: string
  drawdownTotalFormatted: string
  equityPercentFormatted: string
}

export function calculateReverseMortgage(input: ReverseMortgageInput): ReverseMortgageOutput {
  const propertyValue = input.propertyValue ?? 0
  const interestRate = input.interestRate ?? 0
  const initialDrawdown = input.initialDrawdown ?? 0
  const regularDrawdown = input.regularDrawdown ?? 0
  const termYears = input.termYears ?? 1

  const r = interestRate / 100 / 12
  const n = termYears * 12

  let loanBalance = initialDrawdown
  let drawdownTotal = initialDrawdown

  for (let i = 0; i < n; i++) {
    loanBalance = loanBalance * (1 + r) + regularDrawdown
    drawdownTotal += regularDrawdown
  }

  loanBalance = roundMoney(loanBalance)
  const remainingEquity = roundMoney(Math.max(0, propertyValue - loanBalance))
  const equityRemainingPercent = propertyValue > 0
    ? roundMoney(remainingEquity / propertyValue * 100)
    : 0
  const ltvPercent = propertyValue > 0
    ? roundMoney(loanBalance / propertyValue * 100)
    : 0

  return {
    projectedLoanBalance: loanBalance,
    remainingEquity,
    drawdownTotal: roundMoney(drawdownTotal),
    equityRemainingPercent,
    ltvPercent,
    loanBalanceFormatted: `$${loanBalance.toFixed(2)}`,
    remainingEquityFormatted: `$${remainingEquity.toFixed(2)}`,
    drawdownTotalFormatted: `$${roundMoney(drawdownTotal).toFixed(2)}`,
    equityPercentFormatted: `${equityRemainingPercent.toFixed(1)}%`,
  }
}

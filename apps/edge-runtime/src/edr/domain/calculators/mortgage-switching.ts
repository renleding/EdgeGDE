/**
 * EdgeGDE — Domain: Mortgage Switching Calculator
 *
 * Compare staying with current loan versus switching/refinancing.
 * Returns break-even analysis including upfront switching costs.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const MortgageSwitchingInputSchema = z.object({
  currentBalance: z.number().positive('Current balance must be positive'),
  currentRate: z.number().min(0, 'Current rate must be >= 0').max(25, 'Current rate must be <= 25'),
  currentRemainingYears: z.number().int('Remaining years must be whole').positive('Remaining years must be positive'),
  newRate: z.number().min(0, 'New rate must be >= 0').max(25, 'New rate must be <= 25'),
  newFeesUpfront: z.number().min(0, 'New upfront fees must be >= 0').default(0),
  breakCosts: z.number().min(0, 'Break costs must be >= 0').default(0),
  newTermYears: z.number().int('New term must be whole').positive('New term must be positive').optional(),
}).strict()

export type MortgageSwitchingInput = z.input<typeof MortgageSwitchingInputSchema>

export interface MortgageSwitchingOutput {
  stayMonthlyRepayment: number
  switchMonthlyRepayment: number
  stayTotalCost: number
  switchTotalCost: number
  netSavingOrCost: number
  breakEvenMonths: number
  stayMonthlyFormatted: string
  switchMonthlyFormatted: string
  netSavingFormatted: string
  breakEvenFormatted: string
}

export function calculateMortgageSwitching(input: MortgageSwitchingInput): MortgageSwitchingOutput {
  const currentBalance = input.currentBalance ?? 0
  const currentRate = input.currentRate ?? 0
  const currentRemainingYears = input.currentRemainingYears ?? 1
  const newRate = input.newRate ?? 0
  const newFeesUpfront = input.newFeesUpfront ?? 0
  const breakCosts = input.breakCosts ?? 0
  const newTermYears = input.newTermYears ?? currentRemainingYears

  const rCurrent = currentRate / 100 / 12
  const rNew = newRate / 100 / 12
  const currentMonths = currentRemainingYears * 12
  const newMonths = newTermYears * 12

  const calcPayment = (p: number, r: number, n: number) => {
    if (r === 0) return p / n
    const onePlusR = 1 + r
    const powR = Math.pow(onePlusR, n)
    return p * (r * powR) / (powR - 1)
  }

  // Stay: continue current payments for remaining term
  const stayPayment = roundMoney(calcPayment(currentBalance, rCurrent, currentMonths))
  const stayTotalCost = roundMoney(stayPayment * currentMonths)

  // Switch: new loan at new rate, possibly over new term
  // Total switch cost = new payments + upfront fees + break costs
  const switchPayment = roundMoney(calcPayment(currentBalance, rNew, newMonths))
  const switchTotalRepayments = roundMoney(switchPayment * newMonths)
  const switchTotalCost = roundMoney(switchTotalRepayments + newFeesUpfront + breakCosts)

  const netSavingOrCost = roundMoney(stayTotalCost - switchTotalCost)

  // Break-even: how many months before the savings from lower rate offset the switching costs
  const monthlySaving = stayPayment - switchPayment
  const totalSwitchCosts = newFeesUpfront + breakCosts
  const breakEvenMonths = monthlySaving > 0
    ? Math.ceil(totalSwitchCosts / monthlySaving)
    : 999 // Never breaks even

  return {
    stayMonthlyRepayment: stayPayment,
    switchMonthlyRepayment: switchPayment,
    stayTotalCost,
    switchTotalCost,
    netSavingOrCost,
    breakEvenMonths,
    stayMonthlyFormatted: `$${stayPayment.toFixed(2)}`,
    switchMonthlyFormatted: `$${switchPayment.toFixed(2)}`,
    netSavingFormatted: netSavingOrCost >= 0 ? `$${netSavingOrCost.toFixed(2)} saved` : `$${Math.abs(netSavingOrCost).toFixed(2)} extra`,
    breakEvenFormatted: breakEvenMonths < 999 ? `${breakEvenMonths} months` : 'Never breaks even',
  }
}

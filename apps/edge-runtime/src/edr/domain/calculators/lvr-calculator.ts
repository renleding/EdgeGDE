/**
 * EdgeGDE — Domain: LVR (Loan-to-Value Ratio) Calculator
 *
 * Calculate LVR percentage, estimated stamp duty, and LMI indicator.
 * Uses the stamp duty calculator for duty estimation.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'
import { calculateStampDuty, StampDutyInputSchema } from './stamp-duty'
import type { StampDutyInput } from './stamp-duty'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const LvrCalculatorInputSchema = z
  .object({
    propertyValue: z.number().positive('Property value must be positive'),
    loanAmount: z.number().positive('Loan amount must be positive'),
    state: z.enum(['nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt']).default('nsw'),
    isFirstHomeBuyer: z.boolean().default(false),
  })
  .strict()

export type LvrCalculatorInput = z.infer<typeof LvrCalculatorInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface LvrCalculatorOutput {
  lvrPercentage: number
  lvrFormatted: string
  stampDutyEstimate: number
  stampDutyFormatted: string
  lmiRequired: boolean
  lmiWarning: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate LVR, estimate stamp duty, and indicate LMI requirement.
 *
 * LVR = (loanAmount / propertyValue) * 100
 * LMI is typically required when LVR > 80%.
 *
 * @param input - validated LVR calculator input
 * @returns LVR metrics including stamp duty estimate
 */
export function calculateLvr(input: LvrCalculatorInput): LvrCalculatorOutput {
  const { propertyValue, loanAmount, state, isFirstHomeBuyer } = input

  // Validate loan amount doesn't exceed property value
  if (loanAmount > propertyValue) {
    throw new Error('Loan amount cannot exceed property value')
  }

  const lvrPercentage = roundMoney((loanAmount / propertyValue) * 100)
  const lmiRequired = lvrPercentage > 80

  // Estimate stamp duty using the stamp duty calculator
  const stampDutyInput: StampDutyInput = {
    propertyValue,
    state,
    isFirstHomeBuyer,
    isPrincipalPlaceOfResidence: true,
    isForeignBuyer: false,
  }
  const stampDutyResult = calculateStampDuty(stampDutyInput)

  return {
    lvrPercentage,
    lvrFormatted: `${lvrPercentage.toFixed(2)}%`,
    stampDutyEstimate: stampDutyResult.stampDuty,
    stampDutyFormatted: stampDutyResult.stampDutyFormatted,
    lmiRequired,
    lmiWarning: lmiRequired
      ? 'Lenders Mortgage Insurance (LMI) may be required as your LVR exceeds 80%. Additional premiums apply.'
      : 'No LMI required — LVR is 80% or less.',
  }
}

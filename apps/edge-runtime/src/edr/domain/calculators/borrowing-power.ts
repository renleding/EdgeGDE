/**
 * EdgeGDE — Domain: Borrowing Power Calculator
 *
 * Estimate maximum borrowable amount from income, expenses, and
 * serviceability assumptions. Uses a deterministic serviceability
 * formula with conservative buffer.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const BorrowingPowerInputSchema = z
  .object({
    annualIncome: z.number().min(0, 'Annual income must be >= 0'),
    monthlyExpenses: z.number().min(0, 'Monthly expenses must be >= 0'),
    existingDebtPayments: z.number().min(0, 'Existing debt payments must be >= 0').default(0),
    deposit: z.number().min(0, 'Deposit must be >= 0').default(0),
    interestRate: z.number().min(0, 'Interest rate must be >= 0').max(25, 'Interest rate must be <= 25'),
    termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
    interestRateBuffer: z.number().min(0, 'Buffer must be >= 0').max(10, 'Buffer must be <= 10').default(3),
    employmentType: z.enum(['full-time', 'part-time', 'self-employed', 'casual', 'contract']).default('full-time'),
    dependents: z.number().int('Dependents must be whole number').min(0, 'Dependents must be >= 0').default(0),
    creditCommitments: z.number().min(0, 'Credit commitments must be >= 0').default(0),
  })
  .strict()

export type BorrowingPowerInput = z.input<typeof BorrowingPowerInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface BorrowingPowerOutput {
  estimatedBorrowingPower: number
  serviceabilitySurplus: number
  assessedInterestRate: number
  maxLvrAmount: number
  depositRequiredForLvr: number
  estimatedBorrowingPowerFormatted: string
  serviceabilitySurplusFormatted: string
  assessedInterestRateFormatted: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum LVR for standard loans (no LMI). */
const MAX_LVR = 0.80

/** Living expense buffer as a percentage of declared expenses. */
const EXPENSE_BUFFER = 0.15

/** Income stability multiplier based on employment type. */
function incomeMultiplier(type: string): number {
  switch (type) {
    case 'full-time':     return 1.0
    case 'part-time':     return 0.8
    case 'self-employed': return 0.7
    case 'contract':      return 0.75
    case 'casual':        return 0.6
    default:              return 0.8
  }
}

/** Minimum monthly living expenses per dependent ($AUD). */
const DEPENDENT_COST = 500

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

export function calculateBorrowingPower(input: BorrowingPowerInput): BorrowingPowerOutput {
  const annualIncome = input.annualIncome ?? 0
  const monthlyExpenses = input.monthlyExpenses ?? 0
  const existingDebtPayments = input.existingDebtPayments ?? 0
  const deposit = input.deposit ?? 0
  const interestRate = input.interestRate ?? 0
  const termYears = input.termYears ?? 1
  const interestRateBuffer = input.interestRateBuffer ?? 3
  const employmentType = input.employmentType ?? 'full-time'
  const dependents = input.dependents ?? 0
  const creditCommitments = input.creditCommitments ?? 0

  // 1. Assessable income (scaled by employment type stability)
  const effectiveIncome = annualIncome * incomeMultiplier(employmentType)
  const monthlyIncome = effectiveIncome / 12

  // 2. Assessed interest rate (rate + buffer for serviceability)
  const assessedRate = interestRate + interestRateBuffer
  const assessedMonthlyRate = assessedRate / 100 / 12
  const totalMonths = termYears * 12

  // 3. Living expenses (declared + buffer)
  const bufferedExpenses = monthlyExpenses * (1 + EXPENSE_BUFFER)

  // 4. Dependent costs
  const dependentCost = dependents * DEPENDENT_COST

  // 5. Total monthly obligations
  const totalObligations = bufferedExpenses + existingDebtPayments + creditCommitments + dependentCost

  // 6. Serviceable surplus (maximum monthly payment available)
  const serviceableSurplus = Math.max(0, monthlyIncome - totalObligations)

  // 7. Maximum loan amount that can be serviced
  // M = P * r * (1+r)^n / ((1+r)^n - 1) => solve for P
  // P = M * ((1+r)^n - 1) / (r * (1+r)^n)
  let estimatedBorrowingPower = 0
  if (assessedMonthlyRate > 0 && serviceableSurplus > 0) {
    const onePlusR = 1 + assessedMonthlyRate
    const powR = Math.pow(onePlusR, totalMonths)
    estimatedBorrowingPower = serviceableSurplus * (powR - 1) / (assessedMonthlyRate * powR)
  } else if (assessedMonthlyRate === 0 && serviceableSurplus > 0) {
    estimatedBorrowingPower = serviceableSurplus * totalMonths
  }

  estimatedBorrowingPower = roundMoney(estimatedBorrowingPower)

  // 8. LVR-based limits
  const maxLvrAmount = deposit > 0
    ? roundMoney(deposit / (1 - MAX_LVR))
    : estimatedBorrowingPower

  const depositRequiredForLvr = maxLvrAmount > 0
    ? roundMoney(maxLvrAmount - deposit)
    : 0

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    estimatedBorrowingPower,
    serviceabilitySurplus: roundMoney(serviceableSurplus),
    assessedInterestRate: assessedRate,
    maxLvrAmount,
    depositRequiredForLvr,
    estimatedBorrowingPowerFormatted: fmt(estimatedBorrowingPower),
    serviceabilitySurplusFormatted: fmt(roundMoney(serviceableSurplus)),
    assessedInterestRateFormatted: `${assessedRate.toFixed(2)}%`,
  }
}

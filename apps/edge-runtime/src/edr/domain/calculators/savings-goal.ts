/**
 * EdgeGDE — Domain: Savings Goal Calculator
 *
 * How long to save for a goal given current savings, monthly contributions,
 * and interest rate. Uses month-by-month compound interest simulation.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const SavingsGoalInputSchema = z
  .object({
    currentSavings: z.number().min(0, 'Current savings cannot be negative'),
    monthlyContribution: z.number().min(0, 'Monthly contribution cannot be negative'),
    annualRate: z.number().min(0, 'Annual rate must be >= 0').max(100, 'Annual rate must be <= 100'),
    targetAmount: z.number().positive('Target amount must be positive'),
  })
  .strict()

export type SavingsGoalInput = z.infer<typeof SavingsGoalInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface SavingsGoalOutput {
  monthsToGoal: number
  totalContributions: number
  totalInterestEarned: number
  finalAmount: number
  goalReached: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate months needed to reach a savings goal.
 *
 * Simulation: each month, apply monthly interest to balance, then add
 * monthly contribution. Stop when balance >= targetAmount.
 *
 * @param input - validated savings goal input
 * @returns months to goal, total contributions, total interest, final amount
 */
export function calculateSavingsGoal(input: SavingsGoalInput): SavingsGoalOutput {
  const { currentSavings, monthlyContribution, annualRate, targetAmount } = input

  // If already at or above goal, zero months needed
  if (currentSavings >= targetAmount) {
    return {
      monthsToGoal: 0,
      totalContributions: 0,
      totalInterestEarned: 0,
      finalAmount: roundMoney(currentSavings),
      goalReached: true,
    }
  }

  // If no contribution and rate is 0, goal is unreachable
  if (monthlyContribution === 0 && annualRate === 0) {
    return {
      monthsToGoal: Infinity,
      totalContributions: 0,
      totalInterestEarned: 0,
      finalAmount: roundMoney(currentSavings),
      goalReached: false,
    }
  }

  const monthlyRate = annualRate / 100 / 12
  let balance = currentSavings
  let months = 0
  const MAX_MONTHS = 1200 // 100 years max simulation

  while (balance < targetAmount && months < MAX_MONTHS) {
    // Apply interest first, then contribution
    balance = balance * (1 + monthlyRate) + monthlyContribution
    months++
  }

  const totalContributions = roundMoney(months * monthlyContribution)
  const totalInterestEarned = roundMoney(balance - currentSavings - totalContributions)

  return {
    monthsToGoal: months,
    totalContributions,
    totalInterestEarned,
    finalAmount: roundMoney(balance),
    goalReached: balance >= targetAmount,
  }
}

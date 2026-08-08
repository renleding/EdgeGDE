import { describe, it, expect } from 'vitest'
import {
  SavingsGoalInputSchema,
  calculateSavingsGoal,
} from '../../../../src/edr/domain/calculators/savings-goal'

describe('SavingsGoalInputSchema', () => {
  it('accepts a valid input', () => {
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 0, monthlyContribution: 1000, annualRate: 12, targetAmount: 12000 }).success).toBe(true)
  })

  it('rejects negative savings/contribution and non-positive target', () => {
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: -1, monthlyContribution: 1000, annualRate: 12, targetAmount: 12000 }).success).toBe(false)
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 0, monthlyContribution: -1, annualRate: 12, targetAmount: 12000 }).success).toBe(false)
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 0, monthlyContribution: 1000, annualRate: 12, targetAmount: 0 }).success).toBe(false)
  })

  it('rejects out-of-range rate and unknown keys', () => {
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 0, monthlyContribution: 1000, annualRate: 100.01, targetAmount: 12000 }).success).toBe(false)
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 0, monthlyContribution: 1000, annualRate: 12, targetAmount: 12000, extra: 1 }).success).toBe(false)
  })
})

describe('calculateSavingsGoal', () => {
  it('simulates monthly compounding to reach the goal', () => {
    const r = calculateSavingsGoal({ currentSavings: 0, monthlyContribution: 1000, annualRate: 12, targetAmount: 12000 })
    expect(r.monthsToGoal).toBe(12)
    expect(r.totalContributions).toBe(12000)
    expect(r.totalInterestEarned).toBe(682.5)
    expect(r.finalAmount).toBe(12682.5)
    expect(r.goalReached).toBe(true)
  })

  it('returns zero months when already at or above the goal', () => {
    const r = calculateSavingsGoal({ currentSavings: 15000, monthlyContribution: 100, annualRate: 5, targetAmount: 12000 })
    expect(r.monthsToGoal).toBe(0)
    expect(r.totalContributions).toBe(0)
    expect(r.totalInterestEarned).toBe(0)
    expect(r.finalAmount).toBe(15000)
    expect(r.goalReached).toBe(true)
  })

  it('returns Infinity when the goal is unreachable (no contribution, zero rate)', () => {
    const r = calculateSavingsGoal({ currentSavings: 1000, monthlyContribution: 0, annualRate: 0, targetAmount: 2000 })
    expect(r.monthsToGoal).toBe(Infinity)
    expect(r.totalContributions).toBe(0)
    expect(r.totalInterestEarned).toBe(0)
    expect(r.finalAmount).toBe(1000)
    expect(r.goalReached).toBe(false)
  })

  it('caps the simulation at 1200 months', () => {
    const r = calculateSavingsGoal({ currentSavings: 0, monthlyContribution: 1, annualRate: 0, targetAmount: 1000000000 })
    expect(r.monthsToGoal).toBe(1200)
    expect(r.totalContributions).toBe(1200)
    expect(r.finalAmount).toBe(1200)
    expect(r.goalReached).toBe(false)
  })
})

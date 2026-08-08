import { describe, it, expect } from 'vitest'
import {
  CompoundInterestInputSchema,
  calculateCompoundInterest,
} from '../../../../src/edr/domain/calculators/compound-interest'

describe('CompoundInterestInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 1 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.regularContribution).toBe(0)
      expect(r.data.compoundingFrequency).toBe('monthly')
      expect(r.data.contributionTiming).toBe('start')
    }
  })

  it('rejects negative principal and contribution', () => {
    expect(CompoundInterestInputSchema.safeParse({ principal: -1, interestRate: 6, termYears: 1 }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 1, regularContribution: -1 }).success).toBe(false)
  })

  it('rejects out-of-range rate and invalid term', () => {
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 100.01, termYears: 1 }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 0 }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 2.5 }).success).toBe(false)
  })

  it('rejects invalid enums and unknown keys', () => {
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 1, compoundingFrequency: 'daily' }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 1, contributionTiming: 'middle' }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, interestRate: 6, termYears: 1, bonus: 1 }).success).toBe(false)
  })
})

describe('calculateCompoundInterest', () => {
  it('compounds monthly with start-of-period contributions', () => {
    const r = calculateCompoundInterest({ principal: 10000, regularContribution: 100, interestRate: 6, termYears: 1 })
    expect(r.futureValue).toBe(11856.5)
    expect(r.totalContributions).toBe(11200)
    expect(r.interestEarned).toBe(656.5)
    expect(r.effectiveAnnualRate).toBe(6.17)
    expect(r.futureValueFormatted).toBe('$11856.50')
    expect(r.totalContributionsFormatted).toBe('$11200.00')
    expect(r.interestEarnedFormatted).toBe('$656.50')
  })

  it('compounds monthly with end-of-period contributions', () => {
    const r = calculateCompoundInterest({ principal: 10000, regularContribution: 100, interestRate: 6, termYears: 1, contributionTiming: 'end' })
    expect(r.futureValue).toBe(11850.33)
    expect(r.totalContributions).toBe(11200)
    expect(r.interestEarned).toBe(650.33)
    expect(r.effectiveAnnualRate).toBe(6.17)
  })

  it('compounds quarterly', () => {
    const r = calculateCompoundInterest({ principal: 10000, regularContribution: 100, interestRate: 6, termYears: 2, compoundingFrequency: 'quarterly' })
    expect(r.futureValue).toBe(12120.86)
    expect(r.totalContributions).toBe(10800) // 10000 + 100*8
    expect(r.interestEarned).toBe(1320.86)
    expect(r.effectiveAnnualRate).toBe(6.14)
  })

  it('compounds annually', () => {
    const r = calculateCompoundInterest({ principal: 10000, regularContribution: 100, interestRate: 6, termYears: 3, compoundingFrequency: 'annually' })
    expect(r.futureValue).toBe(12247.62)
    expect(r.totalContributions).toBe(10300) // 10000 + 100*3
    expect(r.interestEarned).toBe(1947.62)
    expect(r.effectiveAnnualRate).toBe(6)
  })

  it('returns principal + contributions when rate is zero', () => {
    const r = calculateCompoundInterest({ principal: 10000, regularContribution: 100, interestRate: 0, termYears: 2 })
    expect(r.futureValue).toBe(12400)
    expect(r.totalContributions).toBe(12400)
    expect(r.interestEarned).toBe(0)
    expect(r.effectiveAnnualRate).toBe(0)
  })
})

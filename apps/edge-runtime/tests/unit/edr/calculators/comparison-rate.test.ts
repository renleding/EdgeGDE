import { describe, it, expect } from 'vitest'
import {
  ComparisonRateInputSchema,
  calculateComparisonRate,
} from '../../../../src/edr/domain/calculators/comparison-rate'

describe('ComparisonRateInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 30 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.upfrontFees).toBe(0)
      expect(r.data.ongoingAnnualFees).toBe(0)
      expect(r.data.repaymentFrequency).toBe('monthly')
    }
  })

  it('rejects non-positive principal', () => {
    expect(ComparisonRateInputSchema.safeParse({ principal: 0, interestRate: 5, termYears: 30 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: -100, interestRate: 5, termYears: 30 }).success).toBe(false)
  })

  it('rejects out-of-range rate', () => {
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 25.01, termYears: 30 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: -1, termYears: 30 }).success).toBe(false)
  })

  it('rejects invalid term and missing required fields', () => {
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 0 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 5.5 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5 }).success).toBe(false)
  })

  it('rejects invalid frequency, negative fees, and unknown keys', () => {
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 30, repaymentFrequency: 'daily' }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 30, upfrontFees: -1 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 30, ongoingAnnualFees: -1 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 400000, interestRate: 5, termYears: 30, extra: 1 }).success).toBe(false)
  })
})

describe('calculateComparisonRate', () => {
  it('solves comparison rate with fees above the nominal rate', () => {
    const r = calculateComparisonRate({ principal: 400000, interestRate: 5, termYears: 30, upfrontFees: 1000, ongoingAnnualFees: 500 })
    expect(r.comparisonRate).toBe(5.19)
    expect(r.nominalRate).toBe(5)
    expect(r.totalFees).toBe(16000) // 1000 + 500*30
    expect(r.effectiveAnnualCost).toBe(788023.14)
    expect(r.comparisonRateFormatted).toBe('5.19%')
    expect(r.nominalRateFormatted).toBe('5.00%')
  })

  it('handles zero nominal rate (straight-line payment)', () => {
    const r = calculateComparisonRate({ principal: 12000, interestRate: 0, termYears: 1 })
    expect(r.nominalRate).toBe(0)
    expect(r.totalFees).toBe(0)
    expect(r.effectiveAnnualCost).toBe(12000)
    expect(r.comparisonRate).toBe(0.88)
  })

  it('computes fortnightly and weekly frequencies', () => {
    const f = calculateComparisonRate({ principal: 100000, interestRate: 6, termYears: 5, repaymentFrequency: 'fortnightly' })
    expect(f.comparisonRate).toBe(6.01)
    expect(f.effectiveAnnualCost).toBe(115863.36)

    const w = calculateComparisonRate({ principal: 100000, interestRate: 6, termYears: 5, repaymentFrequency: 'weekly' })
    expect(w.comparisonRate).toBe(6.01)
    expect(w.effectiveAnnualCost).toBe(115806.13)
  })
})

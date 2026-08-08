import { describe, it, expect } from 'vitest'
import {
  InterestOnlyInputSchema,
  calculateInterestOnly,
} from '../../../../src/edr/domain/calculators/interest-only-mortgage'

describe('InterestOnlyInputSchema', () => {
  it('accepts a valid input', () => {
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 6, interestOnlyYears: 5, totalTermYears: 30 }).success).toBe(true)
  })

  it('rejects non-positive principal, out-of-range rate, and invalid terms', () => {
    expect(InterestOnlyInputSchema.safeParse({ principal: 0, interestRate: 6, interestOnlyYears: 5, totalTermYears: 30 }).success).toBe(false)
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 25.01, interestOnlyYears: 5, totalTermYears: 30 }).success).toBe(false)
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 6, interestOnlyYears: 0, totalTermYears: 30 }).success).toBe(false)
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 6, interestOnlyYears: 5, totalTermYears: 0 }).success).toBe(false)
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 6, interestOnlyYears: 2.5, totalTermYears: 30 }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 6, interestOnlyYears: 5, totalTermYears: 30, extra: 1 }).success).toBe(false)
  })
})

describe('calculateInterestOnly', () => {
  it('computes IO repayment, post-IO P&I, and extra cost vs standard P&I', () => {
    const r = calculateInterestOnly({ principal: 500000, interestRate: 6, interestOnlyYears: 5, totalTermYears: 30 })
    expect(r.interestOnlyRepayment).toBe(2500) // 500000 * 0.005
    expect(r.principalAndInterestRepaymentAfterIo).toBe(3221.51)
    expect(r.totalInterest).toBe(616453)
    expect(r.totalRepayment).toBe(1116453)
    expect(r.extraCostVsPAndI).toBe(37263)
    expect(r.ioRepaymentFormatted).toBe('$2500.00')
    expect(r.pAndIRepaymentFormatted).toBe('$3221.51')
    expect(r.totalInterestFormatted).toBe('$616453.00')
    expect(r.extraCostFormatted).toBe('$37263.00')
  })

  it('handles zero interest rate', () => {
    const r = calculateInterestOnly({ principal: 500000, interestRate: 0, interestOnlyYears: 5, totalTermYears: 30 })
    expect(r.interestOnlyRepayment).toBe(0)
    expect(r.principalAndInterestRepaymentAfterIo).toBe(1666.67)
    expect(r.totalInterest).toBe(1)
    expect(r.extraCostVsPAndI).toBe(0.6)
  })

  it('returns zero P&I when the whole term is interest-only', () => {
    const r = calculateInterestOnly({ principal: 500000, interestRate: 6, interestOnlyYears: 30, totalTermYears: 30 })
    expect(r.interestOnlyRepayment).toBe(2500)
    expect(r.principalAndInterestRepaymentAfterIo).toBe(0)
    expect(r.totalRepayment).toBe(900000)
    expect(r.totalInterest).toBe(400000)
    expect(r.extraCostVsPAndI).toBe(-179190)
  })
})

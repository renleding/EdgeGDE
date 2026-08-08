import { describe, it, expect } from 'vitest'
import {
  LoanRepaymentInputSchema,
  calculateLoanRepayment,
} from '../../../../src/edr/domain/calculators/loan-repayment'

describe('LoanRepaymentInputSchema', () => {
  it('accepts a valid input', () => {
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 6, termYears: 30 }).success).toBe(true)
  })

  it('rejects non-positive principal, out-of-range rate, invalid term', () => {
    expect(LoanRepaymentInputSchema.safeParse({ principal: 0, annualRate: 6, termYears: 30 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 100.01, termYears: 30 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: -1, termYears: 30 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 6, termYears: 0 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 6, termYears: 10.5 }).success).toBe(false)
  })

  it('rejects missing fields and unknown keys', () => {
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 6 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 6, termYears: 30, extra: 1 }).success).toBe(false)
  })
})

describe('calculateLoanRepayment', () => {
  it('computes monthly, fortnightly, and weekly repayments with the mortgage formula', () => {
    const r = calculateLoanRepayment({ principal: 500000, annualRate: 6, termYears: 30 })
    expect(r.monthlyRepayment).toBe(2997.75)
    expect(r.fortnightlyRepayment).toBe(1383.58) // 2997.75*12/26
    expect(r.weeklyRepayment).toBe(691.79) // 2997.75*12/52
    expect(r.totalInterest).toBe(579190)
    expect(r.totalCost).toBe(1079190)
    expect(r.monthlyFormatted).toBe('$2997.75')
    expect(r.fortnightlyFormatted).toBe('$1383.58')
    expect(r.weeklyFormatted).toBe('$691.79')
    expect(r.totalInterestFormatted).toBe('$579190.00')
    expect(r.totalCostFormatted).toBe('$1079190.00')
  })

  it('handles zero rate with straight-line principal repayments', () => {
    const r = calculateLoanRepayment({ principal: 500000, annualRate: 0, termYears: 30 })
    expect(r.monthlyRepayment).toBe(1388.89) // 500000/360
    expect(r.fortnightlyRepayment).toBe(641.03)
    expect(r.weeklyRepayment).toBe(320.51)
    expect(r.totalInterest).toBe(0.4) // rounding artifact: 1388.89*360 - 500000
    expect(r.totalCost).toBe(500000.4)
  })

  it('computes a small loan correctly', () => {
    const r = calculateLoanRepayment({ principal: 10000, annualRate: 3, termYears: 5 })
    expect(r.monthlyRepayment).toBe(179.69)
    expect(r.fortnightlyRepayment).toBe(82.93)
    expect(r.weeklyRepayment).toBe(41.47)
    expect(r.totalInterest).toBe(781.4)
    expect(r.totalCost).toBe(10781.4)
  })
})

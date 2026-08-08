import { describe, it, expect } from 'vitest'
import {
  RepaymentComparisonInputSchema,
  calculateRepaymentComparison,
} from '../../../../src/edr/domain/calculators/repayment-comparison'

describe('RepaymentComparisonInputSchema', () => {
  it('accepts a valid input and applies the monthly frequency default', () => {
    const r = RepaymentComparisonInputSchema.safeParse({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 500 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.extraFrequency).toBe('monthly')
  })

  it('rejects non-positive loan amount, out-of-range rate, and invalid term', () => {
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 0, interestRate: 6, termYears: 30, extraRepayment: 500 }).success).toBe(false)
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 400000, interestRate: 100.01, termYears: 30, extraRepayment: 500 }).success).toBe(false)
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 400000, interestRate: 6, termYears: 0, extraRepayment: 500 }).success).toBe(false)
  })

  it('rejects negative extra repayment, invalid frequency, and unknown keys', () => {
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: -1 }).success).toBe(false)
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 500, extraFrequency: 'daily' }).success).toBe(false)
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 500, extra: 1 }).success).toBe(false)
  })
})

describe('calculateRepaymentComparison', () => {
  it('compares standard vs extra repayment strategies monthly', () => {
    const r = calculateRepaymentComparison({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 500, extraFrequency: 'monthly' })
    expect(r.standardMonthly).toBe(2398.2)
    expect(r.standardTotalInterest).toBe(463352)
    expect(r.standardTotalCost).toBe(863352)
    expect(r.extraMonthly).toBe(2898.2)
    expect(r.extraTotalInterest).toBe(280717.58)
    expect(r.extraTotalCost).toBe(680717.58)
    expect(r.monthsSaved).toBe(125)
    expect(r.interestSaved).toBe(182634.42)
    expect(r.extraMonthsToRepay).toBe(235)
  })

  it('returns zero savings with zero extra repayment', () => {
    const r = calculateRepaymentComparison({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 0, extraFrequency: 'monthly' })
    expect(r.extraMonthly).toBe(2398.2)
    expect(r.monthsSaved).toBe(0)
    expect(r.interestSaved).toBe(0)
    expect(r.extraMonthsToRepay).toBe(361) // simulation overruns by one month due to rounding
  })

  it('handles zero interest rate', () => {
    const r = calculateRepaymentComparison({ loanAmount: 12000, interestRate: 0, termYears: 1, extraRepayment: 100, extraFrequency: 'monthly' })
    expect(r.standardMonthly).toBe(1000)
    expect(r.standardTotalInterest).toBe(0)
    expect(r.extraMonthly).toBe(1100)
    expect(r.extraTotalInterest).toBe(0)
    expect(r.extraMonthsToRepay).toBe(11)
    expect(r.monthsSaved).toBe(1)
  })

  it('converts fortnightly and weekly extra repayments to monthly equivalents', () => {
    const f = calculateRepaymentComparison({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 250, extraFrequency: 'fortnightly' })
    expect(f.extraMonthly).toBe(2939.87) // 2398.20 + roundMoney(250*26/12)
    expect(f.interestSaved).toBe(191162.19)
    expect(f.extraMonthsToRepay).toBe(229)

    const w = calculateRepaymentComparison({ loanAmount: 400000, interestRate: 6, termYears: 30, extraRepayment: 120, extraFrequency: 'weekly' })
    expect(w.extraMonthly).toBe(2918.2) // 2398.20 + roundMoney(120*52/12)
    expect(w.interestSaved).toBe(186798.21)
    expect(w.extraMonthsToRepay).toBe(232)
  })
})

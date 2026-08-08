import { describe, it, expect } from 'vitest'
import {
  ExtraRepaymentInputSchema,
  calculateExtraRepayment,
} from '../../../../src/edr/domain/calculators/extra-repayment'

describe('ExtraRepaymentInputSchema', () => {
  it('accepts a valid input and applies the monthly frequency default', () => {
    const r = ExtraRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: 500 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.repaymentFrequency).toBe('monthly')
  })

  it('rejects non-positive principal, out-of-range rate, invalid term', () => {
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 0, interestRate: 6, termYears: 30, extraRepayment: 500 }).success).toBe(false)
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 25.01, termYears: 30, extraRepayment: 500 }).success).toBe(false)
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 0, extraRepayment: 500 }).success).toBe(false)
  })

  it('rejects negative extra repayment, invalid frequency, unknown keys', () => {
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: -1 }).success).toBe(false)
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: 500, repaymentFrequency: 'daily' }).success).toBe(false)
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: 500, extra: 1 }).success).toBe(false)
  })
})

describe('calculateExtraRepayment', () => {
  it('computes months saved, interest saved, and new term for monthly extra repayments', () => {
    const r = calculateExtraRepayment({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: 500 })
    expect(r.standardRepayment).toBe(1798.65)
    expect(r.extraRepaymentAmount).toBe(500)
    expect(r.newRepayment).toBe(2298.65)
    expect(r.monthsSaved).toBe(148)
    expect(r.yearsSaved).toBe(12)
    expect(r.interestSaved).toBe(160295.73)
    expect(r.newTermMonths).toBe(212)
    expect(r.newTotalCost).toBe(487219.85)
    expect(r.standardTotalInterest).toBe(347515.58)
    expect(r.standardTotalCost).toBe(647515.58)
    expect(r.standardRepaymentFormatted).toBe('$1798.65')
    expect(r.newRepaymentFormatted).toBe('$2298.65')
    expect(r.interestSavedFormatted).toBe('$160295.73')
    expect(r.monthsSavedFormatted).toBe('148 months (12 years)')
  })

  it('returns zero savings when extra repayment is zero', () => {
    const r = calculateExtraRepayment({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: 0 })
    expect(r.monthsSaved).toBe(0)
    expect(r.yearsSaved).toBe(0)
    expect(r.interestSaved).toBe(0)
    expect(r.newTermMonths).toBe(360)
    expect(r.newRepayment).toBe(1798.65)
  })

  it('handles zero interest rate with straight-line payments', () => {
    const r = calculateExtraRepayment({ principal: 300000, interestRate: 0, termYears: 30, extraRepayment: 500 })
    expect(r.standardRepayment).toBe(833.33)
    expect(r.newRepayment).toBe(1333.33)
    expect(r.standardTotalInterest).toBe(0)
    expect(r.interestSaved).toBe(0)
    expect(r.monthsSaved).toBe(134)
    expect(r.newTermMonths).toBe(226)
    expect(r.newTotalCost).toBe(300000)
  })

  it('supports fortnightly repayments', () => {
    const r = calculateExtraRepayment({ principal: 300000, interestRate: 6, termYears: 30, extraRepayment: 250, repaymentFrequency: 'fortnightly' })
    expect(r.standardRepayment).toBe(829.75)
    expect(r.newRepayment).toBe(1079.75)
    expect(r.monthsSaved).toBe(335)
    expect(r.yearsSaved).toBe(27)
    expect(r.interestSaved).toBe(167098.89)
    expect(r.newTermMonths).toBe(445)
  })
})

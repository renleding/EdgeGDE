import { describe, it, expect } from 'vitest'
import {
  LumpSumRepaymentInputSchema,
  calculateLumpSumRepayment,
} from '../../../../src/edr/domain/calculators/lump-sum-repayment'

describe('LumpSumRepaymentInputSchema', () => {
  it('accepts a valid input and applies the monthly frequency default', () => {
    const r = LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: 50000 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.repaymentFrequency).toBe('monthly')
  })

  it('rejects non-positive principal, rate, term, and lump sum', () => {
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 0, interestRate: 6, termYears: 30, lumpSum: 50000 }).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 25.01, termYears: 30, lumpSum: 50000 }).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 0, lumpSum: 50000 }).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: 0 }).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: -1 }).success).toBe(false)
  })

  it('rejects invalid frequency and unknown keys', () => {
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: 50000, repaymentFrequency: 'daily' }).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: 50000, extra: 1 }).success).toBe(false)
  })
})

describe('calculateLumpSumRepayment', () => {
  it('computes months and interest saved from a lump sum', () => {
    const r = calculateLumpSumRepayment({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: 50000 })
    expect(r.standardPayment).toBe(1798.65)
    expect(r.lumpSum).toBe(50000)
    expect(r.monthsSaved).toBe(121)
    expect(r.interestSaved).toBe(169329.86)
    expect(r.newTermMonths).toBe(239)
    expect(r.newTotalCost).toBe(479877.35)
    expect(r.interestSavedFormatted).toBe('$169329.86')
    expect(r.monthsSavedFormatted).toBe('121 months')
  })

  it('treats a lump sum >= principal as full payoff', () => {
    const r = calculateLumpSumRepayment({ principal: 300000, interestRate: 6, termYears: 30, lumpSum: 400000 })
    expect(r.newTermMonths).toBe(0)
    expect(r.newTotalCost).toBe(400000)
    expect(r.monthsSaved).toBe(360)
    expect(r.interestSaved).toBe(347515.58)
  })

  it('handles zero interest rate', () => {
    const r = calculateLumpSumRepayment({ principal: 12000, interestRate: 0, termYears: 1, lumpSum: 2000 })
    expect(r.standardPayment).toBe(1000)
    expect(r.newTermMonths).toBe(10)
    expect(r.monthsSaved).toBe(2)
    expect(r.interestSaved).toBe(0)
    expect(r.newTotalCost).toBe(12000)
  })
})

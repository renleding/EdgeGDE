import { describe, it, expect } from 'vitest'
import {
  HomeLoanOffsetInputSchema,
  calculateHomeLoanOffset,
} from '../../../../src/edr/domain/calculators/home-loan-offset'

describe('HomeLoanOffsetInputSchema', () => {
  it('accepts a valid input', () => {
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: 50000, interestRate: 6, termYears: 30 }).success).toBe(true)
  })

  it('rejects non-positive loan balance', () => {
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 0, offsetBalance: 0, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: -500, offsetBalance: 0, interestRate: 6, termYears: 30 }).success).toBe(false)
  })

  it('rejects negative offset balance and out-of-range rate', () => {
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: -1, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: 0, interestRate: 25.01, termYears: 30 }).success).toBe(false)
  })

  it('rejects invalid term and unknown keys', () => {
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: 0, interestRate: 6, termYears: 0 }).success).toBe(false)
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: 0, interestRate: 6, termYears: 10.5 }).success).toBe(false)
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: 0, interestRate: 6, termYears: 30, extra: 1 }).success).toBe(false)
  })
})

describe('calculateHomeLoanOffset', () => {
  it('computes interest and months saved with a partial offset', () => {
    const r = calculateHomeLoanOffset({ loanBalance: 500000, offsetBalance: 50000, interestRate: 6, termYears: 30 })
    expect(r.noOffsetMonthly).toBe(2997.75)
    expect(r.withOffsetMonthly).toBe(2997.75)
    expect(r.effectiveLoanBalance).toBe(450000)
    expect(r.noOffsetTotalInterest).toBe(579190)
    expect(r.withOffsetTotalInterest).toBe(384585.64)
    expect(r.interestSaved).toBe(194604.36)
    expect(r.monthsSaved).toBe(64)
    expect(r.monthlySaving).toBe(0)
    expect(r.interestSavedFormatted).toBe('$194604.36')
    expect(r.monthlySavingFormatted).toBe('See interest saved above')
  })

  it('returns ~zero interest saved when offset is zero (float artifact -2.64)', () => {
    const r = calculateHomeLoanOffset({ loanBalance: 500000, offsetBalance: 0, interestRate: 6, termYears: 30 })
    expect(r.interestSaved).toBe(-2.64)
    expect(r.monthsSaved).toBe(0)
    expect(r.effectiveLoanBalance).toBe(500000)
  })

  it('saves all interest when offset fully covers the loan', () => {
    const r = calculateHomeLoanOffset({ loanBalance: 500000, offsetBalance: 600000, interestRate: 6, termYears: 30 })
    expect(r.effectiveLoanBalance).toBe(0)
    expect(r.withOffsetTotalInterest).toBe(0)
    expect(r.interestSaved).toBe(579190)
    expect(r.monthsSaved).toBe(193)
  })

  it('handles zero interest rate', () => {
    const r = calculateHomeLoanOffset({ loanBalance: 500000, offsetBalance: 50000, interestRate: 0, termYears: 30 })
    expect(r.noOffsetMonthly).toBe(1388.89)
    expect(r.noOffsetTotalInterest).toBe(0.4)
    expect(r.withOffsetTotalInterest).toBe(0)
    expect(r.interestSaved).toBe(0.4)
    expect(r.monthsSaved).toBe(0)
  })
})

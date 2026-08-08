import { describe, it, expect } from 'vitest'
import {
  ReverseMortgageInputSchema,
  calculateReverseMortgage,
} from '../../../../src/edr/domain/calculators/reverse-mortgage'

describe('ReverseMortgageInputSchema', () => {
  it('accepts a valid input and applies drawdown defaults', () => {
    const r = ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70, interestRate: 6, termYears: 10 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.initialDrawdown).toBe(0)
      expect(r.data.regularDrawdown).toBe(0)
    }
  })

  it('rejects non-positive property value and out-of-range age', () => {
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 0, borrowerAge: 70, interestRate: 6, termYears: 10 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 17, interestRate: 6, termYears: 10 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 121, interestRate: 6, termYears: 10 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70.5, interestRate: 6, termYears: 10 }).success).toBe(false)
  })

  it('rejects out-of-range rate, negative drawdowns, invalid term, unknown keys', () => {
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70, interestRate: 25.01, termYears: 10 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70, interestRate: 6, termYears: 10, initialDrawdown: -1 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70, interestRate: 6, termYears: 10, regularDrawdown: -1 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70, interestRate: 6, termYears: 0 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 70, interestRate: 6, termYears: 10, extra: 1 }).success).toBe(false)
  })
})

describe('calculateReverseMortgage', () => {
  it('projects loan balance growth with interest and regular drawdowns', () => {
    const r = calculateReverseMortgage({ propertyValue: 800000, borrowerAge: 70, interestRate: 6, initialDrawdown: 100000, regularDrawdown: 2000, termYears: 10 })
    expect(r.projectedLoanBalance).toBe(509698.37)
    expect(r.remainingEquity).toBe(290301.63)
    expect(r.drawdownTotal).toBe(340000) // 100000 + 2000*120
    expect(r.equityRemainingPercent).toBe(36.29)
    expect(r.ltvPercent).toBe(63.71)
    expect(r.loanBalanceFormatted).toBe('$509698.37')
    expect(r.remainingEquityFormatted).toBe('$290301.63')
    expect(r.drawdownTotalFormatted).toBe('$340000.00')
    expect(r.equityPercentFormatted).toBe('36.3%')
  })

  it('grows the balance linearly with zero interest', () => {
    const r = calculateReverseMortgage({ propertyValue: 800000, borrowerAge: 70, interestRate: 0, initialDrawdown: 100000, regularDrawdown: 2000, termYears: 10 })
    expect(r.projectedLoanBalance).toBe(340000)
    expect(r.remainingEquity).toBe(460000)
    expect(r.equityRemainingPercent).toBe(57.5)
    expect(r.ltvPercent).toBe(42.5)
  })
})

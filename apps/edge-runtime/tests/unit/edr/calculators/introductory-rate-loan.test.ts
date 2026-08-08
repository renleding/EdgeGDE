import { describe, it, expect } from 'vitest'
import {
  IntroductoryRateLoanInputSchema,
  calculateIntroductoryRateLoan,
} from '../../../../src/edr/domain/calculators/introductory-rate-loan'

describe('IntroductoryRateLoanInputSchema', () => {
  it('accepts a valid input', () => {
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 3, introductoryMonths: 12, revertRate: 6, termYears: 30 }).success).toBe(true)
  })

  it('rejects non-positive principal, out-of-range rates, and invalid months/term', () => {
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 0, introductoryRate: 3, introductoryMonths: 12, revertRate: 6, termYears: 30 }).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 25.01, introductoryMonths: 12, revertRate: 6, termYears: 30 }).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 3, introductoryMonths: 0, revertRate: 6, termYears: 30 }).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 3, introductoryMonths: 12, revertRate: -1, termYears: 30 }).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 3, introductoryMonths: 12, revertRate: 6, termYears: 0 }).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 3, introductoryMonths: 6.5, revertRate: 6, termYears: 30 }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(IntroductoryRateLoanInputSchema.safeParse({ principal: 400000, introductoryRate: 3, introductoryMonths: 12, revertRate: 6, termYears: 30, extra: 1 }).success).toBe(false)
  })
})

describe('calculateIntroductoryRateLoan', () => {
  it('computes intro and revert repayments plus weighted average rate', () => {
    const r = calculateIntroductoryRateLoan({ principal: 400000, introductoryRate: 3, introductoryMonths: 12, revertRate: 6, termYears: 30 })
    expect(r.introductoryRepayment).toBe(1000) // 400000 * 0.03/12
    expect(r.revertRepayment).toBe(2428.02)
    expect(r.totalInterest).toBe(456950.96)
    expect(r.averageRate).toBe(5.9) // (3*12 + 6*348) / 360
    expect(r.introRepaymentFormatted).toBe('$1000.00')
    expect(r.revertRepaymentFormatted).toBe('$2428.02')
    expect(r.totalInterestFormatted).toBe('$456950.96')
    expect(r.averageRateFormatted).toBe('5.90%')
  })

  it('returns zero revert repayment when the intro period covers the whole term', () => {
    const r = calculateIntroductoryRateLoan({ principal: 400000, introductoryRate: 3, introductoryMonths: 360, revertRate: 6, termYears: 30 })
    expect(r.introductoryRepayment).toBe(1000)
    expect(r.revertRepayment).toBe(0)
    expect(r.averageRate).toBe(3)
    expect(r.totalInterest).toBe(-40000) // interest-only payments total less than principal
  })

  it('uses straight-line principal repayment when revert rate is zero', () => {
    const r = calculateIntroductoryRateLoan({ principal: 400000, introductoryRate: 3, introductoryMonths: 12, revertRate: 0, termYears: 30 })
    expect(r.revertRepayment).toBe(1149.43) // 400000 / 348
    expect(r.averageRate).toBe(0.1) // (3*12 + 0*348) / 360
  })
})

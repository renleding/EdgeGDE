import { describe, it, expect } from 'vitest'
import {
  SplitLoanInputSchema,
  calculateSplitLoan,
} from '../../../../src/edr/domain/calculators/split-loan'

describe('SplitLoanInputSchema', () => {
  it('accepts a valid input', () => {
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 5, variableRate: 7, variableTermYears: 30 }).success).toBe(true)
  })

  it('rejects non-positive principals and out-of-range rates', () => {
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 0, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 5, variableRate: 7, variableTermYears: 30 }).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 0, fixedRate: 6, fixedTermYears: 5, variableRate: 7, variableTermYears: 30 }).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 25.01, fixedTermYears: 5, variableRate: 7, variableTermYears: 30 }).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 5, variableRate: -1, variableTermYears: 30 }).success).toBe(false)
  })

  it('rejects invalid terms and unknown keys', () => {
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 0, variableRate: 7, variableTermYears: 30 }).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 5, variableRate: 7, variableTermYears: 0 }).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 5, variableRate: 7, variableTermYears: 30, extra: 1 }).success).toBe(false)
  })
})

describe('calculateSplitLoan', () => {
  it('computes individual repayments, combined total, and weighted average rate', () => {
    const r = calculateSplitLoan({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 6, fixedTermYears: 5, variableRate: 7, variableTermYears: 30 })
    expect(r.fixedRepayment).toBe(3866.56)
    expect(r.variableRepayment).toBe(1995.91)
    expect(r.totalRepayment).toBe(5862.47)
    expect(r.totalInterest).toBe(450521.2)
    expect(r.weightedAverageRate).toBe(6.6) // (200000*6 + 300000*7) / 500000
    expect(r.fixedRepaymentFormatted).toBe('$3866.56')
    expect(r.variableRepaymentFormatted).toBe('$1995.91')
    expect(r.totalRepaymentFormatted).toBe('$5862.47')
    expect(r.weightedRateFormatted).toBe('6.60%')
  })

  it('uses straight-line repayment when the fixed rate is zero', () => {
    const r = calculateSplitLoan({ totalPrincipal: 500000, fixedPortion: 200000, fixedRate: 0, fixedTermYears: 5, variableRate: 7, variableTermYears: 30 })
    expect(r.fixedRepayment).toBe(3333.33) // 200000 / 60
    expect(r.variableRepayment).toBe(1995.91)
    expect(r.weightedAverageRate).toBe(4.2) // (200000*0 + 300000*7) / 500000
  })
})

import { describe, it, expect } from 'vitest'
import {
  HowLongToRepayInputSchema,
  calculateHowLongToRepay,
} from '../../../../src/edr/domain/calculators/how-long-to-repay'

describe('HowLongToRepayInputSchema', () => {
  it('accepts a valid input and applies the monthly frequency default', () => {
    const r = HowLongToRepayInputSchema.safeParse({ principal: 10000, interestRate: 6, repaymentAmount: 500 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.repaymentFrequency).toBe('monthly')
  })

  it('rejects non-positive principal, rate out of range, non-positive repayment', () => {
    expect(HowLongToRepayInputSchema.safeParse({ principal: 0, interestRate: 6, repaymentAmount: 500 }).success).toBe(false)
    expect(HowLongToRepayInputSchema.safeParse({ principal: 10000, interestRate: 25.01, repaymentAmount: 500 }).success).toBe(false)
    expect(HowLongToRepayInputSchema.safeParse({ principal: 10000, interestRate: 6, repaymentAmount: 0 }).success).toBe(false)
    expect(HowLongToRepayInputSchema.safeParse({ principal: 10000, interestRate: 6, repaymentAmount: -1 }).success).toBe(false)
  })

  it('rejects invalid frequency and unknown keys', () => {
    expect(HowLongToRepayInputSchema.safeParse({ principal: 10000, interestRate: 6, repaymentAmount: 500, repaymentFrequency: 'daily' }).success).toBe(false)
    expect(HowLongToRepayInputSchema.safeParse({ principal: 10000, interestRate: 6, repaymentAmount: 500, extra: 1 }).success).toBe(false)
  })
})

describe('calculateHowLongToRepay', () => {
  it('repays exactly with zero interest and exact divisor', () => {
    const r = calculateHowLongToRepay({ principal: 10000, interestRate: 0, repaymentAmount: 1000 })
    expect(r.monthsToPayoff).toBe(10)
    expect(r.yearsToPayoff).toBe(0.8)
    expect(r.totalRepaid).toBe(10000)
    expect(r.totalInterest).toBe(0)
    expect(r.monthsFormatted).toBe('0y 10m')
    expect(r.totalInterestFormatted).toBe('$0.00')
    expect(r.totalRepaidFormatted).toBe('$10000.00')
  })

  it('overpays on the final month, producing a small interest figure', () => {
    const r = calculateHowLongToRepay({ principal: 10000, interestRate: 0, repaymentAmount: 300 })
    expect(r.monthsToPayoff).toBe(34)
    expect(r.yearsToPayoff).toBe(2.8)
    expect(r.totalRepaid).toBe(10200) // 34 * 300
    expect(r.totalInterest).toBe(200)
    expect(r.monthsFormatted).toBe('2y 10m')
  })

  it('simulates interest accrual on a standard loan', () => {
    const r = calculateHowLongToRepay({ principal: 300000, interestRate: 6, repaymentAmount: 3000 })
    expect(r.monthsToPayoff).toBe(139)
    expect(r.yearsToPayoff).toBe(11.6)
    expect(r.totalRepaid).toBe(417000)
    expect(r.totalInterest).toBe(117000)
    expect(r.monthsFormatted).toBe('11y 7m')
  })

  it('caps at 600 months when repayment is below monthly interest', () => {
    const r = calculateHowLongToRepay({ principal: 100000, interestRate: 25, repaymentAmount: 100 })
    expect(r.monthsToPayoff).toBe(600)
    expect(r.yearsToPayoff).toBe(50)
    expect(r.monthsFormatted).toBe('50y 0m')
  })

  it('supports fortnightly frequency', () => {
    const r = calculateHowLongToRepay({ principal: 10000, interestRate: 0, repaymentAmount: 500, repaymentFrequency: 'fortnightly' })
    expect(r.monthsToPayoff).toBe(20)
    expect(r.yearsToPayoff).toBe(1.7)
    expect(r.totalRepaid).toBe(10000)
    expect(r.totalInterest).toBe(0)
    expect(r.monthsFormatted).toBe('1y 8m')
  })
})

import { describe, it, expect } from 'vitest'
import {
  BorrowingPowerInputSchema,
  calculateBorrowingPower,
} from '../../../../src/edr/domain/calculators/borrowing-power'

describe('BorrowingPowerInputSchema', () => {
  it('accepts a full valid input', () => {
    const r = BorrowingPowerInputSchema.safeParse({
      annualIncome: 120000,
      monthlyExpenses: 3000,
      existingDebtPayments: 500,
      deposit: 100000,
      interestRate: 6,
      termYears: 30,
      interestRateBuffer: 3,
      employmentType: 'full-time',
      dependents: 1,
      creditCommitments: 200,
    })
    expect(r.success).toBe(true)
  })

  it('applies defaults for optional fields', () => {
    const r = BorrowingPowerInputSchema.safeParse({
      annualIncome: 100000,
      monthlyExpenses: 2000,
      interestRate: 5,
      termYears: 25,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.existingDebtPayments).toBe(0)
      expect(r.data.deposit).toBe(0)
      expect(r.data.interestRateBuffer).toBe(3)
      expect(r.data.employmentType).toBe('full-time')
      expect(r.data.dependents).toBe(0)
      expect(r.data.creditCommitments).toBe(0)
    }
  })

  it('rejects missing required fields', () => {
    expect(BorrowingPowerInputSchema.safeParse({ monthlyExpenses: 3000, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6 }).success).toBe(false)
  })

  it('rejects negative incomes, expenses, and commitments', () => {
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: -1, monthlyExpenses: 3000, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: -1, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, existingDebtPayments: -1 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, deposit: -1 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, creditCommitments: -1 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, dependents: -1 }).success).toBe(false)
  })

  it('rejects out-of-range interest rate and buffer', () => {
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 25.01, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: -0.1, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, interestRateBuffer: 10.01 }).success).toBe(false)
  })

  it('rejects invalid term (zero, negative, non-integer)', () => {
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 0 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: -5 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 5.5 }).success).toBe(false)
  })

  it('rejects invalid employment type, non-integer dependents, and unknown keys', () => {
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, employmentType: 'unicorn' }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, dependents: 1.5 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, bonus: 100 }).success).toBe(false)
  })
})

describe('calculateBorrowingPower', () => {
  it('computes borrowing power, LVR limits, and formatting for a standard case', () => {
    const r = calculateBorrowingPower({
      annualIncome: 120000,
      monthlyExpenses: 3000,
      existingDebtPayments: 500,
      deposit: 100000,
      interestRate: 6,
      termYears: 30,
      dependents: 1,
      creditCommitments: 200,
    })
    expect(r.estimatedBorrowingPower).toBe(664907.98)
    expect(r.serviceabilitySurplus).toBe(5350)
    expect(r.assessedInterestRate).toBe(9)
    expect(r.maxLvrAmount).toBe(500000)
    expect(r.depositRequiredForLvr).toBe(400000)
    expect(r.estimatedBorrowingPowerFormatted).toBe('$664907.98')
    expect(r.serviceabilitySurplusFormatted).toBe('$5350.00')
    expect(r.assessedInterestRateFormatted).toBe('9.00%')
  })

  it('scales income by employment type multiplier', () => {
    // part-time 0.8 → surplus 4550
    const pt = calculateBorrowingPower({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, employmentType: 'part-time' })
    expect(pt.serviceabilitySurplus).toBe(4550)
    expect(pt.estimatedBorrowingPower).toBe(565482.49)
    // self-employed 0.7 → surplus 3550
    const se = calculateBorrowingPower({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, employmentType: 'self-employed' })
    expect(se.serviceabilitySurplus).toBe(3550)
    expect(se.estimatedBorrowingPower).toBe(441200.62)
    // contract 0.75 → surplus 4050
    const ct = calculateBorrowingPower({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, employmentType: 'contract' })
    expect(ct.serviceabilitySurplus).toBe(4050)
    expect(ct.estimatedBorrowingPower).toBe(503341.56)
    // casual 0.6 → surplus 2550
    const cs = calculateBorrowingPower({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30, employmentType: 'casual' })
    expect(cs.serviceabilitySurplus).toBe(2550)
    expect(cs.estimatedBorrowingPower).toBe(316918.76)
  })

  it('uses simple multiplication when assessed rate is 0', () => {
    const r = calculateBorrowingPower({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 0, termYears: 30, interestRateBuffer: 0 })
    expect(r.assessedInterestRate).toBe(0)
    expect(r.serviceabilitySurplus).toBe(6550)
    expect(r.estimatedBorrowingPower).toBe(2358000) // 6550 * 360
  })

  it('returns zero borrowing power when there is no serviceable surplus', () => {
    const r = calculateBorrowingPower({ annualIncome: 30000, monthlyExpenses: 4000, interestRate: 6, termYears: 30 })
    expect(r.serviceabilitySurplus).toBe(0)
    expect(r.estimatedBorrowingPower).toBe(0)
    expect(r.maxLvrAmount).toBe(0)
    expect(r.depositRequiredForLvr).toBe(0)
  })

  it('falls back to borrowing power for LVR limits when deposit is 0', () => {
    const r = calculateBorrowingPower({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30 })
    expect(r.estimatedBorrowingPower).toBe(814046.22)
    expect(r.maxLvrAmount).toBe(814046.22)
    expect(r.depositRequiredForLvr).toBe(814046.22)
  })
})

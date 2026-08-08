import { describe, it, expect } from 'vitest'
import {
  MortgageSwitchingInputSchema,
  calculateMortgageSwitching,
} from '../../../../src/edr/domain/calculators/mortgage-switching'

describe('MortgageSwitchingInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.newFeesUpfront).toBe(0)
      expect(r.data.breakCosts).toBe(0)
      expect(r.data.newTermYears).toBeUndefined()
    }
  })

  it('accepts an explicit new term', () => {
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, newTermYears: 20 }).success).toBe(true)
  })

  it('rejects non-positive balance, out-of-range rates, invalid remaining years', () => {
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 0, currentRate: 6, currentRemainingYears: 25, newRate: 5 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 25.01, currentRemainingYears: 25, newRate: 5 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 0, newRate: 5 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: -1 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, newTermYears: 0 }).success).toBe(false)
  })

  it('rejects negative fees/costs and unknown keys', () => {
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, newFeesUpfront: -1 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, breakCosts: -1 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, extra: 1 }).success).toBe(false)
  })
})

describe('calculateMortgageSwitching', () => {
  it('computes savings, break-even months, and formatted output for a beneficial switch', () => {
    const r = calculateMortgageSwitching({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, newFeesUpfront: 3000, breakCosts: 2000, newTermYears: 25 })
    expect(r.stayMonthlyRepayment).toBe(2577.21)
    expect(r.switchMonthlyRepayment).toBe(2338.36)
    expect(r.stayTotalCost).toBe(773163)
    expect(r.switchTotalCost).toBe(706508)
    expect(r.netSavingOrCost).toBe(66655)
    expect(r.breakEvenMonths).toBe(21) // ceil(5000 / (2577.21 - 2338.36))
    expect(r.stayMonthlyFormatted).toBe('$2577.21')
    expect(r.switchMonthlyFormatted).toBe('$2338.36')
    expect(r.netSavingFormatted).toBe('$66655.00 saved')
    expect(r.breakEvenFormatted).toBe('21 months')
  })

  it('reports never breaking even when the switch rate is higher', () => {
    const r = calculateMortgageSwitching({ currentBalance: 400000, currentRate: 5, currentRemainingYears: 25, newRate: 6 })
    expect(r.netSavingOrCost).toBe(-71655)
    expect(r.breakEvenMonths).toBe(999)
    expect(r.netSavingFormatted).toBe('$71655.00 extra')
    expect(r.breakEvenFormatted).toBe('Never breaks even')
  })

  it('defaults the new term to the current remaining years', () => {
    const r = calculateMortgageSwitching({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, newFeesUpfront: 3000, breakCosts: 2000 })
    expect(r.stayMonthlyRepayment).toBe(2577.21)
    expect(r.switchMonthlyRepayment).toBe(2338.36)
    expect(r.netSavingOrCost).toBe(66655)
    expect(r.breakEvenMonths).toBe(21)
  })

  it('handles zero rates with straight-line payments', () => {
    const r = calculateMortgageSwitching({ currentBalance: 12000, currentRate: 0, currentRemainingYears: 1, newRate: 0, newFeesUpfront: 100, breakCosts: 50 })
    expect(r.stayMonthlyRepayment).toBe(1000)
    expect(r.switchMonthlyRepayment).toBe(1000)
    expect(r.stayTotalCost).toBe(12000)
    expect(r.switchTotalCost).toBe(12150)
    expect(r.netSavingOrCost).toBe(-150)
    expect(r.breakEvenMonths).toBe(999)
  })
})

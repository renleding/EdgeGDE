import { describe, it, expect } from 'vitest'
import {
  LvrCalculatorInputSchema,
  calculateLvr,
} from '../../../../src/edr/domain/calculators/lvr-calculator'

describe('LvrCalculatorInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: 640000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.state).toBe('nsw')
      expect(r.data.isFirstHomeBuyer).toBe(false)
    }
  })

  it('rejects non-positive property value and loan amount', () => {
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: 0, loanAmount: 640000 }).success).toBe(false)
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: 0 }).success).toBe(false)
  })

  it('rejects invalid state, non-boolean FHB, and unknown keys', () => {
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: 640000, state: 'uk' }).success).toBe(false)
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: 640000, isFirstHomeBuyer: 'yes' }).success).toBe(false)
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: 640000, extra: 1 }).success).toBe(false)
  })
})

describe('calculateLvr', () => {
  it('computes LVR, stamp duty, and no-LMI warning at exactly 80%', () => {
    const r = calculateLvr({ propertyValue: 800000, loanAmount: 640000, state: 'nsw', isFirstHomeBuyer: false })
    expect(r.lvrPercentage).toBe(80)
    expect(r.lvrFormatted).toBe('80.00%')
    expect(r.stampDutyEstimate).toBe(18610)
    expect(r.stampDutyFormatted).toBe('$18610.00')
    expect(r.lmiRequired).toBe(false)
    expect(r.lmiWarning).toBe('No LMI required — LVR is 80% or less.')
  })

  it('flags LMI when LVR exceeds 80%', () => {
    const r = calculateLvr({ propertyValue: 800000, loanAmount: 700000, state: 'vic', isFirstHomeBuyer: false })
    expect(r.lvrPercentage).toBe(87.5)
    expect(r.lmiRequired).toBe(true)
    expect(r.lmiWarning).toContain('Lenders Mortgage Insurance (LMI) may be required')
    expect(r.stampDutyEstimate).toBe(36370)
  })

  it('applies first home buyer stamp duty exemption via the stamp duty calculator', () => {
    const r = calculateLvr({ propertyValue: 600000, loanAmount: 540000, state: 'nsw', isFirstHomeBuyer: true })
    expect(r.lvrPercentage).toBe(90)
    expect(r.lmiRequired).toBe(true)
    expect(r.stampDutyEstimate).toBe(0)
  })

  it('throws when the loan amount exceeds the property value', () => {
    expect(() => calculateLvr({ propertyValue: 800000, loanAmount: 900000, state: 'nsw', isFirstHomeBuyer: false })).toThrow('Loan amount cannot exceed property value')
  })
})

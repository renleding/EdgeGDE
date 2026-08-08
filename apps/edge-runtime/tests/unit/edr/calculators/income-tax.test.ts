import { describe, it, expect } from 'vitest'
import {
  IncomeTaxInputSchema,
  calculateIncomeTax,
} from '../../../../src/edr/domain/calculators/income-tax'

describe('IncomeTaxInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = IncomeTaxInputSchema.safeParse({ taxableIncome: 100000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.residentStatus).toBe('resident')
      expect(r.data.medicareLevyApplicable).toBe(true)
      expect(r.data.offsets).toBe(0)
      expect(r.data.deductions).toBe(0)
    }
  })

  it('rejects negative taxable income, offsets, and deductions', () => {
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: -1 }).success).toBe(false)
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: 100000, offsets: -1 }).success).toBe(false)
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: 100000, deductions: -1 }).success).toBe(false)
  })

  it('rejects invalid resident status, non-boolean medicare flag, and unknown keys', () => {
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: 100000, residentStatus: 'alien' }).success).toBe(false)
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: 100000, medicareLevyApplicable: 'yes' }).success).toBe(false)
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: 100000, extra: 1 }).success).toBe(false)
  })
})

describe('calculateIncomeTax', () => {
  it('computes gross tax, medicare levy, and net tax for a mid-bracket income', () => {
    const r = calculateIncomeTax({ taxableIncome: 100000 })
    expect(r.grossTax).toBe(20788) // 4288 + (100000-45000)*0.30
    expect(r.medicareLevy).toBe(2000)
    expect(r.netTaxPayable).toBe(22788)
    expect(r.effectiveTaxRate).toBe(22.79)
    expect(r.offsetsApplied).toBe(0)
    expect(r.grossTaxFormatted).toBe('$20788.00')
    expect(r.medicareLevyFormatted).toBe('$2000.00')
    expect(r.netTaxFormatted).toBe('$22788.00')
    expect(r.effectiveRateFormatted).toBe('22.79%')
  })

  it('returns zero for zero income', () => {
    const r = calculateIncomeTax({ taxableIncome: 0 })
    expect(r.grossTax).toBe(0)
    expect(r.medicareLevy).toBe(0)
    expect(r.netTaxPayable).toBe(0)
    expect(r.effectiveTaxRate).toBe(0)
  })

  it('skips the medicare levy when not applicable', () => {
    const r = calculateIncomeTax({ taxableIncome: 100000, medicareLevyApplicable: false })
    expect(r.grossTax).toBe(20788)
    expect(r.medicareLevy).toBe(0)
    expect(r.netTaxPayable).toBe(20788)
    expect(r.effectiveTaxRate).toBe(20.79)
  })

  it('clamps offsets to the tax payable', () => {
    const r = calculateIncomeTax({ taxableIncome: 100000, offsets: 50000 })
    expect(r.offsetsApplied).toBe(22788)
    expect(r.netTaxPayable).toBe(0)
    expect(r.effectiveTaxRate).toBe(0)
  })

  it('reduces assessable income by deductions', () => {
    const r = calculateIncomeTax({ taxableIncome: 100000, deductions: 10000 })
    expect(r.grossTax).toBe(17788) // 4288 + (90000-45000)*0.30
    expect(r.medicareLevy).toBe(1800)
    expect(r.netTaxPayable).toBe(19588)
    expect(r.effectiveTaxRate).toBe(19.59)
  })

  it('floors assessable income at zero when deductions exceed income', () => {
    const r = calculateIncomeTax({ taxableIncome: 5000, deductions: 10000 })
    expect(r.grossTax).toBe(0)
    expect(r.medicareLevy).toBe(0)
    expect(r.netTaxPayable).toBe(0)
  })

  it('applies every progressive bracket boundary', () => {
    const cases: Array<[number, number, number, number]> = [
      // income, grossTax, medicare, netTax
      [18200, 0, 364, 364],
      [20000, 288, 400, 688],
      [45000, 4288, 900, 5188],
      [45001, 4288.3, 900.02, 5188.32],
      [135000, 31288, 2700, 33988],
      [135001, 31288.37, 2700.02, 33988.39],
      [190000, 51638, 3800, 55438],
      [190001, 51638.45, 3800.02, 55438.47],
      [200000, 56138, 4000, 60138],
    ]
    for (const [income, gross, medicare, net] of cases) {
      const r = calculateIncomeTax({ taxableIncome: income })
      expect(r.grossTax).toBe(gross)
      expect(r.medicareLevy).toBe(medicare)
      expect(r.netTaxPayable).toBe(net)
    }
  })
})

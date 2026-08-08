import { describe, it, expect } from 'vitest'
import {
  IncomeGrossUpInputSchema,
  calculateIncomeGrossUp,
} from '../../../../src/edr/domain/calculators/income-gross-up'

describe('IncomeGrossUpInputSchema', () => {
  it('accepts a valid input with defaults', () => {
    const r = IncomeGrossUpInputSchema.safeParse({ netIncome: 70000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.grossUpRate).toBeUndefined()
      expect(r.data.taxRate).toBeUndefined()
      expect(r.data.incomePeriod).toBe('yearly')
    }
  })

  it('accepts either rate', () => {
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, grossUpRate: 30 }).success).toBe(true)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, taxRate: 30 }).success).toBe(true)
  })

  it('rejects negative net income and out-of-range rates', () => {
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: -1 }).success).toBe(false)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, grossUpRate: 100.01 }).success).toBe(false)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, grossUpRate: -1 }).success).toBe(false)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, taxRate: 100.01 }).success).toBe(false)
  })

  it('rejects invalid period and unknown keys', () => {
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, incomePeriod: 'daily' }).success).toBe(false)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, extra: 1 }).success).toBe(false)
  })
})

describe('calculateIncomeGrossUp', () => {
  it('grosses up using an explicit gross-up rate', () => {
    const r = calculateIncomeGrossUp({ netIncome: 70000, grossUpRate: 30 })
    expect(r.grossIncome).toBe(100000)
    expect(r.totalTax).toBe(30000)
    expect(r.netIncome).toBe(70000)
    expect(r.effectiveRate).toBe(30)
    expect(r.grossFormatted).toBe('$100000.00/yr')
    expect(r.netFormatted).toBe('$70000.00/yr')
  })

  it('derives the rate from taxRate when grossUpRate is absent', () => {
    const r = calculateIncomeGrossUp({ netIncome: 70000, taxRate: 30 })
    expect(r.grossIncome).toBe(100000)
    expect(r.effectiveRate).toBe(30)
  })

  it('defaults to a 30% rate when neither rate is provided', () => {
    const r = calculateIncomeGrossUp({ netIncome: 70000 })
    expect(r.grossIncome).toBe(100000)
    expect(r.effectiveRate).toBe(30)
  })

  it('prefers grossUpRate over taxRate', () => {
    const r = calculateIncomeGrossUp({ netIncome: 70000, grossUpRate: 20, taxRate: 30 })
    expect(r.grossIncome).toBe(87500)
    expect(r.totalTax).toBe(17500)
    expect(r.effectiveRate).toBe(20)
  })

  it('handles a zero rate (gross equals net)', () => {
    const r = calculateIncomeGrossUp({ netIncome: 1000, grossUpRate: 0 })
    expect(r.grossIncome).toBe(1000)
    expect(r.totalTax).toBe(0)
  })

  it('formats periods as wk, fn, mo, yr', () => {
    const w = calculateIncomeGrossUp({ netIncome: 1000, grossUpRate: 20, incomePeriod: 'weekly' })
    expect(w.grossFormatted).toBe('$1250.00/wk')
    expect(w.netFormatted).toBe('$1000.00/wk')

    const m = calculateIncomeGrossUp({ netIncome: 1000, grossUpRate: 20, incomePeriod: 'monthly' })
    expect(m.grossFormatted).toBe('$1250.00/mo')

    const f = calculateIncomeGrossUp({ netIncome: 1000, grossUpRate: 20, incomePeriod: 'fortnightly' })
    expect(f.grossFormatted).toBe('$1250.00/fn')
  })
})

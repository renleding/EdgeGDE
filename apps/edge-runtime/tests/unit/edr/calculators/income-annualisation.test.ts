import { describe, it, expect } from 'vitest'
import {
  IncomeAnnualisationInputSchema,
  calculateIncomeAnnualisation,
} from '../../../../src/edr/domain/calculators/income-annualisation'

describe('IncomeAnnualisationInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.incomePeriod).toBe('monthly')
      expect(r.data.weeksWorkedPerYear).toBe(52)
      expect(r.data.employmentType).toBe('full-time')
    }
  })

  it('rejects negative income and non-integer/out-of-range weeks', () => {
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: -1 }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000, weeksWorkedPerYear: 0 }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000, weeksWorkedPerYear: 53 }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000, weeksWorkedPerYear: 40.5 }).success).toBe(false)
  })

  it('rejects invalid period, employment type, and unknown keys', () => {
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000, incomePeriod: 'daily' }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000, employmentType: 'unicorn' }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 1000, extra: 1 }).success).toBe(false)
  })
})

describe('calculateIncomeAnnualisation', () => {
  it('annualises a yearly income', () => {
    const r = calculateIncomeAnnualisation({ incomeAmount: 52000, incomePeriod: 'yearly' })
    expect(r.weeklyEquivalent).toBe(1000)
    expect(r.annualisedIncome).toBe(52000)
    expect(r.monthlyEquivalent).toBe(4333.33)
    expect(r.annualisedFormatted).toBe('$52000.00')
    expect(r.weeklyFormatted).toBe('$1000.00')
    expect(r.monthlyFormatted).toBe('$4333.33')
  })

  it('annualises a monthly income', () => {
    const r = calculateIncomeAnnualisation({ incomeAmount: 4333.33, incomePeriod: 'monthly' })
    expect(r.weeklyEquivalent).toBe(1000)
    expect(r.annualisedIncome).toBe(51999.96)
    expect(r.monthlyEquivalent).toBe(4333.33)
  })

  it('annualises fortnightly and weekly incomes', () => {
    const f = calculateIncomeAnnualisation({ incomeAmount: 2000, incomePeriod: 'fortnightly' })
    expect(f.weeklyEquivalent).toBe(1000)
    expect(f.annualisedIncome).toBe(52000)

    const w = calculateIncomeAnnualisation({ incomeAmount: 1000, incomePeriod: 'weekly' })
    expect(w.weeklyEquivalent).toBe(1000)
    expect(w.annualisedIncome).toBe(52000)
  })

  it('scales annualised income by weeks worked per year', () => {
    const r = calculateIncomeAnnualisation({ incomeAmount: 1000, incomePeriod: 'weekly', weeksWorkedPerYear: 40 })
    expect(r.weeklyEquivalent).toBe(1000)
    expect(r.annualisedIncome).toBe(40000)
    expect(r.monthlyEquivalent).toBe(4333.33)
  })
})

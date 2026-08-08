import { describe, it, expect } from 'vitest'
import {
  RentVsBuyInputSchema,
  calculateRentVsBuy,
} from '../../../../src/edr/domain/calculators/rent-vs-buy'

describe('RentVsBuyInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.mortgageRate).toBe(6)
      expect(r.data.propertyAppreciation).toBe(3)
      expect(r.data.rentIncrease).toBe(3)
    }
  })

  it('rejects non-positive property price/rent/horizon and negative savings', () => {
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 0, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 0, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: -1, investmentReturnRate: 7, timeHorizonYears: 10 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 0 }).success).toBe(false)
  })

  it('rejects out-of-range rates, non-integer horizon, and unknown keys', () => {
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 100.01, timeHorizonYears: 10 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 5.5 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10, mortgageRate: -1 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10, extra: 1 }).success).toBe(false)
  })
})

describe('calculateRentVsBuy', () => {
  it('computes net worths, snapshots, and break-even year for a 10-year horizon', () => {
    const r = calculateRentVsBuy({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10, mortgageRate: 6, propertyAppreciation: 3, rentIncrease: 3 })
    expect(r.buyNetWorth).toBe(404658.35)
    expect(r.rentNetWorth).toBe(236058.16)
    expect(r.netAdvantage).toBe(168600.19)
    expect(r.buyAdvantage).toBe(true)
    expect(r.breakEvenYear).toBe(1)

    expect(r.yearSnapshots).toHaveLength(10)
    expect(r.yearSnapshots[0]).toEqual({ year: 1, buyNetWorth: 143894.46, rentNetWorth: 128400, buyAdvantage: 15494.46 })
    expect(r.yearSnapshots[9]).toEqual({ year: 10, buyNetWorth: 404658.35, rentNetWorth: 236058.16, buyAdvantage: 168600.19 })
  })

  it('skips the mortgage simulation when savings cover the full purchase price', () => {
    const r = calculateRentVsBuy({ propertyPrice: 200000, weeklyRent: 500, savings: 300000, investmentReturnRate: 5, timeHorizonYears: 5, mortgageRate: 6, propertyAppreciation: 3, rentIncrease: 3 })
    expect(r.buyNetWorth).toBe(231854.81)
    expect(r.rentNetWorth).toBe(382884.47)
    expect(r.buyAdvantage).toBe(false)
    expect(r.breakEvenYear).toBeNull()
    expect(r.yearSnapshots[4]).toEqual({ year: 5, buyNetWorth: 231854.81, rentNetWorth: 382884.47, buyAdvantage: -151029.66 })
  })

  it('handles a zero mortgage rate', () => {
    const r = calculateRentVsBuy({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 10, mortgageRate: 0, propertyAppreciation: 3, rentIncrease: 3 })
    expect(r.buyNetWorth).toBe(486349.83)
    expect(r.rentNetWorth).toBe(236058.16)
    expect(r.netAdvantage).toBe(250291.67)
  })

  it('returns a fully-paid loan balance for horizons beyond the mortgage term', () => {
    const r = calculateRentVsBuy({ propertyPrice: 600000, weeklyRent: 600, savings: 120000, investmentReturnRate: 7, timeHorizonYears: 35, mortgageRate: 6, propertyAppreciation: 3, rentIncrease: 3 })
    expect(r.buyNetWorth).toBe(1688317.47)
    expect(r.yearSnapshots).toHaveLength(35)
    // after year 30 the loan is gone; net worth is property value only
    expect(r.yearSnapshots[29]).toEqual({ year: 30, buyNetWorth: 1456357.48, rentNetWorth: 913470.61, buyAdvantage: 542886.87 })
  })
})

import { describe, it, expect } from 'vitest'
import {
  LeasingInputSchema,
  calculateLeasing,
} from '../../../../src/edr/domain/calculators/leasing'

describe('LeasingInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.fees).toBe(0)
      expect(r.data.paymentFrequency).toBe('monthly')
    }
  })

  it('rejects non-positive asset price, negative residual, out-of-range rate', () => {
    expect(LeasingInputSchema.safeParse({ assetPrice: 0, residualValue: 15000, interestRate: 6, termYears: 5 }).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: -1, interestRate: 6, termYears: 5 }).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: 15000, interestRate: 25.01, termYears: 5 }).success).toBe(false)
  })

  it('rejects invalid term, frequency, negative fees, and unknown keys', () => {
    expect(LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 0 }).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5, paymentFrequency: 'daily' }).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5, fees: -1 }).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5, extra: 1 }).success).toBe(false)
  })
})

describe('calculateLeasing', () => {
  it('computes lease payment from depreciation plus interest components', () => {
    const r = calculateLeasing({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5, fees: 1000 })
    expect(r.capitalizedCost).toBe(41000)
    expect(r.leasePayment).toBe(713.33) // (41000-15000)/60 + (41000+15000)*0.005
    expect(r.totalLeaseCost).toBe(42799.8)
    expect(r.totalInterest).toBe(16799.8)
    expect(r.leasePaymentFormatted).toBe('$713.33/mo')
    expect(r.totalLeaseCostFormatted).toBe('$42799.80')
    expect(r.totalInterestFormatted).toBe('$16799.80')
  })

  it('handles zero interest rate', () => {
    const r = calculateLeasing({ assetPrice: 40000, residualValue: 15000, interestRate: 0, termYears: 5 })
    expect(r.leasePayment).toBe(416.67) // 25000 / 60
    expect(r.totalInterest).toBe(0.2)
    expect(r.totalLeaseCost).toBe(25000.2)
  })

  it('supports fortnightly and weekly payment frequencies', () => {
    const f = calculateLeasing({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5, paymentFrequency: 'fortnightly' })
    expect(f.leasePayment).toBe(319.23)
    expect(f.leasePaymentFormatted).toBe('$319.23/fn')

    const w = calculateLeasing({ assetPrice: 40000, residualValue: 15000, interestRate: 6, termYears: 5, paymentFrequency: 'weekly' })
    expect(w.leasePayment).toBe(159.62)
    expect(w.leasePaymentFormatted).toBe('$159.62/wk')
  })
})

import { describe, it, expect } from 'vitest'
import {
  PropertyBuyingCostInputSchema,
  calculatePropertyBuyingCost,
} from '../../../../src/edr/domain/calculators/property-buying-cost'

describe('PropertyBuyingCostInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.stateOrTerritory).toBe('NSW')
      expect(r.data.firstHomeBuyer).toBe(false)
      expect(r.data.lmiRequired).toBe(false)
      expect(r.data.legalFees).toBe(2000)
      expect(r.data.inspectionFees).toBe(1000)
      expect(r.data.movingCosts).toBe(1500)
      expect(r.data.grantAmount).toBe(0)
    }
  })

  it('rejects non-positive purchase price and negative deposit', () => {
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 0, deposit: 100000 }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: -1 }).success).toBe(false)
  })

  it('rejects invalid state, non-boolean flags, and negative fees', () => {
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000, stateOrTerritory: 'UK' }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000, firstHomeBuyer: 'yes' }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000, lmiRequired: 'yes' }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000, legalFees: -1 }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000, grantAmount: -1 }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 500000, deposit: 100000, extra: 1 }).success).toBe(false)
  })
})

describe('calculatePropertyBuyingCost', () => {
  it('computes stamp duty (capped at 7%), fees, and totals for NSW', () => {
    const r = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 100000 })
    expect(r.stampDuty).toBe(35000) // capped at 7% of 500000
    expect(r.lmiCost).toBe(0)
    expect(r.totalUpfrontCashRequired).toBe(139500) // 100000 + 35000 + 0 + 4500
    expect(r.totalBuyingCost).toBe(539500)
    expect(r.netCashRequiredAfterGrant).toBe(139500)
    expect(r.breakdown).toEqual([
      { label: 'Purchase Price', value: 500000 },
      { label: 'Stamp Duty', value: 35000 },
      { label: 'LMI', value: 0 },
      { label: 'Legal Fees', value: 2000 },
      { label: 'Inspection Fees', value: 1000 },
      { label: 'Moving Costs', value: 1500 },
      { label: 'First Home Grant', value: -0 }, // -grantAmount with grantAmount = 0
    ])
    expect(r.stampDutyFormatted).toBe('$35000.00')
    expect(r.totalUpfrontFormatted).toBe('$139500.00')
    expect(r.totalBuyingCostFormatted).toBe('$539500.00')
    expect(r.netCashAfterGrantFormatted).toBe('$139500.00')
  })

  it('estimates LMI at 5% of the loan when LVR is 96%', () => {
    const r = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 20000, lmiRequired: true })
    expect(r.lmiCost).toBe(24000) // 480000 * 0.05
    expect(r.totalUpfrontCashRequired).toBe(83500)
    expect(r.totalBuyingCost).toBe(563500)
  })

  it('uses state-specific stamp duty tables (VIC, QLD, WA, SA, TAS fallback)', () => {
    const vic = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 100000, stateOrTerritory: 'VIC' })
    expect(vic.stampDuty).toBe(35000) // capped at 7%
    const qld = calculatePropertyBuyingCost({ purchasePrice: 600000, deposit: 100000, stateOrTerritory: 'QLD' })
    expect(qld.stampDuty).toBe(42000) // capped at 7%
    const wa = calculatePropertyBuyingCost({ purchasePrice: 400000, deposit: 80000, stateOrTerritory: 'WA' })
    expect(wa.stampDuty).toBe(28000) // capped at 7%
    const sa = calculatePropertyBuyingCost({ purchasePrice: 200000, deposit: 40000, stateOrTerritory: 'SA' })
    expect(sa.stampDuty).toBe(14000) // capped at 7%
    const tas = calculatePropertyBuyingCost({ purchasePrice: 300000, deposit: 60000, stateOrTerritory: 'TAS' })
    expect(tas.stampDuty).toBe(15352) // falls back to NSW table
  })

  it('subtracts the first home grant from upfront cash required', () => {
    const r = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 100000, grantAmount: 10000, firstHomeBuyer: true })
    expect(r.totalUpfrontCashRequired).toBe(139500)
    expect(r.netCashRequiredAfterGrant).toBe(129500)
    expect(r.breakdown[6]).toEqual({ label: 'First Home Grant', value: -10000 })
  })

  it('applies all LMI rate bands based on LVR', () => {
    // lvr 0.82 → 1.5% of loan
    const b1 = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 90000, lmiRequired: true })
    expect(b1.lmiCost).toBe(6150) // 410000 * 0.015
    // lvr 0.87 → 2.5% of loan
    const b2 = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 65000, lmiRequired: true })
    expect(b2.lmiCost).toBe(10875) // 435000 * 0.025
    // lvr 0.92 → 3.5% of loan
    const b3 = calculatePropertyBuyingCost({ purchasePrice: 500000, deposit: 40000, lmiRequired: true })
    expect(b3.lmiCost).toBe(16100) // 460000 * 0.035
  })

  it('computes duty on the first (base-0) bracket for low prices', () => {
    const r = calculatePropertyBuyingCost({ purchasePrice: 10000, deposit: 1000 })
    expect(r.stampDuty).toBe(125) // 10000 * 0.0125 (NSW first bracket)
  })
})

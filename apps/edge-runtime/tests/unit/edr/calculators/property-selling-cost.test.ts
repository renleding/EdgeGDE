import { describe, it, expect } from 'vitest'
import {
  PropertySellingCostInputSchema,
  calculatePropertySellingCost,
} from '../../../../src/edr/domain/calculators/property-selling-cost'

describe('PropertySellingCostInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = PropertySellingCostInputSchema.safeParse({ salePrice: 800000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.agentCommissionRate).toBe(2.5)
      expect(r.data.marketingCosts).toBe(3000)
      expect(r.data.conveyancingFees).toBe(1500)
      expect(r.data.mortgageDischargeFee).toBe(400)
      expect(r.data.movingCosts).toBe(2000)
    }
  })

  it('rejects non-positive sale price, out-of-range commission, and negative costs', () => {
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 0 }).success).toBe(false)
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 800000, agentCommissionRate: 10.01 }).success).toBe(false)
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 800000, agentCommissionRate: -1 }).success).toBe(false)
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 800000, marketingCosts: -1 }).success).toBe(false)
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 800000, movingCosts: -1 }).success).toBe(false)
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 800000, extra: 1 }).success).toBe(false)
  })
})

describe('calculatePropertySellingCost', () => {
  it('computes commission, total cost, net proceeds, and breakdown with defaults', () => {
    const r = calculatePropertySellingCost({ salePrice: 800000 })
    expect(r.agentCommission).toBe(20000)
    expect(r.totalSellingCost).toBe(26900)
    expect(r.netProceeds).toBe(773100)
    expect(r.breakdown).toEqual([
      { label: 'Sale Price', value: 800000 },
      { label: 'Agent Commission', value: -20000 },
      { label: 'Marketing Costs', value: -3000 },
      { label: 'Conveyancing Fees', value: -1500 },
      { label: 'Mortgage Discharge Fee', value: -400 },
      { label: 'Moving Costs', value: -2000 },
    ])
    expect(r.agentCommissionFormatted).toBe('$20000.00')
    expect(r.totalSellingCostFormatted).toBe('$26900.00')
    expect(r.netProceedsFormatted).toBe('$773100.00')
  })

  it('uses custom costs and commission rate', () => {
    const r = calculatePropertySellingCost({ salePrice: 600000, agentCommissionRate: 1.5, marketingCosts: 5000, conveyancingFees: 2000, mortgageDischargeFee: 600, movingCosts: 3000 })
    expect(r.agentCommission).toBe(9000)
    expect(r.totalSellingCost).toBe(19600)
    expect(r.netProceeds).toBe(580400)
  })

  it('handles a zero commission rate', () => {
    const r = calculatePropertySellingCost({ salePrice: 800000, agentCommissionRate: 0 })
    expect(r.agentCommission).toBe(0)
    expect(r.totalSellingCost).toBe(6900)
    expect(r.netProceeds).toBe(793100)
  })
})

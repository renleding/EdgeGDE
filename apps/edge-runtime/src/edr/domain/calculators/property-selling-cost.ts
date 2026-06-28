/**
 * EdgeGDE — Domain: Property Selling Cost Calculator
 *
 * Estimate selling costs and net proceeds when selling a property.
 * Includes agent commission, marketing, conveyancing, and mortgage discharge fees.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const PropertySellingCostInputSchema = z
  .object({
    salePrice: z.number().positive('Sale price must be positive'),
    agentCommissionRate: z.number().min(0, 'Commission rate must be >= 0').max(10, 'Commission rate must be <= 10').default(2.5),
    marketingCosts: z.number().min(0, 'Marketing costs must be >= 0').default(3000),
    conveyancingFees: z.number().min(0, 'Conveyancing fees must be >= 0').default(1500),
    mortgageDischargeFee: z.number().min(0, 'Mortgage discharge fee must be >= 0').default(400),
    movingCosts: z.number().min(0, 'Moving costs must be >= 0').default(2000),
  })
  .strict()

export type PropertySellingCostInput = z.input<typeof PropertySellingCostInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface PropertySellingCostOutput {
  agentCommission: number
  totalSellingCost: number
  netProceeds: number
  breakdown: Array<{ label: string; value: number }>
  agentCommissionFormatted: string
  totalSellingCostFormatted: string
  netProceedsFormatted: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

export function calculatePropertySellingCost(input: PropertySellingCostInput): PropertySellingCostOutput {
  const salePrice = input.salePrice ?? 0
  const agentCommissionRate = input.agentCommissionRate ?? 2.5
  const marketingCosts = input.marketingCosts ?? 3000
  const conveyancingFees = input.conveyancingFees ?? 1500
  const mortgageDischargeFee = input.mortgageDischargeFee ?? 400
  const movingCosts = input.movingCosts ?? 2000

  const agentCommission = roundMoney(salePrice * (agentCommissionRate / 100))
  const totalSellingCost = roundMoney(agentCommission + marketingCosts + conveyancingFees + mortgageDischargeFee + movingCosts)
  const netProceeds = roundMoney(salePrice - totalSellingCost)

  const breakdown = [
    { label: 'Sale Price', value: salePrice },
    { label: 'Agent Commission', value: -agentCommission },
    { label: 'Marketing Costs', value: -marketingCosts },
    { label: 'Conveyancing Fees', value: -conveyancingFees },
    { label: 'Mortgage Discharge Fee', value: -mortgageDischargeFee },
    { label: 'Moving Costs', value: -movingCosts },
  ]

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    agentCommission,
    totalSellingCost,
    netProceeds,
    breakdown,
    agentCommissionFormatted: fmt(agentCommission),
    totalSellingCostFormatted: fmt(totalSellingCost),
    netProceedsFormatted: fmt(netProceeds),
  }
}

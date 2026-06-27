/**
 * EdgeGDE — Domain: Property Buying Cost Calculator
 *
 * Estimate total upfront and ongoing costs when purchasing a property.
 * Includes stamp duty, legal fees, inspection, moving costs, and grants.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const PropertyBuyingCostInputSchema = z
  .object({
    purchasePrice: z.number().positive('Purchase price must be positive'),
    deposit: z.number().min(0, 'Deposit must be >= 0'),
    stateOrTerritory: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']).default('NSW'),
    firstHomeBuyer: z.boolean().default(false),
    lmiRequired: z.boolean().default(false),
    legalFees: z.number().min(0, 'Legal fees must be >= 0').default(2000),
    inspectionFees: z.number().min(0, 'Inspection fees must be >= 0').default(1000),
    movingCosts: z.number().min(0, 'Moving costs must be >= 0').default(1500),
    grantAmount: z.number().min(0, 'Grant amount must be >= 0').default(0),
  })
  .strict()

export type PropertyBuyingCostInput = z.infer<typeof PropertyBuyingCostInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface PropertyBuyingCostOutput {
  stampDuty: number
  lmiCost: number
  totalUpfrontCashRequired: number
  totalBuyingCost: number
  netCashRequiredAfterGrant: number
  breakdown: Array<{ label: string; value: number }>
  stampDutyFormatted: string
  totalUpfrontFormatted: string
  totalBuyingCostFormatted: string
  netCashAfterGrantFormatted: string
}

// ═══════════════════════════════════════════════════════════════════════════
// State-based stamp duty estimation (simplified Australian rates)
// ═══════════════════════════════════════════════════════════════════════════

function estimateStampDuty(price: number, state: string): number {
  // Simplified progressive rate tables for each state
  // These are estimates — actual duty varies by property type, concessions, etc.
  const tables: Record<string, Array<{ threshold: number; rate: number; base: number }>> = {
    NSW: [
      { threshold: 0,        rate: 0.00, base: 0 },
      { threshold: 15000,    rate: 0.0125, base: 0 },
      { threshold: 32000,    rate: 0.015,  base: 212 },
      { threshold: 87000,    rate: 0.0175, base: 1037 },
      { threshold: 305000,   rate: 0.035,  base: 4852 },
      { threshold: 1057000,  rate: 0.045,  base: 31372 },
      { threshold: 10000000, rate: 0.055,  base: 71606 },
    ],
    VIC: [
      { threshold: 0,        rate: 0.00, base: 0 },
      { threshold: 25000,    rate: 0.014, base: 0 },
      { threshold: 130000,   rate: 0.027, base: 1470 },
      { threshold: 960000,   rate: 0.055, base: 24900 },
    ],
    QLD: [
      { threshold: 0,        rate: 0.00,   base: 0 },
      { threshold: 5000,     rate: 0.01,   base: 0 },
      { threshold: 75000,    rate: 0.025,  base: 700 },
      { threshold: 540000,   rate: 0.035,  base: 12325 },
      { threshold: 1000000,  rate: 0.045,  base: 28425 },
    ],
    WA: [
      { threshold: 0,        rate: 0.00,   base: 0 },
      { threshold: 120000,   rate: 0.014,  base: 0 },
      { threshold: 150000,   rate: 0.019,  base: 420 },
      { threshold: 360000,   rate: 0.029,  base: 4410 },
      { threshold: 725000,   rate: 0.051,  base: 16165 },
    ],
    SA: [
      { threshold: 0,        rate: 0.00, base: 0 },
      { threshold: 12000,    rate: 0.01, base: 0 },
      { threshold: 30000,    rate: 0.02, base: 180 },
      { threshold: 50000,    rate: 0.03, base: 580 },
      { threshold: 100000,   rate: 0.035, base: 2080 },
      { threshold: 500000,   rate: 0.05,  base: 19080 },
    ],
  }

  const table = tables[state] || tables.NSW
  let duty = 0
  for (const bracket of table) {
    if (price <= bracket.threshold) {
      const prevThreshold = 0
      const prevBase = 0
      duty = bracket.base > 0
        ? bracket.base + (price - prevThreshold) * bracket.rate
        : price * bracket.rate
      break
    }
  }

  // Cap at a reasonable maximum
  return Math.min(roundMoney(duty), roundMoney(price * 0.07))
}

function estimateLmi(loanAmount: number, propertyPrice: number): number {
  const lvr = loanAmount / propertyPrice
  if (lvr <= 0.80) return 0
  if (lvr <= 0.85) return roundMoney(loanAmount * 0.015)
  if (lvr <= 0.90) return roundMoney(loanAmount * 0.025)
  if (lvr <= 0.95) return roundMoney(loanAmount * 0.035)
  return roundMoney(loanAmount * 0.05)
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

export function calculatePropertyBuyingCost(input: PropertyBuyingCostInput): PropertyBuyingCostOutput {
  const { purchasePrice, deposit, stateOrTerritory, firstHomeBuyer,
    lmiRequired, legalFees, inspectionFees, movingCosts, grantAmount } = input

  const loanAmount = Math.max(0, purchasePrice - deposit)
  const stampDuty = estimateStampDuty(purchasePrice, stateOrTerritory)
  const lmiCost = lmiRequired ? estimateLmi(loanAmount, purchasePrice) : 0

  const totalFees = legalFees + inspectionFees + movingCosts
  const totalUpfrontCashRequired = roundMoney(deposit + stampDuty + lmiCost + totalFees)
  const totalBuyingCost = roundMoney(purchasePrice + stampDuty + lmiCost + totalFees)
  const netCashRequiredAfterGrant = roundMoney(Math.max(0, totalUpfrontCashRequired - grantAmount))

  const breakdown = [
    { label: 'Purchase Price', value: purchasePrice },
    { label: 'Stamp Duty', value: stampDuty },
    { label: 'LMI', value: lmiCost },
    { label: 'Legal Fees', value: legalFees },
    { label: 'Inspection Fees', value: inspectionFees },
    { label: 'Moving Costs', value: movingCosts },
    { label: 'First Home Grant', value: -grantAmount },
  ]

  const fmt = (v: number) => `$${v.toFixed(2)}`

  return {
    stampDuty,
    lmiCost,
    totalUpfrontCashRequired,
    totalBuyingCost,
    netCashRequiredAfterGrant,
    breakdown,
    stampDutyFormatted: fmt(stampDuty),
    totalUpfrontFormatted: fmt(totalUpfrontCashRequired),
    totalBuyingCostFormatted: fmt(totalBuyingCost),
    netCashAfterGrantFormatted: fmt(netCashRequiredAfterGrant),
  }
}

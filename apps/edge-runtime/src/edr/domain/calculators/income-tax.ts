/**
 * EdgeGDE — Domain: Income Tax Calculator
 *
 * Estimate Australian income tax liability using progressive tax brackets,
 * medicare levy, and offsets.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

export const IncomeTaxInputSchema = z.object({
  taxableIncome: z.number().min(0, 'Taxable income must be >= 0'),
  residentStatus: z.enum(['resident', 'foreign', 'working-holiday']).default('resident'),
  medicareLevyApplicable: z.boolean().default(true),
  offsets: z.number().min(0, 'Offsets must be >= 0').default(0),
  deductions: z.number().min(0, 'Deductions must be >= 0').default(0),
}).strict()

export type IncomeTaxInput = z.input<typeof IncomeTaxInputSchema>

export interface IncomeTaxOutput {
  grossTax: number
  medicareLevy: number
  netTaxPayable: number
  effectiveTaxRate: number
  offsetsApplied: number
  grossTaxFormatted: string
  medicareLevyFormatted: string
  netTaxFormatted: string
  effectiveRateFormatted: string
}

/** 2025-26 Australian progressive tax brackets (resident). */
const TAX_BRACKETS: Array<{ from: number; to: number; base: number; rate: number }> = [
  { from: 0,       to: 18200,   base: 0,      rate: 0 },
  { from: 18201,   to: 45000,   base: 0,      rate: 0.16 },
  { from: 45001,   to: 135000,  base: 4288,   rate: 0.30 },
  { from: 135001,  to: 190000,  base: 31288,  rate: 0.37 },
  { from: 190001,  to: Infinity, base: 51638, rate: 0.45 },
]

function calculateGrossTax(income: number): number {
  for (const bracket of TAX_BRACKETS) {
    if (income >= bracket.from && income <= bracket.to) {
      return roundMoney(bracket.base + (income - bracket.from + 1) * bracket.rate)
    }
  }
  return roundMoney(income * 0.45)
}

export function calculateIncomeTax(input: IncomeTaxInput): IncomeTaxOutput {
  const taxableIncome = input.taxableIncome ?? 0
  const medicareLevyApplicable = input.medicareLevyApplicable ?? true
  const offsets = input.offsets ?? 0
  const deductions = input.deductions ?? 0

  const assessableIncome = Math.max(0, taxableIncome - deductions)
  const grossTax = calculateGrossTax(assessableIncome)

  const medicareLevy = medicareLevyApplicable && assessableIncome > 0
    ? roundMoney(assessableIncome * 0.02)
    : 0

  const offsetsApplied = Math.min(offsets, grossTax + medicareLevy)
  const netTaxPayable = roundMoney(Math.max(0, grossTax + medicareLevy - offsetsApplied))
  const effectiveTaxRate = taxableIncome > 0
    ? roundMoney(netTaxPayable / taxableIncome * 100)
    : 0

  return {
    grossTax,
    medicareLevy,
    netTaxPayable,
    effectiveTaxRate,
    offsetsApplied,
    grossTaxFormatted: `$${grossTax.toFixed(2)}`,
    medicareLevyFormatted: `$${medicareLevy.toFixed(2)}`,
    netTaxFormatted: `$${netTaxPayable.toFixed(2)}`,
    effectiveRateFormatted: `${effectiveTaxRate.toFixed(2)}%`,
  }
}

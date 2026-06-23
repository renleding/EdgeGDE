/**
 * EdgeGDE — Domain: Stamp Duty Calculator
 *
 * Progressive rates for all 8 Australian states/territories
 * with first home buyer concessions for NSW, VIC, QLD, WA, SA.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const StampDutyStateSchema = z.enum([
  'nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt',
])

export const StampDutyInputSchema = z
  .object({
    propertyValue: z.number().positive('Property value must be positive'),
    state: StampDutyStateSchema,
    isFirstHomeBuyer: z.boolean().default(false),
    isPrincipalPlaceOfResidence: z.boolean().default(true),
    isForeignBuyer: z.boolean().default(false),
  })
  .strict()

export type StampDutyInput = z.infer<typeof StampDutyInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface StampDutyOutput {
  stampDuty: number
  stampDutyFormatted: string
  effectiveRate: number
  concessionApplied: boolean
  concessionAmount: number
  concessionDescription: string
  isFirstHomeBuyerEligible: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Structures (progressive brackets)
// ═══════════════════════════════════════════════════════════════════════════

interface Bracket {
  from: number
  to: number | null
  base: number
  rate: number // percentage
}

function calcProgressiveDuty(value: number, brackets: Bracket[]): number {
  let duty = 0
  for (const b of brackets) {
    if (value <= b.from) continue
    const taxable = Math.min(value, b.to ?? Infinity) - b.from
    duty += b.base + taxable * (b.rate / 100)
  }
  return roundMoney(Math.max(0, duty))
}

// NSW — https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty
const NSW_BRACKETS: Bracket[] = [
  { from: 0, to: 0, base: 0, rate: 0 },
  { from: 0, to: 308_000, base: 0, rate: 1.25 },
  { from: 308_000, to: 1_077_000, base: 0, rate: 3.0 },
  { from: 1_077_000, to: 1_651_000, base: 0, rate: 4.5 },
  { from: 1_651_000, to: 3_300_000, base: 0, rate: 5.5 },
  { from: 3_300_000, to: null, base: 0, rate: 7.0 },
]

function calcNSW(value: number, isFHB: boolean): { duty: number; concession: number; desc: string } {
  let duty = calcProgressiveDuty(value, [
    { from: 0, to: 0, base: 0, rate: 0 },
    { from: 0, to: 308_000, base: 0, rate: 1.25 },
    { from: 308_000, to: 1_077_000, base: 0, rate: 3.0 },
    { from: 1_077_000, to: 1_651_000, base: 0, rate: 4.5 },
    { from: 1_651_000, to: 3_300_000, base: 0, rate: 5.5 },
    { from: 3_300_000, to: null, base: 0, rate: 7.0 },
  ])

  let concession = 0
  let desc = 'No concession applied'

  if (isFHB && value <= 1_000_000) {
    concession = duty
    duty = 0
    desc = 'Full exemption — first home buyer (value <= $1,000,000)'
  } else if (isFHB && value <= 1_500_000) {
    const fullDuty = duty
    const concessionalDuty = calcProgressiveDuty(value, [
      { from: 0, to: 0, base: 0, rate: 0 },
      { from: 0, to: 308_000, base: 0, rate: 1.25 },
      { from: 308_000, to: 1_077_000, base: 0, rate: 3.0 },
      { from: 1_077_000, to: null, base: 0, rate: 4.5 },
    ])
    concession = roundMoney(fullDuty - concessionalDuty)
    duty = concessionalDuty
    desc = `Partial concession — first home buyer (value <= $1,500,000); saved $${concession.toFixed(2)}`
  }

  return { duty, concession, desc }
}

// VIC — https://www.sro.vic.gov.au/transfer-duty
const VIC_BRACKETS: Bracket[] = [
  { from: 0, to: 0, base: 0, rate: 0 },
  { from: 0, to: 25_000, base: 0, rate: 1.4 },
  { from: 25_000, to: 130_000, base: 0, rate: 2.4 },
  { from: 130_000, to: 960_000, base: 0, rate: 5.0 },
  { from: 960_000, to: 2_000_000, base: 0, rate: 5.5 },
  { from: 2_000_000, to: null, base: 0, rate: 6.5 },
]

function calcVIC(value: number, isFHB: boolean): { duty: number; concession: number; desc: string } {
  let duty = calcProgressiveDuty(value, VIC_BRACKETS)
  let concession = 0
  let desc = 'No concession applied'

  // PPR concession
  if (value <= 750_000 && isFHB) {
    const fullDuty = duty
    const concessionalDuty = calcProgressiveDuty(value, [
      { from: 0, to: 0, base: 0, rate: 0 },
      { from: 0, to: 25_000, base: 0, rate: 1.4 },
      { from: 25_000, to: 130_000, base: 0, rate: 2.4 },
      { from: 130_000, to: 750_000, base: 0, rate: 4.0 },
      { from: 750_000, to: null, base: 0, rate: 5.0 },
    ])
    concession = roundMoney(fullDuty - concessionalDuty)
    duty = concessionalDuty
    desc = `First home buyer PPR concession applied (value <= $750,000); saved $${concession.toFixed(2)}`
  }

  return { duty, concession, desc }
}

// QLD — https://www.qld.gov.au/housing/buying-owning-home/stamp-duty
function calcQLD(value: number, isFHB: boolean): { duty: number; concession: number; desc: string } {
  let duty = calcProgressiveDuty(value, [
    { from: 0, to: 0, base: 0, rate: 0 },
    { from: 0, to: 5_000, base: 0, rate: 0 },
    { from: 5_000, to: 75_000, base: 0, rate: 1.0 },
    { from: 75_000, to: 540_000, base: 0, rate: 3.5 },
    { from: 540_000, to: 1_000_000, base: 0, rate: 4.5 },
    { from: 1_000_000, to: null, base: 0, rate: 5.75 },
  ])

  let concession = 0
  let desc = 'No concession applied'

  // First home buyer concession: full exemption up to $500k, tapered to $550k
  if (isFHB && value <= 500_000) {
    concession = duty
    duty = 0
    desc = 'Full exemption — first home buyer (value <= $500,000)'
  } else if (isFHB && value <= 550_000) {
    const fullDuty = duty
    // Tapered: duty * (1 - (value - 500000) / 50000)
    const reduction = roundMoney(fullDuty * (1 - (value - 500_000) / 50_000))
    concession = roundMoney(fullDuty - reduction)
    duty = reduction
    desc = `Tapered concession — first home buyer (value $500k–$550k); saved $${concession.toFixed(2)}`
  }

  return { duty, concession, desc }
}

// WA — https://www.wa.gov.au/organisation/department-of-finance/transfer-duty
function calcWA(value: number, isFHB: boolean): { duty: number; concession: number; desc: string } {
  let duty = calcProgressiveDuty(value, [
    { from: 0, to: 0, base: 0, rate: 0 },
    { from: 0, to: 120_000, base: 0, rate: 1.5 },
    { from: 120_000, to: 150_000, base: 0, rate: 2.75 },
    { from: 150_000, to: 360_000, base: 0, rate: 3.5 },
    { from: 360_000, to: 725_000, base: 0, rate: 4.5 },
    { from: 725_000, to: null, base: 0, rate: 5.75 },
  ])

  let concession = 0
  let desc = 'No concession applied'

  if (isFHB && value <= 530_000) {
    // Duty reduced — FHB grant effectively eliminates duty in this range
    const concessionalDuty = calcProgressiveDuty(value, [
      { from: 0, to: 0, base: 0, rate: 0 },
      { from: 0, to: 120_000, base: 0, rate: 1.0 },
      { from: 120_000, to: 150_000, base: 0, rate: 1.75 },
      { from: 150_000, to: 360_000, base: 0, rate: 2.5 },
      { from: 360_000, to: 530_000, base: 0, rate: 3.5 },
      { from: 530_000, to: null, base: 0, rate: 5.75 },
    ])
    concession = roundMoney(duty - concessionalDuty)
    duty = concessionalDuty
    desc = `First home buyer concession applied (value <= $530,000); saved $${concession.toFixed(2)}`
  }

  return { duty, concession, desc }
}

// SA — https://www.revenuesa.sa.gov.au/taxes-and-duties/stamp-duty
function calcSA(value: number, isFHB: boolean): { duty: number; concession: number; desc: string } {
  let duty = calcProgressiveDuty(value, [
    { from: 0, to: 0, base: 0, rate: 0 },
    { from: 0, to: 12_000, base: 0, rate: 1.0 },
    { from: 12_000, to: 30_000, base: 0, rate: 2.0 },
    { from: 30_000, to: 50_000, base: 0, rate: 3.0 },
    { from: 50_000, to: 100_000, base: 0, rate: 4.0 },
    { from: 100_000, to: 200_000, base: 0, rate: 5.0 },
    { from: 200_000, to: 250_000, base: 0, rate: 5.5 },
    { from: 250_000, to: 300_000, base: 0, rate: 6.0 },
    { from: 300_000, to: 500_000, base: 0, rate: 6.5 },
    { from: 500_000, to: null, base: 0, rate: 7.0 },
  ])

  let concession = 0
  let desc = 'No concession applied'

  if (isFHB && value <= 650_000) {
    if (value <= 150_000) {
      concession = duty
      duty = 0
      desc = 'Full exemption — first home buyer (value <= $150,000)'
    } else if (value <= 650_000) {
      const fullDuty = duty
      // SA FHB rebate: phased out from 150k to 650k
      const rebateRate = Math.max(0, 1 - (value - 150_000) / 500_000)
      const rebate = roundMoney(fullDuty * rebateRate)
      concession = rebate
      duty = roundMoney(fullDuty - rebate)
      desc = `First home buyer rebate applied; saved $${concession.toFixed(2)}`
    }
  }

  return { duty, concession, desc }
}

// TAS
function calcTAS(value: number): { duty: number; concession: number; desc: string } {
  const duty = calcProgressiveDuty(value, [
    { from: 0, to: 0, base: 0, rate: 0 },
    { from: 0, to: 25_000, base: 0, rate: 1.75 },
    { from: 25_000, to: 75_000, base: 0, rate: 2.25 },
    { from: 75_000, to: 200_000, base: 0, rate: 3.5 },
    { from: 200_000, to: 375_000, base: 0, rate: 4.0 },
    { from: 375_000, to: 725_000, base: 0, rate: 4.25 },
    { from: 725_000, to: null, base: 0, rate: 4.5 },
  ])
  return { duty, concession: 0, desc: 'No concession applied (TAS)' }
}

// ACT — https://www.revenue.act.gov.au/duties/transfer-duty
function calcACT(value: number): { duty: number; concession: number; desc: string } {
  // ACT uses a different scale — simpler flat rate approach
  const rate = value <= 1_455_000 ? 1.85 : 2.65
  const duty = roundMoney(value * (rate / 100))
  return { duty, concession: 0, desc: 'No concession applied (ACT)' }
}

// NT — https://nt.gov.au/property/buying-home/stamp-duty
function calcNT(value: number): { duty: number; concession: number; desc: string } {
  const duty = calcProgressiveDuty(value, [
    { from: 0, to: 0, base: 0, rate: 0 },
    { from: 0, to: 525_000, base: 0, rate: 1.75 },
    { from: 525_000, to: 3_000_000, base: 0, rate: 3.4 },
    { from: 3_000_000, to: 5_000_000, base: 0, rate: 6.0 },
    { from: 5_000_000, to: null, base: 0, rate: 7.0 },
  ])
  return { duty, concession: 0, desc: 'No concession applied (NT)' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Calculator
// ═══════════════════════════════════════════════════════════════════════════

export function calculateStampDuty(input: StampDutyInput): StampDutyOutput {
  const { propertyValue, state, isFirstHomeBuyer } = input

  const calc = stateToCalc[state](propertyValue, isFirstHomeBuyer)
  const { duty, concession, desc } = calc

  const isEligible =
    (state === 'nsw' && propertyValue <= 1_500_000) ||
    (state === 'vic' && propertyValue <= 750_000) ||
    (state === 'qld' && propertyValue <= 550_000) ||
    (state === 'wa' && propertyValue <= 530_000) ||
    (state === 'sa' && propertyValue <= 650_000) ||
    (['tas', 'act', 'nt'].includes(state) && isFirstHomeBuyer) ||
    (!isFirstHomeBuyer && false)

  return {
    stampDuty: duty,
    stampDutyFormatted: `$${duty.toFixed(2)}`,
    effectiveRate: roundMoney((duty / propertyValue) * 100),
    concessionApplied: concession > 0,
    concessionAmount: concession,
    concessionDescription: desc,
    isFirstHomeBuyerEligible: isEligible,
  }
}

type StateCalcFn = (value: number, isFHB: boolean) => { duty: number; concession: number; desc: string }

const stateToCalc: Record<string, StateCalcFn> = {
  nsw: calcNSW,
  vic: calcVIC,
  qld: calcQLD,
  wa: calcWA,
  sa: calcSA,
  tas: (v, _isFHB) => calcTAS(v),
  act: (v, _isFHB) => calcACT(v),
  nt: (v, _isFHB) => calcNT(v),
}

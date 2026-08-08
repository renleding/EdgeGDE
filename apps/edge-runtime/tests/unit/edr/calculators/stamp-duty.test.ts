import { describe, it, expect } from 'vitest'
import {
  StampDutyInputSchema,
  StampDutyStateSchema,
  calculateStampDuty,
} from '../../../../src/edr/domain/calculators/stamp-duty'

/** Base input with all (output-typed) fields explicit. */
const base = (state: 'nsw' | 'vic' | 'qld' | 'wa' | 'sa' | 'tas' | 'act' | 'nt', propertyValue: number, isFirstHomeBuyer = false) => ({
  propertyValue,
  state,
  isFirstHomeBuyer,
  isPrincipalPlaceOfResidence: true,
  isForeignBuyer: false,
})

describe('StampDutyInputSchema / StampDutyStateSchema', () => {
  it('accepts a valid input and applies boolean defaults', () => {
    const r = StampDutyInputSchema.safeParse({ propertyValue: 400000, state: 'nsw' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.isFirstHomeBuyer).toBe(false)
      expect(r.data.isPrincipalPlaceOfResidence).toBe(true)
      expect(r.data.isForeignBuyer).toBe(false)
    }
  })

  it('rejects non-positive property value and invalid state', () => {
    expect(StampDutyInputSchema.safeParse({ propertyValue: 0, state: 'nsw' }).success).toBe(false)
    expect(StampDutyInputSchema.safeParse({ propertyValue: 400000, state: 'uk' }).success).toBe(false)
    expect(StampDutyStateSchema.safeParse('uk').success).toBe(false)
    expect(StampDutyStateSchema.safeParse('act').success).toBe(true)
  })

  it('rejects non-boolean flags and unknown keys', () => {
    expect(StampDutyInputSchema.safeParse({ propertyValue: 400000, state: 'nsw', isFirstHomeBuyer: 'yes' }).success).toBe(false)
    expect(StampDutyInputSchema.safeParse({ propertyValue: 400000, state: 'nsw', isForeignBuyer: 1 }).success).toBe(false)
    expect(StampDutyInputSchema.safeParse({ propertyValue: 400000, state: 'nsw', extra: 1 }).success).toBe(false)
  })
})

describe('calculateStampDuty — NSW', () => {
  it('computes progressive duty for a non-FHB purchase', () => {
    const r = calculateStampDuty(base('nsw', 400000))
    expect(r.stampDuty).toBe(6610) // 308000*1.25% + 92000*3%
    expect(r.stampDutyFormatted).toBe('$6610.00')
    expect(r.effectiveRate).toBe(1.65)
    expect(r.concessionApplied).toBe(false)
    expect(r.concessionAmount).toBe(0)
    expect(r.concessionDescription).toBe('No concession applied')
    expect(r.isFirstHomeBuyerEligible).toBe(true) // nsw + <= 1.5M
  })

  it('applies the full FHB exemption up to $1M', () => {
    const r = calculateStampDuty(base('nsw', 800000, true))
    expect(r.stampDuty).toBe(0)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(18610)
    expect(r.concessionDescription).toContain('Full exemption')
  })

  it('hits the (inert) partial concession branch above $1M', () => {
    const r = calculateStampDuty(base('nsw', 1200000, true))
    expect(r.stampDuty).toBe(32455)
    expect(r.concessionAmount).toBe(0)
    expect(r.concessionApplied).toBe(false)
    expect(r.concessionDescription).toContain('Partial concession')
  })

  it('marks values above $1.5M as ineligible for FHB', () => {
    const r = calculateStampDuty(base('nsw', 1600000))
    expect(r.stampDuty).toBe(50455)
    expect(r.isFirstHomeBuyerEligible).toBe(false)
  })
})

describe('calculateStampDuty — VIC', () => {
  it('computes progressive duty for a non-FHB purchase', () => {
    const r = calculateStampDuty(base('vic', 500000))
    expect(r.stampDuty).toBe(21370) // 25000*1.4% + 105000*2.4% + 370000*5%
    expect(r.effectiveRate).toBe(4.27)
    expect(r.concessionApplied).toBe(false)
    expect(r.isFirstHomeBuyerEligible).toBe(true)
  })

  it('applies the FHB PPR concession below $750k', () => {
    const r = calculateStampDuty(base('vic', 600000, true))
    expect(r.stampDuty).toBe(21670)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(4700)
    expect(r.concessionDescription).toContain('First home buyer PPR concession')
  })

  it('applies no concession above $750k even for FHB', () => {
    const r = calculateStampDuty(base('vic', 800000, true))
    expect(r.stampDuty).toBe(36370)
    expect(r.concessionApplied).toBe(false)
    expect(r.isFirstHomeBuyerEligible).toBe(false)
  })
})

describe('calculateStampDuty — QLD', () => {
  it('computes progressive duty for a non-FHB purchase', () => {
    const r = calculateStampDuty(base('qld', 400000))
    expect(r.stampDuty).toBe(12075) // 70000*1% + 325000*3.5%
    expect(r.effectiveRate).toBe(3.02)
    expect(r.isFirstHomeBuyerEligible).toBe(true)
  })

  it('applies the full FHB exemption up to $500k', () => {
    const r = calculateStampDuty(base('qld', 400000, true))
    expect(r.stampDuty).toBe(0)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(12075)
    expect(r.concessionDescription).toContain('Full exemption')
  })

  it('applies the tapered FHB concession from $500k to $550k', () => {
    const r = calculateStampDuty(base('qld', 520000, true))
    expect(r.stampDuty).toBe(9765)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(6510)
    expect(r.concessionDescription).toContain('Tapered concession')
  })
})

describe('calculateStampDuty — WA', () => {
  it('computes progressive duty for a non-FHB purchase', () => {
    const r = calculateStampDuty(base('wa', 400000))
    expect(r.stampDuty).toBe(11775) // 120000*1.5% + 30000*2.75% + 210000*3.5% + 40000*4.5%
    expect(r.effectiveRate).toBe(2.94)
    expect(r.isFirstHomeBuyerEligible).toBe(true)
  })

  it('applies the FHB concession up to $530k', () => {
    const r = calculateStampDuty(base('wa', 400000, true))
    expect(r.stampDuty).toBe(8375)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(3400)
    expect(r.concessionDescription).toContain('First home buyer concession')
  })
})

describe('calculateStampDuty — SA', () => {
  it('computes progressive duty for a non-FHB purchase', () => {
    const r = calculateStampDuty(base('sa', 400000))
    expect(r.stampDuty).toBe(20330)
    expect(r.effectiveRate).toBe(5.08)
    expect(r.isFirstHomeBuyerEligible).toBe(true)
  })

  it('applies the full FHB exemption up to $150k', () => {
    const r = calculateStampDuty(base('sa', 100000, true))
    expect(r.stampDuty).toBe(0)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(3080)
    expect(r.concessionDescription).toContain('Full exemption')
  })

  it('applies the phased FHB rebate from $150k to $650k', () => {
    const r = calculateStampDuty(base('sa', 400000, true))
    expect(r.stampDuty).toBe(10165)
    expect(r.concessionApplied).toBe(true)
    expect(r.concessionAmount).toBe(10165)
    expect(r.concessionDescription).toContain('First home buyer rebate')
  })
})

describe('calculateStampDuty — TAS, ACT, NT', () => {
  it('TAS: progressive duty, no concessions, FHB eligibility tied to the FHB flag', () => {
    const r = calculateStampDuty(base('tas', 400000))
    expect(r.stampDuty).toBe(14000)
    expect(r.concessionApplied).toBe(false)
    expect(r.concessionDescription).toBe('No concession applied (TAS)')
    expect(r.isFirstHomeBuyerEligible).toBe(false)

    const fhb = calculateStampDuty(base('tas', 400000, true))
    expect(fhb.isFirstHomeBuyerEligible).toBe(true)
  })

  it('ACT: flat 1.85% up to $1,455,000 and 2.65% above', () => {
    const r1 = calculateStampDuty(base('act', 1000000))
    expect(r1.stampDuty).toBe(18500)
    expect(r1.effectiveRate).toBe(1.85)
    const r2 = calculateStampDuty(base('act', 2000000))
    expect(r2.stampDuty).toBe(53000)
    expect(r2.effectiveRate).toBe(2.65)
  })

  it('NT: progressive duty with 1.75/3.4/6.0/7.0 brackets', () => {
    const r1 = calculateStampDuty(base('nt', 400000))
    expect(r1.stampDuty).toBe(7000) // 400000 * 1.75%
    const r2 = calculateStampDuty(base('nt', 4000000))
    expect(r2.stampDuty).toBe(153337.5) // 525000*1.75% + 2475000*3.4% + 1000000*6%
    expect(r2.effectiveRate).toBe(3.83)
  })
})

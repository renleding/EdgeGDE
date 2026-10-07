/**
 * Vehicle identity: model + variant + model year (FRS-010 F09 groundwork).
 *
 * WHAT THIS PINS AND WHY
 *
 * The owner asked the console to state "Model 3 Performance 2025". No single field
 * carries that, so it is composed from three sources with different provenance:
 *
 *   model   <- CarType           (reported by the vehicle)
 *   variant <- Trim              (reported), falling back to EfficiencyPackage (a
 *                                 codename, so still reported but indirect)
 *   year    <- VIN position 10   (DERIVED — Tesla exposes no model-year field)
 *
 * The tests below pin the two things that could silently mislead:
 *
 *  1. `M3POPPYSEED2024` must resolve to the Performance variant, and its trailing
 *     `2024` must NOT be read as the model year. It is a package generation; the
 *     model year comes from the VIN. Reading the code's digits as a year would print
 *     "2024" for a 2025 car — plausible, wrong, and invisible.
 *  2. An unrecognised code must resolve to null rather than a guess, so an unknown
 *     package surfaces as itself instead of being folded into a variant it is not.
 */
import { describe, it, expect } from 'vitest'
import { modelYearFromVin, variantFromEfficiencyPackage, normaliseCarType } from '../src/analytics'

describe('variant from EfficiencyPackage', () => {
  it('resolves the observed Model 3 Performance package code', () => {
    // The real value from Drogon's payload.
    expect(variantFromEfficiencyPackage('M3POPPYSEED2024')).toBe('Performance')
  })

  it('does not read the package generation as a model year', () => {
    // The 2024 in the code is a build generation, not a year. If this ever changed to
    // return a year-like value the console would contradict the VIN-derived year.
    const variant = variantFromEfficiencyPackage('M3POPPYSEED2024')
    expect(variant).toBe('Performance')
    expect(variant).not.toMatch(/\d{4}/)
  })

  it('is case-insensitive and trims, since the code is an identifier', () => {
    expect(variantFromEfficiencyPackage('m3poppyseed2024')).toBe('Performance')
    expect(variantFromEfficiencyPackage('  M3POPPYSEED2024  ')).toBe('Performance')
  })

  it('returns null for an unknown code rather than guessing', () => {
    // A future package must surface as itself, not be folded into Performance.
    expect(variantFromEfficiencyPackage('M3SOMETHINGNEW2027')).toBeNull()
    expect(variantFromEfficiencyPackage('')).toBeNull()
    expect(variantFromEfficiencyPackage(null)).toBeNull()
  })
})

describe('model year from VIN (ISO 3779 position 10)', () => {
  it('derives 2025 for the real vehicle VIN', () => {
    // LRW3F7ET1SC584656 — position 10 is 'S'. The owner states 2025; this is the
    // independent derivation that has to agree with it.
    const { year } = modelYearFromVin('LRW3F7ET1SC584656')
    expect(year).toBe(2025)
  })

  it('matches the published position-10 table for the modern range', () => {
    // The years the fleet can plausibly span, per the ISO 3779 table.
    const cases: Array<[string, number]> = [
      ['P', 2023],
      ['R', 2024],
      ['S', 2025],
      ['T', 2026],
      ['V', 2027],
    ]
    for (const [code, expected] of cases) {
      const vin = `LRW3F7ET1${code}C584656`
      expect(modelYearFromVin(vin).year, `position 10 = ${code}`).toBe(expected)
    }
  })

  it('returns null rather than a year for an unusable VIN', () => {
    expect(modelYearFromVin('').year).toBeNull()
    expect(modelYearFromVin('SHORT').year).toBeNull()
    // A VIN cannot contain I, O, Q, U or Z in the year position.
    expect(modelYearFromVin('LRW3F7ET1OC584656').year).toBeNull()
  })
})

describe('model identity composes without inventing anything', () => {
  it('model resolves from CarType, and an unknown model does not become a name', () => {
    expect(normaliseCarType('CarTypeModel3')).toBe('Model 3')
    // Tesla explicitly saying it does not know must not produce a segment literally
    // called "Unknown" — that would merge genuinely different vehicles.
    expect(normaliseCarType('CarTypeUnknown')).toBeNull()
    // A bare enum index is not a model name.
    expect(normaliseCarType('3')).toBeNull()
  })

  it('the three sources agree on "Model 3 Performance 2025" for the real vehicle', () => {
    // End-to-end composition from the three independent sources, using the actual
    // values observed for LRW3F7ET1SC584656.
    const model = normaliseCarType('CarTypeModel3')
    const variant = variantFromEfficiencyPackage('M3POPPYSEED2024')
    const { year } = modelYearFromVin('LRW3F7ET1SC584656')
    expect([model, variant, String(year)].join(' ')).toBe('Model 3 Performance 2025')
  })
})

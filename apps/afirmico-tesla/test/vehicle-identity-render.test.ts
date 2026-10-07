/**
 * Regression tests for the two rendering defects found on the LIVE console after
 * the model-identity work shipped.
 *
 * Both were visible in production output before being noticed, which is the point:
 * neither was caught by a test, and both read as plausible rather than broken.
 *
 *  1. "null Performance 2025" — `String(null)` is `"null"`, which is truthy, so an
 *     absent CarType fell through the identity map and was printed as the word
 *     "null" in a model field. Every other component was correct, so the line looked
 *     like a populated answer.
 *  2. A bare "—" for a vehicle with no attributes, which reads as "this vehicle has
 *     no model" rather than "we have not been sent one yet".
 */
import { describe, it, expect } from 'vitest'
import { modelName, vehicleIdentity } from '../src/admin'

// Strip tags so assertions read the visible text, as an operator sees it.
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('modelName: an absent value renders as nothing, never as "null"', () => {
  it('does not print the word null for a missing model', () => {
    // The production defect, exactly: these inputs produced "null Performance 2025".
    for (const absent of [null, undefined, '', '  ', 'null', 'NULL']) {
      const out = modelName(absent)
      expect(out, `input ${JSON.stringify(absent)}`).toBe('')
      expect(out.toLowerCase(), `input ${JSON.stringify(absent)}`).not.toContain('null')
    }
  })

  it('still maps the real CarType labels', () => {
    expect(modelName('CarTypeModel3')).toBe('Model 3')
    expect(modelName('CarTypeModelY')).toBe('Model Y')
    expect(modelName('CarTypeCybertruck')).toBe('Cybertruck')
  })

  it('passes an unrecognised label through rather than inventing one', () => {
    expect(modelName('CarTypeSomethingNew')).toBe('CarTypeSomethingNew')
  })
})

describe('vehicleIdentity: composition and honest empty state', () => {
  it('renders "Model 3 Performance 2025" once the fields have arrived', () => {
    const html = vehicleIdentity({
      vin: 'LRW3F7ET1SC584656',
      car_type: 'CarTypeModel3',
      trim: 'Performance',
      efficiency_package: 'M3POPPYSEED2024',
    })
    expect(text(html)).toContain('Model 3 Performance 2025')
  })

  it('falls back to the package codename and says so when Trim has not arrived', () => {
    // The live state right now: CarType and EfficiencyPackage are in, Trim is not
    // (it was only enabled in migration 0013 and needs the next config apply).
    const html = vehicleIdentity({
      vin: 'LRW3F7ET1SC584656',
      car_type: 'CarTypeModel3',
      trim: null,
      efficiency_package: 'M3POPPYSEED2024',
    })
    const t = text(html)
    expect(t).toContain('Performance')
    expect(t).toContain('Trim not yet received')
    expect(t.toLowerCase()).not.toContain('null')
  })

  it('never emits the literal word null for any absent combination', () => {
    // Exhaustive over the absent/present combinations that occur in practice.
    const cases: Array<Record<string, unknown>> = [
      { vin: 'LRW3F7ET1SC584656' },
      { vin: 'LRW3F7ET1SC584656', car_type: null, trim: null, efficiency_package: null },
      { vin: 'LRW3F7ET1SC584656', car_type: 'CarTypeModel3' },
      { vin: 'LRW3F7ET1SC584656', efficiency_package: 'M3POPPYSEED2024' },
      { vin: 'LRW3F7ET1SC584656', trim: 'Performance' },
      { car_type: 'CarTypeModel3' },
      {},
    ]
    for (const c of cases) {
      const t = text(vehicleIdentity(c))
      expect(t.toLowerCase(), JSON.stringify(c)).not.toContain('null')
      expect(t.toLowerCase(), JSON.stringify(c)).not.toContain('undefined')
    }
  })

  it('states that nothing has been received rather than showing a bare dash', () => {
    // A dash reads as "no model exists"; the truth is "none has been sent yet".
    const t = text(vehicleIdentity({ vin: 'LRW3F7ET1SC584656' }))
    expect(t).toContain('no vehicle attributes received yet')
    // The year is still derivable from the VIN alone and must still appear, but
    // labelled as coming from the VIN rather than presented as a reported model.
    expect(t).toContain('2025 from VIN')
  })

  it('labels the year as derived when the VIN cannot yield one', () => {
    const t = text(vehicleIdentity({ car_type: 'CarTypeModel3' }))
    expect(t).toContain('year not derivable from VIN')
  })

  it('a vehicle whose model is unknown to Tesla resolves to no model, without a segment named Unknown', () => {
    // CarTypeUnknown is Tesla explicitly reporting it does not know. It must not
    // become a model called "unknown" that merges genuinely different vehicles.
    const t = text(vehicleIdentity({ vin: 'LRW3F7ET1SC584656', car_type: 'CarTypeUnknown' }))
    expect(t).not.toContain('unknown 2025')
    expect(t).not.toContain('Unknown 2025')
    expect(t).toContain('no vehicle attributes received yet')
  })
})

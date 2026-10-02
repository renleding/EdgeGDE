/**
 * Tests for group-level analytics (FRS-010 F06).
 *
 * F06-N01 requires zero PII leakage, verified by an automated scan. These tests
 * take the things that would make that claim meaningless — a scan that cannot fail,
 * an unavailable figure silently averaged as zero, and a segmentation source that
 * looks defensive but always produces the same label — and pin them.
 */

import { describe, expect, it } from 'vitest'
import {
  AGGREGATION_VERSION,
  modelYearFromVin,
  normaliseCarType,
  resolveSegment,
  scanForPii,
  sha256Hex,
  toCsv,
  type GroupRow,
} from '../src/analytics'

const sample: GroupRow[] = [
  {
    postcode: '2335',
    model: 'Model 3',
    model_year: 2024,
    segment_source: 'snapshot',
    vehicle_count: 4,
    avg_odometer_km: 18234.5,
    avg_period_distance_km: 1204.3,
    avg_fsd_share: 0.45,
    fsd_contributing_vehicles: 3,
    fsd_partial_vehicles: 1,
  },
  {
    postcode: '2335',
    model: 'Model Y',
    model_year: null,
    segment_source: 'vin_derived',
    vehicle_count: 1,
    avg_odometer_km: 9000,
    avg_period_distance_km: null,
    avg_fsd_share: null,
    fsd_contributing_vehicles: 0,
    fsd_partial_vehicles: 0,
  },
]

describe('group export CSV (F06-R01, F06-R03, F06-N03)', () => {
  it('emits the required metric and segmentation columns', () => {
    const header = toCsv(sample).split('\r\n')[0]
    expect(header).toBe(
      'postcode,model,model_year,vehicle_count,avg_odometer_km,avg_period_distance_km,avg_fsd_share,fsd_contributing_vehicles,fsd_partial_vehicles,segment_source',
    )
  })

  it('segments by postcode + model + year (F06-R03)', () => {
    const csv = toCsv(sample)
    expect(csv).toContain('2335,Model 3,2024,4,')
    // Two rows in one postcode but different models/years remain distinct cells,
    // which is the whole point of R03 — a single cell per postcode would not be
    // segmented at all.
    expect(csv.split('\r\n').filter(Boolean).length).toBe(3)
  })

  it('is byte-reproducible for the same input (F06-N03, AC4)', () => {
    expect(toCsv(sample)).toBe(toCsv(sample))
    expect(toCsv([...sample])).toBe(toCsv(sample))
  })

  it('renders an unavailable figure as empty, not as 0', () => {
    const row = toCsv(sample).split('\r\n')[2]
    expect(row).toBe('2335,Model Y,,1,9000,,,0,0,vin_derived')
  })

  it('does not quantise a share to 10% steps', () => {
    // At 1 dp this would publish 0.5 for a true 0.45 — a materially misleading
    // figure for an underwriter, and invisible at that granularity.
    expect(toCsv(sample)).toContain('0.45')
  })

  it('quotes a model label containing a comma', () => {
    expect(toCsv([{ ...sample[0], model: 'Model 3, Long Range' }])).toContain('"Model 3, Long Range"')
  })

  it('uses CRLF and ends with a newline', () => {
    const csv = toCsv(sample)
    expect(csv.includes('\r\n')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(csv)).toBe(false)
  })

  it('pins the aggregation version (F06-R06)', () => {
    // A change here means figures from two exports are not comparable, so it is
    // asserted rather than left to drift. Bumped to 2.0.0 when segmentation moved
    // to snapshot-backed model/year: output columns changed, so v1 and v2 reports
    // cannot be reconciled and the version is the only thing that says so.
    expect(AGGREGATION_VERSION).toBe('2.0.0')
  })
})

describe('model year from VIN (F06-R03)', () => {
  // Fixtures verified against the ISO 3779 mapping before being asserted here: the
  // year character is at index 9 (the 10th character) of a 17-character VIN, and the
  // letter cycle is 2010=A .. skipping I, O, Q, U, Z. An earlier version of this test
  // asserted 2021 for 'L' and put the year character in the wrong position; both were
  // wrong, and the fixtures are now generated and checked rather than recalled.
  it('reads a digit year unambiguously', () => {
    // Position 10 = '3' -> 2003. Digits are unambiguous (2001-2009).
    expect(modelYearFromVin('5YJ3E1EA73F000001')).toEqual({ year: 2003, ambiguous: false })
  })

  it('maps letters onto the 2010s/2020s decade', () => {
    expect(modelYearFromVin('5YJ3E1EA7AF000001').year).toBe(2010) // A
    expect(modelYearFromVin('5YJ3E1EA7LF000001').year).toBe(2020) // L (K=2019, L=2020)
    expect(modelYearFromVin('5YJ3E1EA7NF000001').year).toBe(2022) // N (no I/O, so M=2021)
    expect(modelYearFromVin('5YJ3E1EA7RF000001').year).toBe(2024) // R
    expect(modelYearFromVin('5YJ3E1EA7YF000001').year).toBe(2030) // Y is the cycle end
  })

  it('flags a letter year as ambiguous rather than asserting it', () => {
    // A letter is genuinely ambiguous between two decades by the standard; the
    // 2010s/2020s reading is assumed because no Tesla predates 2008. The export must
    // be able to say the year is derived, so ambiguity is reported, not hidden.
    expect(modelYearFromVin('5YJ3E1EA7LF000001').ambiguous).toBe(true)
    expect(modelYearFromVin('5YJ3E1EA73F000001').ambiguous).toBe(false)
  })

  it('returns null instead of guessing on a short or unusable VIN', () => {
    expect(modelYearFromVin('').year).toBeNull()
    expect(modelYearFromVin('5YJ3E1EA7').year).toBeNull() // 9 chars: no position 10
    // 'I' is never used by the standard.
    expect(modelYearFromVin('5YJ3E1EA7IF000001').year).toBeNull()
    // '0' in position 10 is invalid.
    expect(modelYearFromVin('5YJ3E1EA70F000001').year).toBeNull()
  })

  it('accepts lowercase VINs', () => {
    expect(modelYearFromVin('5yj3e1ea7lf000001').year).toBe(2020)
  })
})

describe('segment resolution (F06-R03)', () => {
  it('prefers the vehicle row, because that is where a correction would live', () => {
    expect(resolveSegment('Model 3', null, 'CarTypeModelY')).toEqual({
      model: 'Model 3',
      source: 'vehicle_row',
    })
  })

  it('falls back to the once-tier snapshot, which is where CarType actually lands', () => {
    // upsertVehicles writes no model, so this is the path every real export takes.
    // Canonical display name, matching F06-R03's own example ("Model 3 2024 Long
    // Range"). Publishing the raw enum identifier 'Model3' would fail the spec's
    // example and read badly to an insurer.
    expect(resolveSegment(null, null, 'CarTypeModel3')).toEqual({
      model: 'Model 3',
      source: 'snapshot',
    })
  })

  it('includes the variant when the vehicle row carries a trim', () => {
    expect(resolveSegment('Model 3', 'Long Range', null).model).toBe('Model 3 Long Range')
  })

  it('does not duplicate the trim when the model label already contains it', () => {
    expect(resolveSegment('Model 3 Long Range', 'Long Range', null).model).toBe('Model 3 Long Range')
  })

  it('reports an unresolved segment rather than inventing a label', () => {
    // The first version of this module labelled everything 'Unknown' — which looked
    // defensive and was in fact always the outcome, because nothing populated the
    // vehicle row's model. Silent and universal. It must now be distinguishable.
    expect(resolveSegment(null, null, null)).toEqual({ model: 'Unknown', source: 'unresolved' })
    expect(resolveSegment('  ', '', '   ').source).toBe('unresolved')
  })

  it('treats a bare enum index as unresolved, not as a model name', () => {
    // The snapshot writer falls back to String(valueInt). Printing '3' as a model
    // would put an unresolved enum index into an insurer's CSV looking like data.
    expect(normaliseCarType('3')).toBeNull()
    expect(resolveSegment(null, null, '3').source).toBe('unresolved')
  })

  it('maps enum identifiers to canonical display names', () => {
    expect(normaliseCarType('CarTypeModelS')).toBe('Model S')
    expect(normaliseCarType('CarTypeModelY')).toBe('Model Y')
    expect(normaliseCarType('CarTypeCybertruck')).toBe('Cybertruck')
    expect(normaliseCarType('ModelS')).toBe('Model S')
  })

  it('treats the Tesla-unknown label as unresolved', () => {
    // CarTypeUnknown is Tesla explicitly saying it does not know the model. Folding
    // that into a cell named "Unknown" would merge genuinely different vehicles.
    expect(normaliseCarType('CarTypeUnknown')).toBeNull()
    expect(normaliseCarType('unknown')).toBeNull()
  })

  it('does not fold an unmapped model into an existing segment', () => {
    // A future model must surface as its own segment rather than being guessed into
    // 'Model 3' or the catch-all.
    expect(normaliseCarType('CarTypeModelQ')).toBe('Model Q')
  })
})

describe('PII scan (F06-R02, F06-N01, AC1)', () => {
  const csv = toCsv(sample)

  it('passes a clean export', () => {
    expect(scanForPii(csv, [])).toEqual([])
  })

  it('detects each forbidden identifier class when present', () => {
    expect(scanForPii(csv, ['Warren Smith'])).toEqual([]) // not present → clean
    expect(scanForPii(`${csv}Warren Smith\r\n`, ['Warren Smith'])).toEqual(['Warren Smith'])
    expect(scanForPii(`${csv}0412345678\r\n`, ['0412345678'])).toEqual(['0412345678'])
    expect(scanForPii(`${csv}warren@example.com\r\n`, ['warren@example.com'])).toEqual(['warren@example.com'])
    expect(scanForPii(`${csv}5YJ3E1EA7KF000001\r\n`, ['5YJ3E1EA7KF000001'])).toEqual(['5YJ3E1EA7KF000001'])
    expect(scanForPii(`${csv}-33.8688,151.2093\r\n`, ['-33.8688,151.2093'])).toEqual(['-33.8688,151.2093'])
  })

  it('the scan can actually fail, which is the point', () => {
    // A scan that never fires proves nothing. This asserts it detects a real leak.
    expect(scanForPii(`${csv}mem_01H8XYZ,Warren\r\n`, ['mem_01H8XYZ'])).toEqual(['mem_01H8XYZ'])
  })

  it('ignores values too short to be meaningful', () => {
    expect(scanForPii(csv, ['0', '23', 'M'])).toEqual([])
  })
})

describe('export hashing (F06-R06)', () => {
  it('produces a stable 64-char hex digest', async () => {
    const a = await sha256Hex('hello')
    expect(a).toHaveLength(64)
    expect(a).toBe(await sha256Hex('hello'))
  })

  it('changes when a single byte changes', async () => {
    expect(await sha256Hex('2335,4')).not.toBe(await sha256Hex('2335,5'))
  })

  it('matches the known digest for a fixed input', async () => {
    // Anchors the implementation: if this changes, reproducibility across releases
    // (F06-R06) has broken even though the code still "works".
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

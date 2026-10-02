/**
 * Tests for telemetry ingest and profile derivation (FRS-010 F04, F05).
 *
 * These target the logic where a plausible-but-wrong answer is more dangerous
 * than an error: a fabricated FSD share, a negative distance across a counter
 * reset, and an `invalid` signal silently recorded as zero.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyValue,
  extractDatums,
  normalise,
  signalsForPayload,
  SIGNALS_PER_DOLLAR,
  TelemetryParseError,
} from '../src/telemetry'
import { deriveProfile, detectResets, MILES_TO_KM, type FactPoint } from '../src/derive'

/* -------------------------------------------------------------------------- */
/* Value classification                                                       */
/* -------------------------------------------------------------------------- */

describe('classifyValue (F04)', () => {
  it('keeps a double as a double, even when whole', () => {
    // Odometer uses minimum_delta on a float; truncating here would compound
    // across every later delta.
    expect(classifyValue({ doubleValue: 16093.4 })).toMatchObject({ kind: 'real', real: 16093.4 })
    expect(classifyValue({ doubleValue: 100 })).toMatchObject({ kind: 'real', real: 100 })
  })

  it('maps each protobuf oneof member to exactly one column', () => {
    expect(classifyValue({ intValue: 42 })).toMatchObject({ kind: 'int', int: 42 })
    expect(classifyValue({ stringValue: 'model3' })).toMatchObject({ kind: 'text', text: 'model3' })
    expect(classifyValue({ booleanValue: true })).toMatchObject({ kind: 'bool', bool: 1 })
    expect(classifyValue({ booleanValue: false })).toMatchObject({ kind: 'bool', bool: 0 })
    expect(classifyValue({ locationValue: { latitude: -33.8 } })).toMatchObject({ kind: 'json' })
  })

  it('treats invalid as a datum, not a zero', () => {
    // The vehicle explicitly declined the signal. Recording 0 would be a
    // fabricated reading, which F05-R11 forbids in the profile.
    const result = classifyValue({ invalid: true })
    expect(result.kind).toBe('invalid')
    expect(result.real).toBeNull()
    expect(result.int).toBeNull()
  })

  it('prefers invalid over any value present alongside it', () => {
    expect(classifyValue({ invalid: true, doubleValue: 0 }).kind).toBe('invalid')
  })

  it('treats a missing value as invalid rather than zero', () => {
    expect(classifyValue(undefined).kind).toBe('invalid')
    expect(classifyValue({} as never).kind).toBe('invalid')
  })

  it('rejects a non-finite double', () => {
    expect(classifyValue({ doubleValue: NaN }).kind).toBe('invalid')
    expect(classifyValue({ doubleValue: Infinity }).kind).toBe('invalid')
  })
})

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

describe('extractDatums (F04-R13)', () => {
  it('accepts a single envelope', () => {
    const datums = extractDatums({ vin: 'V1', data: [{ key: 'Odometer', value: { doubleValue: 10 } }] })
    expect(datums).toHaveLength(1)
    expect(datums[0].vin).toBe('V1')
  })

  it('accepts a batched array, because fleet-telemetry emits both shapes', () => {
    const datums = extractDatums([
      { vin: 'V1', data: [{ key: 'Odometer' }] },
      { vin: 'V2', data: [{ key: 'Odometer' }, { key: 'Soc' }] },
    ])
    expect(datums).toHaveLength(3)
  })

  it('ignores malformed entries instead of throwing mid-batch', () => {
    const datums = extractDatums([
      { vin: 'V1', data: [{ key: 'Odometer' }, { nope: 1 }, null] },
      null,
      'garbage',
    ] as never)
    expect(datums).toHaveLength(1)
  })

  it('reports a missing VIN as null so the caller can refuse the payload', () => {
    const datums = extractDatums({ data: [{ key: 'Odometer' }] })
    expect(datums[0].vin).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Normalisation and tier routing                                             */
/* -------------------------------------------------------------------------- */

describe('normalise (F04-R01a, F04 AC4)', () => {
  const tiers = new Map([
    ['Odometer', { tier: 'event', collected: 1 }],
    ['MilesSinceReset', { tier: 'event', collected: 1 }],
    ['SelfDrivingMilesSinceReset', { tier: 'event', collected: 1 }],
    ['CarType', { tier: 'once', collected: 1 }],
    ['Soc', { tier: 'event', collected: 0 }],
  ])

  it('keeps a collected field and resolves its tier', () => {
    const { normalised } = normalise(
      [{ vin: 'V1', datum: { key: 'Odometer', value: { doubleValue: 5 } } }],
      tiers,
      'T0',
    )
    expect(normalised[0]).toMatchObject({ fieldKey: 'Odometer', tier: 'event', valueKind: 'real' })
  })

  it('drops an uncatalogued field and says so', () => {
    const { normalised, skippedUnknown } = normalise(
      [{ vin: 'V1', datum: { key: 'BrandNewFirmwareField', value: { intValue: 1 } } }],
      tiers,
      'T0',
    )
    expect(normalised).toHaveLength(0)
    expect(skippedUnknown).toBe(1)
  })

  it('drops a catalogued-but-uncollected field, which is the consented scope working', () => {
    const { normalised, skippedUncollected } = normalise(
      [{ vin: 'V1', datum: { key: 'Soc', value: { intValue: 55 } } }],
      tiers,
      'T0',
    )
    expect(normalised).toHaveLength(0)
    expect(skippedUncollected).toBe(1)
  })

  it('counts invalid values without dropping the datum', () => {
    const { normalised, invalidValues } = normalise(
      [{ vin: 'V1', datum: { key: 'Odometer', value: { invalid: true } } }],
      tiers,
      'T0',
    )
    expect(normalised).toHaveLength(1)
    expect(normalised[0].valueKind).toBe('invalid')
    expect(invalidValues).toBe(1)
  })

  it('preserves the once tier so it routes to the snapshot table', () => {
    const { normalised } = normalise(
      [{ vin: 'V1', datum: { key: 'CarType', value: { stringValue: 'model3' } } }],
      tiers,
      'T0',
    )
    expect(normalised[0].tier).toBe('once')
  })

  it('falls back to the receive time when Tesla sends no created_at', () => {
    const { normalised } = normalise(
      [{ vin: 'V1', datum: { key: 'Odometer', value: { doubleValue: 1 } } }],
      tiers,
      '2026-10-02T00:00:00Z',
    )
    expect(normalised[0].observedAt).toBe('2026-10-02T00:00:00Z')
  })

  it('grades the failure modes separately so the run log can tell them apart', () => {
    const { skippedUnknown, skippedUncollected, invalidValues } = normalise(
      [
        { vin: 'V1', datum: { key: 'Nope', value: { intValue: 1 } } },
        { vin: 'V1', datum: { key: 'Soc', value: { intValue: 1 } } },
        { vin: 'V1', datum: { key: 'Odometer', value: { invalid: true } } },
      ],
      tiers,
      'T0',
    )
    expect({ skippedUnknown, skippedUncollected, invalidValues }).toEqual({
      skippedUnknown: 1,
      skippedUncollected: 1,
      invalidValues: 1,
    })
  })
})

describe('cost accounting (F04-R16)', () => {
  it('uses Tesla\'s 150k signals per dollar', () => {
    expect(SIGNALS_PER_DOLLAR).toBe(150_000)
    expect(signalsForPayload(150_000)).toBe(150_000)
  })
})

describe('persistDatums guards', () => {
  it('refuses a payload with no VIN rather than writing orphan facts', async () => {
    const { persistDatums } = await import('../src/telemetry')
    const fakeDb = {} as D1Database
    await expect(
      persistDatums(fakeDb, { batchId: 'b', vin: null, datums: [], receivedAt: 'T' }),
    ).rejects.toBeInstanceOf(TelemetryParseError)
  })
})

/* -------------------------------------------------------------------------- */
/* Derivation — the FSD rules                                                 */
/* -------------------------------------------------------------------------- */

describe('deriveProfile: distance (F05-R02)', () => {
  it('converts the since-reset delta to kilometres', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31', value: 2000 },
      ],
    })
    expect(profile.distanceKm).toBeCloseTo(1000 * MILES_TO_KM, 6)
  })

  it('falls back to the odometer when the reset counter is absent', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'Odometer', observedAt: '2026-01-01', value: 10000 },
        { fieldKey: 'Odometer', observedAt: '2026-01-31', value: 10200 },
      ],
    })
    expect(profile.distanceKm).toBeCloseTo(200 * MILES_TO_KM, 6)
  })

  it('reports no distance rather than a negative one when the odometer decreases', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'Odometer', observedAt: '2026-01-01', value: 10200 },
        { fieldKey: 'Odometer', observedAt: '2026-01-31', value: 10000 },
      ],
    })
    expect(profile.distanceKm).toBeNull()
  })
})

describe('deriveProfile: FSD share (F05-R03, F05 AC2)', () => {
  it('computes the share of distance driven on FSD', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31', value: 2000 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-01', value: 400 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-31', value: 800 },
      ],
    })
    // 400 FSD miles of 1000 total.
    expect(profile.fsdPercent).toBeCloseTo(0.4, 6)
    expect(profile.fsdAvailability).toBe('measured')
    expect(profile.fsdKm).toBeCloseTo(400 * MILES_TO_KM, 6)
  })

  it('reports unavailable, with a reason, when the vehicle never sends FSD distance', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31', value: 2000 },
      ],
    })
    expect(profile.fsdPercent).toBeNull()
    expect(profile.fsdAvailability).toBe('unavailable')
    expect(profile.fsdNote).toMatch(/did not report Full Self-Driving/i)
  })

  it('never substitutes an estimate — a zero share must be measured, not assumed', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [{ fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 }],
    })
    // One reading cannot establish a delta, so this must not become 0%.
    expect(profile.fsdPercent).toBeNull()
  })

  it('labels a no-travel window rather than dividing by zero', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31', value: 1000 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-01', value: 400 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-31', value: 400 },
      ],
    })
    expect(profile.fsdPercent).toBeNull()
    expect(profile.fsdAvailability).toBe('partial')
    expect(profile.fsdNote).toMatch(/did not move/i)
  })
})

describe('deriveProfile: counter resets (F05-R14)', () => {
  it('detects a decrease as a reset', () => {
    const resets = detectResets('MilesSinceReset', [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 5000 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-01-15', value: 120 },
    ])
    expect(resets).toHaveLength(1)
    expect(resets[0]).toMatchObject({ valueBefore: 5000, valueAfter: 120 })
  })

  it('does not treat a repeated value as a reset', () => {
    // Odometer carries a minimum_delta, so repeats are the expected quiet period.
    expect(
      detectResets('Odometer', [
        { fieldKey: 'Odometer', observedAt: 'a', value: 100 },
        { fieldKey: 'Odometer', observedAt: 'b', value: 100 },
      ]),
    ).toHaveLength(0)
  })

  it('discards the window and reports partial when a reset falls inside it', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 9000 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-15', value: 10 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31', value: 500 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-01', value: 4000 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-15', value: 5 },
        { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-31', value: 300 },
      ],
    })
    expect(profile.counterResetCount).toBe(2)
    expect(profile.fsdAvailability).toBe('partial')
    expect(profile.fsdPercent).toBeNull()
    expect(profile.fsdNote).toMatch(/reset/i)
    // Distance must be the post-reset value, never 500 - 9000 (negative).
    expect(profile.distanceKm).toBeCloseTo(500 * MILES_TO_KM, 6)
    expect(profile.distanceKm).toBeGreaterThan(0)
  })

  it('records each reset so the discontinuity is auditable', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 100 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-10', value: 0 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-20', value: 50 },
      ],
    })
    expect(profile.resets).toHaveLength(1)
    expect(profile.resets[0].detectedAt).toBe('2026-01-10')
  })
})

describe('deriveProfile: determinism and confidence (F05-R09, F05-R10, F05 AC1/AC4)', () => {
  const facts: FactPoint[] = [
    { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 },
    { fieldKey: 'MilesSinceReset', observedAt: '2026-01-15', value: 1500 },
    { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31', value: 2000 },
    { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-01', value: 100 },
    { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-01-31', value: 500 },
  ]

  it('produces byte-identical output for identical input', () => {
    const a = deriveProfile({ periodStart: '2026-01-01', periodEnd: '2026-01-31', facts })
    const b = deriveProfile({ periodStart: '2026-01-01', periodEnd: '2026-01-31', facts })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('is insensitive to input order', () => {
    const shuffled = [...facts].reverse()
    const a = deriveProfile({ periodStart: '2026-01-01', periodEnd: '2026-01-31', facts })
    const b = deriveProfile({ periodStart: '2026-01-01', periodEnd: '2026-01-31', facts: shuffled })
    expect(a.distanceKm).toBe(b.distanceKm)
    expect(a.fsdPercent).toBe(b.fsdPercent)
  })

  it('traces every metric to a fact range (F05-R10)', () => {
    const profile = deriveProfile({ periodStart: '2026-01-01', periodEnd: '2026-01-31', facts })
    expect(profile.sourceFactMin).toBe('2026-01-01')
    expect(profile.sourceFactMax).toBe('2026-01-31')
    for (const note of profile.notes) {
      expect(note.sourceFactMin).not.toBeNull()
      expect(note.definition.length).toBeGreaterThan(20)
    }
  })

  it('flags low confidence from a single snapshot (F05 AC4)', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [{ fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 }],
    })
    expect(profile.snapshotCount).toBe(1)
    expect(profile.lowConfidence).toBe(true)
    expect(profile.confidence).toBeLessThan(0.5)
  })

  it('rates a full window higher than a single reading', () => {
    const rich = deriveProfile({ periodStart: '2026-01-01', periodEnd: '2026-01-31', facts })
    const thin = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [{ fieldKey: 'Odometer', observedAt: '2026-01-01', value: 1 }],
    })
    expect(rich.confidence).toBeGreaterThan(thin.confidence)
    expect(rich.lowConfidence).toBe(false)
  })

  it('ignores facts outside the window', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2025-12-31', value: 1 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-02-01', value: 99999 },
      ],
    })
    expect(profile.distanceKm).toBeNull()
  })

  it('uses the latest reading at or before a boundary, not an arbitrary one', () => {
    // Resends land inside the window; an early/late pairing would skew the delta.
    // The reading exactly at the window start is the window's opening value, so
    // travel is 210 - 100 = 110 miles.
    const profile = deriveProfile({
      periodStart: '2026-01-01T00:00:00Z',
      periodEnd: '2026-01-31T00:00:00Z',
      facts: [
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01T00:00:00Z', value: 100 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-01T06:00:00Z', value: 110 },
        { fieldKey: 'MilesSinceReset', observedAt: '2026-01-31T00:00:00Z', value: 210 },
      ],
    })
    expect(profile.distanceKm).toBeCloseTo(110 * MILES_TO_KM, 6)
  })

  it('reports no distance from a single reading rather than claiming zero travel', () => {
    // A 0 km distance is a *claim* that the vehicle did not move. With one
    // observation we do not know that, so the answer is unknown, not zero.
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [{ fieldKey: 'MilesSinceReset', observedAt: '2026-01-01', value: 1000 }],
    })
    expect(profile.distanceKm).toBeNull()
  })

  it('reports no distance when the odometer repeats unchanged', () => {
    const profile = deriveProfile({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      facts: [
        { fieldKey: 'Odometer', observedAt: '2026-01-01', value: 500 },
        { fieldKey: 'Odometer', observedAt: '2026-01-31', value: 500 },
      ],
    })
    expect(profile.distanceKm).toBeNull()
  })

  it('exposes the derivation version so old profiles stay explainable (F05-R12)', async () => {
    const { DERIVATION_VERSION } = await import('../src/derive')
    expect(DERIVATION_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

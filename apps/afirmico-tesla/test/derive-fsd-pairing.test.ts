/**
 * The paired-delta FSD share: does it survive unmatched emission instants?
 *
 * WHY THIS FILE EXISTS
 *
 * `deriveProfile` computes the FSD share as ΔSelfDriving / ΔTotal, where each delta is
 * taken from that series' OWN boundary readings:
 *
 *   milesFirst = windowOpen(milesResetSeries, periodStart)
 *   milesLast  = valueAt(milesResetSeries, periodEnd)
 *   fsdFirst   = windowOpen(fsdResetSeries, periodStart)
 *   fsdLast    = valueAt(fsdResetSeries, periodEnd)
 *
 * Both counters are independently change-gated (minimum_delta = 1 mile each), and at a
 * 180-second interval they gain many more opportunities to emit apart from one another.
 * When they do, the two deltas cover DIFFERENT SPANS and dividing them compares travel
 * over two different periods.
 *
 * The guard is `deltaMiles > 0 && fsdFirst !== null && fsdLast !== null` — it rejects
 * null and zero, but it never checks that the two windows are the SAME window. So an
 * unaligned pair is reported as `fsdAvailability: 'measured'`, asserting a certainty the
 * data does not support.
 *
 * These tests characterise the current behaviour so the interval change is made against
 * evidence rather than an assumption. If the assertions below fail after a fix, the fix
 * worked and these should be updated to the corrected expectation.
 */
import { describe, it, expect } from 'vitest'
import { deriveProfile } from '../src/derive'

const VIN = 'LRW3F7ET1SC584656'
const PERIOD_START = '2026-10-01T00:00:00Z'
const PERIOD_END = '2026-10-31T00:00:00Z'

type Fact = { fieldKey: string; observedAt: string; value: number }

function profile(facts: Fact[]) {
  return deriveProfile({
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    facts: facts.map((f) => ({ ...f, valueKind: 'real' as const })),
  } as Parameters<typeof deriveProfile>[0])
}

describe('FSD share when both counters emit together (the good case)', () => {
  it('reports a measured share when the boundaries match', () => {
    const facts: Fact[] = [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 1000 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 100 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 2000 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 500 },
    ]
    const p = profile(facts)
    expect(p.fsdAvailability).toBe('measured')
    // 400 FSD miles / 1000 total miles
    expect(p.fsdPercent).toBeCloseTo(0.4, 6)
  })
})

describe('FSD share when the counters emit at DIFFERENT instants (the defect, now fixed)', () => {
  it('refuses the share when the FSD window starts after the total window', () => {
    // Total distance: 1000 -> 2000 over the whole window (1000 mi).
    // FSD: first reading is FOUR DAYS LATER, at 300, ending at 500 (delta 200).
    //
    // The FSD delta covers [10-05, 10-31]; the total delta covers [10-01, 10-31]. They
    // are not the same period, so 200/1000 = 0.20 describes no single window. The true
    // FSD share over [10-01, 10-31] is unknowable, because FSD at 10-01 was never
    // observed.
    //
    // BEFORE THE FIX this returned fsdAvailability 'measured' with fsdPercent 0.20 — an
    // unaligned pair indistinguishable from a genuine measurement.
    const facts: Fact[] = [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 1000 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 2000 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-05T00:00:00Z', value: 300 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 500 },
    ]
    const p = profile(facts)

    // No share is published, because a share needs a common denominator.
    expect(p.fsdAvailability).toBe('partial')
    expect(p.fsdPercent).toBeNull()
    // The defensible figure still is: FSD distance since its own first observation.
    expect(p.fsdKm).toBeCloseTo(200 * 1.609344, 3)
    // And the reason travels with it, naming both instants, so the withholding is
    // explainable rather than a silent null.
    expect(p.fsdNote).toContain('different times')
    expect(p.fsdNote).toContain('2026-10-05T00:00:00Z')
    expect(p.fsdNote).toContain('2026-10-01T00:00:00Z')
  })

  it('no longer reports an 80% share built from a 5-day numerator and a 30-day denominator', () => {
    // The extreme case: FSD first observed 25 days into a 30-day window. The old code
    // published 80% to an underwriter as a measured figure.
    const facts: Fact[] = [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 1000 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 1100 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-26T00:00:00Z', value: 10 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 90 },
    ]
    const p = profile(facts)
    expect(p.fsdAvailability).toBe('partial')
    expect(p.fsdPercent).toBeNull()
  })

  it('still reports a share when the FSD counter starts EARLIER than the total', () => {
    // The safe direction: the numerator's span contains the denominator's, and both
    // counters only increase, so the ratio is a bound rather than a misstatement of a
    // different period. Withholding here would discard usable data.
    const facts: Fact[] = [
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 100 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-05T00:00:00Z', value: 1000 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 2000 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 500 },
    ]
    const p = profile(facts)
    expect(p.fsdAvailability).toBe('measured')
    expect(p.fsdPercent).not.toBeNull()
  })
})

describe('what the profile DOES protect against (so a fix keeps these)', () => {
  it('yields null rather than a fabricated zero when the total did not move', () => {
    const facts: Fact[] = [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 1000 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 100 },
    ]
    const p = profile(facts)
    // One instant cannot support a delta, so no share is claimed.
    expect(p.fsdAvailability).not.toBe('measured')
  })

  it('marks a reset-containing window partial rather than dividing across it', () => {
    const facts: Fact[] = [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 5000 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-15T00:00:00Z', value: 0 },
      { fieldKey: 'MilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 300 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-01T00:00:00Z', value: 1000 },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-10-31T00:00:00Z', value: 1400 },
    ]
    const p = profile(facts)
    expect(p.fsdAvailability).toBe('partial')
  })
})

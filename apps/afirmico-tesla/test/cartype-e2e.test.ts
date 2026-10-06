/**
 * End-to-end check of the CarType path on the WORKER side.
 *
 * The relay half is proven separately (relay.py replays the real payload 14/14).
 * This pins the worker half: the relay's output shape for an enum must classify
 * as text and route to the snapshot table (CarType is `once` tier), not be
 * dropped or mis-typed.
 */
import { describe, it, expect } from 'vitest'
import { extractDatums, classifyValue, normalise } from '../src/telemetry'

describe('CarType end-to-end on the worker side', () => {
  // Exactly what the FIXED relay now forwards.
  const relayOutput = {
    vin: 'LRW3F7ET1SC584656',
    data: [
      { key: 'CarType', value: { stringValue: 'CarTypeModel3' }, createdAt: '2026-10-06T20:28:16Z' },
      { key: 'SentryMode', value: { stringValue: 'SentryModeStateOff' }, createdAt: '2026-10-06T20:28:16Z' },
      { key: 'SpeedLimitWarning', value: { stringValue: 'SpeedAssistLevelNone' }, createdAt: '2026-10-06T20:28:16Z' },
      { key: 'Odometer', value: { doubleValue: 21952.18342257409 }, createdAt: '2026-10-06T20:28:16Z' },
    ],
  }

  it('classifies the enum wrapper as text, not invalid', () => {
    const v = classifyValue({ stringValue: 'CarTypeModel3' })
    expect(v.kind).toBe('text')
    expect(v.text).toBe('CarTypeModel3')
  })

  it('keeps CarType through normalise as a once-tier text datum', () => {
    const extracted = extractDatums(relayOutput)
    const tiers = new Map([
      ['CarType', { tier: 'once', collected: 1 }],
      ['SentryMode', { tier: 'on_change', collected: 1 }],
      ['SpeedLimitWarning', { tier: 'on_change', collected: 1 }],
      ['Odometer', { tier: 'event', collected: 1 }],
    ])
    const { normalised, skippedUnknown, skippedUncollected, invalidValues } = normalise(
      extracted, tiers, '2026-10-06T20:28:22.449Z',
    )
    // Nothing may be dropped: this is the assertion that would have caught the
    // three-field loss at the worker boundary too.
    expect(skippedUnknown).toBe(0)
    expect(skippedUncollected).toBe(0)
    expect(invalidValues).toBe(0)
    expect(normalised).toHaveLength(4)

    const carType = normalised.find((d) => d.fieldKey === 'CarType')!
    expect(carType.tier).toBe('once')          // routes to tesla_vehicle_snapshot
    expect(carType.valueKind).toBe('text')
    expect(carType.valueText).toBe('CarTypeModel3')

    const sentry = normalised.find((d) => d.fieldKey === 'SentryMode')!
    expect(sentry.tier).toBe('on_change')      // routes to the fact stream
    expect(sentry.valueText).toBe('SentryModeStateOff')
  })
})

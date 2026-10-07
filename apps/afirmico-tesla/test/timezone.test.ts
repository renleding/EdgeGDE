/**
 * State resolution and dual-timezone rendering.
 *
 * WHY THESE TESTS EXIST
 *
 * An owner reported being in the car "around 0800 local". The dashboard showed
 * `02:28:15`, which read as 2:28 AM and contradicted them. The data was right and the
 * display was wrong. These tests pin the display, and the state resolution it depends
 * on, so that cannot recur.
 *
 * The state boundary cases matter more than they look: a postcode resolved to the wrong
 * state puts a member in the wrong timezone, and the error is invisible because the
 * rendered time still looks perfectly plausible. That is the class of defect this file
 * is for.
 */
import { describe, it, expect } from 'vitest'
import {
  stateFromPostcode,
  timeZoneForState,
  timeZoneForPostcode,
  formatDualTime,
  formatTimeColumns,
} from '../src/timezone'

// The owner's actual vehicle timestamp, and the instant their trip was delivered.
const OBSERVED = '2026-10-07T02:28:15Z'

describe('stateFromPostcode', () => {
  it('resolves the member postcode in production (2906 is ACT)', () => {
    expect(stateFromPostcode('2906')).toBe('ACT')
  })

  it('handles the ACT exceptions that sit inside the NSW numeric ranges', () => {
    // The ACT's postcodes are three separate blocks, not one range. These are the ones
    // that get a member's timezone wrong if the blocks are treated as contiguous.
    expect(stateFromPostcode(2600)).toBe('ACT') // Canberra
    expect(stateFromPostcode(2601)).toBe('ACT')
    expect(stateFromPostcode(2618)).toBe('ACT')
    // 2619 (Queanbeyan) and 2640-2649 are NSW despite being numerically adjacent.
    expect(stateFromPostcode(2619)).toBe('NSW')
    expect(stateFromPostcode(2640)).toBe('NSW')
    expect(stateFromPostcode(2649)).toBe('NSW')
    // ...and ACT resumes at 2900, then hands back to NSW at 2921.
    expect(stateFromPostcode(2900)).toBe('ACT')
    expect(stateFromPostcode(2920)).toBe('ACT')
    expect(stateFromPostcode(2921)).toBe('NSW')
  })

  it('resolves the main state blocks', () => {
    const cases: Array<[number, string]> = [
      [1000, 'NSW'], [2000, 'NSW'], [2599, 'NSW'], [2800, 'NSW'],
      [3000, 'VIC'], [3800, 'VIC'], [3999, 'VIC'],
      [4000, 'QLD'], [4500, 'QLD'], [4999, 'QLD'],
      [5000, 'SA'], [5600, 'SA'], [5999, 'SA'],
      [6000, 'WA'], [6800, 'WA'], [6999, 'WA'],
      [7000, 'TAS'], [7300, 'TAS'], [7999, 'TAS'],
      [800, 'NT'], [899, 'NT'], [999, 'NT'],
    ]
    for (const [pc, state] of cases) {
      expect(stateFromPostcode(pc), `postcode ${pc}`).toBe(state)
    }
  })

  it('accepts a number or a zero-padded string, since postcodes are stored as text', () => {
    // An ACT/NT postcode with a leading zero survives only if written as text; the
    // resolver must not depend on which representation arrived.
    expect(stateFromPostcode('0200')).toBe('ACT')
    expect(stateFromPostcode(200)).toBe('ACT')
    expect(stateFromPostcode('0800')).toBe('NT')
  })

  it('returns null rather than guessing for an unresolvable value', () => {
    // A guess here shows a plausible local time for the WRONG zone, which is worse than
    // showing UTC alone.
    expect(stateFromPostcode(null)).toBeNull()
    expect(stateFromPostcode(undefined)).toBeNull()
    expect(stateFromPostcode('')).toBeNull()
    expect(stateFromPostcode('abc')).toBeNull()
    expect(stateFromPostcode(0)).toBeNull()
    expect(stateFromPostcode(150)).toBeNull() // below the ACT block
  })
})

describe('timeZoneForPostcode', () => {
  it('maps the member postcode to the ACT zone', () => {
    expect(timeZoneForPostcode('2906')).toBe('Australia/Sydney')
  })

  it('gives QLD a different zone from NSW, because QLD has no daylight saving', () => {
    // This is the substantive point: a single hardcoded "+11" would be wrong for a
    // Queensland member all year, and wrong for SA by half an hour.
    expect(timeZoneForPostcode(2000)).toBe('Australia/Sydney') // NSW
    expect(timeZoneForPostcode(4000)).toBe('Australia/Brisbane') // QLD
    expect(timeZoneForPostcode(5000)).toBe('Australia/Adelaide') // SA
    expect(timeZoneForPostcode(6000)).toBe('Australia/Perth') // WA
    expect(timeZoneForPostcode(800)).toBe('Australia/Darwin') // NT
  })

  it('returns null for an unknown postcode so the caller falls back to UTC', () => {
    expect(timeZoneForPostcode(null)).toBeNull()
    expect(timeZoneForPostcode('150')).toBeNull()
    expect(timeZoneForState(null)).toBeNull()
  })
})

describe('formatDualTime: 24-hour, UTC first, local additive', () => {
  it('renders the owner trip instant as UTC plus AEDT in 24-hour time', () => {
    // The exact conversion that resolves the owner's report: 02:28:15 UTC is 13:28:15
    // AEDT on the same day. It must NOT render as 2:28 with an AM/PM marker.
    const out = formatDualTime(OBSERVED, 'Australia/Sydney')
    expect(out).toBe('2026-10-07 02:28:15 UTC (2026-10-07 13:28:15 AEDT)')
  })

  it('uses 24-hour format with no AM/PM marker, at both ends of the day', () => {
    // hour12/h23 mistakes show up exactly here: midnight and afternoon are where a
    // 12-hour clock leaks back in.
    const afternoon = formatDualTime(OBSERVED, 'Australia/Sydney')
    expect(afternoon).not.toMatch(/am|pm/i)
    expect(afternoon).toContain('13:28:15')

    // 14:00 UTC = 01:00 next day AEDT — the date must roll forward with the zone.
    const midnightish = formatDualTime('2026-10-06T14:00:00Z', 'Australia/Sydney')
    expect(midnightish).toContain('2026-10-07 01:00:00 AEDT')
    expect(midnightish).not.toMatch(/am|pm/i)
  })

  it('always leads with UTC so an incident timeline stays unambiguous', () => {
    const out = formatDualTime(OBSERVED, 'Australia/Brisbane')
    expect(out.startsWith('2026-10-07 02:28:15 UTC')).toBe(true)
  })

  it('distinguishes QLD from NSW at the same instant (AEST vs AEDT)', () => {
    // Same UTC instant, different state, different local hour — which is why the state
    // has to be resolved rather than assumed.
    const nsw = formatDualTime(OBSERVED, 'Australia/Sydney')
    const qld = formatDualTime(OBSERVED, 'Australia/Brisbane')
    expect(nsw).toContain('13:28:15 AEDT')
    expect(qld).toContain('12:28:15 AEST')
  })

  it('degrades to UTC alone when no zone is known, with no undefined placeholder', () => {
    // A missing zone must not produce a plausible-looking wrong local time.
    const out = formatDualTime(OBSERVED, null)
    expect(out).toBe('2026-10-07 02:28:15 UTC')
    expect(out).not.toContain('undefined')
    expect(out).not.toContain('(')
  })

  it('falls back to UTC for an invalid zone rather than throwing', () => {
    const out = formatDualTime(OBSERVED, 'Not/AZone')
    expect(out).toBe('2026-10-07 02:28:15 UTC')
  })

  it('renders absence as a dash, never as an epoch or "Invalid Date"', () => {
    expect(formatDualTime(null, 'Australia/Sydney')).toBe('—')
    expect(formatDualTime('', 'Australia/Sydney')).toBe('—')
    expect(formatDualTime('not-a-date', 'Australia/Sydney')).toBe('not-a-date')
  })
})

describe('formatTimeColumns: sortable UTC beside readable local', () => {
  it('splits the two values so neither can be mistaken for the other', () => {
    const { utc, local } = formatTimeColumns(OBSERVED, 'Australia/Sydney')
    expect(utc).toBe('2026-10-07 02:28:15')
    expect(local).toBe('13:28:15 AEDT')
  })

  it('leaves local blank when the zone is unknown rather than echoing UTC', () => {
    const { utc, local } = formatTimeColumns(OBSERVED, null)
    expect(utc).toBe('2026-10-07 02:28:15')
    expect(local).toBe('—')
  })

  it('handles a missing timestamp in both columns', () => {
    expect(formatTimeColumns(null, 'Australia/Sydney')).toEqual({ utc: '—', local: '—' })
  })
})

/**
 * Australian state resolution and dual-timezone rendering.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every timestamp on the operator console was rendered as bare UTC with no local
 * equivalent. An owner reported being in the car "around 0800 local time"; the
 * dashboard showed `02:28:15` and, because the telemetry header says `(UTC)` while the
 * overview row carries no label at all, that read as 2:28 AM — contradicting the
 * owner's account of their own trip. The data was correct and the display was not.
 *
 * A UTC instant is the right thing to STORE. It is the wrong thing to show an operator
 * unaided, because they reason in local time and the conversion is not mental
 * arithmetic anyone should be doing while reading a car's history.
 *
 * WHY THE STATE MATTERS, NOT JUST THE OFFSET
 * -----------------------------------------
 * Australia's offsets are not uniform and not all states observe daylight saving:
 *
 *   AEDT (UTC+11)  NSW, VIC, ACT, TAS  — daylight saving
 *   AEST (UTC+10)  QLD                 — no daylight saving, all year
 *   ACDT (UTC+10:30) / ACST  SA        — observes DST, but a half-hour offset
 *   AWST (UTC+8)   WA                  — no daylight saving
 *   ACST (UTC+9:30) NT                 — no daylight saving
 *
 * So a single hardcoded "+11" would be wrong for a Queensland member at any time of
 * year and wrong for a South Australian member by 30 minutes. The zone is derived from
 * the member's state, which is derived from their postcode — and the IANA zone database
 * handles the DST transition itself, so no seasonal logic is written here.
 *
 * NOTHING HERE IS A SOURCE OF TRUTH FOR THE TIME. It is presentation: the stored value
 * stays the UTC instant, and these functions only choose how to show it. A rendering
 * bug therefore cannot corrupt a stored timestamp.
 */

/** Australian states and territories. */
export type AuState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA'

/**
 * Resolve a 4-digit Australian postcode to its state or territory.
 *
 * Ranges follow Australia Post's allocation. The ACT entries are called out because
 * they are the ones that surprise people: the ACT's postcodes are not one contiguous
 * block — they are three, sitting inside the NSW ranges, and 2619 and 2640–2649 are
 * NSW (Queanbeyan and the Albury district) even though they are numerically adjacent
 * to ACT codes. Getting this wrong puts a member in the wrong timezone, so the
 * exception is encoded rather than smoothed over.
 *
 * Returns null for an unmatched value rather than guessing. A caller that cannot
 * resolve a state must show UTC alone, which is correct everywhere, rather than
 * showing a plausible local time for the wrong zone.
 */
export function stateFromPostcode(postcode: string | number | null | undefined): AuState | null {
  if (postcode === null || postcode === undefined) return null
  // Postcodes are stored as text, but leading zeros (NT/ACT `0200`-`0299`) survive a
  // round trip only if the value was written as text — so accept either and pad.
  const raw = String(postcode).trim()
  if (!/^\d+$/.test(raw)) return null
  const pc = Number(raw)
  if (!Number.isFinite(pc) || pc < 0 || pc > 9999) return null

  // Territory and small-jurisdiction ranges first, so the NSW block below cannot
  // swallow them.
  if ((pc >= 200 && pc <= 299) || (pc >= 2600 && pc <= 2618) || (pc >= 2620 && pc <= 2639) || (pc >= 2900 && pc <= 2920)) {
    return 'ACT'
  }
  if ((pc >= 800 && pc <= 899) || (pc >= 900 && pc <= 999)) return 'NT'
  if (pc >= 7000 && pc <= 7999) return 'TAS'

  // The contiguous mainland blocks.
  if (pc >= 1000 && pc <= 2599) return 'NSW'
  if (pc >= 2619 && pc <= 2619) return 'NSW' // Queanbeyan — adjacent to ACT codes
  if (pc >= 2640 && pc <= 2899) return 'NSW'
  if (pc >= 2921 && pc <= 2999) return 'NSW'
  if (pc >= 3000 && pc <= 3999) return 'VIC'
  if (pc >= 4000 && pc <= 4999) return 'QLD'
  if (pc >= 5000 && pc <= 5999) return 'SA'
  if (pc >= 6000 && pc <= 6999) return 'WA'
  if (pc >= 8000 && pc <= 8999) return 'VIC'
  if (pc >= 9000 && pc <= 9999) return 'QLD'

  return null
}

/**
 * IANA timezone for a state.
 *
 * The ACT and the Northern Territory both have their own zone. Deriving ACT from
 * `Australia/Sydney` would also work in practice, but naming the zone explicitly keeps
 * the mapping honest and lets a reader check it against the postal code above.
 */
const STATE_TIME_ZONE: Record<AuState, string> = {
  ACT: 'Australia/Sydney',
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide',
  WA: 'Australia/Perth',
  TAS: 'Australia/Hobart',
  NT: 'Australia/Darwin',
}

/** The IANA zone for a state, or null when the state is unknown. */
export function timeZoneForState(state: AuState | null): string | null {
  return state ? STATE_TIME_ZONE[state] ?? null : null
}

/** Zone for a postcode, resolving the state first. */
export function timeZoneForPostcode(postcode: string | number | null | undefined): string | null {
  return timeZoneForState(stateFromPostcode(postcode))
}

/**
 * Format one instant as a UTC date-time, optionally with a state-local equivalent.
 *
 * Output shape (24-hour, per the owner's instruction):
 *
 *   "2026-10-07 02:28:15 UTC (13:28:15 AEDT)"
 *
 * UTC is ALWAYS shown and always first. The local time is additive, never a
 * replacement — an operator comparing a note from the owner to the dashboard needs one
 * unambiguous reference, and an incident timeline is read in UTC. The local value is
 * what makes it legible.
 *
 * `hourCycle: 'h23'` gives 00–23 with no AM/PM marker. `hour12: false` is the older
 * spelling and is ambiguous for some locales (it can still produce a 12-hour clock with
 * h24 at midnight), so `h23` is used explicitly.
 *
 * An unresolvable zone degrades to UTC with NO local suffix and no "(undefined)". A
 * missing zone must not produce a plausible-looking wrong time.
 */
export function formatDualTime(iso: string | null | undefined, timeZone: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)

  // Slice the ISO string rather than reformatting UTC through Intl: the stored value is
  // already UTC and already ISO-8601, so this is exact and cannot drift with the
  // runtime's locale data.
  const utc = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  if (!timeZone) return `${utc} UTC`

  try {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).formatToParts(date)

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const local = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
    // `timeZoneName: 'short'` yields AEDT/AEST/ACST/ACDT — the abbreviation an Australian
    // reader recognises, and it distinguishes QLD (AEST) from NSW (AEDT) which the
    // numeric offset does not make obvious.
    const zoneName = get('timeZoneName')
    return `${utc} UTC (${local}${zoneName ? ` ${zoneName}` : ''})`
  } catch {
    // An invalid zone identifier is a configuration error, not a reason to drop the
    // timestamp — UTC alone is always correct.
    return `${utc} UTC`
  }
}

/**
 * Two labelled columns for a table header, so the pairing is explicit and neither
 * value can be read as the other.
 *
 * Returned as a pair rather than one combined string because a table needs the UTC
 * value sortable and the local value readable side by side.
 */
export function formatTimeColumns(
  iso: string | null | undefined,
  timeZone: string | null,
): { utc: string; local: string } {
  if (!iso) return { utc: '—', local: '—' }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { utc: String(iso), local: '—' }

  const utc = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  if (!timeZone) return { utc, local: '—' }

  try {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const zoneName = get('timeZoneName')
    return {
      utc,
      local: `${get('hour')}:${get('minute')}:${get('second')}${zoneName ? ` ${zoneName}` : ''}`,
    }
  } catch {
    return { utc, local: '—' }
  }
}

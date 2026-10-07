/**
 * Driver profile derivation (FRS-010 F05).
 *
 * What this produces
 * ------------------
 * Distance travelled and FSD reliance over a reporting window, derived from the
 * fact stream — plus an honest statement of how confident the figure is. This is
 * what an underwriter receives; raw telemetry never leaves.
 *
 * The two rules that do the real work
 * -----------------------------------
 * 1. **Counters reset** (F05-R14). `MilesSinceReset` and
 *    `SelfDrivingMilesSinceReset` both reset on a software update, a computer
 *    replacement or a factory reset. An observer that simply subtracts last from
 *    now will report negative travel at every firmware update, and a *negative*
 *    distance is not a small error — it silently corrupts the average used to
 *    price the risk. A decrease is therefore treated as a reset: the window is
 *    discarded and restarted from the post-reset value. `MilesSinceReset` also
 *    wraps when a vehicle is offline for a long period, which produces the same
 *    signature and the same handling.
 *
 * 2. **FSD is a ratio, never a distance** (F05-R03, F05-R11). There is no
 *    standalone "FSD km" field. The share is
 *    `ΔSelfDrivingMilesSinceReset / ΔMilesSinceReset` over a window in which
 *    neither counter reset. If either is missing — older hardware, firmware
 *    without the signal, or a reset inside the window — the profile reports
 *    `unavailable` and says why. It must never substitute an estimate, because
 *    FSD reliance is the single figure most likely to move a premium.
 *
 * Determinism (F05-R09, N01) is achieved by reading facts in a total order and
 * doing all arithmetic in one pass with no floating-point accumulation across
 * unordered input.
 */

import { newId } from './store'

/**
 * Bumped whenever the arithmetic below changes, so old profiles stay explainable
 * (F05-R12).
 *
 * THE INVARIANT, AND WHY IT IS TRACKED AS A PENDING ITEM
 * -----------------------------------------------------
 * One DERIVATION_VERSION must describe exactly ONE derivation behaviour. A value
 * written into `tesla_driver_profile.derivation_version` and carried into the release
 * package is the only way a profile derived last month can be explained today — so two
 * different behaviours sharing one version makes that impossible, and a bump before the
 * behaviour changes makes the version meaningless.
 *
 * `Trim` is currently MID-MIGRATION into this derivation. The state at the time of
 * writing:
 *
 *   - migration 0013 enables the `Trim` field in the catalog,
 *   - but `tesla_vehicle_snapshot.trim` is still NULL until the next telemetry config
 *     apply asks the vehicle for it,
 *   - so the next payload that arrives changes what `resolveSegment` can produce —
 *     from `Model 3` to `Model 3 Performance` — WITHOUT any change to this file.
 *
 * That is the dangerous case: the arithmetic here is published and consumed, yet an
 * upstream input silently gains a value. If the bump is forgotten, profiles before and
 * after Trim carries "1.0.0" while meaning different things.
 *
 * DECISION (owner-approved, option C): hold the bump and land it WITH the change that
 * alters derivation behaviour — so one version maps to one behaviour rather than bumping
 * ahead of a change that has not happened.
 *
 * THE BUMP HAS NOW HAPPENED, WITH THE CHANGE
 * ------------------------------------------
 * Two things reached the derivation at once **2026-10-07**, so the version moved:
 *
 *   1. `Trim` enters the vehicle segment. Migration 0013 enabled the field; the value
 *      arrives with the next telemetry config apply, after which `resolveSegment` can
 *      return "Model 3 Performance" where it previously returned "Model 3".
 *   2. **The FSD share stopped being computed across mismatched spans.** The two
 *      distance counters are independently change-gated, so they can open at different
 *      instants; `ΔSelfDriving / ΔTotal` was dividing travel over one period by travel
 *      over another and reporting the result as `measured`. That is a fabricated figure
 *      in a client-facing document, and a 180-second interval would have made it
 *      routine rather than rare.
 *
 * Both are behaviour changes, so both are covered by this one bump. Version history:
 *
 *   1.0.0  the original arithmetic
 *   1.1.0  Trim in the segment; FSD share refused when the spans do not align
 */
export const DERIVATION_VERSION = '1.1.0'

/**
 * Derivation-affecting changes that are known, expected, and NOT yet reflected in
 * `DERIVATION_VERSION`.
 *
 * EMPTY, and it should stay empty between releases. A non-empty list is a deliberate,
 * tracked state: it is how a known change is carried without either bumping ahead of it
 * (which makes the version meaningless) or leaving it adrift (which lets two behaviours
 * share one version). The owner's option C was to bundle the bump with the change, and
 * that is what happened on 2026-10-07.
 *
 * Each entry records the version it was declared against so DRIFT can be detected: if a
 * change becomes `effective` while the version still equals `declaredAgainstVersion`, the
 * invariant "one version = one behaviour" has been broken, and
 * `test/derive-version.test.ts` fails.
 */
export interface PendingDerivationChange {
  readonly change: string
  /** True once the input or arithmetic has actually changed behaviour. */
  readonly effective: boolean
  /** The DERIVATION_VERSION in force when this change was declared. */
  readonly declaredAgainstVersion: string
  readonly note: string
}

export const PENDING_DERIVATION_CHANGES: ReadonlyArray<PendingDerivationChange> = []

/** Tesla reports distance in miles; underwriters and members are metric. */
export const MILES_TO_KM = 1.609344

/** F05-R08: below this many usable observations a profile is flagged, not presented as complete. */
export const MIN_SNAPSHOTS_FOR_CONFIDENCE = 3

export interface FactPoint {
  fieldKey: string
  observedAt: string
  /** Numeric value from whichever typed column the fact carried. */
  value: number
}

export interface CounterResetEvent {
  fieldKey: string
  valueBefore: number
  valueAfter: number
  detectedAt: string
}

export interface ProfileMetricNote {
  metric: string
  sourceField: string | null
  sourceFactMin: string | null
  sourceFactMax: string | null
  definition: string
}

export interface DerivedProfile {
  periodStart: string
  periodEnd: string
  odometerKm: number | null
  distanceKm: number | null
  fsdKm: number | null
  fsdPercent: number | null
  fsdAvailability: 'measured' | 'partial' | 'unavailable'
  fsdNote: string | null
  counterResetCount: number
  resets: CounterResetEvent[]
  confidence: number
  lowConfidence: boolean
  snapshotCount: number
  sourceFactMin: string | null
  sourceFactMax: string | null
  notes: ProfileMetricNote[]
}

/**
 * Reduce a fact series to the last observation at or before each instant.
 *
 * Tesla may deliver the same signal more than once within a window (retries and
 * resends are normal), so a window boundary that lands mid-burst would otherwise
 * pair an early reading of one counter with a late reading of the other. Taking
 * the latest reading at each boundary keeps the pair consistent.
 */
function valueAt(points: FactPoint[], atOrBefore: string): number | null {
  let best: FactPoint | null = null
  for (const point of points) {
    if (point.observedAt <= atOrBefore) {
      if (!best || point.observedAt > best.observedAt) best = point
    }
  }
  return best ? best.value : null
}

/**
 * Opening value for a window, WITH the instant it came from.
 *
 * Normally the latest reading at or before the boundary. If collection began
 * *inside* the window there is no such reading — and returning null there would
 * mean a member who connected mid-month can never be given a profile at all.
 * The earliest reading within the window is the correct opening value in that
 * case, and it is why this is separate from `valueAt`.
 *
 * The instant is returned because two counters paired for a ratio must be compared
 * over the SAME span. Without it, `ΔSelfDriving / ΔTotal` can divide travel over one
 * period by travel over another and still be reported as a measured share — see
 * `fsdSpansComparable`.
 */
function windowOpenWithInstant(
  points: FactPoint[],
  periodStart: string,
): { value: number; observedAt: string } | null {
  const atBoundary = valueAtPoint(points, periodStart)
  if (atBoundary) return atBoundary
  const inWindow = points.filter((p) => p.observedAt >= periodStart)
  if (!inWindow.length) return null
  const earliest = inWindow.reduce((e, p) => (p.observedAt < e.observedAt ? p : e))
  return { value: earliest.value, observedAt: earliest.observedAt }
}

/** As `valueAt`, but keeping the winning point so its instant is available. */
function valueAtPoint(points: FactPoint[], atOrBefore: string): FactPoint | null {
  let best: FactPoint | null = null
  for (const point of points) {
    if (point.observedAt <= atOrBefore) {
      if (!best || point.observedAt > best.observedAt) best = point
    }
  }
  return best
}

/** As `windowOpen`, discarding the instant. Retained for callers that only need a value. */
function windowOpen(points: FactPoint[], periodStart: string): number | null {
  return windowOpenWithInstant(points, periodStart)?.value ?? null
}

/** Readings at distinct instants, which is what a delta requires. */
function distinctInstants(points: FactPoint[]): number {
  return new Set(points.map((p) => p.observedAt)).size
}

/**
 * Find counter resets in a series.
 *
 * A decrease is the signature. Equal values are not resets: `Odometer` uses a
 * `minimum_delta`, so repeats of the same value are the expected quiet period.
 */
export function detectResets(fieldKey: string, points: FactPoint[]): CounterResetEvent[] {
  const ordered = [...points].sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  const resets: CounterResetEvent[] = []
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].value < ordered[i - 1].value) {
      resets.push({
        fieldKey,
        valueBefore: ordered[i - 1].value,
        valueAfter: ordered[i].value,
        detectedAt: ordered[i].observedAt,
      })
    }
  }
  return resets
}

/**
 * Derive a profile for one vehicle over one window.
 *
 * Deterministic given the same inputs: single pass, total ordering, no clock
 * reads, no randomness.
 */
export function deriveProfile(options: {
  periodStart: string
  periodEnd: string
  facts: FactPoint[]
}): DerivedProfile {
  const { periodStart, periodEnd } = options

  const inWindow = options.facts
    .filter((f) => f.observedAt >= periodStart && f.observedAt <= periodEnd)
    .sort((a, b) => (a.observedAt === b.observedAt ? a.fieldKey.localeCompare(b.fieldKey) : a.observedAt.localeCompare(b.observedAt)))

  const seriesOf = (key: string) => inWindow.filter((f) => f.fieldKey === key)
  const odometerSeries = seriesOf('Odometer')
  const milesResetSeries = seriesOf('MilesSinceReset')
  const fsdResetSeries = seriesOf('SelfDrivingMilesSinceReset')

  const sourceFactMin = inWindow[0]?.observedAt ?? null
  const sourceFactMax = inWindow[inWindow.length - 1]?.observedAt ?? null

  // --- odometer ----------------------------------------------------------
  const odoFirst = odometerSeries.length ? odometerSeries[0].value : null
  const odoLast = odometerSeries.length ? odometerSeries[odometerSeries.length - 1].value : null
  const odometerKm = odoLast === null ? null : odoLast * MILES_TO_KM

  // --- distance: prefer the since-reset counter, fall back to the odometer --
  //
  // A distance needs two distinct observations. With only one, the first and
  // last readings are the same instant and the delta is 0 — which would be
  // reported to an underwriter as "the vehicle did not move". That is a
  // fabricated claim, not a small error, so an unpaired series yields null.
  let distanceKm: number | null = null
  const milesFirst = windowOpen(milesResetSeries, periodStart)
  const milesLast = valueAt(milesResetSeries, periodEnd)
  const milesResets = detectResets('MilesSinceReset', milesResetSeries)

  if (milesFirst !== null && milesLast !== null && distinctInstants(milesResetSeries) >= 2) {
    distanceKm = milesResets.length === 0
      ? (milesLast - milesFirst) * MILES_TO_KM
      : // A reset inside the window makes the span unknowable; the post-reset
        // value is the only defensible figure and it is labelled partial below.
        milesLast * MILES_TO_KM
  } else if (
    odoFirst !== null &&
    odoLast !== null &&
    odoLast > odoFirst &&
    distinctInstants(odometerSeries) >= 2
  ) {
    distanceKm = (odoLast - odoFirst) * MILES_TO_KM
  }

  // --- FSD ---------------------------------------------------------------
  const fsdFirst = windowOpen(fsdResetSeries, periodStart)
  const fsdLast = valueAt(fsdResetSeries, periodEnd)
  const fsdResets = detectResets('SelfDrivingMilesSinceReset', fsdResetSeries)

  // The OPENING INSTANTS, so the two deltas can be checked for span alignment. Both
  // counters are independently change-gated (minimum_delta = 1 mile each), so they drift
  // apart whenever one moves without the other — and at a 180-second interval that
  // becomes routine rather than rare.
  const milesOpen = windowOpenWithInstant(milesResetSeries, periodStart)
  const fsdOpen = windowOpenWithInstant(fsdResetSeries, periodStart)

  let fsdPercent: number | null = null
  let fsdKm: number | null = null
  let fsdAvailability: DerivedProfile['fsdAvailability'] = 'unavailable'
  let fsdNote: string | null = null

  if (!fsdResetSeries.length) {
    fsdNote =
      'The vehicle did not report Full Self-Driving distance. This is expected on hardware or firmware that does not expose it, and no estimate has been substituted.'
  } else if (milesFirst === null || milesLast === null) {
    fsdNote =
      'Full Self-Driving distance was reported but total distance was not, so a share cannot be computed.'
  } else if (milesResets.length || fsdResets.length) {
    fsdAvailability = 'partial'
    fsdKm = fsdLast === null ? null : fsdLast * MILES_TO_KM
    fsdNote =
      'A distance counter reset inside this window (software update, computer replacement or factory reset). Only travel since the reset is known, so no share is reported for the full window.'
  } else {
    const deltaMiles = milesLast - milesFirst
    const deltaFsd = (fsdLast ?? 0) - (fsdFirst ?? 0)

    // The FSD window must not START LATER than the total-distance window.
    //
    // `windowOpen` deliberately falls back to the earliest in-window reading when no
    // reading exists at the boundary, so a member who connected mid-month still gets a
    // profile. The two counters can therefore open at DIFFERENT instants, and
    // `ΔSelfDriving / ΔTotal` would then divide travel over one period by travel over
    // another — reporting, as `measured`, a share that describes no single window.
    //
    // A LATER FSD start is the unsafe direction: the denominator covers more time than
    // the numerator, so the share is understated and the span difference is unbounded.
    // An EARLIER FSD start is safe in the sense that the numerator's span contains the
    // denominator's, and the counters only ever increase, so the share is an upper
    // bound rather than a misstatement of a different period.
    const fsdStartsAfterTotal =
      fsdOpen !== null && milesOpen !== null && fsdOpen.observedAt > milesOpen.observedAt

    if (deltaMiles > 0 && fsdFirst !== null && fsdLast !== null && !fsdStartsAfterTotal) {
      fsdPercent = deltaFsd / deltaMiles
      fsdKm = deltaFsd * MILES_TO_KM
      fsdAvailability = 'measured'
    } else if (deltaMiles > 0 && fsdStartsAfterTotal) {
      // Refuse the ratio rather than publish one that covers two different periods. The
      // FSD distance since its first observation is still defensible and is reported;
      // only the SHARE — which needs a common denominator — is withheld.
      fsdAvailability = 'partial'
      fsdKm = deltaFsd * MILES_TO_KM
      fsdNote =
        'Full Self-Driving distance and total distance were first observed at different times ' +
        `(${fsdOpen?.observedAt} and ${milesOpen?.observedAt}), so the two cover different periods. ` +
        'A share would compare travel over one span against travel over another, so it is not reported. ' +
        'Full Self-Driving distance since its first observation is given instead.'
    } else if (deltaMiles === 0) {
      fsdAvailability = 'partial'
      fsdNote = 'The vehicle did not move during this window, so Full Self-Driving usage is not meaningful.'
    } else {
      fsdNote = 'Total distance was zero or negative across this window, so no Full Self-Driving share could be derived.'
    }
  }

  // --- resets: persist for audit ------------------------------------------
  const resets = [...milesResets, ...fsdResets].sort((a, b) => a.detectedAt.localeCompare(b.detectedAt))

  // --- confidence (F05-R08, F05 AC4) --------------------------------------
  const snapshotCount = new Set(inWindow.map((f) => f.observedAt)).size
  let confidence = 0
  if (snapshotCount >= MIN_SNAPSHOTS_FOR_CONFIDENCE) confidence += 0.5
  else if (snapshotCount > 0) confidence += 0.15 * snapshotCount
  if (distanceKm !== null) confidence += 0.25
  if (fsdAvailability === 'measured') confidence += 0.25
  else if (fsdAvailability === 'partial') confidence += 0.1
  confidence = Math.round(Math.min(1, confidence) * 100) / 100

  return {
    periodStart,
    periodEnd,
    odometerKm,
    distanceKm,
    fsdKm,
    fsdPercent,
    fsdAvailability,
    fsdNote,
    counterResetCount: resets.length,
    resets,
    confidence,
    lowConfidence: confidence < 0.5 || snapshotCount < MIN_SNAPSHOTS_FOR_CONFIDENCE,
    snapshotCount,
    sourceFactMin,
    sourceFactMax,
    notes: [
      {
        metric: 'distance_km',
        sourceField: milesResets.length ? null : 'MilesSinceReset',
        sourceFactMin,
        sourceFactMax,
        definition: milesResets.length
          ? 'Distance since the most recent counter reset in this window, converted to kilometres.'
          : 'Increase in the vehicle\u2019s distance-since-reset counter across this window, converted to kilometres.',
      },
      {
        metric: 'fsd_percent',
        sourceField: 'SelfDrivingMilesSinceReset',
        sourceFactMin,
        sourceFactMax,
        definition:
          'Proportion of distance driven with Full Self-Driving engaged, as reported by the vehicle. This is a share of the period, not lifetime usage.',
      },
    ],
  }
}

/**
 * Persist a derived profile (F05-R12: the derivation version is stored so a past
 * profile stays reproducible after a formula change).
 */
export async function saveProfile(
  db: D1Database,
  options: {
    memberId: string
    vin: string
    profile: DerivedProfile
    nowIso: string
  },
): Promise<string> {
  const { profile } = options
  const profileId = newId()

  await db
    .prepare(
      `INSERT INTO tesla_driver_profile
         (profile_id, member_id, vin, period_start, period_end,
          odometer_km, distance_km, fsd_km, fsd_availability, fsd_note,
          counter_reset_count, derivation_version, source_fact_min, source_fact_max, derived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      profileId,
      options.memberId,
      options.vin,
      profile.periodStart,
      profile.periodEnd,
      profile.odometerKm,
      profile.distanceKm,
      profile.fsdKm,
      profile.fsdAvailability,
      profile.fsdNote,
      profile.counterResetCount,
      DERIVATION_VERSION,
      profile.sourceFactMin,
      profile.sourceFactMax,
      options.nowIso,
    )
    .run()

  // F05-R14: record the resets themselves so a discontinuity is explainable
  // rather than visible only as an unexplained gap in the series.
  if (profile.resets.length) {
    await db.batch(
      profile.resets.map((reset) =>
        db
          .prepare(
            `INSERT INTO tesla_counter_reset
               (reset_id, vin, field_key, value_before, value_after, detected_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(newId(), options.vin, reset.fieldKey, reset.valueBefore, reset.valueAfter, reset.detectedAt),
      ),
    )
  }

  return profileId
}

/**
 * Read the facts a derivation needs for one vehicle and window (F05-R10: every
 * metric traces to a stored fact range, so this returns the ordered points
 * themselves rather than aggregates).
 */
export async function loadFacts(
  db: D1Database,
  options: { vin: string; from: string; to: string; fieldKeys: string[] },
): Promise<FactPoint[]> {
  const placeholders = options.fieldKeys.map(() => '?').join(',')
  const rows = await db
    .prepare(
      `SELECT field_key, observed_at,
              COALESCE(value_real, CAST(value_int AS REAL)) AS value
         FROM tesla_telemetry_fact
        WHERE vin = ?
          AND field_key IN (${placeholders})
          AND observed_at >= ?
          AND observed_at <= ?
          AND value_kind IN ('real','int')
        ORDER BY observed_at ASC`,
    )
    .bind(options.vin, ...options.fieldKeys, options.from, options.to)
    .all<{ field_key: string; observed_at: string; value: number }>()

  return (rows.results ?? []).map((row) => ({
    fieldKey: row.field_key,
    observedAt: row.observed_at,
    value: row.value,
  }))
}

/** The fields a profile is derived from — the consented subset (F04-R01a). */
export const DERIVATION_FIELDS = ['Odometer', 'MilesSinceReset', 'SelfDrivingMilesSinceReset'] as const

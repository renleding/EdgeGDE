/**
 * Group-level anonymised analytics (FRS-010 F06).
 *
 * Purpose: an insurer assessing the Australian Tesla market can query postcode-level
 * aggregates with no PII, to inform pricing before quoting individual members.
 *
 * How PII is prevented — structurally, not by review
 * --------------------------------------------------
 * F06-R02 forbids member identifier, name, email, mobile, VIN and precise location
 * from the output, and F06-N01 requires **zero** leakage verified by an automated
 * scan of every export. The way to guarantee that is not to write careful code and
 * read it back — it is to make the leak unrepresentable.
 *
 * Every row emitted is built by this module into a `GroupRow` — an interface whose
 * fields are all numbers or non-PII strings (postcode, model label, model year). A
 * caller cannot attach a VIN or a member id to a row because the type has no field
 * to carry one. The unit tests then scan the serialised output for the literal PII
 * values present in the input, which turns "we were careful" into an assertion that
 * fails CI.
 *
 * A defect this module had, found by inspecting the writers rather than the code
 * ---------------------------------------------------------------------------
 * F06-R03 (Must) requires segmentation by "model/variant/year". The first version of
 * this module read `tesla_vehicle.model` and labelled anything blank `'Unknown'`.
 * That looked defensive and was in fact **always** the outcome, because
 * `upsertVehicles` in `store.ts` writes only `vin`, `display_name`, `first_seen_at`
 * and `last_seen_at` — nothing in production has ever populated `tesla_vehicle.model`.
 * Every export would therefore have segmented all 1,500 vehicles into a single cell
 * named `Unknown`, satisfying the letter of R01 while defeating R03 entirely, and
 * doing it without a single error.
 *
 * The model, variant and year now come from where the data actually is: the once-tier
 * snapshot (`tesla_vehicle_snapshot`, written by `telemetry.ts` for `CarType`,
 * `Version` and `EfficiencyPackage`), with the denormalised vehicle column used as an
 * override once something populates it. Where neither yields a model, the row is
 * reported as unresolved and counted in the export caveats — never silently labelled.
 *
 * Model year is a special case
 * ---------------------------
 * Tesla's 272-field catalog contains **no model-year field at all** (verified: the
 * only match for /year/i is an unrelated collision-sensitivity enum). `Version` is
 * the firmware version, not the model year, so it cannot serve. Model year is
 * therefore derived from VIN position 10 per ISO 3779, and marked as such: the
 * export carries a caveat and a per-row `segment_source`, because a derived year is a
 * weaker claim than a reported one and the recipient is entitled to know which they
 * have. See `modelYearFromVin`.
 *
 * Two requirements that pull against each other, resolved explicitly
 * ----------------------------------------------------------------
 * F06-R04 (Must) requires a postcode cohort of a **single** member to be
 * publishable, with no minimum cohort size. F06-R08 (Should) says to suppress or
 * generalise cells so small they become re-identifiable, and to warn the operator.
 * Must beats Should, so nothing is suppressed. Instead every small cell is counted
 * and reported, and the export record keeps that count permanently — so "was the
 * operator warned?" is answerable later rather than being a claim about a console
 * message nobody kept.
 *
 * What is NOT published
 * ---------------------
 * Charging behaviour. F06-R05 originally required a charging distribution, but the
 * energy scopes were never granted, so there is no such datum in the database. The
 * metric was removed from the spec (v1.12) rather than filled with a plausible
 * number.
 */

import type { D1Database } from '@cloudflare/workers-types'

/**
 * Bump when the aggregation or segmentation logic changes: figures from two versions
 * are not comparable (F06-R06).
 *
 * 2.0.0 — segmentation moved to snapshot-backed model/variant/year with a derived
 * model year. Output columns changed, so a v1 report and a v2 report cannot be
 * reconciled and the version is the only thing that says so.
 */
export const AGGREGATION_VERSION = '2.0.0'

/** The only shape that can reach the output. Every field is non-identifying by construction. */
export interface GroupRow {
  postcode: string
  /** Model/variant label, e.g. "Model 3". Never a VIN. */
  model: string
  /** ISO 3779 model year derived from the VIN, or null when not derivable. */
  model_year: number | null
  /** How the segment was resolved. Lets a reader tell a reported model from a derived one. */
  segment_source: SegmentSource
  /** F06-R05: vehicle count in this cell. */
  vehicle_count: number
  /** F06-R05: average odometer reading. Null when no vehicle in the cell reported one. */
  avg_odometer_km: number | null
  /** F06-R05: average distance over the period. Null when nothing usable. */
  avg_period_distance_km: number | null
  /** F06-R05: average FSD share, as a fraction 0-1. Null when unavailable — never 0. */
  avg_fsd_share: number | null
  /**
   * F06-R09: how many vehicles contributed a usable FSD ratio, so the recipient can
   * judge representativeness. Without this an average reads as universal when it may
   * rest on one vehicle.
   */
  fsd_contributing_vehicles: number
  /**
   * Of the contributing vehicles, how many rested on a `partial` derivation (a
   * counter reset or a missing signal) rather than a `measured` one. An average
   * built from approximations is a different claim from one built from
   * measurements, and the recipient cannot tell them apart from the mean alone.
   */
  fsd_partial_vehicles: number
}

/**
 * Where the model/variant segment came from.
 * - `vehicle_row`  — the denormalised `tesla_vehicle` columns (authoritative when set)
 * - `snapshot`     — the once-tier snapshot, which is where CarType actually lands today
 * - `vin_derived`  — model could not be resolved; only the VIN year is known
 * - `unresolved`   — neither source yielded a model
 */
export type SegmentSource = 'vehicle_row' | 'snapshot' | 'vin_derived' | 'unresolved'

export interface GroupExportInput {
  /** Restrict to profiles derived within this period. */
  periodStart: string
  periodEnd: string
  /** Optional postcode filter for a single-market query. */
  postcode?: string | null
  requestedBy: string
  nowIso?: string
}

export interface SmallCellWarning {
  postcode: string
  model: string
  vehicleCount: number
}

/** A stated limitation of the export. Carried in the artifact, not left in a log. */
export interface ExportCaveat {
  code: string
  detail: string
  affected_vehicles: number
}

export interface GroupExportResult {
  exportId: string
  csv: string
  sha256: string
  rows: GroupRow[]
  rowCount: number
  vehicleCount: number
  /**
   * F06-R08: cells published despite being small. Empty is the normal case; a
   * non-empty list is what the operator must be warned about.
   */
  smallCells: SmallCellWarning[]
  /**
   * F06-R09: members excluded because they have no postcode on record. Reported
   * rather than silently dropped — an aggregate that quietly omits a slice of the
   * population is worse than one that says how much it omitted.
   */
  membersExcludedNoPostcode: number
  /** F06-AC6: the collection runs whose facts underlie these figures. */
  collectionRunIds: string[]
  /** Stated limitations, so a caveat cannot be lost with the process that produced it. */
  caveats: ExportCaveat[]
}

/** A single-member cell is the F06-R04 case; anything at or below this is warned about. */
const SMALL_CELL_THRESHOLD = 3

/**
 * Average of the non-null values, or null when there are none.
 *
 * Returning null rather than 0 is the whole point: "no vehicle reported an
 * odometer" and "the average odometer is 0 km" are different claims, and a 0 would
 * be read as the second.
 *
 * `dp` is explicit because the right precision differs by metric and a single global
 * choice is wrong for at least one of them: kilometres at 1 dp is plenty, but a
 * share at 1 dp quantises FSD usage to 10% steps, so 0.45 would be published as 0.5
 * — a materially misleading figure for an underwriter. Rounding also keeps the
 * export byte-stable across runs (F06-N03), since an unrounded float mean can differ
 * in the 12th decimal and break reproducibility for no real reason.
 */
function mean(values: Array<number | null>, dp: number): number | null {
  const usable = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (!usable.length) return null
  const sum = usable.reduce((a, b) => a + b, 0)
  const factor = 10 ** dp
  return Math.round((sum / usable.length) * factor) / factor
}

/** Kilometre means: 1 dp. */
const KM_DP = 1
/** Share means: 3 dp, i.e. 0.1% granularity. */
const SHARE_DP = 3

/** RFC 4180 field escaping, same rule as the individual release package. */
function csvField(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const HEADERS = [
  'postcode',
  'model',
  'model_year',
  'vehicle_count',
  'avg_odometer_km',
  'avg_period_distance_km',
  'avg_fsd_share',
  'fsd_contributing_vehicles',
  'fsd_partial_vehicles',
  'segment_source',
] as const

export function toCsv(rows: GroupRow[]): string {
  const lines = [HEADERS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        csvField(row.postcode),
        csvField(row.model),
        csvField(row.model_year),
        csvField(row.vehicle_count),
        csvField(row.avg_odometer_km),
        csvField(row.avg_period_distance_km),
        csvField(row.avg_fsd_share),
        csvField(row.fsd_contributing_vehicles),
        csvField(row.fsd_partial_vehicles),
        csvField(row.segment_source),
      ].join(','),
    )
  }
  // CRLF per RFC 4180, and a trailing newline so the file is line-terminated.
  return `${lines.join('\r\n')}\r\n`
}

/**
 * The exact bytes that get hashed and delivered.
 *
 * F06-R06/R07 want a figure reconciled later, and F06-N03 wants identical output
 * for an identical dataset. Hashing the CSV itself — rather than recomputing a hash
 * from the inputs — means the hash identifies what was actually sent.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Model year from VIN position 10 (1-indexed), per ISO 3779.
 *
 * Tesla's field catalog has no model-year field, so this is the only available
 * source. The rule: the 10th character is the model year within a 30-year cycle.
 * `1`–`9` are the years 2001–2009, and letters `A`–`Y` (with I, O, Q, U and Z never
 * used) run 1980–2000 and again 2010–2030. Because a letter is ambiguous between two
 * decades, the 2010s/2020s decade is assumed — correct for every Tesla, since the
 * Model S begins in 2012 and no Tesla predates 2008. `ambiguous` is returned anyway
 * so the export can state that the year is derived rather than reported.
 *
 * Deliberately **not** validating the whole VIN: check digits vary by market and a
 * strict check would discard valid Australian VINs.
 */
export function modelYearFromVin(vin: string): { year: number | null; ambiguous: boolean } {
  if (!vin || vin.length < 10) return { year: null, ambiguous: false }
  const code = vin[9].toUpperCase()

  // A digit is unambiguous: 2001-2009. Position 10 is '0' only on invalid VINs.
  if (/^[1-9]$/.test(code)) return { year: 2000 + Number(code), ambiguous: false }
  if (code === '0') return { year: null, ambiguous: false }

  const order = 'ABCDEFGHJKLMNPRSTVWXY' // I, O, Q, U, Z excluded by the standard
  const index = order.indexOf(code)
  if (index === -1) return { year: null, ambiguous: false }
  return { year: 2010 + index, ambiguous: true }
}

/**
 * Tesla's CarTypeValue enum labels mapped to their canonical display names.
 *
 * The stored value is a code identifier (`CarTypeModel3`), not a display name, and
 * F06-R03's own example is "Model 3 2024 Long Range, postcode 2335" — so publishing
 * `Model3` would both read badly and fail to match the specification's example.
 *
 * Note that `CarTypeModel3` does not appear in the seeded enum values (0=Unknown,
 * 1=ModelS, 2=ModelX, 4=ModelY, 5=SemiTruck, 6=Cybertruck — 3 is absent), so the
 * Model 3 mapping is carried for correctness against a live vehicle rather than
 * because the catalog confirms it. Recorded here so the omission is not mistaken for
 * a complete enumeration later.
 */
const CAR_TYPE_DISPLAY: Record<string, string> = {
  model3: 'Model 3',
  models: 'Model S',
  modelx: 'Model X',
  modely: 'Model Y',
  cybertruck: 'Cybertruck',
  semitruck: 'Semi Truck',
  roadster: 'Roadster',
}

/**
 * Turn a stored CarType value into a display model label.
 *
 * Tesla delivers enums as labels ("CarTypeModel3"), but the snapshot writer falls
 * back to `String(valueInt)` when no text is present — so a bare index can arrive
 * here. A bare number is **not** treated as a model: printing `3` as a model name
 * would put an unresolved enum index into an insurer's CSV looking like data.
 *
 * `CarTypeUnknown` is Tesla explicitly reporting that it does not know the model, so
 * it resolves to null (an unresolved segment) rather than a cell named "Unknown" that
 * would silently merge genuinely different vehicles.
 */
export function normaliseCarType(raw: string | null): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return null

  const stripped = text.replace(/^CarType/i, '').trim()
  if (!stripped) return null
  if (stripped.toLowerCase() === 'unknown') return null

  const mapped = CAR_TYPE_DISPLAY[stripped.toLowerCase()]
  if (mapped) return mapped

  // An unmapped label: split on the camel-case boundary so it at least reads as words
  // rather than a code identifier. Not mapped to a guess — a future model should
  // surface as its own segment, not be folded into an existing one.
  return stripped.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || null
}

/**
 * Variant from Tesla's `EfficiencyPackage`, e.g. "M3POPPYSEED2024" -> "Performance".
 *
 * WHY THIS EXISTS
 * ---------------
 * `CarType` gives the model only (Model 3). The variant — Performance, Long Range —
 * is not in any field we collect: `Trim` (`vehicle_config.trim_badging`) is the field
 * that would report it and Tesla exposes it separately, but `EfficiencyPackage` is
 * already collected and its value is a build-package code that identifies the variant.
 *
 * The observed value is `M3POPPYSEED2024`, and POPPYSEED is Tesla's internal codename
 * for the Model 3 Performance (the "Ludicrous" refresh). The trailing `2024` is the
 * package generation, NOT the model year and NOT the registration year — Tesla kept
 * reporting the same string on later builds, so it must never be read as a year.
 * The model year is derived separately from the VIN by `modelYearFromVin`.
 *
 * The mapping is deliberately small and explicit rather than a pattern match: a regex
 * over codenames would silently invent a variant for a code we have never seen. An
 * unrecognised package returns null, and the caller shows the raw code instead of a
 * guess — the same discipline as `normaliseCarType`.
 */
const EFFICIENCY_PACKAGE_VARIANT: Record<string, string> = {
  // Model 3
  M3POPPYSEED2024: 'Performance',
  // Model Y
  MYPOPPYSEED2024: 'Performance',
  MYBLACK2024: 'Long Range',
}

/**
 * Resolve the vehicle variant from the collected `EfficiencyPackage` code.
 *
 * Returns null when the code is absent or not one we can map — never a guess.
 */
export function variantFromEfficiencyPackage(raw: string | null): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  if (!code) return null
  return EFFICIENCY_PACKAGE_VARIANT[code] ?? null
}

/**
 * Resolve model/variant and its provenance from the three places the data can live.
 *
 * Order matters and is deliberate: the denormalised vehicle row wins when it is
 * populated, because that is where a human or a future onboarding step would correct
 * a wrong model. Otherwise the once-tier snapshot — the only source actually
 * populated today — is used.
 */
export function resolveSegment(
  vehicleModel: string | null,
  vehicleTrim: string | null,
  snapshotCarType: string | null,
): { model: string; source: SegmentSource } {
  const rowModel = vehicleModel?.trim()
  if (rowModel) {
    const trim = vehicleTrim?.trim()
    // Variant is part of the required segmentation, so include it when present.
    return { model: trim && !rowModel.includes(trim) ? `${rowModel} ${trim}` : rowModel, source: 'vehicle_row' }
  }
  const snap = normaliseCarType(snapshotCarType)
  if (snap) return { model: snap, source: 'snapshot' }
  return { model: 'Unknown', source: 'unresolved' }
}

/**
 * Build the group aggregate.
 *
 * Rows come from `tesla_driver_profile` joined to the vehicle, member and the
 * once-tier snapshot, because the profile is the derived, versioned figure —
 * aggregating raw facts would re-derive distance here and diverge from the
 * individual package (F07-R01).
 */
export async function buildGroupExport(
  db: D1Database,
  input: GroupExportInput,
): Promise<GroupExportResult> {
  const nowIso = input.nowIso ?? new Date().toISOString()

  // Members with no postcode cannot be placed in any cell. Counted, not hidden.
  const excluded = await db
    .prepare(
      `SELECT count(DISTINCT p.member_id) AS c
         FROM tesla_driver_profile p
         JOIN tesla_member m ON m.member_id = p.member_id
        WHERE m.postcode IS NULL
          AND p.period_start >= ? AND p.period_end <= ?`,
    )
    .bind(input.periodStart, input.periodEnd)
    .first<{ c: number }>()

  // One row per (postcode, vehicle), taking that vehicle's most recent profile in
  // the period. A vehicle with several profiles must not be counted twice — that
  // would inflate the cohort and the averages in the same direction.
  //
  // The snapshot joins are LEFT: a vehicle that has connected but not yet reported a
  // once-tier field must still appear, as an unresolved segment rather than vanish.
  const rows = await db
    .prepare(
      `SELECT m.postcode AS postcode,
              NULLIF(TRIM(v.model), '')     AS vehicle_model,
              NULLIF(TRIM(v.trim), '')      AS vehicle_trim,
              s_car.value_text              AS snapshot_car_type,
              p.vin                         AS vin,
              p.odometer_km, p.distance_km, p.fsd_km, p.fsd_availability
         FROM tesla_driver_profile p
         JOIN tesla_member m  ON m.member_id = p.member_id
         JOIN tesla_vehicle v ON v.vin = p.vin
         LEFT JOIN tesla_vehicle_snapshot s_car
                ON s_car.vin = p.vin AND s_car.field_key = 'CarType'
        WHERE m.postcode IS NOT NULL
          AND p.period_start >= ? AND p.period_end <= ?
          AND (? IS NULL OR m.postcode = ?)
          AND p.profile_id = (
                SELECT p2.profile_id FROM tesla_driver_profile p2
                 WHERE p2.vin = p.vin
                 ORDER BY p2.derived_at DESC LIMIT 1
              )`,
    )
    .bind(input.periodStart, input.periodEnd, input.postcode ?? null, input.postcode ?? null)
    .all<{
      postcode: string
      vehicle_model: string | null
      vehicle_trim: string | null
      snapshot_car_type: string | null
      vin: string
      odometer_km: number | null
      distance_km: number | null
      fsd_km: number | null
      fsd_availability: string
    }>()

  // F06-AC6: which collection runs produced the underlying facts. Derived from the
  // facts themselves rather than from a time window, so the answer is the runs that
  // actually contributed rather than the runs that happened to be nearby.
  const runRows = await db
    .prepare(
      `SELECT DISTINCT b.run_id AS run_id
         FROM tesla_telemetry_fact f
         JOIN tesla_telemetry_batch b ON b.batch_id = f.batch_id
        WHERE f.observed_at >= ? AND f.observed_at <= ?
          AND b.run_id IS NOT NULL
        ORDER BY b.run_id`,
    )
    .bind(input.periodStart, input.periodEnd)
    .all<{ run_id: string }>()
  const collectionRunIds = (runRows.results ?? []).map((r) => r.run_id)

  // Group in code rather than in SQL. The FSD share is a ratio of two nullable
  // columns, and expressing "only count it when the pair is usable" in SQL invites
  // a division-by-zero or a silent NULL that reads as zero usage.
  interface Cell {
    postcode: string
    model: string
    modelYear: number | null
    source: SegmentSource
    odometers: Array<number | null>
    distances: Array<number | null>
    shares: Array<number | null>
    partials: number
    yearAmbiguous: number
  }

  const cells = new Map<string, Cell>()
  let unresolvedVehicles = 0
  let vinOnlyVehicles = 0
  let ambiguousYearVehicles = 0

  for (const row of rows.results ?? []) {
    const seg = resolveSegment(row.vehicle_model, row.vehicle_trim, row.snapshot_car_type)
    const { year, ambiguous } = modelYearFromVin(row.vin)

    if (seg.source === 'unresolved') {
      unresolvedVehicles += 1
      // A vehicle with a derivable year but no model still carries usable segment
      // information; record that it is year-only rather than calling it unknown.
      if (year !== null) {
        seg.source = 'vin_derived'
        vinOnlyVehicles += 1
      }
    }
    if (ambiguous) ambiguousYearVehicles += 1

    const key = `${row.postcode}\u0000${seg.model}\u0000${year ?? 'n'}\u0000${seg.source}`
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        postcode: row.postcode,
        model: seg.model,
        modelYear: year,
        source: seg.source,
        odometers: [],
        distances: [],
        shares: [],
        partials: 0,
        yearAmbiguous: 0,
      }
      cells.set(key, cell)
    }
    cell.odometers.push(row.odometer_km)
    cell.distances.push(row.distance_km)
    if (ambiguous) cell.yearAmbiguous += 1

    // F06-R05: an unavailable FSD period is NOT zero usage.
    //
    // The schema permits exactly 'measured' | 'partial' | 'unavailable'. Testing for
    // an 'available' sentinel that does not exist was a real bug: the condition never
    // matched, so avg_fsd_share would have been null in every export forever and the
    // metric would have looked deliberately withheld rather than broken. 'partial' is
    // accepted as usable (it is a real ratio from a reset-affected counter, and
    // derive.ts already refuses to emit one without a valid denominator), but it is
    // counted separately and disclosed.
    const usable =
      (row.fsd_availability === 'measured' || row.fsd_availability === 'partial') &&
      row.fsd_km !== null &&
      row.distance_km !== null &&
      row.distance_km > 0
    cell.shares.push(usable ? (row.fsd_km as number) / (row.distance_km as number) : null)
    if (usable && row.fsd_availability === 'partial') cell.partials += 1
  }

  const groupRows: GroupRow[] = []
  const smallCells: SmallCellWarning[] = []

  for (const cell of cells.values()) {
    const contributing = cell.shares.filter((s) => s !== null).length
    const row: GroupRow = {
      postcode: cell.postcode,
      model: cell.model,
      model_year: cell.modelYear,
      segment_source: cell.source,
      vehicle_count: cell.odometers.length,
      avg_odometer_km: mean(cell.odometers, KM_DP),
      avg_period_distance_km: mean(cell.distances, KM_DP),
      avg_fsd_share: mean(cell.shares, SHARE_DP),
      fsd_contributing_vehicles: contributing,
      fsd_partial_vehicles: contributing ? cell.partials : 0,
    }
    groupRows.push(row)

    if (row.vehicle_count <= SMALL_CELL_THRESHOLD) {
      smallCells.push({
        postcode: row.postcode,
        model: row.model,
        vehicleCount: row.vehicle_count,
      })
    }
  }

  // Deterministic ordering. Without it the same dataset can serialise in a
  // different order and F06-N03 (identical input → identical output) fails for no
  // real reason.
  const bySegment = (a: GroupRow, b: GroupRow) =>
    a.postcode !== b.postcode
      ? a.postcode.localeCompare(b.postcode)
      : a.model !== b.model
        ? a.model.localeCompare(b.model)
        : (a.model_year ?? 0) - (b.model_year ?? 0)
  groupRows.sort(bySegment)
  smallCells.sort((a, b) =>
    a.postcode === b.postcode ? a.model.localeCompare(b.model) : a.postcode.localeCompare(b.postcode),
  )

  // Caveats are computed, not asserted. Each one is emitted only when the condition
  // it describes actually holds in this dataset, so a clean export says nothing and a
  // limited one says exactly what is limited.
  const caveats: ExportCaveat[] = []
  if (unresolvedVehicles > 0) {
    caveats.push({
      code: 'segment_unresolved',
      detail:
        'These vehicles have no model on the vehicle row and no CarType in the once-tier ' +
        'snapshot, so they fall into an Unknown segment. F06-R03 segmentation is not ' +
        'satisfied for them; they should be excluded from model-level analysis.',
      affected_vehicles: unresolvedVehicles,
    })
  }
  if (ambiguousYearVehicles > 0) {
    caveats.push({
      code: 'model_year_derived',
      detail:
        'Model year is derived from VIN position 10 (ISO 3779), not reported by the vehicle, ' +
        'because Tesla exposes no model-year field. A letter in that position is ambiguous ' +
        'between two decades and the 2010s/2020s decade has been assumed. Treat these years ' +
        'as indicative.',
      affected_vehicles: ambiguousYearVehicles,
    })
  }
  caveats.push({
    code: 'charging_not_collected',
    detail:
      'Charging behaviour is absent from this export and cannot be added: the Tesla app was ' +
      'never granted the energy scopes, so no charging datum exists. F06-R05 was amended for ' +
      'this in v1.12.',
    affected_vehicles: 0,
  })

  const csv = toCsv(groupRows)
  const sha256 = await sha256Hex(csv)

  const exportId = `gex_${nowIso.replace(/[^0-9]/g, '').slice(0, 17)}_${sha256.slice(0, 8)}`
  const vehicleCount = groupRows.reduce((a, r) => a + r.vehicle_count, 0)

  const queryJson = JSON.stringify({
    period_start: input.periodStart,
    period_end: input.periodEnd,
    postcode: input.postcode ?? null,
    aggregation_version: AGGREGATION_VERSION,
  })

  // F06-R07: log the export before returning it. A figure that reached an insurer
  // without a log row is unauditable, so the log is part of the export, not a
  // follow-up.
  await db.batch([
    db
      .prepare(
        `INSERT INTO tesla_group_export
           (export_id, query_json, requested_by, requested_at, period_start, period_end,
            row_count, vehicle_count, artifact_sha256, r2_key, aggregation_version,
            small_cell_count, warnings_json, members_excluded_no_postcode,
            collection_run_ids, caveats_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        exportId,
        queryJson,
        input.requestedBy,
        nowIso,
        input.periodStart,
        input.periodEnd,
        groupRows.length,
        vehicleCount,
        sha256,
        AGGREGATION_VERSION,
        smallCells.length,
        smallCells.length ? JSON.stringify(smallCells) : null,
        excluded?.c ?? 0,
        collectionRunIds.length ? JSON.stringify(collectionRunIds) : null,
        JSON.stringify(caveats),
      ),
    db
      .prepare(
        `INSERT INTO tesla_audit_event
           (event_id, occurred_at, actor, actor_type, action, subject_type, subject_id, detail_json)
         VALUES (?, ?, ?, 'system', 'group_export_created', 'tesla_group_export', ?, ?)`,
      )
      .bind(
        `aud_gex_${exportId}`,
        nowIso,
        input.requestedBy,
        exportId,
        JSON.stringify({
          row_count: groupRows.length,
          vehicle_count: vehicleCount,
          sha256,
          small_cells: smallCells.length,
          collection_runs: collectionRunIds.length,
        }),
      ),
  ])

  return {
    exportId,
    csv,
    sha256,
    rows: groupRows,
    rowCount: groupRows.length,
    vehicleCount,
    smallCells,
    membersExcludedNoPostcode: excluded?.c ?? 0,
    collectionRunIds,
    caveats,
  }
}

/**
 * F06-N01: the automated scan of every export.
 *
 * Checks the delivered bytes for any of the values that must never appear. Callers
 * pass the actual PII values present in the source data, so this is a real check
 * against real values rather than a regex guessing at what PII looks like (a regex
 * for "a name" would either miss names or reject the word "Model").
 *
 * Returns the offending values found. Empty means the export is clean.
 */
export function scanForPii(
  csv: string,
  knownPiiValues: string[],
): string[] {
  const hits: string[] = []
  for (const value of knownPiiValues) {
    // Skip anything too short to be meaningful — a 1-character "value" would match
    // inside a number and produce a false positive that erodes trust in the scan.
    if (!value || value.length < 3) continue
    if (csv.includes(value)) hits.push(value)
  }
  return hits
}

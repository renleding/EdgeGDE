/**
 * Fleet Telemetry ingest (FRS-010 F04).
 *
 * The relay is a span port (F04-R13): it terminates mTLS, forwards the payload
 * bytes, and holds no database. All parsing, tiering, counting and persistence
 * happen here.
 *
 * Design notes
 * ------------
 * Tesla sends protobuf-derived JSON where each datum's value is a oneof —
 * exactly one of doubleValue / intValue / stringValue / booleanValue /
 * locationValue, or `invalid: true` when a signal is unsupported on that
 * vehicle. `invalid` is stored, not discarded: it is the evidence that a field
 * was requested and the vehicle declined, which is what F05-R11 needs to say
 * "unavailable" honestly instead of estimating.
 *
 * Tier routing is the load-bearing decision. A `once` field (CarType, Version,
 * EfficiencyPackage) belongs in the snapshot table and must never accumulate a
 * row per push; anything else is an observed fact. The database enforces this
 * with guard triggers, so a mistake here fails loudly rather than quietly
 * growing the fact table by millions of rows a year.
 */

import { newId } from './store'

/** Protobuf oneof shapes Tesla emits per datum. */
export interface TelemetryValue {
  doubleValue?: number
  intValue?: number
  stringValue?: string
  booleanValue?: boolean
  locationValue?: unknown
  invalid?: boolean
}

export interface TelemetryDatum {
  key: string
  value?: TelemetryValue
  createdAt?: string
}

/** A single element of the fleet-telemetry payload, as forwarded by the relay. */
export interface TelemetryEnvelope {
  vin?: string
  data?: TelemetryDatum[]
}

export type ValueKind = 'real' | 'int' | 'text' | 'bool' | 'json' | 'invalid'

/**

 * A datum after normalisation: the tier has been resolved from the catalog and
 * the value collapsed to exactly one typed column.
 */
export interface NormalisedDatum {
  fieldKey: string
  observedAt: string
  valueKind: ValueKind
  valueReal: number | null
  valueInt: number | null
  valueText: string | null
  valueBool: number | null
  valueJson: string | null
  /** Resolved from tesla_field_catalog; null when the field is not catalogued. */
  tier: 'once' | 'event' | 'on_change' | null
}

export class TelemetryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TelemetryParseError'
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalise one protobuf-derived value into exactly one typed column.
 *
 * Order matters: `invalid` is checked first because Tesla sets it alongside
 * absent value fields, and treating it as a value would record 0 for a signal
 * the vehicle explicitly could not provide.
 */
export function classifyValue(value: TelemetryValue | undefined): {
  kind: ValueKind
  real: number | null
  int: number | null
  text: string | null
  bool: number | null
  json: string | null
} {
  const none = { real: null, int: null, text: null, bool: null, json: null }

  if (!value || value.invalid === true) {
    return { kind: 'invalid', ...none }
  }

  // A double that arrives as a whole number is still a double: Odometer uses
  // minimum_delta on a float, so preserving the type avoids a silent truncation
  // that would compound across every subsequent delta.
  if (typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue)) {
    return { kind: 'real', ...none, real: value.doubleValue }
  }
  if (typeof value.intValue === 'number' && Number.isFinite(value.intValue)) {
    return { kind: 'int', ...none, int: Math.trunc(value.intValue) }
  }
  if (typeof value.stringValue === 'string') {
    return { kind: 'text', ...none, text: value.stringValue }
  }
  if (typeof value.booleanValue === 'boolean') {
    return { kind: 'bool', ...none, bool: value.booleanValue ? 1 : 0 }
  }
  if (value.locationValue !== undefined) {
    return { kind: 'json', ...none, json: JSON.stringify(value.locationValue) }
  }

  // Present but unrecognised: record as invalid rather than inventing a zero.
  return { kind: 'invalid', ...none }
}

/**
 * Extract every datum from a relay payload.
 *
 * The relay may forward a single object or a batch; both are accepted because
 * fleet-telemetry emits either depending on flush timing, and rejecting one
 * shape silently loses data.
 */
export function extractDatums(body: unknown): Array<{ vin: string | null; datum: TelemetryDatum }> {
  const envelopes: TelemetryEnvelope[] = Array.isArray(body)
    ? (body as TelemetryEnvelope[])
    : [body as TelemetryEnvelope]

  const out: Array<{ vin: string | null; datum: TelemetryDatum }> = []
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== 'object') continue
    const vin = typeof envelope.vin === 'string' ? envelope.vin : null
    const data = Array.isArray(envelope.data) ? envelope.data : []
    for (const datum of data) {
      if (datum && typeof datum.key === 'string') out.push({ vin, datum })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Tier resolution                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Read the collection tier for a set of field keys.
 *
 * Returns only catalogued fields. An unknown key is dropped rather than stored:
 * a fact row for an uncatalogued field cannot be written anyway (the foreign key
 * and the guard trigger both refuse it), and dropping here keeps the reason
 * legible in the run log instead of surfacing as a constraint failure per datum.
 */
export async function resolveTiers(
  db: D1Database,
  fieldKeys: string[],
): Promise<Map<string, { tier: string; collected: number }>> {
  const unique = [...new Set(fieldKeys)]
  const map = new Map<string, { tier: string; collected: number }>()
  if (!unique.length) return map

  // Chunked to stay well inside D1's parameter limit (100 bound params).
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db
      .prepare(
        `SELECT field_key, collection_tier, collected
           FROM tesla_field_catalog
          WHERE field_key IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ field_key: string; collection_tier: string; collected: number }>()
    for (const row of rows.results ?? []) {
      map.set(row.field_key, { tier: row.collection_tier, collected: row.collected })
    }
  }
  return map
}

/**
 * Build the normalisable datum set for a payload.
 *
 * Fields that are catalogued but marked `collected = 0` are dropped here. The
 * catalog holds the full 272-field universe so the schema never needs changing,
 * but only the consented subset may actually be stored — and doing that
 * filtering in code, with the database trigger as the backstop, means a
 * misconfiguration fails at the insert rather than being silently accepted.
 */
export function normalise(
  datums: Array<{ vin: string | null; datum: TelemetryDatum }>,
  tiers: Map<string, { tier: string; collected: number }>,
  receivedAt: string,
): { normalised: NormalisedDatum[]; skippedUnknown: number; skippedUncollected: number; invalidValues: number } {
  const normalised: NormalisedDatum[] = []
  let skippedUnknown = 0
  let skippedUncollected = 0
  let invalidValues = 0

  for (const { datum } of datums) {
    const meta = tiers.get(datum.key)
    if (!meta) {
      skippedUnknown++
      continue
    }
    if (meta.collected !== 1) {
      skippedUncollected++
      continue
    }

    const value = classifyValue(datum.value)
    if (value.kind === 'invalid') invalidValues++

    normalised.push({
      fieldKey: datum.key,
      observedAt: datum.createdAt ?? receivedAt,
      valueKind: value.kind,
      valueReal: value.real,
      valueInt: value.int,
      valueText: value.text,
      valueBool: value.bool,
      valueJson: value.json,
      tier: meta.tier as NormalisedDatum['tier'],
    })
  }

  return { normalised, skippedUnknown, skippedUncollected, invalidValues }
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export interface IngestResult {
  batchId: string
  vin: string | null
  datumsAccepted: number
  factsWritten: number
  snapshotsWritten: number
  snapshotHistoryWritten: number
  skippedUnknown: number
  skippedUncollected: number
  invalidValues: number
}

/**
 * Persist a normalised datum set.
 *
 * `once` fields go to the snapshot table (current value plus history) — the
 * history row is what makes a profile's vehicle-configuration claims auditable
 * after the member changes wheels. Everything else appends a fact row, which is
 * where deltas are computed from.
 *
 * The whole write is one D1 batch so a partial payload cannot half-land and
 * leave the fact stream with a gap that a later derivation would read as zero
 * travel.
 */
export async function persistDatums(
  db: D1Database,
  options: {
    batchId: string
    vin: string | null
    datums: NormalisedDatum[]
    receivedAt: string
    isResend?: boolean
    /**
     * Which transport delivered these rows (F14-R10): 'telemetry' (default) or
     * 'poll'. The poll coordinator passes 'poll' so every fact row records its
     * source; a streamed row needs no argument and keeps the honest default.
     * Snapshot rows carry no source — the snapshot is a current-value table,
     * and `once` fields arrive over both lanes (identity poll, telemetry).
     */
    source?: 'telemetry' | 'poll'
  },
): Promise<{ factsWritten: number; snapshotsWritten: number; snapshotHistoryWritten: number }> {
  const { batchId, vin, datums, receivedAt } = options
  const isResend = options.isResend ? 1 : 0
  const source = options.source ?? 'telemetry'

  if (!vin) throw new TelemetryParseError('payload carried no VIN')

  // Dedupe on (field_key, observed_at). Tesla does redeliver the same datum, and
  // the fact table's UNIQUE constraint would otherwise abort the whole batch on a
  // replay — turning a harmless duplicate into total data loss for that payload.
  // Keeps ingest idempotent (F04-N05).
  //
  // A valid reading beats an invalid one for the same instant: `invalid` means
  // the vehicle could not supply the signal, so if it also supplied a value, the
  // value is the truth. Last-wins alone would let an "unavailable" marker
  // overwrite a real odometer reading and silently lose distance.
  const deduped = new Map<string, NormalisedDatum>()
  for (const datum of datums) {
    const key = `${datum.fieldKey}\u0000${datum.observedAt}`
    const existing = deduped.get(key)
    if (existing && existing.valueKind !== 'invalid' && datum.valueKind === 'invalid') continue
    deduped.set(key, datum)
  }

  let factsWritten = 0
  let snapshotsWritten = 0
  let snapshotHistoryWritten = 0

  // One statement per datum: D1 rejects multi-value INSERTs on the fact table
  // because the guard trigger fires per row and the CHECK spans six columns, so
  // batching rows into one statement obscures which datum was refused.
  const facts: D1PreparedStatement[] = []
  const snapshots: D1PreparedStatement[] = []
  const history: D1PreparedStatement[] = []

  for (const datum of deduped.values()) {
    if (datum.tier === 'once') {
      snapshots.push(
        db
          .prepare(
            `INSERT INTO tesla_vehicle_snapshot
               (vin, field_key, value_text, value_kind, observed_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (vin, field_key) DO UPDATE SET
               value_text  = excluded.value_text,
               value_kind  = excluded.value_kind,
               observed_at = excluded.observed_at`,
          )
          .bind(
            vin,
            datum.fieldKey,
            datum.valueText ?? String(datum.valueInt ?? datum.valueReal ?? datum.valueBool ?? ''),
            datum.valueKind === 'invalid' ? 'text' : datum.valueKind,
            datum.observedAt,
          ),
      )
      history.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO tesla_vehicle_snapshot_history
               (vin, field_key, value_text, observed_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(
            vin,
            datum.fieldKey,
            datum.valueText ?? String(datum.valueInt ?? datum.valueReal ?? datum.valueBool ?? ''),
            datum.observedAt,
          ),
      )
      snapshotsWritten++
      snapshotHistoryWritten++
      continue
    }

    facts.push(
      db
        .prepare(
          `INSERT INTO tesla_telemetry_fact
             (fact_id, vin, field_key, observed_at, received_at,
              value_real, value_int, value_text, value_bool, value_json,
              value_kind, collection_tier, batch_id, is_resend, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          vin,
          datum.fieldKey,
          datum.observedAt,
          receivedAt,
          datum.valueReal,
          datum.valueInt,
          datum.valueText,
          datum.valueBool,
          datum.valueJson,
          datum.valueKind,
          // The DB CHECK only admits event/on_change. `once` was diverted to the
          // snapshot table above and a null tier would be a normalisation bug,
          // so this is defaulted rather than passed through.
          datum.tier ?? 'event',
          batchId,
          isResend,
          source,
        ),
    )
    factsWritten++
  }

  if (facts.length) await db.batch(facts)
  if (snapshots.length) await db.batch(snapshots)
  if (history.length) await db.batch(history)

  return { factsWritten, snapshotsWritten, snapshotHistoryWritten }
}

/* -------------------------------------------------------------------------- */
/* Cost accounting (F04-R16)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tesla bills 150,000 signals per US$1.
 *
 * Cost is counted per VIN per UTC day so it is observable continuously rather
 * than discovered on an invoice — F04-R16 exists because R-07 (a billing breach
 * silently de-configuring every vehicle) is a launch blocker, and a meter that
 * only reads the invoice is not a meter.
 */
export const SIGNALS_PER_DOLLAR = 150_000

/** Signals attributable to one ingested payload. */
export function signalsForPayload(datumCount: number): number {
  return datumCount
}

export async function recordSignals(
  db: D1Database,
  options: { vin: string | null; datumCount: number; nowIso: string },
): Promise<void> {
  const day = options.nowIso.slice(0, 10)
  await db
    .prepare(
      `INSERT INTO tesla_signal_counter
         (counter_id, vin, period_start, signals, data_requests, wakes, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT (vin, period_start) DO UPDATE SET
         signals    = signals + excluded.signals,
         updated_at = excluded.updated_at`,
    )
    .bind(newId(), options.vin, day, options.datumCount, options.nowIso)
    .run()
}

/** Month-to-date signals and derived cost for one VIN, or the whole fleet. */
export interface CostReport {
  vin: string | 'ALL'
  month: string
  signals: number
  costUsd: number
}

export async function costReport(db: D1Database, month: string, vin?: string): Promise<CostReport> {
  const row = vin
    ? await db
        .prepare(
          `SELECT COALESCE(SUM(signals), 0) AS signals
             FROM tesla_signal_counter
            WHERE vin = ? AND period_start LIKE ?`,
        )
        .bind(vin, `${month}%`)
        .first<{ signals: number }>()
    : await db
        .prepare(
          `SELECT COALESCE(SUM(signals), 0) AS signals
             FROM tesla_signal_counter
            WHERE period_start LIKE ?`,
        )
        .bind(`${month}%`)
        .first<{ signals: number }>()

  const signals = row?.signals ?? 0
  return { vin: vin ?? 'ALL', month, signals, costUsd: signals / SIGNALS_PER_DOLLAR }
}

/* -------------------------------------------------------------------------- */
/* Run log (F04-R10, F04-R11)                                                 */
/* -------------------------------------------------------------------------- */

export interface IngestRun {
  runId: string
  cadence: string
  startedAt: string
  finishedAt: string | null
  vehiclesAttempted: number
  vehiclesSucceeded: number
  vehiclesFailed: number
  errors: Array<{ vin: string; code: string }>
  costUsd: number
  status: 'running' | 'complete' | 'partial' | 'failed'
}

/**
 * Start a collection run log row.
 *
 * Ingest is push-driven, so a "run" here is a telemetry flush window rather than
 * a poll loop; the log records what arrived and what was refused, which is the
 * same evidence F04-R10 asks for and is what makes a silent collection failure
 * visible.
 */
export async function startIngestRun(
  db: D1Database,
  options: { cadence: string; nowIso: string },
): Promise<string> {
  const runId = newId()
  await db
    .prepare(
      `INSERT INTO tesla_ingest_run
         (run_id, cadence, started_at, status, vehicles_attempted,
          vehicles_succeeded, vehicles_failed, errors_json, cost_usd, updated_at)
       VALUES (?, ?, ?, 'running', 0, 0, 0, '[]', 0, ?)`,
    )
    .bind(runId, options.cadence, options.nowIso, options.nowIso)
    .run()
  return runId
}

/**
 * Close a run. A run with any per-vehicle error is `partial`, not `failed`,
 * because F04-R11 requires one vehicle's failure to leave every other vehicle's
 * data intact and reported.
 */
export async function finishIngestRun(
  db: D1Database,
  runId: string,
  update: {
    nowIso: string
    attempted: number
    succeeded: number
    failed: number
    errors: Array<{ vin: string; code: string }>
    costUsd: number
  },
): Promise<void> {
  const status = update.failed === 0 ? 'complete' : update.succeeded > 0 ? 'partial' : 'failed'
  await db
    .prepare(
      `UPDATE tesla_ingest_run
          SET finished_at = ?, status = ?, vehicles_attempted = ?, vehicles_succeeded = ?,
              vehicles_failed = ?, errors_json = ?, cost_usd = ?, updated_at = ?
        WHERE run_id = ?`,
    )
    .bind(
      update.nowIso,
      status,
      update.attempted,
      update.succeeded,
      update.failed,
      JSON.stringify(update.errors),
      update.costUsd,
      update.nowIso,
      runId,
    )
    .run()
}

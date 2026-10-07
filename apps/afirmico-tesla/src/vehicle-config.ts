/**
 * Per-vehicle telemetry configuration (FRS-010 F02-R11, F02-R12).
 *
 * Two obligations live here:
 *   - configure a vehicle by sending `fleet_telemetry_config` through
 *     `tesla-http-proxy`, which signs the payload with the application private
 *     key (the proxy is used SOLELY as a config signer — no vehicle commands);
 *   - remove a vehicle's configuration when consent is revoked, so collection
 *     stops *at the vehicle* rather than by discarding inbound data (F02-R12).
 *
 * The requirement for the second is easy to under- read. Revoking a member and
 * dropping their ingest payloads leaves the car transmitting: Tesla keeps
 * billing for the signals and the vehicle keeps sending location-adjacent
 * state. Removal has to be an explicit delete aimed at the vehicle.
 *
 * What this module does NOT do, stated plainly because the distinction matters
 * for release: it builds and records the configuration, but the network send is
 * gated on `TESLA_PROXY_URL`. Until that proxy is deployed and reachable, a
 * configuration is recorded `pending` with `last_error` naming the reason —
 * never recorded as applied. A config row that claims `active` without a
 * successful round trip would be the exact class of silent false success this
 * platform has already been bitten by (F11-R02, the v1.19 stale-deploy).
 */

/** The four outcomes Tesla reports per VIN, as distinct states (F02-R11). */
export type SkipReason =
  | 'missing_key'
  | 'unsupported_hardware'
  | 'unsupported_firmware'
  | 'max_configs'

/** `tesla_telemetry_config.state` (matches the schema CHECK). */
export type ConfigState = 'pending' | 'active' | 'skipped' | 'failed' | 'removed'

/**
 * One collected field, as read from `tesla_field_catalog`.
 *
 * Only the collected rows are passed in: the catalog's `collected = 1` set is
 * the authority for what is sent (F04-R01a, §3.7). This module never decides
 * the field set, so it cannot drift from it.
 */
export interface CollectedField {
  field_key: string
  collection_tier: 'event' | 'on_change' | 'once'
  /** Tesla `minimum_delta` for `on_change` fields; null when not set. */
  min_delta: number | null
}

/**
 * Three minutes (180 s).
 *
 * CHANGED FROM 21600 (6 hours) on the owner's instruction, 2026-10-07.
 *
 * WHY IT MOVED
 * ------------
 * At 6 hours the time series was too coarse to answer the question it exists for. An
 * owner reported being in the car around 0800; the single record for that period carried
 * values captured at 13:28 the PREVIOUS DAY, because `Odometer` had not moved enough to
 * pass its delta gate and the vehicle re-sent its last known values. A trip was therefore
 * invisible in the data even though the vehicle had connected and delivered a payload.
 *
 * At 180 s the same drive produces a real series. This is the change that makes the
 * odometer and FSD figures analysable over time rather than as isolated points.
 *
 * COST, MEASURED AGAINST THIS ACCOUNT'S ACTUAL SETTINGS
 * -----------------------------------------------------
 * Tesla transmits ON CHANGE, gated by the interval — so the interval is a ceiling, not a
 * rate. Only the three distance fields have a `minimum_delta`; the other eleven are
 * change-gated settings that stay quiet regardless of the interval.
 *
 *   worst case (continuous driving), 3 delta-gated fields:
 *     1 send / 180 s = 60 signals/hour
 *     2 h/day driving x 30 days = ~3,600 signals/month ~= **$0.024/month**
 *   against the configured $100 limit: 0.024% consumed, ~4,167x margin over the
 *  10x floor F02-R13 requires ("211,693x" was the margin at 6 h, for comparison).
 *
 * A PARKED VEHICLE STILL PRODUCES NOTHING. The interval only bounds how often a CHANGED
 * value may be sent; it does not create sends. 180 s does not make the dashboard live —
 * there is up to a 3-minute lag on a changing value, and the UI says so rather than
 * implying real time.
 *
 * A CORRECTION TO THE PREVIOUS COMMENT
 * ------------------------------------
 * The old note said "the docs show a 1-60 s range ... so this is VERIFY-ON-FIRST-VEHICLE".
 * That was wrong and is withdrawn: 21600 was accepted in production for days (the live
 * config row records `interval_seconds: 21600`), and Tesla's published examples use
 * values well above 60 s (60 s, 10 minutes). The real ceiling is far higher than 60.
 *
 * WHAT THIS DOES NOT CHANGE
 * -------------------------
 * The `minimum_delta` gates are untouched. Lowering the interval without them would not
 * increase resolution — a value that has not changed is not sent at any interval — it
 * would only allow a changed value to be sent more often.
 */
export const SYNC_INTERVAL_SECONDS = 180

/** Human-readable interval recorded on the row; Tesla's own accepted format. */
export const SYNC_INTERVAL = '3 minutes'

/** A `vehicle_config` entry: interval, plus a delta gate where it applies. */
export interface FieldConfig {
  interval_seconds: number
  minimum_delta?: number
}

/**
 * Build the `fields` block for the telemetry configuration.
 *
 * Deterministic and pure: same catalog rows in, same object out, with keys in a
 * stable order — so the built artifact can be asserted against a recorded
 * expectation and a change to it shows up as a diff rather than as a config
 * that quietly differs between vehicles.
 *
 * `minimum_delta` is only emitted where the catalog carries one, and never for
 * `once` fields: a `once` field is sent once on adoption, so a delta gate on it
 * is meaningless (and Tesla rejects a delta on some fields).
 */
export function buildFieldConfig(rows: CollectedField[]): Record<string, FieldConfig> {
  const out: Record<string, FieldConfig> = {}
  for (const row of [...rows].sort((a, b) => a.field_key.localeCompare(b.field_key))) {
    const cfg: FieldConfig = { interval_seconds: SYNC_INTERVAL_SECONDS }
    if (row.collection_tier !== 'once' && row.min_delta !== null && row.min_delta > 0) {
      cfg.minimum_delta = row.min_delta
    }
    out[row.field_key] = cfg
  }
  return out
}

export interface TelemetryConfigInput {
  vins: string[]
  hostname: string
  port: number
  /** Contents of the certificate chain, not a path (Tesla requires the bytes). */
  ca: string
  fields: CollectedField[]
}

/** The exact JSON body sent to Tesla. Returned as an object for testability. */
export function buildTelemetryConfig(input: TelemetryConfigInput): object {
  return {
    vins: input.vins,
    config: {
      hostname: input.hostname,
      port: input.port,
      ca: input.ca,
      fields: buildFieldConfig(input.fields),
    },
  }
}

/**
 * Classify a `skipped_vehicles` entry.
 *
 * These are four genuinely different operational situations sharing one
 * response shape, and collapsing them is how a fleet ends up "configured" with
 * silent gaps: `missing_key` needs the member to add the virtual key,
 * `unsupported_hardware` needs a different car, `unsupported_firmware` may
 * resolve with an update, and `max_configs` means the vehicle already has
 * Tesla's ceiling of configs from other apps and will never accept ours until
 * the member removes one. Returns null for anything unrecognised so an unknown
 * reason is recorded verbatim rather than forced into a wrong bucket.
 */
export function mapSkipReason(raw: unknown): SkipReason | null {
  if (typeof raw !== 'string') return null
  const known: SkipReason[] = ['missing_key', 'unsupported_hardware', 'unsupported_firmware', 'max_configs']
  const norm = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (known as string[]).includes(norm) ? (norm as SkipReason) : null
}

export interface ConfigRecordInput {
  vin: string
  hostname: string
  port: number
  fields: CollectedField[]
  now: string
  syncInterval?: string
}

/**
 * Build the `tesla_telemetry_config` row.
 *
 * `fields_json` stores the config sent for that vehicle verbatim (the schema
 * says so, and it is what makes a later "why did this car bill differently"
 * answerable). The initial state is always `pending`: the row records intent,
 * and only a confirmed round trip moves it to `active`.
 */
export function buildConfigRecord(input: ConfigRecordInput): {
  config_id: string
  vin: string
  state: ConfigState
  sync_interval: string
  hostname: string
  port: number
  fields_json: string
  config_version: number
  applied_at: null
  verified_at: null
  last_error: null
  created_at: string
} {
  return {
    config_id: `cfg_${input.vin}_${input.now}`,
    vin: input.vin,
    state: 'pending',
    sync_interval: input.syncInterval ?? SYNC_INTERVAL,
    hostname: input.hostname,
    port: input.port,
    fields_json: JSON.stringify(buildFieldConfig(input.fields)),
    config_version: 1,
    applied_at: null,
    verified_at: null,
    last_error: null,
    created_at: input.now,
  }
}

/**
 * Whether the proxy transport is available.
 *
 * Checked rather than assumed, so the caller can record `pending` with an
 * honest reason instead of attempting a fetch to an undefined URL and
 * mislabelling the resulting TypeError as a Tesla-side failure.
 */
export function proxyConfigured(env: { TESLA_PROXY_URL?: string }): boolean {
  const url = env.TESLA_PROXY_URL
  return typeof url === 'string' && /^https?:\/\//.test(url)
}

/**
 * Build the `last_error` value for a failed config send.
 *
 * The status code alone is not enough to act on. A `http_404` from the signer
 * chain is ambiguous between "the config endpoint moved", "this VIN is not
 * visible to the authorising account" and "the vehicle has no such resource" —
 * three different repairs. The upstream reply body carries the only explanation
 * available, so it is captured rather than discarded.
 *
 * Recorded against the VIN, so it is bounded and redacted before it is stored:
 * whitespace is collapsed, the text is clipped, and anything shaped like a
 * bearer token or JWT is removed. An error string must never become a place a
 * credential leaks into a table an operator reads.
 */
export function upstreamErrorDetail(status: number, rawBody: string): string {
  const base = `http_${status}`
  const collapsed = rawBody.replace(/\s+/g, ' ').trim()
  if (!collapsed) return base

  // Prefer a structured message; fall back to the raw body. Tesla's replies use
  // `error` / `error_description`, and the signer chain can return other shapes.
  let detail = collapsed
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    const candidate = parsed.error ?? parsed.error_description ?? parsed.message ?? parsed.detail
    if (typeof candidate === 'string' && candidate.trim()) detail = candidate.trim()
    else if (candidate && typeof candidate === 'object') detail = JSON.stringify(candidate)
  } catch {
    // Not JSON — the raw (already collapsed) body is the detail.
  }

  const redacted = detail.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted-jwt]')
  const clipped = redacted.slice(0, UPSTREAM_ERROR_MAX)
  return clipped ? `${base}:${clipped}` : base
}

/** Upper bound on a stored upstream error, so one row cannot grow unbounded. */
export const UPSTREAM_ERROR_MAX = 300

/**
 * Reject a configuration attempt that could never succeed, before it is sent.
 *
 * A config with no fields, no VINs, or no `ca` is a caller bug. Sending it would
 * produce a Tesla-side error that reads like a vehicle problem and would be
 * recorded against the VIN — blaming the car for our mistake. The `ca` check is
 * the one that matters most in practice: Tesla requires the certificate
 * *contents*, and a path string (`/opt/relay/certs/fullchain.pem`) would be
 * accepted by our own code and rejected only remotely (the exact failure the
 * relay hit on first run).
 */
export function validateConfigInput(input: TelemetryConfigInput): string[] {
  const problems: string[] = []
  if (input.vins.length === 0) problems.push('no_vins')
  if (input.fields.length === 0) problems.push('no_fields')
  if (!input.hostname) problems.push('no_hostname')
  if (!(input.port > 0 && input.port <= 65535)) problems.push('bad_port')
  if (!input.ca) problems.push('no_ca')
  else if (input.ca.length < 100 || input.ca.trimStart().startsWith('/')) {
    problems.push('ca_not_certificate_contents')
  }
  return problems
}

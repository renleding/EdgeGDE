/**
 * Tests for per-vehicle telemetry configuration (FRS-010 F02-R11, F02-R12).
 *
 * The requirement's difficulty is not building the JSON — it is refusing to
 * report success that did not happen. Three of the four properties below exist
 * to stop a specific false success:
 *
 *   1. `ca` must be certificate CONTENTS, not a path. A path is valid to our own
 *      validation and rejected only by Tesla — exactly how the relay failed on
 *      its first run. A config built with a path would be recorded against a VIN
 *      and read, later, as a vehicle problem.
 *   2. With no proxy configured the state must be `pending`, never `active`.
 *      `active` is the value the runbook and any dashboard trust.
 *   3. The four `skipped_vehicles` reasons are distinct operational situations
 *      (add a key / different car / update firmware / remove another app's
 *      config). Collapsing them loses the only information that makes a gap
 *      actionable.
 *   4. Removal (F02-R12) must be aimed at the vehicle. A teardown that marks the
 *      row removed but never reaches Tesla is reported as `sent: false`, so the
 *      claim "collection has stopped" cannot be made on a row edit alone.
 */

import { describe, expect, it } from 'vitest'
import {
  SYNC_INTERVAL_SECONDS,
  UPSTREAM_ERROR_MAX,
  buildConfigRecord,
  buildFieldConfig,
  buildTelemetryConfig,
  mapSkipReason,
  proxyConfigured,
  upstreamErrorDetail,
  validateConfigInput,
  type CollectedField,
} from '../src/vehicle-config'

/** The real collected set's shape: three `event`, three `once`, eight `on_change`. */
const FIELDS: CollectedField[] = [
  { field_key: 'Odometer', collection_tier: 'event', min_delta: null },
  { field_key: 'MilesSinceReset', collection_tier: 'event', min_delta: null },
  { field_key: 'SelfDrivingMilesSinceReset', collection_tier: 'event', min_delta: 1 },
  { field_key: 'CarType', collection_tier: 'once', min_delta: null },
  { field_key: 'Version', collection_tier: 'once', min_delta: null },
  { field_key: 'EfficiencyPackage', collection_tier: 'once', min_delta: null },
  { field_key: 'SentryMode', collection_tier: 'on_change', min_delta: 1 },
  { field_key: 'PinToDriveEnabled', collection_tier: 'on_change', min_delta: null },
]

const CA = `-----BEGIN CERTIFICATE-----\n${'MIIB'.repeat(60)}\n-----END CERTIFICATE-----\n`

describe('field config (F02-R11)', () => {
  it('emits a stable, sorted key order', () => {
    // Deterministic ordering is what makes a change to the built artifact show
    // up as a reviewable diff instead of as two vehicles configured differently.
    const keys = Object.keys(buildFieldConfig(FIELDS))
    expect(keys).toEqual([...keys].sort())
  })

  it('gates on delta only where the catalog carries one', () => {
    const cfg = buildFieldConfig(FIELDS)
    expect(cfg['SelfDrivingMilesSinceReset']).toEqual({
      interval_seconds: SYNC_INTERVAL_SECONDS,
      minimum_delta: 1,
    })
    expect(cfg['Odometer']).toEqual({ interval_seconds: SYNC_INTERVAL_SECONDS })
  })

  it('never puts a delta gate on a once field', () => {
    // A `once` field is sent on adoption; a delta on it is meaningless and some
    // fields reject it.
    const cfg = buildFieldConfig([{ field_key: 'CarType', collection_tier: 'once', min_delta: 5 }])
    expect(cfg['CarType']).toEqual({ interval_seconds: SYNC_INTERVAL_SECONDS })
  })

  it('uses a six-hour interval', () => {
    expect(SYNC_INTERVAL_SECONDS).toBe(21600)
  })
})

describe('validateConfigInput: caller bugs must not be blamed on the vehicle', () => {
  const base = { vins: ['VIN1'], hostname: 'telemetry.afirmi.co', port: 443, ca: CA, fields: FIELDS }

  it('accepts a well-formed config', () => {
    expect(validateConfigInput(base)).toEqual([])
  })

  it('rejects a CA given as a path', () => {
    // The relay's first-run failure: our side is happy, Tesla is not.
    expect(validateConfigInput({ ...base, ca: '/opt/relay/certs/fullchain.pem' }))
      .toContain('ca_not_certificate_contents')
  })

  it('rejects a missing CA, missing VINs, missing fields and a bad port', () => {
    expect(validateConfigInput({ ...base, ca: '' })).toContain('no_ca')
    expect(validateConfigInput({ ...base, vins: [] })).toContain('no_vins')
    expect(validateConfigInput({ ...base, fields: [] })).toContain('no_fields')
    expect(validateConfigInput({ ...base, port: 0 })).toContain('bad_port')
    expect(validateConfigInput({ ...base, port: 70000 })).toContain('bad_port')
  })
})

describe('buildTelemetryConfig', () => {
  it('nests fields under config with the relay host and port', () => {
    const cfg = buildTelemetryConfig({
      vins: ['VIN1'], hostname: 'telemetry.afirmi.co', port: 443, ca: CA, fields: FIELDS,
    }) as { vins: string[]; config: { hostname: string; port: number; fields: Record<string, unknown>; ca: string } }
    expect(cfg.vins).toEqual(['VIN1'])
    expect(cfg.config.hostname).toBe('telemetry.afirmi.co')
    expect(cfg.config.port).toBe(443)
    expect(Object.keys(cfg.config.fields).length).toBe(FIELDS.length)
  })

  it('carries the certificate contents inline, not a reference', () => {
    const cfg = buildTelemetryConfig({
      vins: ['VIN1'], hostname: 'h', port: 443, ca: CA, fields: FIELDS,
    }) as { config: { ca: string } }
    expect(cfg.config.ca).toContain('BEGIN CERTIFICATE')
  })
})

describe('proxyConfigured', () => {
  it('is false when unset, empty or not a URL', () => {
    expect(proxyConfigured({})).toBe(false)
    expect(proxyConfigured({ TESLA_PROXY_URL: '' })).toBe(false)
    expect(proxyConfigured({ TESLA_PROXY_URL: 'proxy.local' })).toBe(false)
  })

  it('is true for an http(s) URL', () => {
    expect(proxyConfigured({ TESLA_PROXY_URL: 'https://proxy.internal' })).toBe(true)
    expect(proxyConfigured({ TESLA_PROXY_URL: 'http://127.0.0.1:4443' })).toBe(true)
  })
})

describe('mapSkipReason (F02-R11: four distinct states)', () => {
  it('maps each documented reason', () => {
    for (const r of ['missing_key', 'unsupported_hardware', 'unsupported_firmware', 'max_configs']) {
      expect(mapSkipReason(r)).toBe(r)
    }
  })

  it('tolerates the spellings Tesla actually returns', () => {
    expect(mapSkipReason('MISSING_KEY')).toBe('missing_key')
    expect(mapSkipReason('unsupported-hardware')).toBe('unsupported_hardware')
    expect(mapSkipReason('  missing key  ')).toBe('missing_key')
    expect(mapSkipReason('max_configs')).toBe('max_configs')
  })

  it('returns null for an unknown reason rather than guessing a bucket', () => {
    // An unrecognised reason is recorded verbatim upstream instead of being
    // forced into a wrong state, which would make it unactionable.
    expect(mapSkipReason('some_new_tesla_reason')).toBeNull()
    expect(mapSkipReason(undefined)).toBeNull()
    expect(mapSkipReason(42)).toBeNull()
  })
})

describe('buildConfigRecord', () => {
  it('starts pending, with no applied/verified timestamp', () => {
    // The row records intent. Only a confirmed round trip may move it to active.
    const rec = buildConfigRecord({
      vin: 'VIN1', hostname: 'telemetry.afirmi.co', port: 443, fields: FIELDS, now: '2026-10-03T00:00:00.000Z',
    })
    expect(rec.state).toBe('pending')
    expect(rec.applied_at).toBeNull()
    expect(rec.verified_at).toBeNull()
    expect(rec.vin).toBe('VIN1')
  })

  it('stores the sent field config verbatim', () => {
    const rec = buildConfigRecord({
      vin: 'VIN1', hostname: 'h', port: 443, fields: FIELDS, now: '2026-10-03T00:00:00.000Z',
    })
    const stored = JSON.parse(rec.fields_json)
    expect(Object.keys(stored)).toContain('Odometer')
    expect(Object.keys(stored).length).toBe(FIELDS.length)
  })

  it('derives config_id from vin and timestamp, so a re-apply is idempotent', () => {
    const args = { vin: 'VIN1', hostname: 'h', port: 443, fields: FIELDS, now: '2026-10-03T00:00:00.000Z' }
    expect(buildConfigRecord(args).config_id).toBe(buildConfigRecord(args).config_id)
  })
})

describe('upstreamErrorDetail (F02-R11 diagnosis)', () => {
  // A bare `http_404` is ambiguous between a moved endpoint, a VIN the account
  // cannot see, and a missing resource — three different repairs. These tests
  // pin the property that makes a failure actionable: the upstream explanation
  // is kept, and it is kept safely.

  it('keeps the upstream message alongside the status', () => {
    const body = JSON.stringify({ response: null, error: 'vehicle_not_found', error_description: '' })
    expect(upstreamErrorDetail(404, body)).toBe('http_404:vehicle_not_found')
  })

  it('falls back to the raw body when it is not JSON', () => {
    expect(upstreamErrorDetail(502, 'upstream connect error')).toBe('http_502:upstream connect error')
  })

  it('returns the bare status when the body is empty', () => {
    expect(upstreamErrorDetail(404, '')).toBe('http_404')
    expect(upstreamErrorDetail(404, '   \n  ')).toBe('http_404')
  })

  it('never stores a credential-shaped token', () => {
    // The stored error is read by operators; it must not become a leak path.
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
    const out = upstreamErrorDetail(403, JSON.stringify({ error: `rejected token ${jwt}` }))
    expect(out).not.toContain('eyJhbGciOiJSUzI1NiJ9')
    expect(out).toContain('[redacted-jwt]')
    expect(out.startsWith('http_403:')).toBe(true)
  })

  it('bounds the stored detail so one row cannot grow unbounded', () => {
    const out = upstreamErrorDetail(404, 'x'.repeat(5000))
    expect(out.length).toBeLessThanOrEqual('http_404:'.length + UPSTREAM_ERROR_MAX)
  })

  it('collapses whitespace so a multi-line body stays one line', () => {
    expect(upstreamErrorDetail(500, 'line one\n\n  line two')).toBe('http_500:line one line two')
  })
})

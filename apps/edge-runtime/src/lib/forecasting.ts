/**
 * EdgeGDE — Forecasting Projection Library
 *
 * Telemetry & Analytics v1.0.0:
 * Forecast outputs are versioned, lineage-backed materialized projections.
 * They are never authoritative truth.
 */

import { guardDB } from './db'
import { guardKV } from './kv'

export const CHRONOS_2_MODEL_NAME = 'chronos-2'
export const CHRONOS_2_MODEL_VERSION = '1.0.0'
export const CHRONOS_2_CHECKPOINT = 'amazon/chronos-2'
export const DEFAULT_FORECAST_QUANTILES = [0.1, 0.5, 0.9]

export type ForecastFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | string
export type ForecastStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped'

export interface ForecastQuantile {
  q: number
  value: number
}

export interface ForecastPointInput {
  ds: string
  point_forecast?: number | null
  p10?: number | null
  p50?: number | null
  p90?: number | null
  lower_bound?: number | null
  upper_bound?: number | null
  quantiles?: ForecastQuantile[] | Record<string, number> | null
}

export interface ForecastSeriesInput {
  id?: string
  metric_name?: string
  frequency?: ForecastFrequency
  points?: Array<{ ds: string; value: number }>
}

export interface CreateForecastRunInput {
  tenantId: string
  metricName: string
  seriesId?: string
  modelName?: string
  modelVersion?: string
  checkpoint?: string
  configHash?: string
  inputSnapshotId?: string
  frequency?: ForecastFrequency
  horizon?: number
  quantiles?: number[]
  requestedBy?: string
  source?: string
  externalJobId?: string
}

export interface CompleteForecastRunInput {
  runId: string
  tenantId: string
  pointCount?: number
  evaluationMetrics?: Record<string, unknown>
  status?: ForecastStatus
  error?: string
}

export interface Chronos2RequestPayload {
  model: string
  model_version: string
  checkpoint: string
  prediction_length: number
  quantile_levels: number[]
  id_column: string
  timestamp_column: string
  target_column: string
  series: Array<{
    id: string
    timestamp: string
    target: number
  }>
  metadata: {
    run_id: string
    tenant_id: string
    metric_name: string
    frequency: string
  }
}

export interface Chronos2ParsedPoint {
  ds: string
  point_forecast: number | null
  p10: number | null
  p50: number | null
  p90: number | null
  lower_bound: number | null
  upper_bound: number | null
  quantiles_json: string
}

export interface Chronos2InferenceResult {
  points: Chronos2ParsedPoint[]
  modelName: string
  modelVersion: string
  checkpoint: string
  skipped: boolean
  skipReason?: string
}

export interface ForecastRun {
  id: string
  tenant_id: string
  metric_name: string
  series_id: string
  model_name: string
  model_version: string | null
  checkpoint: string | null
  config_hash: string | null
  input_snapshot_id: string | null
  status: ForecastStatus
  frequency: string
  horizon: number
  quantiles_json: string
  point_count: number
  evaluation_metrics_json: string | null
  external_job_id: string | null
  requested_by: string | null
  source: string
  error: string | null
  started_at: number | null
  completed_at: number | null
  created_at: string
  updated_at: string
}

export interface ForecastPoint {
  id: string
  run_id: string
  tenant_id: string
  series_id: string
  ds: string
  step_index: number
  point_forecast: number | null
  p10: number | null
  p50: number | null
  p90: number | null
  lower_bound: number | null
  upper_bound: number | null
  quantiles_json: string
  created_at: string
}

export function normalizeForecastQuantiles(quantiles?: number[]): number[] {
  const values = Array.isArray(quantiles) && quantiles.length > 0 ? quantiles : DEFAULT_FORECAST_QUANTILES
  return [...new Set(values.map(q => Number(q)).filter(q => Number.isFinite(q) && q > 0 && q < 1))].sort((a, b) => a - b)
}

export function forecastQuantilesJson(quantiles?: number[]): string {
  return JSON.stringify(normalizeForecastQuantiles(quantiles))
}

export function forecastLatestPointerKey(tenantId: string, metricName: string, seriesId = 'tenant_global'): string {
  return `tenant:${tenantId}:forecast:${metricName}:${seriesId}:latest`
}

export function forecastConfigHash(input: {
  modelName: string
  modelVersion?: string
  checkpoint?: string
  frequency: string
  horizon: number
  quantiles: number[]
  metricName: string
}): string {
  const stable = {
    model_name: input.modelName,
    model_version: input.modelVersion || null,
    checkpoint: input.checkpoint || null,
    frequency: input.frequency,
    horizon: input.horizon,
    quantiles: normalizeForecastQuantiles(input.quantiles),
    metric_name: input.metricName,
  }
  const encoded = encodeURIComponent(JSON.stringify(stable))
  return `fc_${encoded.slice(0, 28)}`
}

export function buildChronos2RequestPayload(input: {
  runId: string
  tenantId: string
  metricName: string
  seriesId?: string
  frequency: ForecastFrequency
  horizon: number
  quantiles: number[]
  series: ForecastSeriesInput[]
}): Chronos2RequestPayload {
  const quantiles = normalizeForecastQuantiles(input.quantiles)
  const seriesId = input.seriesId || 'tenant_global'
  const rows = input.series.flatMap((series) => {
    const id = series.id || seriesId
    return (series.points || []).map(point => ({
      id,
      timestamp: point.ds,
      target: point.value,
    }))
  })

  return {
    model: CHRONOS_2_MODEL_NAME,
    model_version: CHRONOS_2_MODEL_VERSION,
    checkpoint: CHRONOS_2_CHECKPOINT,
    prediction_length: input.horizon,
    quantile_levels: quantiles,
    id_column: 'id',
    timestamp_column: 'timestamp',
    target_column: 'target',
    series: rows,
    metadata: {
      run_id: input.runId,
      tenant_id: input.tenantId,
      metric_name: input.metricName,
      frequency: input.frequency,
    },
  }
}

export function parseChronos2ForecastResponse(
  response: unknown,
  options: {
    runId: string
    tenantId: string
    seriesId?: string
    quantiles?: number[]
  },
): Chronos2ParsedPoint[] {
  const quantiles = normalizeForecastQuantiles(options.quantiles)
  const seriesId = options.seriesId || 'tenant_global'
  const rows = extractForecastRows(response)

  return rows.map((row, index) => {
    const ds = String(row.ds || row.timestamp || row.date || index)
    const point_forecast = toNumber(row.point_forecast ?? row.point ?? row.mean ?? row.median ?? row.p50 ?? null)
    const p10 = toNumber(row.p10 ?? row.q10 ?? row.quantiles?.[0.1] ?? row.quantiles?.['0.1'] ?? null)
    const p50 = toNumber(row.p50 ?? row.median ?? row.quantiles?.[0.5] ?? row.quantiles?.['0.5'] ?? null)
    const p90 = toNumber(row.p90 ?? row.q90 ?? row.quantiles?.[0.9] ?? row.quantiles?.['0.9'] ?? null)
    const lower_bound = toNumber(row.lower_bound ?? row.lo ?? p10)
    const upper_bound = toNumber(row.upper_bound ?? row.hi ?? p90)
    const quantileMap: Record<string, number> = {}

    if (p10 !== null) quantileMap['0.1'] = p10
    if (p50 !== null) quantileMap['0.5'] = p50
    if (p90 !== null) quantileMap['0.9'] = p90
    for (const q of quantiles) {
      const key = String(q)
      if (quantileMap[key] === undefined) {
        const value = toNumber((row as any)?.quantiles?.[q] ?? (row as any)?.quantiles?.[key] ?? null)
        if (value !== null) quantileMap[key] = value
      }
    }

    return {
      ds,
      point_forecast,
      p10,
      p50,
      p90,
      lower_bound,
      upper_bound,
      quantiles_json: JSON.stringify(quantileMap),
    }
  }).map((point, index) => ({ ...point, ds: point.ds || String(index) }))
}

function extractForecastRows(response: unknown): Array<Record<string, any>> {
  if (!response || typeof response !== 'object') return []
  const body = response as any

  if (Array.isArray(body)) return body.map(row => (typeof row === 'object' ? row : { point_forecast: row }))

  for (const key of ['forecast', 'predictions', 'series', 'points']) {
    const value = body[key]
    if (Array.isArray(value)) return value.map(row => (typeof row === 'object' ? row : { point_forecast: row }))
  }

  if (typeof body === 'object') return [body]
  return []
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function createForecastRun(
  db: any,
  kv: any,
  input: CreateForecastRunInput,
): Promise<string> {
  const guardedDb = guardDB(db)
  const guardedKv = guardKV(kv)
  const now = Math.floor(Date.now() / 1000)
  const runId = crypto.randomUUID()
  const seriesId = input.seriesId || 'tenant_global'
  const frequency = input.frequency || 'daily'
  const horizon = Math.max(1, Math.min(Number(input.horizon || 30), 1024))
  const quantiles = normalizeForecastQuantiles(input.quantiles)
  const modelName = input.modelName || CHRONOS_2_MODEL_NAME
  const modelVersion = input.modelVersion || CHRONOS_2_MODEL_VERSION
  const checkpoint = input.checkpoint || CHRONOS_2_CHECKPOINT
  const configHash = input.configHash || forecastConfigHash({
    modelName,
    modelVersion,
    checkpoint,
    frequency,
    horizon,
    quantiles,
    metricName: input.metricName,
  })

  await guardedDb.insert(
    { tenantId: input.tenantId },
    'forecast_runs',
    {
      id: runId,
      tenant_id: input.tenantId,
      metric_name: input.metricName,
      series_id: seriesId,
      model_name: modelName,
      model_version: modelVersion,
      checkpoint,
      config_hash: configHash,
      input_snapshot_id: input.inputSnapshotId || null,
      status: 'queued',
      frequency,
      horizon,
      quantiles_json: JSON.stringify(quantiles),
      point_count: 0,
      evaluation_metrics_json: '{}',
      external_job_id: input.externalJobId || null,
      requested_by: input.requestedBy || null,
      source: input.source || 'manual',
      started_at: now,
      completed_at: null,
    },
  )

  await guardedKv.put(
    forecastLatestPointerKey(input.tenantId, input.metricName, seriesId),
    JSON.stringify({ runId, status: 'queued', updated_at: now }),
    { tenantId: input.tenantId },
  )

  return runId
}

export async function markForecastRunRunning(
  db: any,
  runId: string,
  externalJobId?: string,
): Promise<void> {
  const guardedDb = guardDB(db)
  await guardedDb.update(
    {},
    'forecast_runs',
    {
      status: 'running',
      external_job_id: externalJobId || null,
      updated_at: new Date().toISOString(),
    },
    'id = ?',
    [runId],
  )
}

export async function completeForecastRun(
  db: any,
  input: CompleteForecastRunInput,
): Promise<void> {
  const guardedDb = guardDB(db)
  await guardedDb.update(
    {},
    'forecast_runs',
    {
      status: input.status || 'completed',
      point_count: input.pointCount || 0,
      evaluation_metrics_json: JSON.stringify(input.evaluationMetrics || {}),
      error: input.error || null,
      completed_at: Math.floor(Date.now() / 1000),
      updated_at: new Date().toISOString(),
    },
    'id = ?',
    [input.runId],
  )
}

export async function failForecastRun(
  db: any,
  runId: string,
  error: string,
): Promise<void> {
  await completeForecastRun(db, {
    runId,
    tenantId: '',
    status: 'failed',
    error,
  })
}

export async function recordForecastPoints(
  db: any,
  runId: string,
  tenantId: string,
  seriesId: string,
  points: ForecastPointInput[],
  metricName = 'forecast',
): Promise<void> {
  const guardedDb = guardDB(db)
  const now = new Date().toISOString()
  const inserts = points.map((point, index) => {
    const quantileMap = normalizeQuantileMap(point.quantiles, point)
    return guardedDb.insert(
      { tenantId },
      'forecast_points',
      {
        id: crypto.randomUUID(),
        run_id: runId,
        tenant_id: tenantId,
        series_id: seriesId,
        ds: point.ds,
        step_index: index,
        point_forecast: point.point_forecast ?? null,
        p10: point.p10 ?? quantileMap['0.1'] ?? null,
        p50: point.p50 ?? quantileMap['0.5'] ?? null,
        p90: point.p90 ?? quantileMap['0.9'] ?? null,
        lower_bound: point.lower_bound ?? quantileMap['0.1'] ?? null,
        upper_bound: point.upper_bound ?? quantileMap['0.9'] ?? null,
        quantiles_json: JSON.stringify(quantileMap),
        created_at: now,
      },
    )
  })

  for (const insert of inserts) {
    await insert
  }

  const latest = points[points.length - 1]
  if (latest) {
    const quantileMap = normalizeQuantileMap(latest.quantiles, latest)
    await guardedDb.prepare(
      `INSERT INTO forecast_series (
        tenant_id, series_id, metric_name, frequency, latest_run_id,
        latest_ds, latest_step, latest_point, latest_lower_bound,
        latest_upper_bound, latest_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, series_id) DO UPDATE SET
        latest_run_id = excluded.latest_run_id,
        latest_ds = excluded.latest_ds,
        latest_step = excluded.latest_step,
        latest_point = excluded.latest_point,
        latest_lower_bound = excluded.latest_lower_bound,
        latest_upper_bound = excluded.latest_upper_bound,
        latest_created_at = excluded.latest_created_at`,
    ).bind(
      tenantId,
      seriesId,
      metricName,
      'daily',
      runId,
      latest.ds,
      points.length - 1,
      latest.point_forecast ?? null,
      latest.lower_bound ?? quantileMap['0.1'] ?? null,
      latest.upper_bound ?? quantileMap['0.9'] ?? null,
      now,
    ).run()
  }
}

export async function publishLatestForecastPointer(
  kv: any,
  tenantId: string,
  metricName: string,
  seriesId: string,
  runId: string,
  status = 'completed',
): Promise<void> {
  const guardedKv = guardKV(kv)
  await guardedKv.put(
    forecastLatestPointerKey(tenantId, metricName, seriesId),
    JSON.stringify({ runId, status, updated_at: Math.floor(Date.now() / 1000) }),
    { tenantId },
  )
}

export async function getLatestForecastRun(
  db: any,
  tenantId: string,
  metricName: string,
  seriesId = 'tenant_global',
): Promise<ForecastRun | null> {
  const guardedDb = guardDB(db)
  const row = await guardedDb.first<ForecastRun>(
    { tenantId },
    `SELECT * FROM forecast_runs
     WHERE tenant_id = ? AND metric_name = ? AND series_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, metricName, seriesId],
  )
  return row || null
}

export async function queryForecastPoints(
  db: any,
  tenantId: string,
  metricName: string,
  seriesId = 'tenant_global',
  limit = 100,
): Promise<ForecastPoint[]> {
  const guardedDb = guardDB(db)
  const safeLimit = Math.min(Math.max(1, limit), 1000)
  const rows = await guardedDb.all<ForecastPoint>(
    { tenantId },
    `SELECT fp.* FROM forecast_points fp
     JOIN forecast_runs fr ON fr.id = fp.run_id
     WHERE fp.tenant_id = ? AND fr.metric_name = ? AND fp.series_id = ?
     ORDER BY fp.ds DESC LIMIT ?`,
    [tenantId, metricName, seriesId, safeLimit],
  )
  return rows.results || []
}

function normalizeQuantileMap(
  quantiles: ForecastPointInput['quantiles'],
  point: ForecastPointInput,
): Record<string, number> {
  const map: Record<string, number> = {}
  if (point.p10 !== null && point.p10 !== undefined) map['0.1'] = point.p10
  if (point.p50 !== null && point.p50 !== undefined) map['0.5'] = point.p50
  if (point.p90 !== null && point.p90 !== undefined) map['0.9'] = point.p90

  if (Array.isArray(quantiles)) {
    for (const q of quantiles) {
      map[String(q.q)] = q.value
    }
  } else if (quantiles && typeof quantiles === 'object') {
    for (const [key, value] of Object.entries(quantiles)) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) map[key] = parsed
    }
  }

  return map
}

export function seasonalNaiveForecast(
  points: Array<{ ds: string; value: number }>,
  horizon: number,
  quantiles?: number[],
): Chronos2ParsedPoint[] {
  if (points.length === 0) return []
  const q = normalizeForecastQuantiles(quantiles)
  const last = points[points.length - 1]
  const p10 = q.includes(0.1) ? last.value * 0.9 : null
  const p50 = q.includes(0.5) ? last.value : null
  const p90 = q.includes(0.9) ? last.value * 1.1 : null

  return Array.from({ length: horizon }, (_, index) => {
    const ds = new Date(last.ds)
    ds.setDate(ds.getDate() + index + 1)
    return {
      ds: ds.toISOString().slice(0, 10),
      point_forecast: last.value,
      p10,
      p50,
      p90,
      lower_bound: p10,
      upper_bound: p90,
      quantiles_json: JSON.stringify({
        ...(p10 !== null ? { '0.1': p10 } : {}),
        ...(p50 !== null ? { '0.5': p50 } : {}),
        ...(p90 !== null ? { '0.9': p90 } : {}),
      }),
    }
  })
}

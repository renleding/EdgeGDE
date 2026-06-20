/**
 * EdgeGDE — Historical Metric Series
 *
 * Telemetry & Analytics v1.0.0:
 * Historical metric series are the authoritative input source for forecasts.
 * Forecast outputs remain materialized projections, not authoritative truth.
 */

import { guardDB } from './db'
import type { ForecastFrequency, ForecastSeriesInput } from './forecasting'

export type MetricFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | ForecastFrequency

export interface MetricPointInput {
  ds: string
  value: number
  source?: string
  metadata?: Record<string, unknown> | null
}

export interface MetricSeriesInput {
  tenantId: string
  metricName: string
  seriesId?: string
  frequency?: MetricFrequency
  timezone?: string
  description?: string
  points: MetricPointInput[]
}

export interface MetricSeriesSummary {
  tenant_id: string
  series_id: string
  metric_name: string
  frequency: string
  timezone: string | null
  description: string | null
  first_ds: string | null
  last_ds: string | null
  point_count: number
  created_at: string
  updated_at: string
}

export interface MetricPoint {
  tenant_id: string
  series_id: string
  metric_name: string
  ds: string
  value: number
  source: string
  metadata_json: string
  created_at: string
  updated_at: string
}

export interface QueryMetricSeriesPointsOptions {
  tenantId: string
  metricName?: string
  seriesId?: string
  limit?: number
  start?: string
  end?: string
}

export interface BacktestConfig {
  horizon: number
  model?: 'seasonal_naive' | 'moving_average' | string
  quantiles?: number[]
  minTrainPoints?: number
  minTestPoints?: number
  stepSize?: number
  movingAverageWindow?: number
}

export interface BacktestFold {
  foldId: string
  trainStart: string
  trainEnd: string
  testStart: string
  testEnd: string
  trainPoints: MetricPoint[]
  actualPoints: MetricPoint[]
  forecastPoints: BacktestForecastPoint[]
}

export interface BacktestForecastPoint {
  ds: string
  point_forecast: number
  p10?: number | null
  p50?: number | null
  p90?: number | null
  lower_bound?: number | null
  upper_bound?: number | null
}

export interface BacktestMetrics {
  mae: number
  rmse: number
  mape?: number
  smape?: number
  p10_coverage?: number
  p50_coverage?: number
  p90_coverage?: number
  intervals?: {
    p10: number
    p50: number
    p90: number
  }
}

export interface BacktestResult {
  model: string
  horizon: number
  quantiles: number[]
  folds: BacktestFold[]
  metrics: BacktestMetrics
}

export function normalizeMetricSeriesId(metricName: string, seriesId?: string): string {
  return seriesId || metricName
}

export function normalizeMetricPoints(points: MetricPointInput[]): MetricPointInput[] {
  return points
    .map(point => ({
      ds: point.ds,
      value: Number(point.value),
      source: point.source || 'manual',
      metadata: point.metadata || null,
    }))
    .filter(point => point.ds && Number.isFinite(point.value))
    .sort((a, b) => a.ds.localeCompare(b.ds))
}

export async function ingestMetricSeriesPoints(db: any, input: MetricSeriesInput): Promise<MetricSeriesSummary> {
  const guardedDb = guardDB(db)
  const seriesId = normalizeMetricSeriesId(input.metricName, input.seriesId)
  const points = normalizeMetricPoints(input.points)
  if (points.length === 0) {
    throw new Error('metric series ingestion requires at least one point')
  }

  const firstDs = points[0].ds
  const lastDs = points[points.length - 1].ds
  const now = new Date().toISOString()
  const frequency = input.frequency || 'daily'
  const timezone = input.timezone || 'UTC'
  const description = input.description || null

  await guardedDb.prepare(`
    INSERT INTO metric_series (
      tenant_id,
      series_id,
      metric_name,
      frequency,
      timezone,
      description,
      first_ds,
      last_ds,
      point_count,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, series_id) DO UPDATE SET
      metric_name = excluded.metric_name,
      frequency = excluded.frequency,
      timezone = excluded.timezone,
      description = COALESCE(excluded.description, metric_series.description),
      first_ds = CASE WHEN metric_series.first_ds IS NULL THEN excluded.first_ds ELSE metric_series.first_ds END,
      last_ds = excluded.last_ds,
      point_count = metric_series.point_count + excluded.point_count,
      updated_at = excluded.updated_at
  `).bind(
    input.tenantId,
    seriesId,
    input.metricName,
    frequency,
    timezone,
    description,
    firstDs,
    lastDs,
    points.length,
    now,
    now,
  ).run()

  for (const point of points) {
    await guardedDb.prepare(`
      INSERT INTO metric_points (
        tenant_id,
        series_id,
        metric_name,
        ds,
        value,
        source,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, series_id, ds) DO UPDATE SET
        metric_name = excluded.metric_name,
        value = excluded.value,
        source = excluded.source,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).bind(
      input.tenantId,
      seriesId,
      input.metricName,
      point.ds,
      point.value,
      point.source || 'manual',
      JSON.stringify(point.metadata || {}),
      now,
      now,
    ).run()
  }

  return getMetricSeriesSummary(guardedDb, input.tenantId, input.metricName, seriesId)
}

export async function getMetricSeriesSummary(db: any, tenantId: string, metricName: string, seriesId: string): Promise<MetricSeriesSummary> {
  const guardedDb = guardDB(db)
  const row = await guardedDb.first<MetricSeriesSummary>(
    {},
    `SELECT tenant_id, series_id, metric_name, frequency, timezone, description, first_ds, last_ds, point_count, created_at, updated_at
     FROM metric_series
     WHERE tenant_id = ? AND metric_name = ? AND series_id = ?`,
    [tenantId, metricName, seriesId],
  )
  if (!row) {
    throw new Error('metric series not found')
  }
  return row
}

export async function queryMetricSeriesPoints(db: any, options: QueryMetricSeriesPointsOptions): Promise<MetricPoint[]> {
  const guardedDb = guardDB(db)
  const limit = Math.min(Math.max(Number(options.limit || 512), 1), 5000)
  const clauses = ['tenant_id = ?']
  const params: any[] = [options.tenantId]

  if (options.metricName) {
    clauses.push('metric_name = ?')
    params.push(options.metricName)
  }
  if (options.seriesId) {
    clauses.push('series_id = ?')
    params.push(options.seriesId)
  }
  if (options.start) {
    clauses.push('ds >= ?')
    params.push(options.start)
  }
  if (options.end) {
    clauses.push('ds <= ?')
    params.push(options.end)
  }

  const result = await guardedDb.all<MetricPoint>(
    {},
    `SELECT tenant_id, series_id, metric_name, ds, value, source, metadata_json, created_at, updated_at
     FROM metric_points
     WHERE ${clauses.join(' AND ')}
     ORDER BY ds ASC
     LIMIT ?`,
    params.concat(limit),
  )
  return result.results
}

export async function listMetricSeries(db: any, tenantId: string, metricName?: string, limit = 100): Promise<MetricSeriesSummary[]> {
  const guardedDb = guardDB(db)
  const params: any[] = [tenantId]
  const where = metricName ? 'tenant_id = ? AND metric_name = ?' : 'tenant_id = ?'
  if (metricName) params.push(metricName)
  params.push(Math.min(Math.max(limit, 1), 500))

  const result = await guardedDb.all<MetricSeriesSummary>(
    {},
    `SELECT tenant_id, series_id, metric_name, frequency, timezone, description, first_ds, last_ds, point_count, created_at, updated_at
     FROM metric_series
     WHERE ${where}
     ORDER BY metric_name ASC, series_id ASC
     LIMIT ?`,
    params,
  )
  return result.results
}

export function buildForecastSeriesInputFromMetricPoints(points: MetricPoint[]): ForecastSeriesInput[] {
  const bySeries = new Map<string, ForecastSeriesInput>()
  for (const point of points) {
    const key = `${point.tenant_id}:${point.series_id}:${point.metric_name}`
    const current = bySeries.get(key) || {
      id: point.series_id,
      metric_name: point.metric_name,
      frequency: 'daily',
      points: [],
    }
    current.points = current.points || []
    current.points.push({ ds: point.ds, value: point.value })
    bySeries.set(key, current)
  }
  return Array.from(bySeries.values())
}

export function runMetricSeriesBacktest(points: MetricPoint[], config: BacktestConfig): BacktestResult {
  const horizon = Math.max(Number(config.horizon || 1), 1)
  const minTrainPoints = Math.max(Number(config.minTrainPoints || horizon + 2), horizon + 2)
  const minTestPoints = Math.max(Number(config.minTestPoints || horizon), 1)
  const stepSize = Math.max(Number(config.stepSize || 1), 1)
  const sorted = [...points].sort((a, b) => a.ds.localeCompare(b.ds))
  if (sorted.length < minTrainPoints + minTestPoints) {
    throw new Error(`metric series backtest requires at least ${minTrainPoints + minTestPoints} points`)
  }

  const folds: BacktestFold[] = []
  let trainEnd = minTrainPoints - 1
  while (trainEnd + horizon <= sorted.length - 1) {
    const testStart = trainEnd + 1
    const testEnd = Math.min(testStart + horizon - 1, sorted.length - 1)
    const trainPoints = sorted.slice(0, trainEnd + 1)
    const actualPoints = sorted.slice(testStart, testEnd + 1)
    if (actualPoints.length < minTestPoints) break

    folds.push({
      foldId: `fold-${folds.length + 1}`,
      trainStart: trainPoints[0].ds,
      trainEnd: trainPoints[trainPoints.length - 1].ds,
      testStart: actualPoints[0].ds,
      testEnd: actualPoints[actualPoints.length - 1].ds,
      trainPoints,
      actualPoints,
      forecastPoints: generateBacktestForecast(trainPoints, actualPoints, config),
    })

    trainEnd += stepSize
  }

  if (folds.length === 0) {
    throw new Error('metric series backtest produced no folds')
  }

  return {
    model: config.model || 'seasonal_naive',
    horizon,
    quantiles: config.quantiles || [0.1, 0.5, 0.9],
    folds,
    metrics: evaluateBacktestResult(folds),
  }
}

export function generateBacktestForecast(trainPoints: MetricPoint[], actualPoints: MetricPoint[], config: BacktestConfig): BacktestForecastPoint[] {
  if ((config.model || 'seasonal_naive') === 'moving_average') {
    return generateMovingAverageForecast(trainPoints, actualPoints, config)
  }
  return generateSeasonalNaiveForecast(trainPoints, actualPoints, config)
}

function generateSeasonalNaiveForecast(trainPoints: MetricPoint[], actualPoints: MetricPoint[], config: BacktestConfig): BacktestForecastPoint[] {
  const values = trainPoints.map(point => point.value)
  const lastValue = values[values.length - 1]
  const quantiles = config.quantiles || [0.1, 0.5, 0.9]
  return actualPoints.map(point => ({
    ds: point.ds,
    point_forecast: lastValue,
    p10: quantiles.includes(0.1) ? Math.max(0, lastValue * 0.8) : null,
    p50: quantiles.includes(0.5) ? lastValue : null,
    p90: quantiles.includes(0.9) ? lastValue * 1.2 : null,
    lower_bound: quantiles.includes(0.1) ? Math.max(0, lastValue * 0.8) : null,
    upper_bound: quantiles.includes(0.9) ? lastValue * 1.2 : null,
  }))
}

function generateMovingAverageForecast(trainPoints: MetricPoint[], actualPoints: MetricPoint[], config: BacktestConfig): BacktestForecastPoint[] {
  const window = Math.max(Number(config.movingAverageWindow || 7), 1)
  const values = trainPoints.map(point => point.value)
  const recent = values.slice(-window)
  const avg = recent.reduce((sum, value) => sum + value, 0) / recent.length
  const quantiles = config.quantiles || [0.1, 0.5, 0.9]
  return actualPoints.map(point => ({
    ds: point.ds,
    point_forecast: avg,
    p10: quantiles.includes(0.1) ? Math.max(0, avg * 0.8) : null,
    p50: quantiles.includes(0.5) ? avg : null,
    p90: quantiles.includes(0.9) ? avg * 1.2 : null,
    lower_bound: quantiles.includes(0.1) ? Math.max(0, avg * 0.8) : null,
    upper_bound: quantiles.includes(0.9) ? avg * 1.2 : null,
  }))
}

export function evaluateBacktestResult(folds: BacktestFold[]): BacktestMetrics {
  const errors: number[] = []
  const squaredErrors: number[] = []
  const percentageErrors: number[] = []
  const symmetricPercentageErrors: number[] = []
  const coverage = {
    p10: { hits: 0, total: 0 },
    p50: { hits: 0, total: 0 },
    p90: { hits: 0, total: 0 },
  }

  for (const fold of folds) {
    for (let i = 0; i < fold.actualPoints.length; i += 1) {
      const actual = fold.actualPoints[i]
      const forecast = fold.forecastPoints[i]
      if (!forecast) continue
      const error = actual.value - forecast.point_forecast
      const absError = Math.abs(error)
      errors.push(absError)
      squaredErrors.push(error * error)
      if (actual.value !== 0) percentageErrors.push(absError / Math.abs(actual.value))
      symmetricPercentageErrors.push((2 * absError) / (Math.abs(actual.value) + Math.abs(forecast.point_forecast)))
      if (forecast.p10 != null && forecast.p90 != null) {
        coverage.p10.total += 1
        if (actual.value >= forecast.p10) coverage.p10.hits += 1
        coverage.p50.total += 1
        if ((forecast.p50 == null && actual.value <= forecast.p90) || (forecast.p50 != null && actual.value <= forecast.p50)) coverage.p50.hits += 1
        coverage.p90.total += 1
        if (actual.value <= forecast.p90) coverage.p90.hits += 1
      }
    }
  }

  const count = errors.length
  const mae = mean(errors)
  const rmse = Math.sqrt(mean(squaredErrors))
  const mape = percentageErrors.length > 0 ? mean(percentageErrors) : undefined
  const smape = symmetricPercentageErrors.length > 0 ? mean(symmetricPercentageErrors) : undefined

  return {
    mae,
    rmse,
    mape,
    smape,
    p10_coverage: coverage.p10.total > 0 ? coverage.p10.hits / coverage.p10.total : undefined,
    p50_coverage: coverage.p50.total > 0 ? coverage.p50.hits / coverage.p50.total : undefined,
    p90_coverage: coverage.p90.total > 0 ? coverage.p90.hits / coverage.p90.total : undefined,
    intervals: {
      p10: coverage.p10.total,
      p50: coverage.p50.total,
      p90: coverage.p90.total,
    },
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

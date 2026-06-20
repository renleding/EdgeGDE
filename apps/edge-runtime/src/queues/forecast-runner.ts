/**
 * EdgeGDE — Forecast Runner Queue Consumer
 *
 * Telemetry & Analytics v1.0.0:
 * Runs forecast jobs asynchronously and stores outputs as materialized
 * projections in D1. Forecast outputs are never authoritative truth.
 */

import {
  CHRONOS_2_CHECKPOINT,
  CHRONOS_2_MODEL_NAME,
  CHRONOS_2_MODEL_VERSION,
  buildChronos2RequestPayload,
  completeForecastRun,
  createForecastRun,
  evaluateForecastPromotion,
  markForecastRunRunning,
  parseChronos2ForecastResponse,
  publishLatestForecastPointer,
  recordForecastAuditEvent,
  recordForecastPoints,
  seasonalNaiveForecast,
  type Chronos2InferenceResult,
  type ForecastSeriesInput,
} from '../lib/forecasting'
import { guardDB } from '../lib/db'
import {
  DEFAULT_PRODUCTION_MODEL_NAME,
  resolveForecastModelDefaults,
} from '../lib/forecast-model-comparison'
import { guardKV } from '../lib/kv'
import {
  buildForecastSeriesInputFromMetricPoints,
  queryMetricSeriesPoints,
} from '../lib/metric-series'

export interface ForecastRunMessage {
  type: 'forecast_run_requested'
  tenantId: string
  metricName: string
  seriesId?: string
  frequency?: string
  horizon?: number
  quantiles?: number[]
  requestedBy?: string
  source?: string
  modelName?: string
  series?: ForecastSeriesInput[]
}

export interface ForecastRunnerEnv {
  DB?: any
  TENANT_KV?: any
  CHRONOS2_ENDPOINT?: string
  CHRONOS2_API_KEY?: string
  TIMESFM25_ENDPOINT?: string
  TIMESFM25_API_KEY?: string
}

const DEFAULT_PROMOTION_GATE = {
  minPointCount: 1,
  requireFinitePointForecasts: true,
  requireQuantileOrdering: true,
  requireIntervalBounds: true,
}

export async function queue(batch: any, env: ForecastRunnerEnv): Promise<void> {
  const db = guardDB(env.DB)
  const kv = guardKV(env.TENANT_KV)

  for (const msg of batch.messages) {
    const body = msg.body as ForecastRunMessage
    if (body?.type !== 'forecast_run_requested') {
      msg.ack()
      continue
    }

    try {
      const modelDefaults = resolveForecastModelDefaults(body.modelName || DEFAULT_PRODUCTION_MODEL_NAME)
      const runId = await createForecastRun(db, kv, {
        tenantId: body.tenantId,
        metricName: body.metricName,
        seriesId: body.seriesId,
        frequency: body.frequency,
        horizon: body.horizon,
        quantiles: body.quantiles,
        requestedBy: body.requestedBy,
        source: body.source || 'queue',
        modelName: body.modelName || modelDefaults.modelName,
        modelVersion: modelDefaults.modelVersion,
        checkpoint: modelDefaults.checkpoint,
      })

      const providedSeries = normalizeForecastSeries(body.series || [])
      const historicalSeries = providedSeries.length > 0
        ? providedSeries
        : buildForecastSeriesInputFromMetricPoints(await queryMetricSeriesPoints(db, {
          tenantId: body.tenantId,
          metricName: body.metricName,
          seriesId: body.seriesId,
          limit: Math.max((body.horizon || 30) + 512, 512),
        }))
      if (historicalSeries.length === 0 || historicalSeries.every(series => (series.points || []).length === 0)) {
        throw new Error('forecast run requires historical metric points or an explicit series payload')
      }
      const inference = modelDefaults.modelName === 'chronos2'
        ? await runChronos2Inference({
          endpoint: env.CHRONOS2_ENDPOINT,
          apiKey: env.CHRONOS2_API_KEY,
          runId,
          tenantId: body.tenantId,
          metricName: body.metricName,
          seriesId: body.seriesId,
          frequency: body.frequency || 'daily',
          horizon: body.horizon || 30,
          quantiles: body.quantiles,
          series: historicalSeries,
        })
        : await runTimesFM25Inference({
          endpoint: env.TIMESFM25_ENDPOINT,
          apiKey: env.TIMESFM25_API_KEY,
          runId,
          tenantId: body.tenantId,
          metricName: body.metricName,
          seriesId: body.seriesId,
          frequency: body.frequency || 'daily',
          horizon: body.horizon || 30,
          quantiles: body.quantiles,
          series: historicalSeries,
        })

      await recordForecastAuditEvent(db, body.tenantId, runId, 'forecast_run_started', {
        source: body.source || 'queue',
        requested_by: body.requestedBy || null,
        series_id: body.seriesId || 'tenant_global',
        horizon: body.horizon || 30,
        model_name: modelDefaults.modelName,
      })

      await markForecastRunRunning(db, runId, inference.skipped ? undefined : runId)

      const promotion = evaluateForecastPromotion(inference.points, {
        inference_model: inference.modelName,
        inference_model_version: inference.modelVersion,
        inference_checkpoint: inference.checkpoint,
        skipped: inference.skipped,
        skip_reason: inference.skipReason || null,
      }, DEFAULT_PROMOTION_GATE)

      if (!promotion.publishable) {
        await completeForecastRun(db, {
          runId,
          tenantId: body.tenantId,
          pointCount: inference.points.length,
          evaluationMetrics: {
            inference_model: inference.modelName,
            inference_model_version: inference.modelVersion,
            inference_checkpoint: inference.checkpoint,
            skipped: inference.skipped,
            skip_reason: inference.skipReason || null,
          },
          promotionStatus: promotion.promotionStatus,
          promotionMetrics: promotion.metrics,
          promotionError: promotion.errors.map(error => `${error.code}: ${error.message}`).join('; '),
          status: 'failed',
          error: promotion.errors.map(error => error.message).join('; '),
        })
        await recordForecastAuditEvent(db, body.tenantId, runId, 'forecast_projection_rejected', promotion.metrics)
        msg.ack()
        continue
      }

      await recordForecastPoints(
        db,
        runId,
        body.tenantId,
        body.seriesId || 'tenant_global',
        inference.points,
        body.metricName,
      )
      await completeForecastRun(db, {
        runId,
        tenantId: body.tenantId,
        pointCount: inference.points.length,
        evaluationMetrics: {
          inference_model: inference.modelName,
          inference_model_version: inference.modelVersion,
          inference_checkpoint: inference.checkpoint,
          skipped: inference.skipped,
          skip_reason: inference.skipReason || null,
        },
        promotionStatus: promotion.promotionStatus,
        promotionMetrics: promotion.metrics,
        promotionError: promotion.errors.map(error => `${error.code}: ${error.message}`).join('; '),
        status: inference.skipped ? 'skipped' : 'completed',
      })
      await recordForecastAuditEvent(db, body.tenantId, runId, 'forecast_projection_published', promotion.metrics)
      await publishLatestForecastPointer(
        kv,
        body.tenantId,
        body.metricName,
        body.seriesId || 'tenant_global',
        runId,
        inference.skipped ? 'skipped' : 'completed',
      )
      msg.ack()
    } catch (err: any) {
      console.error('[forecast-runner] failed:', err)
      msg.retry()
    }
  }
}

async function runChronos2Inference(input: {
  endpoint?: string
  apiKey?: string
  runId: string
  tenantId: string
  metricName: string
  seriesId?: string
  frequency: string
  horizon: number
  quantiles?: number[]
  series: ForecastSeriesInput[]
}): Promise<Chronos2InferenceResult> {
  const payload = buildChronos2RequestPayload({
    runId: input.runId,
    tenantId: input.tenantId,
    metricName: input.metricName,
    seriesId: input.seriesId,
    frequency: input.frequency,
    horizon: input.horizon,
    quantiles: input.quantiles || [],
    series: input.series,
  })

  if (!input.endpoint) {
    return {
      points: seasonalNaiveForecast(input.series.flatMap(series => series.points || []), input.horizon, input.quantiles),
      modelName: CHRONOS_2_MODEL_NAME,
      modelVersion: CHRONOS_2_MODEL_VERSION,
      checkpoint: CHRONOS_2_CHECKPOINT,
      skipped: true,
      skipReason: 'CHRONOS2_ENDPOINT not configured; seasonal naive fallback generated projection only.',
    }
  }

  const res = await fetch(input.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error(`Chronos-2 inference failed with ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  return {
    points: parseChronos2ForecastResponse(json, {
      runId: input.runId,
      tenantId: input.tenantId,
      seriesId: input.seriesId,
      quantiles: input.quantiles,
    }),
    modelName: CHRONOS_2_MODEL_NAME,
    modelVersion: CHRONOS_2_MODEL_VERSION,
    checkpoint: CHRONOS_2_CHECKPOINT,
    skipped: false,
  }
}

async function runTimesFM25Inference(input: {
  endpoint?: string
  apiKey?: string
  runId: string
  tenantId: string
  metricName: string
  seriesId?: string
  frequency: string
  horizon: number
  quantiles?: number[]
  series: ForecastSeriesInput[]
}): Promise<Chronos2InferenceResult> {
  if (!input.endpoint) {
    return {
      points: runLocalTimesFM25Forecast(input.series, input.horizon, input.quantiles),
      modelName: DEFAULT_PRODUCTION_MODEL_NAME,
      modelVersion: '2.5',
      checkpoint: 'timesfm-2.5',
      skipped: true,
      skipReason: 'TIMESFM25_ENDPOINT not configured; local deterministic TimesFM 2.5 adapter generated projection only.',
    }
  }

  const res = await fetch(input.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: 'timesfm-2.5',
      model_version: '2.5',
      checkpoint: 'timesfm-2.5',
      prediction_length: input.horizon,
      quantile_levels: input.quantiles || [],
      id_column: 'id',
      timestamp_column: 'timestamp',
      target_column: 'target',
      series: input.series.flatMap(forecastSeries => (forecastSeries.points || []).map(point => ({
        id: seriesIdFromForecastSeries(forecastSeries),
        timestamp: point.ds,
        target: point.value,
      }))),
      metadata: {
        run_id: input.runId,
        tenant_id: input.tenantId,
        metric_name: input.metricName,
        frequency: input.frequency,
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`TimesFM 2.5 inference failed with ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  return {
    points: parseChronos2ForecastResponse(json, {
      runId: input.runId,
      tenantId: input.tenantId,
      seriesId: input.seriesId,
      quantiles: input.quantiles,
    }),
    modelName: DEFAULT_PRODUCTION_MODEL_NAME,
    modelVersion: '2.5',
    checkpoint: 'timesfm-2.5',
    skipped: false,
  }
}

function seriesIdFromForecastSeries(series: ForecastSeriesInput): string {
  return series.id || 'tenant_global'
}

function runLocalTimesFM25Forecast(series: ForecastSeriesInput[], horizon: number, quantiles?: number[]): any[] {
  const points = series.flatMap(item => item.points || []).sort((a, b) => String(a.ds).localeCompare(String(b.ds)))
  const values = points.map(point => Number(point.value)).filter(Number.isFinite)
  if (values.length === 0) return []
  const recentWindow = Math.min(21, values.length)
  const recent = values.slice(-recentWindow)
  const older = values.slice(-recentWindow * 2, -recentWindow)
  const lastValue = values[values.length - 1]
  const median = medianValue(recent)
  const olderMedian = older.length > 0 ? medianValue(older) : median
  const dailyTrend = recentWindow > 0 ? (median - olderMedian) / recentWindow : 0
  const dampedTrend = dailyTrend * 0.7
  const width = Math.max(Math.abs(dailyTrend) * recentWindow * 2, median * 0.05, 1)
  const baseDate = new Date(points[points.length - 1].ds)
  const q10 = quantiles?.includes(0.1) ?? true
  const q50 = quantiles?.includes(0.5) ?? true
  const q90 = quantiles?.includes(0.9) ?? true
  return Array.from({ length: horizon }, (_, index) => {
    const forecast = lastValue + dampedTrend * (index + 1)
    const ds = new Date(baseDate.getTime() + (index + 1) * 86400000).toISOString().slice(0, 10)
    return {
      ds,
      point_forecast: forecast,
      p10: q10 ? Math.max(0, forecast - width) : null,
      p50: q50 ? forecast : null,
      p90: q90 ? forecast + width : null,
      lower_bound: q10 ? Math.max(0, forecast - width) : null,
      upper_bound: q90 ? forecast + width : null,
      quantiles_json: JSON.stringify({
        '0.1': q10 ? Math.max(0, forecast - width) : null,
        '0.5': q50 ? forecast : null,
        '0.9': q90 ? forecast + width : null,
      }),
    }
  })
}

function medianValue(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function normalizeForecastSeries(series: ForecastSeriesInput[]): ForecastSeriesInput[] {
  return series.map(item => ({
    id: item.id || 'tenant_global',
    metric_name: item.metric_name,
    frequency: item.frequency,
    points: (item.points || []).map(point => ({
      ds: point.ds,
      value: Number(point.value),
    })).filter(point => Number.isFinite(point.value)),
  }))
}

export default { queue }

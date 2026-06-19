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
  markForecastRunRunning,
  parseChronos2ForecastResponse,
  publishLatestForecastPointer,
  recordForecastPoints,
  seasonalNaiveForecast,
  type Chronos2InferenceResult,
  type ForecastSeriesInput,
} from '../lib/forecasting'
import { guardDB } from '../lib/db'
import { guardKV } from '../lib/kv'

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
  series?: ForecastSeriesInput[]
}

export interface ForecastRunnerEnv {
  DB?: any
  TENANT_KV?: any
  CHRONOS2_ENDPOINT?: string
  CHRONOS2_API_KEY?: string
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
      const runId = await createForecastRun(db, kv, {
        tenantId: body.tenantId,
        metricName: body.metricName,
        seriesId: body.seriesId,
        frequency: body.frequency,
        horizon: body.horizon,
        quantiles: body.quantiles,
        requestedBy: body.requestedBy,
        source: body.source || 'queue',
      })

      const series = normalizeForecastSeries(body.series || [])
      const inference = await runChronos2Inference({
        endpoint: env.CHRONOS2_ENDPOINT,
        apiKey: env.CHRONOS2_API_KEY,
        runId,
        tenantId: body.tenantId,
        metricName: body.metricName,
        seriesId: body.seriesId,
        frequency: body.frequency || 'daily',
        horizon: body.horizon || 30,
        quantiles: body.quantiles,
        series,
      })

      await markForecastRunRunning(db, runId, inference.skipped ? undefined : runId)
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
        status: inference.skipped ? 'skipped' : 'completed',
      })
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

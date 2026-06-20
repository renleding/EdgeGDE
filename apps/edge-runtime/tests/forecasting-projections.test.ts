// @ts-nocheck
/* eslint-disable local/no-raw-storage-access */
/**
 * EdgeGDE — Forecasting Projection Contract Tests
 *
 * Run:
 *   bun test tests/forecasting-projections.test.ts
 */

import assert from 'node:assert'
import {
  buildChronos2RequestPayload,
  CHRONOS_2_CHECKPOINT,
  CHRONOS_2_MODEL_NAME,
  CHRONOS_2_MODEL_VERSION,
  evaluateForecastPromotion,
  forecastConfigHash,
  forecastLatestPointerKey,
  parseChronos2ForecastResponse,
  seasonalNaiveForecast,
  validateForecastProjection,
} from '../src/lib/forecasting'

test('forecasting projection contract', () => {
  const migration = `CREATE TABLE IF NOT EXISTS forecast_runs
CREATE TABLE IF NOT EXISTS forecast_points
CREATE TABLE IF NOT EXISTS forecast_series
model_name TEXT NOT NULL DEFAULT 'chronos-2'`

  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS forecast_runs'))
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS forecast_points'))
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS forecast_series'))
  assert.ok(migration.includes('model_name TEXT NOT NULL DEFAULT \'chronos-2\''))

  const request = buildChronos2RequestPayload({
    runId: 'run-1',
    tenantId: 'tenant-a',
    metricName: 'lead_submissions',
    seriesId: 'daily',
    frequency: 'daily',
    horizon: 3,
    quantiles: [0.1, 0.5, 0.9],
    series: [
      {
        id: 'daily',
        metric_name: 'lead_submissions',
        frequency: 'daily',
        points: [
          { ds: '2026-06-17', value: 10 },
          { ds: '2026-06-18', value: 12 },
          { ds: '2026-06-19', value: 14 },
        ],
      },
    ],
  })

  assert.strictEqual(request.model, CHRONOS_2_MODEL_NAME)
  assert.strictEqual(request.model_version, CHRONOS_2_MODEL_VERSION)
  assert.strictEqual(request.checkpoint, CHRONOS_2_CHECKPOINT)
  assert.strictEqual(request.prediction_length, 3)
  assert.deepStrictEqual(request.quantile_levels, [0.1, 0.5, 0.9])
  assert.strictEqual(request.metadata.run_id, 'run-1')
  assert.strictEqual(request.metadata.tenant_id, 'tenant-a')
  assert.strictEqual(request.metadata.metric_name, 'lead_submissions')
  assert.strictEqual(request.series.length, 3)

  const parsed = parseChronos2ForecastResponse({
    forecast: [
      { ds: '2026-06-20', point_forecast: 15, p10: 13, p50: 15, p90: 18 },
      { ds: '2026-06-21', point_forecast: 16, p10: 14, p50: 16, p90: 19 },
    ],
  }, { runId: 'run-1', tenantId: 'tenant-a', seriesId: 'daily', quantiles: [0.1, 0.5, 0.9] })

  assert.strictEqual(parsed.length, 2)
  assert.strictEqual(parsed[0].ds, '2026-06-20')
  assert.strictEqual(parsed[0].point_forecast, 15)
  assert.strictEqual(parsed[0].p10, 13)
  assert.strictEqual(parsed[0].p50, 15)
  assert.strictEqual(parsed[0].p90, 18)
  assert.strictEqual(JSON.parse(parsed[0].quantiles_json)['0.9'], 18)

  const fallback = seasonalNaiveForecast([
    { ds: '2026-06-19', value: 20 },
  ], 2, [0.1, 0.5, 0.9])

  assert.strictEqual(fallback.length, 2)
  assert.strictEqual(fallback[0].point_forecast, 20)
  assert.strictEqual(fallback[0].p10, 18)
  assert.strictEqual(fallback[0].p50, 20)
  assert.strictEqual(fallback[0].p90, 22)
  assert.strictEqual(fallback[0].ds, '2026-06-20')

  assert.strictEqual(
    forecastConfigHash({
      modelName: CHRONOS_2_MODEL_NAME,
      modelVersion: CHRONOS_2_MODEL_VERSION,
      checkpoint: CHRONOS_2_CHECKPOINT,
      frequency: 'daily',
      horizon: 30,
      quantiles: [0.1, 0.5, 0.9],
      metricName: 'lead_submissions',
    }).startsWith('fc_'),
    true,
  )

  assert.strictEqual(
    forecastLatestPointerKey('tenant-a', 'lead_submissions', 'daily'),
    'tenant:tenant-a:forecast:lead_submissions:daily:latest',
  )
})

test('forecast promotion gate accepts valid projection', () => {
  const report = evaluateForecastPromotion(
    [
      { ds: '2026-06-20', point_forecast: 15, p10: 13, p50: 15, p90: 18, lower_bound: 13, upper_bound: 18 },
      { ds: '2026-06-21', point_forecast: 16, p10: 14, p50: 16, p90: 19, lower_bound: 14, upper_bound: 19 },
    ],
    { mae: 1.5, smape: 0.08 },
    {
      minPointCount: 2,
      requireFinitePointForecasts: true,
      requireQuantileOrdering: true,
      requireIntervalBounds: true,
      maxMae: 2,
    },
  )

  assert.strictEqual(report.publishable, true)
  assert.strictEqual(report.promotionStatus, 'published')
  assert.strictEqual(report.errors.length, 0)
  assert.strictEqual(report.metrics.mae, 1.5)
})

test('forecast promotion gate rejects invalid quantile ordering', () => {
  const validation = validateForecastProjection([
    { ds: '2026-06-20', point_forecast: 15, p10: 18, p50: 15, p90: 18, lower_bound: 18, upper_bound: 18 },
  ])

  assert.strictEqual(validation.publishable, false)
  assert.strictEqual(validation.promotionStatus, 'rejected')
  assert.strictEqual(validation.errors[0].code, 'QUANTILE_ORDER')
})

test('forecast promotion gate rejects backtest threshold failure', () => {
  const report = evaluateForecastPromotion(
    [{ ds: '2026-06-20', point_forecast: 15, p10: 13, p50: 15, p90: 18 }],
    { mae: 5, smape: 0.2 },
    { maxMae: 2 },
  )

  assert.strictEqual(report.publishable, false)
  assert.strictEqual(report.promotionStatus, 'rejected')
  assert.strictEqual(report.errors[0].code, 'MAE_THRESHOLD')
})

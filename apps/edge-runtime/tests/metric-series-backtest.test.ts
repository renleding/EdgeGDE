// @ts-nocheck
/**
 * EdgeGDE — Metric Series and Backtest Tests
 */

import assert from 'node:assert'
import {
  buildForecastSeriesInputFromMetricPoints,
  normalizeMetricPoints,
  runMetricSeriesBacktest,
  evaluateBacktestResult,
} from '../src/lib/metric-series'

test('metric series ingestion contract', () => {
  const points = normalizeMetricPoints([
    { ds: '2026-06-19', value: 10, source: 'unit_test', metadata: { label: 'a' } },
    { ds: '2026-06-18', value: 12 },
    { ds: '2026-06-20', value: 14 },
  ])

  assert.equal(points.length, 3)
  assert.equal(points[0].ds, '2026-06-18')
  assert.equal(points[0].value, 12)
  assert.equal(points[0].source, 'manual')
  assert.equal(points[2].metadata_json, undefined)
})

test('backtest harness evaluates seasonal naive baseline', () => {
  const points = [
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-01', value: 10, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-02', value: 12, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-03', value: 14, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-04', value: 16, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-05', value: 18, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-06', value: 20, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
  ]

  const result = runMetricSeriesBacktest(points, {
    horizon: 2,
    model: 'seasonal_naive',
    quantiles: [0.1, 0.5, 0.9],
    minTrainPoints: 4,
    minTestPoints: 2,
  })

  assert.equal(result.model, 'seasonal_naive')
  assert.equal(result.horizon, 2)
  assert.equal(result.folds.length, 1)
  assert.equal(result.folds[0].trainEnd, '2026-06-04')
  assert.equal(result.folds[0].testStart, '2026-06-05')
  assert.equal(result.folds[0].forecastPoints[0].point_forecast, 16)
  assert.equal(result.folds[0].forecastPoints[1].point_forecast, 16)
  assert.equal(result.metrics.mae, 3)
})

test('backtest harness evaluates moving average baseline', () => {
  const points = [
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-01', value: 10, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-02', value: 20, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-03', value: 30, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-04', value: 40, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-05', value: 50, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
  ]

  const result = runMetricSeriesBacktest(points, {
    horizon: 1,
    model: 'moving_average',
    movingAverageWindow: 2,
    minTrainPoints: 3,
    minTestPoints: 1,
  })

  assert.equal(result.folds.length, 2)
  assert.equal(result.folds[0].forecastPoints[0].point_forecast, 25)
  assert.equal(result.folds[1].forecastPoints[0].point_forecast, 35)
})

test('backtest metrics compute MAE and RMSE', () => {
  const folds = [
    {
      foldId: 'fold-1',
      trainStart: '2026-06-01',
      trainEnd: '2026-06-02',
      testStart: '2026-06-03',
      testEnd: '2026-06-04',
      trainPoints: [],
      actualPoints: [
        { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-03', value: 10, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
        { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-04', value: 20, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
      ],
      forecastPoints: [
        { ds: '2026-06-03', point_forecast: 8, p10: 7, p50: 8, p90: 12 },
        { ds: '2026-06-04', point_forecast: 18, p10: 17, p50: 18, p90: 22 },
      ],
    },
  ]

  const metrics = evaluateBacktestResult(folds)
  assert.equal(metrics.mae, 2)
  assert.equal(metrics.rmse, 2)
  assert.equal(metrics.p90_coverage, 1)
})

test('metric points convert to forecast series input', () => {
  const series = buildForecastSeriesInputFromMetricPoints([
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-01', value: 10, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
    { tenant_id: 'tenant-a', series_id: 'daily', metric_name: 'lead_submissions', ds: '2026-06-02', value: 12, source: 'test', metadata_json: '{}', created_at: 'now', updated_at: 'now' },
  ])

  assert.equal(series.length, 1)
  assert.equal(series[0].id, 'daily')
  assert.equal(series[0].points.length, 2)
  assert.equal(series[0].points[1].value, 12)
})

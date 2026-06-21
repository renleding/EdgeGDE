// @ts-nocheck
import assert from 'node:assert'
import {
  buildAnalyticsSummary,
  projectionStatusBadge,
  renderAnalyticsPage,
  renderBacktestMetrics,
  renderForecastPoints,
  renderMetricSeriesRows,
  renderModelComparisonRows,
} from '../src/api/admin-analytics'

function createMockDb(data = {}) {
  const statements = {
    first: () => data.first || null,
    all: () => data.all || { results: [] },
    run: () => ({ success: true }),
  }
  return {
    prepare: () => ({
      bind: () => statements,
      first: statements.first,
      all: statements.all,
      run: statements.run,
    }),
  }
}

function createMockKv(pointer = null) {
  return { get: async () => pointer }
}

test('admin analytics renders projection status badges', () => {
  assert.ok(projectionStatusBadge('published').includes('badge-published'))
  assert.ok(projectionStatusBadge('rejected').includes('badge-rejected'))
  assert.ok(projectionStatusBadge('failed').includes('badge-failed'))
  assert.ok(projectionStatusBadge('skipped').includes('badge-skipped'))
  assert.ok(projectionStatusBadge('pending').includes('badge-pending'))
})

test('admin analytics renders metric and forecast rows', () => {
  const seriesHtml = renderMetricSeriesRows([{
    metric_name: 'lead_submissions',
    series_id: 'daily',
    frequency: 'daily',
    point_count: 10,
    latest_ds: '2026-06-19',
    latest_value: 42,
  }])
  assert.ok(seriesHtml.includes('lead_submissions'))
  assert.ok(seriesHtml.includes('42'))

  const forecastHtml = renderForecastPoints([{
    ds: '2026-06-20',
    point_forecast: 44,
    lower_bound: 40,
    upper_bound: 48,
    created_at: '2026-06-20T00:00:00.000Z',
    run_id: 'run-1',
  }])
  assert.ok(forecastHtml.includes('44'))
  assert.ok(forecastHtml.includes('run-1'))
})

test('admin analytics renders backtest metrics', () => {
  const html = renderBacktestMetrics({
    metrics: { mae: 1.5, rmse: 2.1, smape: 0.08 },
    folds: [{}, {}],
  })
  assert.ok(html.includes('MAE'))
  assert.ok(html.includes('1.5'))
  assert.ok(html.includes('2'))
})

test('admin analytics renders model comparison rows', () => {
  const html = renderModelComparisonRows({
    primaryMetric: 'mae',
    winner: { model: 'timesfm_2_5', status: 'success', rank: 1, runtimeMs: 1 },
    models: [
      { model: 'timesfm_2_5', status: 'success', rank: 1, metrics: { mae: 1, rmse: 2, smape: 0.1 }, runtimeMs: 1 },
      { model: 'chronos2', status: 'success', rank: 2, metrics: { mae: 3, rmse: 4, smape: 0.2 }, runtimeMs: 1 },
    ],
    generatedAt: '2026-06-20T00:00:00.000Z',
  })
  assert.ok(html.includes('Winner: timesfm_2_5'))
  assert.ok(html.includes('chronos2'))
})

test('admin analytics builds summary from mock D1 and KV', async () => {
  const db = createMockDb({
    all: { results: [
      { metric_name: 'lead_submissions', series_id: 'daily', frequency: 'daily', point_count: 10, latest_ds: '2026-06-19', latest_value: 42 },
    ] },
    first: { id: 'run-1', metric_name: 'lead_submissions', promotion_status: 'published' },
  })
  const kv = createMockKv({ runId: 'run-1', status: 'completed' })

  const summary = await buildAnalyticsSummary(db, kv, {
    tenantId: 'tenant-a',
    metricName: 'lead_submissions',
    seriesId: 'daily',
  })

  assert.strictEqual(summary.tenantId, 'tenant-a')
  assert.strictEqual(summary.seriesCount, 1)
  assert.strictEqual(summary.latestForecast.id, 'run-1')
  assert.strictEqual(summary.pointer.runId, 'run-1')
})

test('admin analytics renders dashboard page', () => {
  const html = renderAnalyticsPage({
    tenantId: 'tenant-a',
    metricName: 'lead_submissions',
    seriesId: 'daily',
    seriesCount: 1,
    series: [{ metric_name: 'lead_submissions', series_id: 'daily', frequency: 'daily', point_count: 10, latest_ds: '2026-06-19', latest_value: 42 }],
    latestForecast: { id: 'run-1', model_name: 'chronos-2', promotion_status: 'published' },
    forecastPoints: [{ ds: '2026-06-20', point_forecast: 44, lower_bound: 40, upper_bound: 48, created_at: '2026-06-20T00:00:00.000Z', run_id: 'run-1' }],
    pointer: { runId: 'run-1', status: 'completed' },
    recentAuditEvents: [],
    generatedAt: '2026-06-20T00:00:00.000Z',
  }, undefined, undefined, false)

  assert.ok(html.includes('Telemetry & Analytics'))
  assert.ok(html.includes('Forecast Projection'))
  assert.ok(html.includes('published'))
})

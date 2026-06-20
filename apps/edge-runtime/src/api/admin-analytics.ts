/**
 * EdgeGDE — Admin Analytics API and Dashboard
 *
 * Telemetry & Analytics v1.1:
 * Shows metric series, forecast projections, backtest metrics, and projection
 * status while preserving the rule that forecasts are projections, not truth.
 */

import { Hono } from 'hono'
import { adminAuth } from '../middleware/auth'
import { guardDB } from '../lib/db'
import { guardKV } from '../lib/kv'
import {
  forecastLatestPointerKey,
  getLatestForecastRun,
  queryForecastPoints,
} from '../lib/forecasting'
import {
  listMetricSeries,
  queryMetricSeriesPoints,
  runMetricSeriesBacktest,
} from '../lib/metric-series'
import { queryAuditLogs } from '../lib/audit'

export const adminAnalyticsRouter = new Hono()

adminAnalyticsRouter.use('*', adminAuth)

interface AnalyticsSummary {
  tenantId: string
  metricName?: string
  seriesId: string
  seriesCount: number
  series: any[]
  latestForecast: any
  forecastPoints: any[]
  pointer: any
  recentAuditEvents: any[]
  backtest?: any
  generatedAt: string
}

export function projectionStatusBadge(status?: string): string {
  const value = status || 'pending'
  const normalized = value.toLowerCase()
  if (normalized === 'published') return '<span class="badge badge-published">published</span>'
  if (normalized === 'rejected') return '<span class="badge badge-rejected">rejected</span>'
  if (normalized === 'failed') return '<span class="badge badge-failed">failed</span>'
  if (normalized === 'skipped') return '<span class="badge badge-skipped">skipped</span>'
  return '<span class="badge badge-pending">pending</span>'
}

export function renderMetricSeriesRows(series: any[]): string {
  if (!series.length) return '<tr><td colspan="6" class="empty-cell">No metric series found</td></tr>'
  return series.map((row: any) => `
    <tr>
      <td>${escapeHtml(row.metric_name || '')}</td>
      <td>${escapeHtml(row.series_id || '')}</td>
      <td>${escapeHtml(row.frequency || '')}</td>
      <td>${escapeHtml(row.point_count || 0)}</td>
      <td>${escapeHtml(row.latest_ds || '')}</td>
      <td>${escapeHtml(row.latest_value ?? '')}</td>
    </tr>`).join('')
}

export function renderForecastPoints(rows: any[]): string {
  if (!rows.length) return '<tr><td colspan="6" class="empty-cell">No forecast points found</td></tr>'
  return rows.map((row: any) => `
    <tr>
      <td>${escapeHtml(row.ds || '')}</td>
      <td>${escapeHtml(row.point_forecast ?? '')}</td>
      <td>${escapeHtml(row.lower_bound ?? '')}</td>
      <td>${escapeHtml(row.upper_bound ?? '')}</td>
      <td>${escapeHtml(row.created_at || '')}</td>
      <td>${escapeHtml(row.run_id || '')}</td>
    </tr>`).join('')
}

export function renderBacktestMetrics(result?: any): string {
  if (!result?.metrics) return '<div class="empty">No backtest requested</div>'
  const metrics = result.metrics
  return `<div class="metric-grid">
    <div><span>MAE</span><strong>${escapeHtml(String(metrics.mae ?? 'n/a'))}</strong></div>
    <div><span>RMSE</span><strong>${escapeHtml(String(metrics.rmse ?? 'n/a'))}</strong></div>
    <div><span>sMAPE</span><strong>${escapeHtml(String(metrics.smape ?? 'n/a'))}</strong></div>
    <div><span>Folds</span><strong>${escapeHtml(String(result.folds?.length || 0))}</strong></div>
  </div>`
}

export async function buildAnalyticsSummary(
  db: any,
  kv: any,
  input: {
    tenantId: string
    metricName?: string
    seriesId?: string
    includeBacktest?: boolean
    horizon?: number
    backtestModel?: string
  },
): Promise<AnalyticsSummary> {
  const guardedDb = guardDB(db)
  const guardedKv = guardKV(kv)
  const tenantId = input.tenantId
  const seriesId = input.seriesId || 'tenant_global'
  const metricName = input.metricName
  const horizon = Number(input.horizon || 30)
  const backtestModel = input.backtestModel || 'seasonal_naive'

  const series = metricName
    ? await listMetricSeries(guardedDb, tenantId, metricName, 100)
    : await listMetricSeries(guardedDb, tenantId, undefined, 100)
  const latestForecast = await getLatestForecastRun(guardedDb, tenantId, metricName || 'forecast', seriesId)
  const forecastPoints = latestForecast
    ? await queryForecastPoints(guardedDb, tenantId, latestForecast.metric_name, seriesId, 100)
    : []
  const pointerKey = forecastLatestPointerKey(tenantId, metricName || 'forecast', seriesId)
  const pointer = await guardedKv.get(pointerKey, { tenantId }, 'json')
  const recentAuditEvents = await queryAuditLogs(guardedDb, tenantId, { limit: 20 })
  const backtest = input.includeBacktest
    ? runMetricSeriesBacktest(await queryMetricSeriesPoints(guardedDb, {
      tenantId,
      metricName: metricName || (latestForecast?.metric_name || ''),
      seriesId,
      limit: 5000,
    }), {
      horizon,
      model: backtestModel,
    })
    : undefined

  return {
    tenantId,
    metricName,
    seriesId,
    seriesCount: series.length,
    series,
    latestForecast,
    forecastPoints,
    pointer,
    recentAuditEvents,
    backtest,
    generatedAt: new Date().toISOString(),
  }
}

adminAnalyticsRouter.get('/analytics', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series')
  const includeBacktest = c.req.query('backtest') === 'true'
  if (!tenantId) return c.json({ error: 'tenant query param is required' }, 400)

  try {
    const summary = await buildAnalyticsSummary((c.env as any).DB, (c.env as any).TENANT_KV, {
      tenantId,
      metricName,
      seriesId,
      includeBacktest,
      horizon: Number(c.req.query('horizon') || 30),
      backtestModel: c.req.query('model') || 'seasonal_naive',
    })
    return c.json({ summary })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

adminAnalyticsRouter.get('/analytics/status', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series')
  if (!tenantId) return c.json({ error: 'tenant query param is required' }, 400)

  try {
    const summary = await buildAnalyticsSummary((c.env as any).DB, (c.env as any).TENANT_KV, {
      tenantId,
      metricName,
      seriesId,
    })
    return c.json({
      status: summary.latestForecast?.promotion_status || 'pending',
      latestRunId: summary.latestForecast?.id || null,
      seriesCount: summary.seriesCount,
      forecastPointCount: summary.forecastPoints.length,
      pointer: summary.pointer,
      generatedAt: summary.generatedAt,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

adminAnalyticsRouter.get('/admin/analytics', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series')
  const token = c.req.query('token')
  const includeBacktest = c.req.query('backtest') === 'true'

  try {
    const summary = await buildAnalyticsSummary((c.env as any).DB, (c.env as any).TENANT_KV, {
      tenantId,
      metricName,
      seriesId,
      includeBacktest,
      horizon: Number(c.req.query('horizon') || 30),
      backtestModel: c.req.query('model') || 'seasonal_naive',
    })
    return c.html(renderAnalyticsPage(summary, token))
  } catch (err: any) {
    return c.html(renderAnalyticsPage({
      tenantId,
      metricName,
      seriesId: seriesId || 'tenant_global',
      seriesCount: 0,
      series: [],
      latestForecast: null,
      forecastPoints: [],
      pointer: null,
      recentAuditEvents: [],
      generatedAt: new Date().toISOString(),
    }, token, err.message))
  }
})

export function renderAnalyticsPage(summary: AnalyticsSummary, token?: string, error?: string, includeBacktest = false): string {
  const tenantId = summary.tenantId
  const qs = (token ? `&token=${token}` : '')
  const metricParam = summary.metricName ? `&metric=${encodeURIComponent(summary.metricName)}` : ''
  const seriesParam = summary.seriesId ? `&series=${encodeURIComponent(summary.seriesId)}` : ''
  const status = summary.latestForecast?.promotion_status || 'pending'
  const forecastWarning = status === 'published'
    ? '<div class="notice notice-info">Forecast is a materialized projection, not authoritative truth.</div>'
    : '<div class="notice notice-warning">No published forecast projection is available yet.</div>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telemetry & Analytics — AFIRMICO Admin</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
    a{color:#58a6ff;text-decoration:none}.nav{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;gap:24px;align-items:center}.nav h1{font-size:16px;color:#f0f6fc}.nav a{font-size:13px;padding:4px 8px;border-radius:4px}.nav a.active{background:#1c2128;color:#f0f6fc}.container{max-width:1120px;margin:0 auto;padding:24px}.card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}.card h3{font-size:14px;color:#f0f6fc;margin-bottom:8px}.meta{font-size:11px;color:#8b949e;margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #2d3140;font-weight:500}td{padding:8px;border-bottom:1px solid #1c2128}.empty,.empty-cell{color:#4a4d55;text-align:center;padding:24px;font-size:13px}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric-grid div{background:#0f1117;border:1px solid #2d3140;border-radius:6px;padding:12px}.metric-grid span{display:block;color:#8b949e;font-size:11px;margin-bottom:4px}.metric-grid strong{font-size:18px}.badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:4px}.badge-published{background:#238636;color:#fff}.badge-rejected,.badge-failed{background:#da3633;color:#fff}.badge-skipped{background:#d29922;color:#fff}.badge-pending{background:#6e7681;color:#fff}.notice{border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:12px}.notice-info{background:#0c2d3a;border:1px solid #1f6feb;color:#79c0ff}.notice-warning{background:#3a2d0c;border:1px solid #d29922;color:#f2cc60}.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.filters input,.filters button{padding:6px 10px;border-radius:6px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:12px}.filters button{background:#238636;border-color:#238636;color:#fff}.muted{color:#8b949e}.danger{color:#da3633}
  </style>
</head>
<body>
  <nav class="nav">
    <h1>Telemetry & Analytics</h1>
    <a href="/admin/analytics?tenant=${escapeHtml(tenantId)}${qs}">Analytics</a>
    <a href="/admin/kb?tenant=${escapeHtml(tenantId)}${qs}">Knowledge Base</a>
    <a href="/admin/config?tenant=${escapeHtml(tenantId)}${qs}">Config</a>
    <a href="/admin/drift${qs}">Drift</a>
  </nav>
  <div class="container">
    <div class="card">
      <h3>📊 Analytics Overview</h3>
      <div class="meta">Tenant: ${escapeHtml(tenantId)} · Generated: ${escapeHtml(summary.generatedAt)}</div>
      ${error ? `<div class="notice notice-warning">${escapeHtml(error)}</div>` : ''}
      ${forecastWarning}
      <div class="metric-grid">
        <div><span>Series</span><strong>${summary.seriesCount}</strong></div>
        <div><span>Forecast status</span><strong>${projectionStatusBadge(status)}</strong></div>
        <div><span>Forecast points</span><strong>${summary.forecastPoints.length}</strong></div>
        <div><span>Latest run</span><strong>${escapeHtml(summary.latestForecast?.id || 'none')}</strong></div>
      </div>
    </div>

    <div class="card">
      <h3>🔎 Filters</h3>
      <form class="filters" method="get" action="/admin/analytics">
        <input type="hidden" name="tenant" value="${escapeHtml(tenantId)}">
        ${token ? `<input type="hidden" name="token" value="${escapeHtml(token)}">` : ''}
        <input type="text" name="metric" placeholder="metric name" value="${escapeHtml(summary.metricName || '')}">
        <input type="text" name="series" placeholder="series id" value="${escapeHtml(summary.seriesId || '')}">
        <input type="number" name="horizon" placeholder="horizon" value="30" min="1" max="1024">
        <label class="muted"><input type="checkbox" name="backtest" value="true" ${includeBacktest ? 'checked' : ''}> include backtest</label>
        <button type="submit">Refresh</button>
      </form>
    </div>

    <div class="card">
      <h3>📈 Metric Series</h3>
      <table>
        <thead><tr><th>Metric</th><th>Series</th><th>Frequency</th><th>Points</th><th>Latest ds</th><th>Latest value</th></tr></thead>
        <tbody>${renderMetricSeriesRows(summary.series)}</tbody>
      </table>
    </div>

    <div class="card">
      <h3>🔮 Forecast Projection</h3>
      <div class="meta">Projection status: ${projectionStatusBadge(status)} · Model: ${escapeHtml(summary.latestForecast?.model_name || 'none')}</div>
      <table>
        <thead><tr><th>ds</th><th>Point</th><th>Lower</th><th>Upper</th><th>Created</th><th>Run</th></tr></thead>
        <tbody>${renderForecastPoints(summary.forecastPoints)}</tbody>
      </table>
    </div>

    <div class="card">
      <h3>🧪 Backtest</h3>
      ${renderBacktestMetrics(summary.backtest)}
    </div>

    <div class="card">
      <h3>🧾 Recent Audit Events</h3>
      ${renderAuditEvents(summary.recentAuditEvents)}
    </div>
  </div>
</body>
</html>`
}

function renderAuditEvents(events: any[]): string {
  if (!events.length) return '<div class="empty">No audit events found</div>'
  return `<table>
    <thead><tr><th>Type</th><th>Created</th><th>Payload</th></tr></thead>
    <tbody>${events.map((event: any) => `<tr>
      <td>${escapeHtml(event.event_type || '')}</td>
      <td>${escapeHtml(String(event.created_at || ''))}</td>
      <td><code>${escapeHtml(event.payload_json || '{}')}</code></td>
    </tr>`).join('')}</tbody>
  </table>`
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

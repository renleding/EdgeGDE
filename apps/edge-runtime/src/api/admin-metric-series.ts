/**
 * EdgeGDE — Admin Metric Series API
 *
 * Telemetry & Analytics v1.0.0:
 * Historical metric series are the authoritative input source for forecasts.
 * Forecast outputs remain materialized projections, not authoritative truth.
 */

import { Hono } from 'hono'
import { adminAuth } from '../middleware/auth'
import { guardDB } from '../lib/db'
import {
  ingestMetricSeriesPoints,
  listMetricSeries,
  queryMetricSeriesPoints,
  runMetricSeriesBacktest,
} from '../lib/metric-series'

export const adminMetricSeriesRouter = new Hono()

adminMetricSeriesRouter.use('*', adminAuth)

adminMetricSeriesRouter.post('/points', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const tenantId = body.tenantId || c.req.query('tenant')
  const metricName = body.metricName || c.req.query('metric')
  const seriesId = body.seriesId || c.req.query('series')
  const frequency = body.frequency || c.req.query('frequency') || 'daily'
  const timezone = body.timezone || c.req.query('timezone') || 'UTC'
  const description = body.description || c.req.query('description')
  const points = Array.isArray(body.points) ? body.points : []

  if (!tenantId || !metricName || points.length === 0) {
    return c.json({ error: 'tenantId, metricName, and points are required' }, 400)
  }

  try {
    const summary = await ingestMetricSeriesPoints((c.env as any).DB, {
      tenantId,
      metricName,
      seriesId,
      frequency,
      timezone,
      description,
      points,
    })
    return c.json({ success: true, series: summary, ingestedPoints: points.length })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

adminMetricSeriesRouter.get('/series', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const limit = Number(c.req.query('limit') || 100)
  if (!tenantId) {
    return c.json({ error: 'tenant query param is required' }, 400)
  }

  const series = await listMetricSeries((c.env as any).DB, tenantId, metricName, limit)
  return c.json({ series })
})

adminMetricSeriesRouter.get('/points', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series')
  const limit = Number(c.req.query('limit') || 512)
  const start = c.req.query('start')
  const end = c.req.query('end')

  if (!tenantId || !metricName) {
    return c.json({ error: 'tenant and metric query params are required' }, 400)
  }

  const points = await queryMetricSeriesPoints((c.env as any).DB, {
    tenantId,
    metricName,
    seriesId,
    limit,
    start,
    end,
  })
  return c.json({ points })
})

adminMetricSeriesRouter.post('/backtest', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const tenantId = body.tenantId || c.req.query('tenant')
  const metricName = body.metricName || c.req.query('metric')
  const seriesId = body.seriesId || c.req.query('series')
  const horizon = Number(body.horizon || 30)
  const model = body.model || 'seasonal_naive'
  const quantiles = Array.isArray(body.quantiles) ? body.quantiles : [0.1, 0.5, 0.9]

  if (!tenantId || !metricName) {
    return c.json({ error: 'tenantId and metricName are required' }, 400)
  }

  const points = await queryMetricSeriesPoints((c.env as any).DB, {
    tenantId,
    metricName,
    seriesId,
    limit: body.limit || 5000,
  })
  if (points.length === 0) {
    return c.json({ error: 'No metric points found for backtest' }, 404)
  }

  const result = runMetricSeriesBacktest(points, {
    horizon,
    model,
    quantiles,
    minTrainPoints: body.minTrainPoints,
    minTestPoints: body.minTestPoints,
    stepSize: body.stepSize,
    movingAverageWindow: body.movingAverageWindow,
  })

  return c.json({ result })
})

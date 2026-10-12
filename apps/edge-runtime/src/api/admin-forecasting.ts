/**
 * EdgeGDE — Admin Forecasting API
 *
 * Telemetry & Analytics v1.0.0:
 * Provides an admin-triggered forecast run request. Forecast outputs remain
 * materialized projections, not authoritative truth.
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { adminAuth } from '../middleware/auth'
import {
  createForecastRun,
  getLatestForecastRun,
  queryForecastPoints,
  forecastLatestPointerKey,
} from '../lib/forecasting'
import { guardDB } from '../lib/db'
import { guardKV } from '../lib/kv'
import type { ForecastRunnerEnv } from '../queues/forecast-runner'

/** Hono router for admin forecasting endpoints. */
export const adminForecastingRouter = new Hono()

adminForecastingRouter.use('*', adminAuth)

adminForecastingRouter.get('/latest', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series') || 'tenant_global'
  if (!tenantId || !metricName) {
    return c.json({ error: 'tenant and metric query params are required' }, 400)
  }

  const db = guardDB(envFromContext(c).DB)
  const run = await getLatestForecastRun(db, tenantId, metricName, seriesId)
  if (!run) {
    return c.json({ error: 'No forecast run found' }, 404)
  }

  return c.json({ run })
})

adminForecastingRouter.get('/points', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series') || 'tenant_global'
  const limit = Number(c.req.query('limit') || 100)
  if (!tenantId || !metricName) {
    return c.json({ error: 'tenant and metric query params are required' }, 400)
  }

  const db = guardDB(envFromContext(c).DB)
  const points = await queryForecastPoints(db, tenantId, metricName, seriesId, limit)
  return c.json({ points })
})

adminForecastingRouter.post('/run', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const tenantId = body.tenantId || c.req.query('tenant')
  const metricName = body.metricName || c.req.query('metric')
  const seriesId = body.seriesId || c.req.query('series') || 'tenant_global'
  const horizon = Number(body.horizon || 30)
  const frequency = body.frequency || 'daily'
  const quantiles = Array.isArray(body.quantiles) ? body.quantiles : [0.1, 0.5, 0.9]

  if (!tenantId || !metricName) {
    return c.json({ error: 'tenantId and metricName are required' }, 400)
  }

  const db = guardDB(envFromContext(c).DB)
  const kv = guardKV(envFromContext(c).TENANT_KV)
  const queue = envFromContext(c).FORECASTING_QUEUE
  const runId = await createForecastRun(db, kv, {
    tenantId,
    metricName,
    seriesId,
    horizon,
    frequency,
    quantiles,
    requestedBy: 'admin',
    source: 'admin_api',
  })

  if (queue?.send) {
    await queue.send({
      type: 'forecast_run_requested',
      runId,
      tenantId,
      metricName,
      seriesId,
      frequency,
      horizon,
      quantiles,
      requestedBy: 'admin',
      source: 'admin_api',
    })
    return c.json({ success: true, status: 'queued', runId })
  }

  const { queue: handleForecastRun } = await import('../queues/forecast-runner')
  c.executionCtx.waitUntil(handleForecastRun({
    messages: [{
      body: {
        type: 'forecast_run_requested',
        runId,
        tenantId,
        metricName,
        seriesId,
        frequency,
        horizon,
        quantiles,
        requestedBy: 'admin',
        source: 'admin_api',
      },
      ack: async () => {},
      retry: async () => {},
    }],
  }, envFromContext(c) as unknown as ForecastRunnerEnv))

  return c.json({ success: true, status: 'queued', runId })
})

adminForecastingRouter.get('/pointer', async (c) => {
  const tenantId = c.req.query('tenant')
  const metricName = c.req.query('metric')
  const seriesId = c.req.query('series') || 'tenant_global'
  if (!tenantId || !metricName) {
    return c.json({ error: 'tenant and metric query params are required' }, 400)
  }

  const kv = guardKV(envFromContext(c).TENANT_KV)
  const key = forecastLatestPointerKey(tenantId, metricName, seriesId)
  const value = await kv.get(key, 'json')
  return c.json({ key, value })
})

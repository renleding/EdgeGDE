import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { correlationMiddleware, getCorrelationId } from '../../../src/middleware/correlation'

type Vars = {
  correlationId: string
  missionId?: string
  actionId?: string
}

function makeApp() {
  const app = new Hono<{ Variables: Vars }>()
  app.use('*', correlationMiddleware)
  app.get('/test', (c) => {
    return c.json({
      correlationId: c.get('correlationId'),
      missionId: c.get('missionId'),
      actionId: c.get('actionId'),
      viaHelper: getCorrelationId(c),
    })
  })
  return app
}

describe('correlationMiddleware', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the X-Correlation-Id header when present', async () => {
    const app = makeApp()
    const res = await app.request('/test', { headers: { 'x-correlation-id': 'corr-123' } })
    const body = (await res.json()) as Vars & { viaHelper: string }
    expect(body.correlationId).toBe('corr-123')
    expect(body.viaHelper).toBe('corr-123')
  })

  it('auto-injects a UUID v4 when header is missing', async () => {
    const app = makeApp()
    const res = await app.request('/test')
    const body = (await res.json()) as Vars & { viaHelper: string }
    expect(body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(body.viaHelper).toBe(body.correlationId)
  })

  it('sets response header x-correlation-id', async () => {
    const app = makeApp()
    const res = await app.request('/test', { headers: { 'x-correlation-id': 'abc' } })
    expect(res.headers.get('x-correlation-id')).toBe('abc')
  })

  it('stores mission and action IDs when provided', async () => {
    const app = makeApp()
    const res = await app.request('/test', {
      headers: { 'x-mission-id': 'm-1', 'x-action-id': 'a-1' },
    })
    const body = (await res.json()) as Vars & { viaHelper: string }
    expect(body.missionId).toBe('m-1')
    expect(body.actionId).toBe('a-1')
  })

  it('leaves mission/action undefined when absent', async () => {
    const app = makeApp()
    const res = await app.request('/test')
    const body = (await res.json()) as Vars & { viaHelper: string }
    expect(body.missionId).toBeUndefined()
    expect(body.actionId).toBeUndefined()
  })

  it('warns on auto-injection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = makeApp()
    await app.request('/test')
    expect(warn).toHaveBeenCalled()
    const msg = warn.mock.calls[0][0] as string
    expect(msg).toContain('[correlation] auto-injected')
  })
})

describe('getCorrelationId helper', () => {
  it('returns empty string when no correlationId set', async () => {
    const app = new Hono<{ Variables: Vars }>()
    app.get('/x', (c) => c.text(getCorrelationId(c)))
    const res = await app.request('/x')
    expect(await res.text()).toBe('')
  })
})

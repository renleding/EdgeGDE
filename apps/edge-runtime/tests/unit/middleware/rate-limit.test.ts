import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { rateLimitRegistration, rateLimitLogin } from '../../../src/middleware/rate-limit'

// Stub envFromContext to return a controllable KV
const kvState = new Map<string, any>()
const kv = {
  get: vi.fn(async (key: string) => kvState.get(key) ?? null),
  put: vi.fn(async (key: string, val: string) => { kvState.set(key, JSON.parse(val)) }),
}

vi.mock('../../../src/lib/env', () => ({
  envFromContext: () => ({ TENANT_KV: kv }),
}))

function makeApp(handler: any) {
  const app = new Hono()
  app.use('*', handler)
  app.get('/x', (c) => c.text('ok'))
  return app
}

describe('rateLimitRegistration', () => {
  beforeEach(() => {
    kvState.clear()
    vi.clearAllMocks()
  })

  it('allows first request and increments count', async () => {
    const app = makeApp(rateLimitRegistration())
    const res = await app.request('/x', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    const stored = kvState.get('rl:register:ip:1.2.3.4')
    expect(stored.count).toBe(1)
  })

  it('blocks after 3 attempts per IP', async () => {
    const app = makeApp(rateLimitRegistration())
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/x', { headers: { 'CF-Connecting-IP': '5.6.7.8' } })
      expect(res.status).toBe(200)
    }
    const res4 = await app.request('/x', { headers: { 'CF-Connecting-IP': '5.6.7.8' } })
    expect(res4.status).toBe(429)
    const body = (await res4.json()) as { error: string; retryAfter: number }
    expect(body.error).toContain('Too many registration attempts')
    expect(body.retryAfter).toBe(3600)
  })

  it('resets counter when window expires', async () => {
    const app = makeApp(rateLimitRegistration())
    for (let i = 0; i < 3; i++) {
      await app.request('/x', { headers: { 'CF-Connecting-IP': '9.9.9.9' } })
    }
    // Simulate expiry: force stored reset to the past
    const key = 'rl:register:ip:9.9.9.9'
    const stored = kvState.get(key)
    kvState.set(key, { ...stored, reset: Math.floor(Date.now() / 1000) - 10 })
    const res = await app.request('/x', { headers: { 'CF-Connecting-IP': '9.9.9.9' } })
    expect(res.status).toBe(200)
  })
})

describe('rateLimitLogin', () => {
  beforeEach(() => {
    kvState.clear()
    vi.clearAllMocks()
  })

  it('allows up to 10 login attempts per 15 min window', async () => {
    const app = makeApp(rateLimitLogin())
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/x', { headers: { 'CF-Connecting-IP': '1.1.1.1' } })
      expect(res.status).toBe(200)
    }
    const res11 = await app.request('/x', { headers: { 'CF-Connecting-IP': '1.1.1.1' } })
    expect(res11.status).toBe(429)
    const body = (await res11.json()) as { retryAfter: number }
    expect(body.retryAfter).toBe(900)
  })

  it('uses X-Forwarded-For first hop as IP', async () => {
    const app = makeApp(rateLimitLogin())
    await app.request('/x', { headers: { 'X-Forwarded-For': '10.0.0.1, 10.0.0.2' } })
    expect(kvState.has('rl:login:ip:10.0.0.1')).toBe(true)
  })

  it('uses unknown IP when no client IP headers present', async () => {
    const app = makeApp(rateLimitLogin())
    await app.request('/x')
    expect(kvState.has('rl:login:ip:unknown')).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LocalRateLimiter, rateLimiter } from '../../../src/lib/rate-limiter'

describe('LocalRateLimiter — token consumption', () => {
  it('allows the first request with 59 remaining', async () => {
    const rl = new LocalRateLimiter()
    const r = await rl.check('acme')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(59)
  })

  it('denies requests once the bucket is exhausted', async () => {
    const rl = new LocalRateLimiter()
    for (let i = 0; i < 60; i++) {
      const r = await rl.check('acme')
      expect(r.allowed).toBe(true)
    }
    const denied = await rl.check('acme')
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
  })

  it('keeps separate buckets per tenant', async () => {
    const rl = new LocalRateLimiter()
    await rl.check('tenant-a')
    const b = await rl.check('tenant-b')
    expect(b.allowed).toBe(true)
    expect(b.remaining).toBe(59)
  })

  it('does not refill before the interval elapses', async () => {
    const rl = new LocalRateLimiter()
    await rl.check('acme')
    await rl.check('acme')
    expect(await rl.check('acme')).toEqual({ allowed: true, remaining: 57 })
    expect(rl.getTokens('acme')).toBe(57)
  })
})

describe('LocalRateLimiter — refill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refills the full bucket after a full interval', async () => {
    const rl = new LocalRateLimiter()
    for (let i = 0; i < 60; i++) await rl.check('acme')
    expect((await rl.check('acme')).allowed).toBe(false)

    vi.advanceTimersByTime(60_000)
    const r = await rl.check('acme')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(59)
  })

  it('refills proportionally for partial intervals', async () => {
    const rl = new LocalRateLimiter()
    for (let i = 0; i < 60; i++) await rl.check('acme')

    vi.advanceTimersByTime(30_000) // half a minute → 30 tokens
    const r = await rl.check('acme')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(29)
  })

  it('caps refill at MAX_TOKENS', async () => {
    const rl = new LocalRateLimiter()
    await rl.check('acme') // 59 left

    vi.advanceTimersByTime(120_000) // 120 tokens of refill — capped at 60
    // Refill is lazy: it only happens inside check(). After the capped refill
    // (59 + 60 → min(60, 119) = 60) one token is consumed → 59 remaining.
    // Without the cap this would be 179 - 1 = 178.
    const r = await rl.check('acme')
    expect(r).toEqual({ allowed: true, remaining: 59 })
    expect(rl.getTokens('acme')).toBe(59)
  })
})

describe('LocalRateLimiter — reset and inspection', () => {
  it('resets a single tenant bucket', async () => {
    const rl = new LocalRateLimiter()
    await rl.check('acme')
    expect(rl.getTokens('acme')).toBe(59)
    rl.reset('acme')
    expect(rl.getTokens('acme')).toBe(60)
    expect((await rl.check('acme')).remaining).toBe(59)
  })

  it('clears all buckets when no tenant is given', async () => {
    const rl = new LocalRateLimiter()
    await rl.check('a')
    await rl.check('b')
    rl.reset()
    expect(rl.getTokens('a')).toBe(60)
    expect(rl.getTokens('b')).toBe(60)
  })

  it('getTokens returns MAX_TOKENS for unknown tenants', () => {
    const rl = new LocalRateLimiter()
    expect(rl.getTokens('nobody')).toBe(60)
  })

  it('reflects consumed tokens in getTokens', async () => {
    const rl = new LocalRateLimiter()
    await rl.check('acme')
    await rl.check('acme')
    expect(rl.getTokens('acme')).toBe(58)
  })
})

describe('rateLimiter singleton', () => {
  it('is a LocalRateLimiter instance', () => {
    expect(rateLimiter).toBeInstanceOf(LocalRateLimiter)
  })

  it('works as a shared instance', async () => {
    rateLimiter.reset()
    const r = await rateLimiter.check('singleton-tenant')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(59)
    rateLimiter.reset('singleton-tenant')
  })
})

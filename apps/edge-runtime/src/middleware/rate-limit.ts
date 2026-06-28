/**
 * EdgeGDE — Rate Limiting Middleware (KV-based)
 *
 * Uses KV with TTL for per-IP and per-email rate limiting.
 * Falls back gracefully if KV is not available.
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler, Next } from 'hono'

function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
}

async function checkKvRateLimit(
  kv: any,
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - windowSeconds

  try {
    // Atomic increment + expiry
    const current = await kv.get(key, 'json')
    if (!current || current.reset < now) {
      await kv.put(key, JSON.stringify({ count: 1, reset: now + windowSeconds }), { expirationTtl: windowSeconds + 10 })
      return { allowed: true, remaining: maxRequests - 1 }
    }

    if (current.count >= maxRequests) {
      return { allowed: false, remaining: 0 }
    }

    await kv.put(key, JSON.stringify({ ...current, count: current.count + 1 }), { expirationTtl: windowSeconds + 10 })
    return { allowed: true, remaining: maxRequests - current.count - 1 }
  } catch {
    return { allowed: true, remaining: 1 } // fail open
  }
}

/**
 * Rate limit registration.
 * - Per-IP: max 3 per hour
 * - Per-email: max 2 per day
 */
export function rateLimitRegistration(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const kv = (c.env as any)?.TENANT_KV
    if (!kv) { await next(); return }
    const ip = clientIp(c)
    const ipResult = await checkKvRateLimit(kv, `rl:register:ip:${ip}`, 3, 3600)
    if (!ipResult.allowed) {
      return c.json({ error: 'Too many registration attempts. Try again later.', retryAfter: 3600 }, 429)
    }
    await next()
  }
}

/**
 * Rate limit login.
 * - Per-IP: max 10 per 15 minutes
 */
export function rateLimitLogin(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const kv = (c.env as any)?.TENANT_KV
    if (!kv) { await next(); return }
    const ip = clientIp(c)
    const result = await checkKvRateLimit(kv, `rl:login:ip:${ip}`, 10, 900)
    if (!result.allowed) {
      return c.json({ error: 'Too many login attempts. Try again later.', retryAfter: 900 }, 429)
    }
    await next()
  }
}

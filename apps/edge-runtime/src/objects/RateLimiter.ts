/**
 * EdgeGDE Runtime — Durable Object Token-Bucket Rate Limiter
 * HSAES Phase 20: Platform hardening with DO-based rate limiting.
 *
 * Token bucket: 60 requests per minute, continuous refill.
 * Uses DO state.storage for persistence across requests.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const MAX_TOKENS = 60
const REFILL_INTERVAL_MS = 60_000 // 1 minute
const REFILL_RATE = MAX_TOKENS // refill all tokens over the interval

// ═══════════════════════════════════════════════════════════════════════════
// Durable Object State Keys
// ═══════════════════════════════════════════════════════════════════════════

const KEY_TOKENS = 'tokens'
const KEY_LAST_REFILL = 'lastRefill'

// ═══════════════════════════════════════════════════════════════════════════
// RateLimiter Durable Object
// ═══════════════════════════════════════════════════════════════════════════

export class RateLimiter {
  private state: DurableObjectState

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    // ── Parse tenantId from request ───────────────────────────────────────
    let tenantId: string | null = null

    if (request.method === 'POST') {
      try {
        const body = await request.json() as { tenantId?: string }
        tenantId = body.tenantId ?? null
      } catch {
        // Not JSON body — try URL params
      }
    }

    if (!tenantId) {
      const url = new URL(request.url)
      tenantId = url.searchParams.get('tenantId')
    }

    if (!tenantId) {
      return Response.json(
        { error: 'Missing tenantId parameter' },
        { status: 400 },
      )
    }

    // ── Token bucket logic ────────────────────────────────────────────────
    const now = Date.now()
    const storage = this.state.storage

    // Use per-tenant keys so different tenants don't interfere
    const tokenKey = `${KEY_TOKENS}:${tenantId}`
    const refillKey = `${KEY_LAST_REFILL}:${tenantId}`

    // Get current state
    let tokens = await storage.get<number>(tokenKey) ?? MAX_TOKENS
    let lastRefill = await storage.get<number>(refillKey) ?? now

    // Calculate refill
    const elapsed = now - lastRefill
    const refillTokens = Math.floor((elapsed / REFILL_INTERVAL_MS) * REFILL_RATE)

    if (refillTokens > 0) {
      tokens = Math.min(MAX_TOKENS, tokens + refillTokens)
      lastRefill = now
    }

    // Check if request is allowed
    let allowed = false
    let remaining = tokens

    if (tokens >= 1) {
      tokens -= 1
      allowed = true
      remaining = tokens
    }

    // Persist updated state
    await storage.put(tokenKey, tokens)
    await storage.put(refillKey, lastRefill)

    return Response.json({
      allowed,
      remaining,
    })
  }
}

/**
 * EdgeGDE Runtime — Local Dev Rate Limiter Shim
 * HSAES Phase 20: In-memory token bucket for use outside Durable Objects.
 *
 * Same API as the Durable Object RateLimiter but backed by an
 * in-memory Map instead of DO state.storage.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const MAX_TOKENS = 60
const REFILL_INTERVAL_MS = 60_000 // 1 minute
const REFILL_RATE = MAX_TOKENS

// ═══════════════════════════════════════════════════════════════════════════
// Per-tenant token bucket state
// ═══════════════════════════════════════════════════════════════════════════

interface BucketState {
  tokens: number
  lastRefill: number
}

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Token Bucket Implementation
// ═══════════════════════════════════════════════════════════════════════════

export class LocalRateLimiter {
  private buckets = new Map<string, BucketState>()

  /**
   * Check if a request is allowed for the given tenant.
   * Returns same shape as Durable Object RateLimiter.fetch():
   * `{ allowed: boolean, remaining: number }`
   */
  async check(
    tenantId: string,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now()
    let state = this.buckets.get(tenantId)

    if (!state) {
      state = { tokens: MAX_TOKENS, lastRefill: now }
      this.buckets.set(tenantId, state)
    }

    // Calculate refill
    const elapsed = now - state.lastRefill
    const refillTokens = Math.floor(
      (elapsed / REFILL_INTERVAL_MS) * REFILL_RATE,
    )

    if (refillTokens > 0) {
      state.tokens = Math.min(MAX_TOKENS, state.tokens + refillTokens)
      state.lastRefill = now
    }

    // Check if request is allowed
    let allowed = false
    let remaining = state.tokens

    if (state.tokens >= 1) {
      state.tokens -= 1
      allowed = true
      remaining = state.tokens
    }

    return { allowed, remaining }
  }

  /**
   * Reset rate limiter state for a tenant (useful in tests).
   */
  reset(tenantId?: string): void {
    if (tenantId) {
      this.buckets.delete(tenantId)
    } else {
      this.buckets.clear()
    }
  }

  /**
   * Get current token count for a tenant (useful for debugging).
   */
  getTokens(tenantId: string): number {
    const state = this.buckets.get(tenantId)
    return state?.tokens ?? MAX_TOKENS
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton instance for use across the app
// ═══════════════════════════════════════════════════════════════════════════

export const rateLimiter = new LocalRateLimiter()

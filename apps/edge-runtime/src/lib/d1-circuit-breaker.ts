/**
 * EdgeGDE — D1 Circuit Breaker (FRS P3)
 * =======================================
 * Prevents cascading failures when D1 is unavailable.
 * After 3 consecutive failures, enters degraded mode for 30s.
 */
export class D1CircuitBreaker {
  private failures = 0
  private lastFailure = 0
  private readonly threshold = 3
  private readonly cooldownMs = 30000

  /** True if circuit is open (in degraded mode) */
  get isOpen(): boolean {
    if (this.failures >= this.threshold) {
      const elapsed = Date.now() - this.lastFailure
      if (elapsed > this.cooldownMs) {
        this.failures = 0 // Auto-recover after cooldown
        return false
      }
      return true
    }
    return false
  }

  get failureCount(): number { return this.failures }

  /** Record a failure. Returns true if circuit just opened. */
  recordFailure(): boolean {
    this.failures++
    this.lastFailure = Date.now()
    return this.failures >= this.threshold
  }

  /** Record a success — resets failure count. */
  recordSuccess(): void {
    this.failures = 0
  }

  /** Reset entirely. */
  reset(): void {
    this.failures = 0
    this.lastFailure = 0
  }
}

/** Global circuit breaker instance for D1. */
export const d1CircuitBreaker = new D1CircuitBreaker()

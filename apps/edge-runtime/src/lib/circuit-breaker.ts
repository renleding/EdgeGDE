/**
 * EdgeGDE — LLM Circuit Breaker
 *
 * Prevents cascading failures when LLM providers are unavailable.
 * Tracks consecutive failures and opens the circuit after a threshold.
 * Automatically half-opens after a cooldown period.
 *
 * Usage:
 *   import { llmCircuitBreaker } from './lib/circuit-breaker'
 *
 *   if (!llmCircuitBreaker.isAvailable()) {
 *     return { error: 'LLM temporarily unavailable', cached: true }
 *   }
 *
 *   try {
 *     const result = await callLLM(prompt)
 *     llmCircuitBreaker.recordSuccess()
 *     return result
 *   } catch (err) {
 *     llmCircuitBreaker.recordFailure()
 *     throw err
 *   }
 *
 * @packageDocumentation
 */

interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit (default: 5) */
  failureThreshold: number
  /** Milliseconds to wait before half-opening (default: 30_000 = 30s) */
  cooldownMs: number
  /** Maximum half-open attempts before giving up (default: 3) */
  maxHalfOpenAttempts: number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  maxHalfOpenAttempts: 3,
}

type CircuitState = 'closed' | 'open' | 'half-open'

class CircuitBreaker {
  private config: CircuitBreakerConfig
  private state: CircuitState = 'closed'
  private failureCount = 0
  private halfOpenAttempts = 0
  private lastFailureTime = 0
  private totalFailures = 0
  private totalSuccesses = 0
  private lastError: string | null = null

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Check if the circuit allows requests through. */
  isAvailable(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime
      if (elapsed >= this.config.cooldownMs) {
        this.state = 'half-open'
        this.halfOpenAttempts = 0
        return true
      }
      return false
    }
    // half-open: allow but track attempts
    if (this.halfOpenAttempts < this.config.maxHalfOpenAttempts) {
      this.halfOpenAttempts++
      return true
    }
    return false
  }

  /** Record a successful call. Resets failure count. */
  recordSuccess(): void {
    this.totalSuccesses++
    this.failureCount = 0
    this.halfOpenAttempts = 0
    this.lastError = null
    if (this.state === 'half-open') {
      this.state = 'closed'
    }
  }

  /** Record a failed call. May open the circuit. */
  recordFailure(error?: string): void {
    this.totalFailures++
    this.failureCount++
    this.lastFailureTime = Date.now()
    this.lastError = error ?? 'Unknown error'

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open'
    }
  }

  /** Reset the circuit to closed state. */
  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.halfOpenAttempts = 0
    this.lastFailureTime = 0
  }

  /** Get circuit breaker status for observability. */
  getStatus(): { state: CircuitState; failureCount: number; totalFailures: number; totalSuccesses: number; lastError: string | null; available: boolean } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastError: this.lastError,
      available: this.isAvailable(),
    }
  }
}

/** Default singleton LLM circuit breaker. */
export const llmCircuitBreaker = new CircuitBreaker()

/** Create a named circuit breaker instance. */
export function createCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return new CircuitBreaker(config)
}

export type { CircuitBreakerConfig, CircuitState }
export { CircuitBreaker }

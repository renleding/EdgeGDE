/**
 * EdgeGDE — Circuit Breaker Test Suite
 *
 * Covers:
 *   - Circuit opens after N failures
 *   - Circuit closes (resets) after cooldown
 *   - Half-open state transitions (limited attempts, success closes, failure reopens)
 *   - Success resets failure counter
 *   - Singleton and factory exports
 *   - getStatus observability
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { CircuitBreaker, llmCircuitBreaker, createCircuitBreaker } from '../../../src/lib/circuit-breaker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a deterministic breaker with fast cooldown for timing tests. */
function makeBreaker(config?: Partial<{
  failureThreshold: number
  cooldownMs: number
  maxHalfOpenAttempts: number
}>): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 1000, // 1 second — fast but we control it with fake timers
    maxHalfOpenAttempts: 2,
    ...config,
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  // Singleton tests — isolated from the timing-sensitive tests below
  describe('exports', () => {
    it('exports a default singleton instance', () => {
      expect(llmCircuitBreaker).toBeInstanceOf(CircuitBreaker)
    })

    it('createCircuitBreaker returns a fresh instance', () => {
      const cb = createCircuitBreaker('test')
      expect(cb).toBeInstanceOf(CircuitBreaker)
      expect(cb).not.toBe(llmCircuitBreaker)
    })
  })

  describe('closed state', () => {
    let cb: CircuitBreaker

    beforeEach(() => {
      cb = new CircuitBreaker()
    })

    it('starts closed and available', () => {
      expect(cb.isAvailable()).toBe(true)
      const status = cb.getStatus()
      expect(status.state).toBe('closed')
      expect(status.available).toBe(true)
      expect(status.failureCount).toBe(0)
    })

    it('records successes without affecting availability (increments counter)', () => {
      cb.recordSuccess()
      expect(cb.isAvailable()).toBe(true)
      expect(cb.getStatus().totalSuccesses).toBe(1)
      expect(cb.getStatus().failureCount).toBe(0)
    })

    it('records failures and increments counters', () => {
      cb.recordFailure('oops')
      expect(cb.isAvailable()).toBe(true)
      const s = cb.getStatus()
      expect(s.failureCount).toBe(1)
      expect(s.totalFailures).toBe(1)
      expect(s.lastError).toBe('oops')
    })

    it('keeps circuit closed when failures are below threshold', () => {
      cb.recordFailure()
      cb.recordFailure()
      expect(cb.isAvailable()).toBe(true)
      expect(cb.getStatus().state).toBe('closed')
    })

    it('success resets failure count while in closed state', () => {
      cb.recordFailure()
      cb.recordFailure()
      cb.recordSuccess()
      expect(cb.getStatus().failureCount).toBe(0)
      expect(cb.isAvailable()).toBe(true)
    })

    it('defaults lastError to null when no failures recorded', () => {
      expect(cb.getStatus().lastError).toBeNull()
    })
  })

  describe('open state — circuit opens after N failures', () => {
    let cb: CircuitBreaker

    beforeEach(() => {
      cb = makeBreaker({ failureThreshold: 3 })
    })

    it('opens after threshold failures', () => {
      cb.recordFailure('err1')
      cb.recordFailure('err2')
      cb.recordFailure('err3')
      expect(cb.getStatus().state).toBe('open')
      expect(cb.isAvailable()).toBe(false)
    })

    it('records last error when circuit opens', () => {
      cb.recordFailure('a')
      cb.recordFailure('b')
      cb.recordFailure('fatal')
      expect(cb.getStatus().lastError).toBe('fatal')
    })

    it('stays open on further failures', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure()
      expect(cb.isAvailable()).toBe(false)
      cb.recordFailure('extra')
      expect(cb.getStatus().state).toBe('open')
      expect(cb.getStatus().totalFailures).toBe(4)
    })

    it('uses default error message when none provided', () => {
      cb = makeBreaker({ failureThreshold: 1 })
      cb.recordFailure()
      expect(cb.getStatus().lastError).toBe('Unknown error')
    })

    it('remains unavailable while cooldown has not elapsed', () => {
      vi.useFakeTimers()
      try {
        cb.recordFailure() // 1
        cb.recordFailure() // 2
        cb.recordFailure() // 3  — open now
        expect(cb.isAvailable()).toBe(false)

        // Advance time halfway through cooldown
        vi.advanceTimersByTime(500)
        expect(cb.isAvailable()).toBe(false)
        expect(cb.getStatus().state).toBe('open')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('half-open state — circuit resets after cooldown', () => {
    let cb: CircuitBreaker

    beforeEach(() => {
      cb = makeBreaker({ failureThreshold: 2, cooldownMs: 1000, maxHalfOpenAttempts: 2 })
    })

    it('transitions to half-open after cooldown elapses', () => {
      vi.useFakeTimers()
      try {
        cb.recordFailure('f1')
        cb.recordFailure('f2') // open
        expect(cb.isAvailable()).toBe(false)

        // After cooldown, isAvailable() should transition to half-open
        vi.advanceTimersByTime(1000)
        expect(cb.isAvailable()).toBe(true)
        expect(cb.getStatus().state).toBe('half-open')
      } finally {
        vi.useRealTimers()
      }
    })

    it('allows limited attempts in half-open state', () => {
      vi.useFakeTimers()
      try {
        cb.recordFailure()
        cb.recordFailure() // open
        vi.advanceTimersByTime(1000)

        // maxHalfOpenAttempts = 2
        // First call transitions open→half-open (increments halfOpenAttempts=0, returns true)
        expect(cb.isAvailable()).toBe(true) // transition
        // Next 2 calls are the half-open attempts
        expect(cb.isAvailable()).toBe(true) // attempt 1
        expect(cb.isAvailable()).toBe(true) // attempt 2
        // 4th call is blocked
        expect(cb.isAvailable()).toBe(false) // attempt 3 — blocked
        expect(cb.getStatus().state).toBe('half-open')
      } finally {
        vi.useRealTimers()
      }
    })

    it('closes circuit on success during half-open (success resets state)', () => {
      vi.useFakeTimers()
      try {
        cb.recordFailure()
        cb.recordFailure() // open
        vi.advanceTimersByTime(1000)

        // Half-open → one attempt succeeds
        expect(cb.isAvailable()).toBe(true)
        cb.recordSuccess()
        expect(cb.getStatus().state).toBe('closed')
        expect(cb.getStatus().failureCount).toBe(0)
        expect(cb.isAvailable()).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('re-opens circuit on failure during half-open', () => {
      vi.useFakeTimers()
      try {
        cb.recordFailure()
        cb.recordFailure() // open
        vi.advanceTimersByTime(1000)

        // Half-open → attempt fails
        expect(cb.isAvailable()).toBe(true) // attempt 1
        cb.recordFailure('half-open failure')
        expect(cb.getStatus().state).toBe('open')
        expect(cb.getStatus().lastError).toBe('half-open failure')

        // Must wait for cooldown again
        expect(cb.isAvailable()).toBe(false)
        vi.advanceTimersByTime(999)
        expect(cb.isAvailable()).toBe(false) // still in cooldown
      } finally {
        vi.useRealTimers()
      }
    })

    it('resets halfOpenAttempts counter when transitioning from open to half-open', () => {
      vi.useFakeTimers()
      try {
        cb.recordFailure()
        cb.recordFailure() // open
        vi.advanceTimersByTime(1000)
        expect(cb.isAvailable()).toBe(true) // transition (open→half-open)
        expect(cb.isAvailable()).toBe(true) // attempt 1
        expect(cb.isAvailable()).toBe(true) // attempt 2
        // All half-open attempts exhausted — stays half-open but blocks
        expect(cb.isAvailable()).toBe(false)
        expect(cb.getStatus().state).toBe('half-open')

        // Advancing time does NOT help because state is half-open,
        // not open — the cooldown check only fires in the open state.
        // A failure in half-open transitions back to open instead.
        // Record a failure through the real path:
        // (simulate the call that was allowed then failed)
        cb.recordFailure('attempt failed')
        expect(cb.getStatus().state).toBe('open')

        // Now cooldown will reset attempts
        vi.advanceTimersByTime(1000)
        expect(cb.isAvailable()).toBe(true) // transition again (open→half-open)
        expect(cb.isAvailable()).toBe(true) // attempt 1
        expect(cb.isAvailable()).toBe(true) // attempt 2
        expect(cb.isAvailable()).toBe(false) // exhausted again
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('reset()', () => {
    it('resets to closed state and clears counters', () => {
      const cb = makeBreaker({ failureThreshold: 1 })
      cb.recordFailure('boom')
      expect(cb.getStatus().state).toBe('open')

      cb.reset()
      const s = cb.getStatus()
      expect(s.state).toBe('closed')
      expect(s.failureCount).toBe(0)
      // lastError is NOT cleared by reset (design preserves it for observability)
      expect(s.lastError).toBe('boom')
      expect(s.available).toBe(true)
    })

    it('does not clear total counters (cumulative metrics preserved? — failureCount is reset, totalFailures/totalSuccesses persist)', () => {
      const cb = makeBreaker({ failureThreshold: 2 })
      cb.recordSuccess()
      cb.recordFailure('x')
      cb.recordFailure('y')
      expect(cb.getStatus().totalFailures).toBe(2)
      expect(cb.getStatus().totalSuccesses).toBe(1)

      cb.reset()
      const s = cb.getStatus()
      // failureCount should be 0 (reset), but totalFailures/totalSuccesses persist
      expect(s.failureCount).toBe(0)
      expect(s.totalFailures).toBe(2)
      expect(s.totalSuccesses).toBe(1)
    })
  })

  describe('getStatus()', () => {
    it('returns full status object with all fields', () => {
      const cb = makeBreaker({ failureThreshold: 2 })
      const s = cb.getStatus()
      expect(s).toHaveProperty('state')
      expect(s).toHaveProperty('failureCount')
      expect(s).toHaveProperty('totalFailures')
      expect(s).toHaveProperty('totalSuccesses')
      expect(s).toHaveProperty('lastError')
      expect(s).toHaveProperty('available')
    })

    it('reflects live state changes', () => {
      const cb = makeBreaker({ failureThreshold: 2 })
      let s = cb.getStatus()
      expect(s.state).toBe('closed')
      expect(s.available).toBe(true)

      cb.recordFailure('x')
      cb.recordFailure('y')
      s = cb.getStatus()
      expect(s.state).toBe('open')
      expect(s.available).toBe(false)
      expect(s.lastError).toBe('y')
      expect(s.failureCount).toBe(2)
    })
  })

  describe('custom configuration', () => {
    it('uses defaults when no config provided', () => {
      const cb = new CircuitBreaker()
      // Default: 5 failures to open
      cb.recordFailure()
      cb.recordFailure()
      cb.recordFailure()
      cb.recordFailure()
      expect(cb.getStatus().state).toBe('closed')
      cb.recordFailure()
      expect(cb.getStatus().state).toBe('open')
    })

    it('accepts partial config overrides', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 })
      cb.recordFailure()
      expect(cb.getStatus().state).toBe('open')
    })
  })
})

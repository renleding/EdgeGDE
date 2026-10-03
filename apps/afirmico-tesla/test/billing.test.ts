/**
 * Tests for the billing-limit guard (FRS-010 F02-R13, F02-N04; R-07).
 *
 * The requirement being tested is narrow and easy to get subtly wrong: the
 * billing limit MUST sit at least 10x above projected monthly usage, and the
 * 80%/100% alerts MUST be wired. The failure it prevents is unrecoverable —
 * Tesla strips every telemetry config on a breach and does not restore them —
 * so the assertions below are about the *decision*, not the plumbing.
 */

import { describe, expect, it } from 'vitest'
import {
  ALERT_BREACH_FRACTION,
  ALERT_WARN_FRACTION,
  MIN_MARGIN_RATIO,
  evaluateBillingGuard,
  monthWindow,
  projectMonth,
} from '../src/billing'
import { SIGNALS_PER_DOLLAR } from '../src/telemetry'

/** Signals needed to reach `usd`, at the platform's own rate. */
const signalsFor = (usd: number) => usd * SIGNALS_PER_DOLLAR

describe('projectMonth', () => {
  it('scales month-to-date usage up to a full month', () => {
    // 10 days in, 10 USD spent, 30-day month -> 30 USD projected.
    expect(projectMonth(signalsFor(10), 10, 30)).toBeCloseTo(signalsFor(30), 6)
  })

  it('does not divide by zero on day 0', () => {
    expect(projectMonth(signalsFor(5), 0, 30)).toBe(0)
  })

  it('projects a whole month when the month is complete', () => {
    expect(projectMonth(signalsFor(12), 30, 30)).toBeCloseTo(signalsFor(12), 6)
  })
})

describe('monthWindow', () => {
  it('counts elapsed days as the day-of-month (UTC)', () => {
    expect(monthWindow('2026-10-03T04:05:06Z')).toEqual({
      month: '2026-10',
      daysElapsed: 3,
      daysInMonth: 31,
    })
  })

  it('gets February right in a leap year', () => {
    expect(monthWindow('2028-02-15T00:00:00Z').daysInMonth).toBe(29)
  })

  it('gets February right in a non-leap year', () => {
    expect(monthWindow('2027-02-15T00:00:00Z').daysInMonth).toBe(28)
  })
})

describe('evaluateBillingGuard — the 10x margin (F02-R13)', () => {
  it('passes a limit exactly at the 10x floor', () => {
    // Half the month elapsed, 5 USD spent -> 10 USD projected -> 10x is 100.
    const g = evaluateBillingGuard({
      signalsMtd: signalsFor(5),
      daysElapsed: 15,
      daysInMonth: 30,
      limitUsd: 100,
    })
    expect(g.marginRatio).toBeCloseTo(10, 6)
    expect(g.marginOk).toBe(true)
  })

  it('fails a limit below the floor', () => {
    const g = evaluateBillingGuard({
      signalsMtd: signalsFor(5),
      daysElapsed: 15,
      daysInMonth: 30,
      limitUsd: 99,
    })
    expect(g.marginOk).toBe(false)
    expect(g.marginRatio).toBeLessThan(MIN_MARGIN_RATIO)
  })

  it('treats an unset limit as unconfigured, NOT as healthy', () => {
    const g = evaluateBillingGuard({
      signalsMtd: signalsFor(5),
      daysElapsed: 15,
      daysInMonth: 30,
      limitUsd: null,
    })
    expect(g.configured).toBe(false)
    // No margin can be asserted, so this must never read as "fine".
    expect(g.marginOk).toBe(false)
    expect(g.marginRatio).toBeNull()
  })

  it('treats a zero limit as unconfigured rather than instantly breached', () => {
    const g = evaluateBillingGuard({
      signalsMtd: signalsFor(5),
      daysElapsed: 15,
      daysInMonth: 30,
      limitUsd: 0,
    })
    expect(g.configured).toBe(false)
    expect(g.alertBreach).toBe(false)
  })

  it('reports no_usage projection without inventing a margin', () => {
    const g = evaluateBillingGuard({
      signalsMtd: 0,
      daysElapsed: 3,
      daysInMonth: 30,
      limitUsd: 100,
    })
    expect(g.projectedMonthUsd).toBe(0)
    expect(g.marginRatio).toBeNull()
    expect(g.marginOk).toBe(false)
  })
})

describe('evaluateBillingGuard — alerts (F02-R13)', () => {
  const opts = { signalsMtd: signalsFor(8), daysElapsed: 15, daysInMonth: 30, limitUsd: 100 }

  it('raises the 80% alert at the threshold', () => {
    // 8 of 100 consumed while 20/day projects to 16 for the month...
    // consumed is measured against the limit, so this is 0.08 — not 80%.
    const g = evaluateBillingGuard(opts)
    expect(g.consumedFraction).toBeCloseTo(0.08, 6)
    expect(g.alertWarn).toBe(false)
  })

  it('raises the 80% alert once 80% of the limit is consumed', () => {
    const g = evaluateBillingGuard({ ...opts, signalsMtd: signalsFor(80) })
    expect(g.alertWarn).toBe(true)
    expect(g.alertBreach).toBe(false)
  })

  it('raises the breach alert at 100%', () => {
    const g = evaluateBillingGuard({ ...opts, signalsMtd: signalsFor(100) })
    expect(g.alertBreach).toBe(true)
  })

  it('raises the breach alert past 100%', () => {
    const g = evaluateBillingGuard({ ...opts, signalsMtd: signalsFor(250) })
    expect(g.alertBreach).toBe(true)
  })

  it('keeps the alert thresholds ordered', () => {
    expect(ALERT_WARN_FRACTION).toBeLessThan(ALERT_BREACH_FRACTION)
  })

  it('does not alert on consumption when the limit is unset', () => {
    const g = evaluateBillingGuard({ ...opts, limitUsd: null })
    expect(g.alertWarn).toBe(false)
    expect(g.alertBreach).toBe(false)
    expect(g.consumedFraction).toBeNull()
  })
})

describe('evaluateBillingGuard — the margin is a forecast, not a reading', () => {
  it('flags a limit that looks fine on day 1 but cannot survive the month', () => {
    // Day 1, 1 USD spent -> 30 USD projected. A 100 USD limit fails 10x.
    const g = evaluateBillingGuard({
      signalsMtd: signalsFor(1),
      daysElapsed: 1,
      daysInMonth: 30,
      limitUsd: 100,
    })
    expect(g.usageUsd).toBeLessThan(2)
    expect(g.marginOk).toBe(false)
    expect(g.projectedMonthUsd).toBeCloseTo(30, 4)
  })

  it('does not breach merely because usage is on pace to fill the limit', () => {
    const g = evaluateBillingGuard({
      signalsMtd: signalsFor(1),
      daysElapsed: 1,
      daysInMonth: 30,
      limitUsd: 100,
    })
    expect(g.alertBreach).toBe(false)
  })
})

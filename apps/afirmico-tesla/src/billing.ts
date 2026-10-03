/**
 * Billing-limit guard (F02-R13, F02-N04; closes the Tier 1 half of R-07).
 *
 * Why this exists. A Tesla billing-limit breach is the highest-severity failure
 * in the system: Tesla strips every `fleet_telemetry_config` from every vehicle
 * and does NOT restore them. Collecting stops silently, and because the relay
 * only forwards, nothing at the relay can notice. deploy.md says so outright —
 * "The relay is the wrong place to detect this — it is Tier 1's /healthz and the
 * billing alerts that must catch it."
 *
 * So this module owns detection only, and deliberately does not own remediation.
 * It answers one question from data the platform already stores
 * (`tesla_signal_counter`, the same table `costReport` reads): are we inside the
 * safety margin F02-R13 requires? The answer is surfaced through `/healthz` so
 * it is visible in production rather than only in a dashboard nobody opens.
 *
 * The margin is the point. F02-R13 requires the limit to be at least 10x
 * projected monthly usage. A limit set too close to real usage is not a safety
 * net — the first busy month breaches, and a breach is unrecoverable in place.
 */

import { newId } from './store'
import { SIGNALS_PER_DOLLAR, costReport } from './telemetry'

/** F02-R13: the limit MUST be at least this multiple of projected usage. */
export const MIN_MARGIN_RATIO = 10

/** Alert thresholds, as the fraction of the limit that has been consumed. */
export const ALERT_WARN_FRACTION = 0.8
export const ALERT_BREACH_FRACTION = 1.0

export interface BillingGuardEvaluation {
  /** Whether a billing limit is actually configured. */
  configured: boolean
  usageUsd: number
  /** Projected spend for the whole calendar month, from month-to-date usage. */
  projectedMonthUsd: number
  /** The configured limit. `null` when unset — never treat unset as unlimited. */
  limitUsd: number | null
  /** limitUsd / projectedMonthUsd. `null` when unconfigured or no usage yet. */
  marginRatio: number | null
  /** Whether the margin meets F02-R13's floor. */
  marginOk: boolean
  /** Fraction of the limit consumed month-to-date. */
  consumedFraction: number | null
  alertWarn: boolean
  alertBreach: boolean
}

/**
 * Project the month from month-to-date signals.
 *
 * Month-to-date is incomplete by definition, so comparing it directly to a
 * monthly limit always looks safe early in the month and is most wrong exactly
 * when it matters. Days elapsed, not days remaining, drives the scaling.
 */
export function projectMonth(signalsMtd: number, daysElapsed: number, daysInMonth: number): number {
  if (daysElapsed <= 0) return 0
  const perDay = signalsMtd / daysElapsed
  return perDay * daysInMonth
}

/** Days in the UTC month containing `nowIso`, and the day-of-month (1-based). */
export function monthWindow(nowIso: string): { month: string; daysElapsed: number; daysInMonth: number } {
  const [year, month, day] = nowIso.slice(0, 10).split('-').map(Number)
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { month: `${nowIso.slice(0, 7)}`, daysElapsed: day, daysInMonth }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * Pure evaluation — no I/O, so the decision logic is testable on its own.
 */
export function evaluateBillingGuard(options: {
  signalsMtd: number
  daysElapsed: number
  daysInMonth: number
  limitUsd: number | null
}): BillingGuardEvaluation {
  const usageUsd = options.signalsMtd / SIGNALS_PER_DOLLAR
  const projectedSignals = projectMonth(options.signalsMtd, options.daysElapsed, options.daysInMonth)
  const projectedMonthUsd = projectedSignals / SIGNALS_PER_DOLLAR
  const limitUsd = options.limitUsd

  const configured = typeof limitUsd === 'number' && limitUsd > 0
  const marginRatio =
    configured && projectedMonthUsd > 0 ? round((limitUsd as number) / projectedMonthUsd) : null
  const consumedFraction = configured ? round(usageUsd / (limitUsd as number)) : null

  return {
    configured,
    usageUsd: round(usageUsd),
    projectedMonthUsd: round(projectedMonthUsd),
    limitUsd: limitUsd ?? null,
    marginRatio,
    marginOk: marginRatio !== null && marginRatio >= MIN_MARGIN_RATIO,
    consumedFraction,
    alertWarn: consumedFraction !== null && consumedFraction >= ALERT_WARN_FRACTION,
    alertBreach: consumedFraction !== null && consumedFraction >= ALERT_BREACH_FRACTION,
  }
}

/**
 * Run the guard for the current month and record the result.
 *
 * `previousState` is threaded in by the caller rather than read here so the
 * alert-transition decision is explicit and testable: an alert timestamp is
 * stamped on the *transition* into a level, so raising the limit and having the
 * level clear does not re-stamp on the way back down.
 */
export async function evaluateAndRecord(options: {
  db: D1Database
  limitUsd: number | null
  nowIso: string
  previousState?: { alert80SentAt?: string | null; alert100SentAt?: string | null } | null
}): Promise<{ evaluation: BillingGuardEvaluation; remediationState: string | null }> {
  const { month, daysElapsed, daysInMonth } = monthWindow(options.nowIso)
  const report = await costReport(options.db, month)

  const evaluation = evaluateBillingGuard({
    signalsMtd: report.signals,
    daysElapsed,
    daysInMonth,
    limitUsd: options.limitUsd,
  })

  const prev = options.previousState ?? null
  const alert80SentAt =
    prev?.alert80SentAt ?? (evaluation.alertWarn ? options.nowIso : null)
  const alert100SentAt =
    prev?.alert100SentAt ?? (evaluation.alertBreach ? options.nowIso : null)

  // A breach is recorded as `detected` and only advances past that by a
  // deliberate re-apply, which records `configs_reapplied` then `verified`.
  // Nothing in this check may clear it: Tesla does not restore the configs, so
  // a later healthy reading does not mean the fleet was repaired.
  const remediationState = evaluation.alertBreach ? 'detected' : null

  await options.db
    .prepare(
      `INSERT INTO tesla_billing_guard
         (guard_id, checked_at, limit_usd, usage_usd, projected_month, margin_ratio,
          alert_80_sent_at, alert_100_sent_at, breach_detected_at, remediation_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      options.nowIso,
      evaluation.limitUsd,
      evaluation.usageUsd,
      evaluation.projectedMonthUsd,
      evaluation.marginRatio,
      alert80SentAt,
      alert100SentAt,
      evaluation.alertBreach ? options.nowIso : null,
      remediationState,
    )
    .run()

  return { evaluation, remediationState }
}

/** The latest recorded guard row, so alert transitions can be sustained. */
export async function latestBillingGuard(
  db: D1Database,
): Promise<{ alert_80_sent_at: string | null; alert_100_sent_at: string | null } | null> {
  return await db
    .prepare(
      `SELECT alert_80_sent_at, alert_100_sent_at
         FROM tesla_billing_guard
        ORDER BY checked_at DESC
        LIMIT 1`,
    )
    .first<{ alert_80_sent_at: string | null; alert_100_sent_at: string | null }>()
}

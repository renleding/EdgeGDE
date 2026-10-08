/**
 * FEATURE-13: Data Export & Scheduled Reporting — Scheduler
 * 
 * Calendar-style recurrence engine for export schedules.
 * Supports hourly, daily, weekly, monthly, yearly, specific date, and specific weekdays.
 * Computes next_run_at for each enabled schedule.
 */

import { D1Database } from '@cloudflare/workers-types'

export interface RecurrenceConfig {
  // For 'specific_date'
  specific_date?: string // ISO date string
  // For 'specific_weekdays'
  weekdays?: number[] // 0=Sun .. 6=Sat
  time_of_day?: string // HH:MM in UTC
}

export interface ScheduleWithNextRun {
  schedule_id: string
  name: string
  description: string | null
  scope: string
  group_id: string | null
  vin: string | null
  time_range: string
  format: string
  recurrence: string
  recurrence_config: string | null
  recipients: string
  email_template: string | null
  enabled: number
  created_by: string | null
  created_at: string
  updated_at: string
  next_run_at: string | null
  last_run_at: string | null
  last_run_status: string | null
}

/**
 * Parse recurrence_config JSON into RecurrenceConfig object.
 */
export function parseRecurrenceConfig(config: string | null): RecurrenceConfig {
  if (!config) return {}
  try {
    return JSON.parse(config)
  } catch {
    return {}
  }
}

/**
 * Compute next run time for a schedule based on its recurrence rule.
 * Returns ISO string in UTC, or null if no future run exists.
 */
export function computeNextRun(
  schedule: ScheduleWithNextRun,
  from: Date = new Date()
): string | null {
  const config = parseRecurrenceConfig(schedule.recurrence_config)
  let next = new Date(from.getTime() + 60000) // Start from next minute boundary

  switch (schedule.recurrence) {
    case 'hourly':
      // Round up to next hour
      next = new Date(Math.ceil(next.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000))
      break

    case 'daily':
      // At configured time of day (default 00:00 UTC)
      const dailyTime = config.time_of_day || '00:00'
      const [dailyH, dailyM] = dailyTime.split(':').map(Number)
      next.setUTCHours(dailyH, dailyM, 0, 0)
      if (next <= from) {
        next.setUTCDate(next.getUTCDate() + 1)
      }
      break

    case 'weekly':
      // At configured time on configured day (default Sunday)
      const weeklyDay = config.weekdays?.[0] ?? 0 // 0 = Sunday
      const weeklyTime = config.time_of_day || '00:00'
      const [weeklyH, weeklyM] = weeklyTime.split(':').map(Number)
      next.setUTCHours(weeklyH, weeklyM, 0, 0)
      // Find next occurrence of target weekday
      const daysUntil = (weeklyDay - next.getUTCDay() + 7) % 7
      next.setUTCDate(next.getUTCDate() + (daysUntil === 0 && next <= from ? 7 : daysUntil))
      break

    case 'monthly':
      // At configured day and time (default 1st of month, 00:00)
      const monthlyDay = Math.min(config.weekdays?.[0] ?? 1, 28) // day of month, cap at 28
      const monthlyTime = config.time_of_day || '00:00'
      const [monthlyH, monthlyM] = monthlyTime.split(':').map(Number)
      next = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), monthlyDay, monthlyH, monthlyM, 0, 0))
      if (next <= from) {
        next = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, monthlyDay, monthlyH, monthlyM, 0, 0))
      }
      break

    case 'yearly':
      // At configured month, day, time (default Jan 1, 00:00)
      const yearlyMonth = (config.weekdays?.[0] ?? 1) - 1 // 0-11
      const yearlyDay = Math.min(config.weekdays?.[1] ?? 1, 28)
      const yearlyTime = config.time_of_day || '00:00'
      const [yearlyH, yearlyM] = yearlyTime.split(':').map(Number)
      next = new Date(Date.UTC(next.getUTCFullYear(), yearlyMonth, yearlyDay, yearlyH, yearlyM, 0, 0))
      if (next <= from) {
        next = new Date(Date.UTC(next.getUTCFullYear() + 1, yearlyMonth, yearlyDay, yearlyH, yearlyM, 0, 0))
      }
      break

    case 'specific_date':
      if (config.specific_date) {
        const [datePart, timePart] = config.specific_date.split('T')
        if (datePart) {
          const [y, m, d] = datePart.split('-').map(Number)
          const time = timePart || '00:00:00'
          const [h, mi, s] = time.split(':').map(Number)
          next = new Date(Date.UTC(y, m - 1, d, h || 0, mi || 0, s || 0))
          if (next <= from) return null // Past date, no future run
        }
      }
      break

    case 'specific_weekdays':
      if (config.weekdays && config.weekdays.length > 0) {
        const weekdayTime = config.time_of_day || '00:00'
        const [wdH, wdM] = weekdayTime.split(':').map(Number)
        const targetWeekdays = config.weekdays.sort((a, b) => a - b)
        
        // Find next matching weekday
        let found = false
        for (let i = 0; i < 7; i++) {
          const candidate = new Date(next.getTime() + i * 24 * 60 * 60 * 1000)
          candidate.setUTCHours(wdH, wdM, 0, 0)
          if (targetWeekdays.includes(candidate.getUTCDay()) && candidate > from) {
            next = candidate
            found = true
            break
          }
        }
        if (!found) return null // No matching weekday in next 7 days
      }
      break

    default:
      return null
  }

  return next.toISOString()
}

/**
 * Update next_run_at for all enabled schedules.
 * Call this periodically (e.g., via cron) or after schedule changes.
 */
export async function updateAllNextRunTimes(db: D1Database): Promise<number> {
  const schedules = await db.prepare(
    `SELECT * FROM telemetry_export_schedule WHERE enabled = 1`
  ).all<ScheduleWithNextRun>()

  let updated = 0
  for (const s of schedules.results ?? []) {
    const nextRun = computeNextRun(s)
    if (nextRun) {
      await db.prepare(
        `UPDATE telemetry_export_schedule SET next_run_at = ?, updated_at = ? WHERE schedule_id = ?`
      ).bind(nextRun, new Date().toISOString(), s.schedule_id).run()
      updated++
    }
  }
  return updated
}

/**
 * Get schedules that are due to run (next_run_at <= now).
 */
export async function getDueSchedules(db: D1Database): Promise<ScheduleWithNextRun[]> {
  const now = new Date().toISOString()
  const res = await db.prepare(
    `SELECT * FROM telemetry_export_schedule WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?`
  ).bind(now).all<ScheduleWithNextRun>()
  return res.results ?? []
}

/**
 * Update a single schedule's next_run_at after it runs.
 */
export async function updateScheduleAfterRun(
  db: D1Database,
  schedule_id: string,
  runStatus: string
): Promise<void> {
  // Fetch schedule to compute next run
  const s = await db.prepare(
    `SELECT * FROM telemetry_export_schedule WHERE schedule_id = ?`
  ).bind(schedule_id).first<ScheduleWithNextRun>()

  if (s) {
    const nextRun = computeNextRun(s)
    await db.prepare(
      `UPDATE telemetry_export_schedule 
       SET next_run_at = ?, 
           last_run_at = ?, 
           last_run_status = ?,
           updated_at = ?
       WHERE schedule_id = ?`
    ).bind(nextRun, new Date().toISOString(), runStatus, new Date().toISOString(), schedule_id).run()
  }
}

/**
 * Create a new export schedule with computed next_run_at.
 */
export async function createExportSchedule(
  db: D1Database,
  params: {
    schedule_id: string
    name: string
    description: string | null
    scope: string
    group_id: string | null
    vin: string | null
    time_range: string
    format: string
    recurrence: string
    recurrence_config: string | null
    recipients: string
    email_template: string | null
    enabled: number
    created_by: string | null
  }
): Promise<void> {
  const now = new Date().toISOString()
  
  // Create temporary schedule object to compute next_run
  const tempSchedule: ScheduleWithNextRun = {
    ...params,
    created_at: now,
    updated_at: now,
    next_run_at: null,
    last_run_at: null,
    last_run_status: null,
  }

  const nextRun = computeNextRun(tempSchedule)

  await db.prepare(
    `INSERT INTO telemetry_export_schedule (
      schedule_id, name, description, scope, group_id, vin, time_range, format,
      recurrence, recurrence_config, recipients, email_template, enabled,
      created_by, created_at, updated_at, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    params.schedule_id,
    params.name,
    params.description,
    params.scope,
    params.group_id,
    params.vin,
    params.time_range,
    params.format,
    params.recurrence,
    params.recurrence_config,
    params.recipients,
    params.email_template,
    params.enabled,
    params.created_by,
    now,
    now,
    nextRun
  ).run()
}
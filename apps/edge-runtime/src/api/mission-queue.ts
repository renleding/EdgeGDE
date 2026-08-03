/**
 * EdgeGDE Mission Queue API — FRS-007 Phase 3 (Control Plane)
 *
 * D1 Dispatcher-Performer queue with lease-based locking.
 *
 * Design (FRS-007 v1.0, Q2 resolution — LOCKED):
 *   - The Dispatcher enqueues discrete transactions.
 *   - A Performer (local State Engine daemon) claims ONE item at a time.
 *   - Claim is ATOMIC: only QUEUED items OR items whose lease has
 *     EXPIRED (no heartbeat within lease_duration_seconds) are claimable.
 *   - The claimant must heartbeat every heartbeat_interval_seconds to
 *     extend the lease; a crashed/hung performer loses the lease after
 *     the TTL and the item is automatically released back to the queue.
 *   - After max_attempts releases, the item goes DEAD (dead-lettered).
 *
 * Statuses: QUEUED → IN_PROGRESS → COMPLETED | FAILED | DEAD
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { D1Database } from '@cloudflare/workers-types'

const missionQueueRouter = new Hono()

const EnqueueSchema = z.object({
  missionId: z.string().min(1),
  payload: z.record(z.unknown()).optional().default({}),
  priority: z.number().int().min(0).max(10).optional().default(0),
  maxAttempts: z.number().int().min(1).max(10).optional().default(3),
})

const ClaimSchema = z.object({
  performerId: z.string().min(1),
  leaseDurationSeconds: z.number().int().min(10).max(600).optional().default(60),
})

const HeartbeatSchema = z.object({
  itemId: z.string().min(1),
  performerId: z.string().min(1),
})

const CompleteSchema = z.object({
  itemId: z.string().min(1),
  performerId: z.string().min(1),
  status: z.enum(['COMPLETED', 'FAILED']),
  result: z.record(z.unknown()).optional().default({}),
  error: z.string().optional().default(''),
})

function db(env: Record<string, unknown>): D1Database {
  const e = env as { DB?: D1Database }
  if (!e.DB) {
    throw new Error('D1 binding DB not configured')
  }
  return e.DB
}

const now = () => Date.now()

// ═══════════════════════════════════════════════════════════════════════
// POST /api/v1/mission-queue/enqueue — Dispatcher loads transactions
// ═══════════════════════════════════════════════════════════════════════
missionQueueRouter.post('/enqueue', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = EnqueueSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const { missionId, payload, priority, maxAttempts } = parsed.data
    const itemId = crypto.randomUUID()
    await db(c.env as Record<string, unknown>).prepare(
      `INSERT INTO mission_queue
         (item_id, mission_id, payload_json, status, priority,
          max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?)`,
    ).bind(itemId, missionId, JSON.stringify(payload), priority, maxAttempts, now(), now()).run()
    return c.json({ success: true, itemId, status: 'QUEUED' })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════
// POST /api/v1/mission-queue/claim — Performer atomically claims ONE item
// ═══════════════════════════════════════════════════════════════════════
//
// Atomic lease reclaim: eligible items are QUEUED, or IN_PROGRESS whose
// lease has expired. The claim is a single UPDATE ... RETURNING so two
// performers can never claim the same item.
missionQueueRouter.post('/claim', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = ClaimSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const { performerId, leaseDurationSeconds } = parsed.data
    const t = now()
    const leaseUntil = t + leaseDurationSeconds * 1000

    // 1. Reap expired leases first (crash/hang recovery): any IN_PROGRESS
    //    item whose lease expired returns to QUEUED, attempts + 1, unless
    //    attempts already exceed max_attempts → DEAD.
    await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET status = CASE
                WHEN attempts + 1 >= max_attempts THEN 'DEAD'
                ELSE 'QUEUED'
              END,
              lease_holder = NULL,
              lease_expires_at = NULL,
              attempts = attempts + 1,
              updated_at = ?
        WHERE status = 'IN_PROGRESS'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ?`,
    ).bind(t, t).run()

    // 2. Atomic claim — highest priority first, then oldest.
    const row = await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET status = 'IN_PROGRESS',
              lease_holder = ?,
              lease_expires_at = ?,
              last_heartbeat_at = ?,
              heartbeat_count = 0,
              updated_at = ?
        WHERE item_id = (
          SELECT item_id FROM mission_queue
           WHERE status = 'QUEUED'
           ORDER BY priority DESC, created_at ASC
           LIMIT 1
        )
        RETURNING item_id, mission_id, payload_json, status, attempts,
                  lease_expires_at, lease_duration_seconds`,
    ).bind(performerId, leaseUntil, t, t).first()

    if (!row) {
      return c.json({ success: true, item: null, message: 'queue_empty' })
    }
    return c.json({
      success: true,
      item: {
        itemId: row.item_id,
        missionId: row.mission_id,
        payload: JSON.parse(row.payload_json as string),
        status: row.status,
        attempts: row.attempts,
        leaseExpiresAt: row.lease_expires_at,
        leaseDurationSeconds: row.lease_duration_seconds,
      },
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════
// POST /api/v1/mission-queue/heartbeat — renew the lease (extend TTL)
// ═══════════════════════════════════════════════════════════════════════
missionQueueRouter.post('/heartbeat', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = HeartbeatSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const { itemId, performerId } = parsed.data
    const t = now()
    const row = await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET lease_expires_at = ?,
              last_heartbeat_at = ?,
              heartbeat_count = heartbeat_count + 1,
              updated_at = ?
        WHERE item_id = ?
          AND status = 'IN_PROGRESS'
          AND lease_holder = ?
        RETURNING item_id, lease_expires_at, heartbeat_count`,
    ).bind(t + 60000, t, t, itemId, performerId).first()
    if (!row) {
      return c.json({ success: false, error: 'lease_not_held_or_expired', itemId }, 409)
    }
    return c.json({
      success: true,
      itemId,
      leaseExpiresAt: (row as { lease_expires_at: number }).lease_expires_at,
      heartbeatCount: (row as { heartbeat_count: number }).heartbeat_count,
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════
// POST /api/v1/mission-queue/complete — verified outcome (Performer)
// ═══════════════════════════════════════════════════════════════════════
missionQueueRouter.post('/complete', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = CompleteSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const { itemId, performerId, status, result, error } = parsed.data
    const t = now()
    const row = await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET status = ?,
              result_json = ?,
              error_log = ?,
              lease_holder = NULL,
              lease_expires_at = NULL,
              completed_at = ?,
              updated_at = ?
        WHERE item_id = ?
          AND status = 'IN_PROGRESS'
          AND lease_holder = ?
        RETURNING item_id, status`,
    ).bind(status, JSON.stringify(result), error, t, t, itemId, performerId).first()
    if (!row) {
      return c.json({ success: false, error: 'lease_not_held_or_expired', itemId }, 409)
    }
    return c.json({ success: true, itemId, status: row.status })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════
// GET /api/v1/mission-queue — Control Room analytics
// ═══════════════════════════════════════════════════════════════════════
missionQueueRouter.get('/', async (c) => {
  try {
    const dbc = db(c.env as Record<string, unknown>)
    const byStatus = await dbc.prepare(
      `SELECT status, COUNT(*) AS n, MIN(created_at) AS oldest
         FROM mission_queue GROUP BY status`,
    ).all()
    const inFlight = await dbc.prepare(
      `SELECT item_id, mission_id, lease_holder,
              lease_expires_at, heartbeat_count, attempts
         FROM mission_queue WHERE status = 'IN_PROGRESS'`,
    ).all()
    return c.json({ success: true, byStatus: byStatus.results, inFlight: inFlight.results })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

export { missionQueueRouter }

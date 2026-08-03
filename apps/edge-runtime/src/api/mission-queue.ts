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
 *
 * CLOCK RULE (FRS-007 closure, LOCKED): lease issuance (claim), expiry
 * (reap), renewal (heartbeat), and validation (complete) MUST all use the
 * SAME DB clock — unixepoch() * 1000. Never mix Python/browser/DB time
 * for lease decisions; the DB is the single authority on lease state.
 *
 * Completion is ATOMIC (no TOCTOU): validate + mutate in ONE UPDATE ...
 * WHERE lease_expires_at > (unixepoch() * 1000) RETURNING. A late
 * complete() after lease expiry matches 0 rows → 409 Conflict, and the
 * queue row is untouched.
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
  targetState: z.string().optional().default(''),
  stateObjectId: z.string().optional().default(''),
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

// P1 — trust boundaries: every response crossing the network boundary is
// validated at runtime; malformed payloads fail before business logic.
const ClaimResponseSchema = z.object({
  success: z.boolean(),
  item: z.object({
    itemId: z.string(),
    missionId: z.string(),
    payload: z.record(z.unknown()),
    status: z.string(),
    attempts: z.number(),
    leaseExpiresAt: z.number(),
    leaseDurationSeconds: z.number(),
    targetState: z.string().optional(),
    stateObjectId: z.string().optional(),
  }).nullable().optional(),
  message: z.string().optional(),
})

const HeartbeatResponseSchema = z.object({
  success: z.boolean(),
  itemId: z.string().optional(),
  leaseExpiresAt: z.number().optional(),
  heartbeatCount: z.number().optional(),
  error: z.string().optional(),
})

const CompleteResponseSchema = z.object({
  success: z.boolean(),
  itemId: z.string().optional(),
  status: z.string().optional(),
  error: z.string().optional(),
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
    const { missionId, payload, priority, maxAttempts, targetState, stateObjectId } = parsed.data
    const itemId = crypto.randomUUID()
    await db(c.env as Record<string, unknown>).prepare(
      `INSERT INTO mission_queue
         (item_id, mission_id, payload_json, status, priority,
          max_attempts, target_state, state_object_id, created_at, updated_at)
       VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?)`,
    ).bind(itemId, missionId, JSON.stringify(payload), priority, maxAttempts,
           targetState || null, stateObjectId || null, now(), now()).run()
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
    const leaseMs = leaseDurationSeconds * 1000
    const dbNow = '(unixepoch() * 1000)'

    // 1. Reap expired leases first (crash/hang recovery): any IN_PROGRESS
    //    item whose lease expired returns to QUEUED, attempts + 1, unless
    //    attempts already exceed max_attempts → DEAD.
    //    CLOCK RULE: expiry compared against the DB clock, never Date.now().
    await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET status = CASE
                WHEN attempts + 1 >= max_attempts THEN 'DEAD'
                ELSE 'QUEUED'
              END,
              lease_holder = NULL,
              lease_expires_at = NULL,
              attempts = attempts + 1,
              updated_at = ${dbNow}
        WHERE status = 'IN_PROGRESS'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ${dbNow}`,
    ).run()

    // 2. Atomic claim — highest priority first, then oldest. Lease issued
    //    off the DB clock so expiry, renewal, and validation share one time.
    const row = await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET status = 'IN_PROGRESS',
              lease_holder = ?,
              lease_expires_at = ${dbNow} + ?,
              last_heartbeat_at = ${dbNow},
              heartbeat_count = 0,
              updated_at = ${dbNow}
        WHERE item_id = (
          SELECT item_id FROM mission_queue
           WHERE status = 'QUEUED'
           ORDER BY priority DESC, created_at ASC
           LIMIT 1
        )
        RETURNING item_id, mission_id, payload_json, status, attempts,
                  lease_expires_at, lease_duration_seconds,
                  target_state, state_object_id`,
    ).bind(performerId, leaseMs).first()

    if (!row) {
      return c.json(ClaimResponseSchema.parse({ success: true, item: null, message: 'queue_empty' }))
    }
    return c.json(ClaimResponseSchema.parse({
      success: true,
      item: {
        itemId: row.item_id,
        missionId: row.mission_id,
        payload: JSON.parse(row.payload_json as string),
        status: row.status,
        attempts: row.attempts,
        leaseExpiresAt: row.lease_expires_at,
        leaseDurationSeconds: row.lease_duration_seconds,
        targetState: row.target_state ?? '',
        stateObjectId: row.state_object_id ?? '',
      },
    }))
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
    const dbNow = '(unixepoch() * 1000)'
    const row = await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET lease_expires_at = ${dbNow} + 60000,
              last_heartbeat_at = ${dbNow},
              heartbeat_count = heartbeat_count + 1,
              updated_at = ${dbNow}
        WHERE item_id = ?
          AND status = 'IN_PROGRESS'
          AND lease_holder = ?
        RETURNING item_id, lease_expires_at, heartbeat_count`,
    ).bind(itemId, performerId).first()
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
    // ATOMIC completion (eliminates TOCTOU): validate lease + mutate in
    // ONE statement. The lease is valid only while lease_expires_at is in
    // the future on the DB clock — a late complete() after expiry (or after
    // reclaim by another performer) matches 0 rows → 409, state untouched.
    const dbNow = '(unixepoch() * 1000)'
    const row = await db(c.env as Record<string, unknown>).prepare(
      `UPDATE mission_queue
          SET status = ?,
              result_json = ?,
              error_log = ?,
              lease_holder = NULL,
              lease_expires_at = NULL,
              completed_at = ${dbNow},
              updated_at = ${dbNow}
        WHERE item_id = ?
          AND status = 'IN_PROGRESS'
          AND lease_holder = ?
          AND lease_expires_at > ${dbNow}
        RETURNING item_id, status`,
    ).bind(status, JSON.stringify(result), error, itemId, performerId).first()
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
    const counts = await dbc.prepare(
      `SELECT status, COUNT(*) AS n FROM mission_queue GROUP BY status`,
    ).all()
    const oldestQueued = await dbc.prepare(
      `SELECT MIN(created_at) AS oldest FROM mission_queue WHERE status='QUEUED'`,
    ).first()
    const oldestLease = await dbc.prepare(
      `SELECT MIN(lease_expires_at) AS oldest FROM mission_queue WHERE status='IN_PROGRESS'`,
    ).first()
    const recovered = await dbc.prepare(
      `SELECT COUNT(*) AS n FROM mission_queue WHERE attempts > 0`,
    ).first()
    const inFlight = await dbc.prepare(
      `SELECT item_id, mission_id, lease_holder,
              lease_expires_at, heartbeat_count, attempts
         FROM mission_queue WHERE status = 'IN_PROGRESS'`,
    ).all()

    const byStatus: Record<string, number> = {}
    for (const r of (counts.results as Array<{ status: string; n: number }>)) {
      byStatus[r.status] = r.n
    }
    const t = now()
    return c.json({
      success: true,
      metrics: {
        queue_depth: byStatus.QUEUED ?? 0,
        in_progress_count: byStatus.IN_PROGRESS ?? 0,
        dead_letter_count: byStatus.DEAD ?? 0,
        failed_count: byStatus.FAILED ?? 0,
        completed_count: byStatus.COMPLETED ?? 0,
        lease_recovery_count: (recovered?.n as number) ?? 0,
        oldest_queue_age_ms: oldestQueued?.oldest != null
          ? Math.max(0, t - (oldestQueued.oldest as number)) : 0,
        oldest_lease_age_ms: oldestLease?.oldest != null
          ? Math.max(0, t - (oldestLease.oldest as number)) : 0,
      },
      inFlight: inFlight.results,
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

export { missionQueueRouter }

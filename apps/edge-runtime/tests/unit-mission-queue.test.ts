/**
 * FRS-007 Phase 3 — Mission Queue lease-based locking tests
 *
 * Runs the REAL SQL from migrations/0025_create_mission_queue.sql against
 * an in-memory SQLite database (node:sqlite) through a D1-compatible
 * adapter, so the atomic claim subselect, lease reaping, and dead-letter
 * logic are exercised as they run in production.
 *
 * Covered:
 *   - enqueue → claim (atomic, priority-ordered)
 *   - second performer cannot claim while leased
 *   - heartbeat extends the lease
 *   - expired lease is reaped → item returns to QUEUED (attempts+1)
 *   - max_attempts exhaustion → DEAD (dead-letter)
 *   - complete finalizes; foreign performer is rejected
 */

// @ts-nocheck
import assert from 'node:assert'
import { describe, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { missionQueueRouter } from '../src/api/mission-queue'

let db
let nextItemId = 0

// ── D1-compatible adapter over node:sqlite ────────────────────────────
function createD1() {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql)
      const exec = (mode, params) => {
        const args = params.map((p) => (p === undefined ? null : p))
        if (mode === 'run') {
          return { success: true, meta: { changes: stmt.run(...args).changes } }
        }
        if (mode === 'first') {
          const row = stmt.get(...args)
          return row === undefined ? null : row
        }
        return { results: stmt.all(...args) }
      }
      const bound = (params) => ({
        run: () => exec('run', params),
        first: () => exec('first', params),
        all: () => exec('all', params),
      })
      return {
        bind: (...params) => bound(params),
        run: () => exec('run', []),
        first: () => exec('first', []),
        all: () => exec('all', []),
      }
    },
  }
}

function makeContext() {
  return {
    req: { json: async () => ({}), url: new URL('http://localhost/') },
    json: (body, status = 200) => ({ body, status }),
    env: { DB: createD1() },
  }
}

function findHandler(method, path) {
  const handler = missionQueueRouter.routes.find(
    (r) => r.method === method && r.path === path,
  )
  if (!handler) throw new Error(`no handler for ${method} ${path}`)
  return handler.handler
}

async function call(method, path, body) {
  const ctx = makeContext()
  ctx.req.json = async () => body
  ctx.req.url = new URL(`http://localhost${path}`)
  ctx.req.method = method
  return findHandler(method, path)(ctx, async () => undefined)
}

function rowById(itemId) {
  return db.prepare('SELECT * FROM mission_queue WHERE item_id = ?').get(itemId)
}

beforeEach(() => {
  const m1 = readFileSync(
    join(dirname(__dirname), 'migrations', '0025_create_mission_queue.sql'),
    'utf8',
  )
  const m2 = readFileSync(
    join(dirname(__dirname), 'migrations', '0026_add_resumption_handshake.sql'),
    'utf8',
  )
  db = new DatabaseSync(':memory:')
  db.exec(m1)
  db.exec(m2)
})

describe('FRS-007 Mission Queue — lease-based locking (real SQL)', () => {
  it('enqueues and claims an item atomically (priority order)', async () => {
    const e1 = await call('POST', '/enqueue', { missionId: 'm1', payload: { deal: 'low' }, priority: 1 })
    const e2 = await call('POST', '/enqueue', { missionId: 'm2', payload: { deal: 'high' }, priority: 5 })
    assert.strictEqual(e1.body.success, true)
    assert.strictEqual(e2.body.success, true)

    const claim = await call('POST', '/claim', { performerId: 'node-1' })
    assert.strictEqual(claim.body.success, true)
    assert.strictEqual(claim.body.item.itemId, e2.body.itemId) // high priority first
    assert.strictEqual(claim.body.item.status, 'IN_PROGRESS')
    assert.ok(claim.body.item.leaseExpiresAt > Date.now())
  })

  it('second performer cannot claim while lease is held', async () => {
    await call('POST', '/enqueue', { missionId: 'm3', payload: {} })
    await call('POST', '/claim', { performerId: 'node-1' })
    const second = await call('POST', '/claim', { performerId: 'node-2' })
    assert.strictEqual(second.body.item, null)
    assert.strictEqual(second.body.message, 'queue_empty')
  })

  it('heartbeat extends the lease', async () => {
    await call('POST', '/enqueue', { missionId: 'm4', payload: {} })
    const claim = await call('POST', '/claim', { performerId: 'node-1' })
    const itemId = claim.body.item.itemId
    const before = claim.body.item.leaseExpiresAt
    const hb = await call('POST', '/heartbeat', { itemId, performerId: 'node-1' })
    assert.strictEqual(hb.body.success, true)
    assert.strictEqual(hb.body.heartbeatCount, 1)
    assert.ok(hb.body.leaseExpiresAt >= before)
  })

  it('expired lease is reaped → item returns to QUEUED with attempts+1', async () => {
    await call('POST', '/enqueue', { missionId: 'm5', payload: {} })
    const claim = await call('POST', '/claim', { performerId: 'node-1' })
    const itemId = claim.body.item.itemId
    // Force lease expiry (performer "crashed")
    db.prepare('UPDATE mission_queue SET lease_expires_at = ? WHERE item_id = ?')
      .run(Date.now() - 1000, itemId)

    const reclaim = await call('POST', '/claim', { performerId: 'node-2' })
    assert.strictEqual(reclaim.body.success, true)
    assert.strictEqual(reclaim.body.item.itemId, itemId)
    assert.strictEqual(reclaim.body.item.attempts, 1)
    assert.strictEqual(reclaim.body.item.status, 'IN_PROGRESS')
  })

  it('max_attempts exhaustion dead-letters the item (DEAD)', async () => {
    await call('POST', '/enqueue', { missionId: 'm6', payload: {}, maxAttempts: 2 })
    const claim = await call('POST', '/claim', { performerId: 'node-1' })
    const itemId = claim.body.item.itemId
    // Expire lease → reclaim (attempts 1)
    db.prepare('UPDATE mission_queue SET lease_expires_at = ? WHERE item_id = ?')
      .run(Date.now() - 1000, itemId)
    await call('POST', '/claim', { performerId: 'node-2' })
    // Expire again → attempts 2 >= max 2 → DEAD
    db.prepare('UPDATE mission_queue SET lease_expires_at = ? WHERE item_id = ?')
      .run(Date.now() - 1000, itemId)
    const c3 = await call('POST', '/claim', { performerId: 'node-3' })
    assert.strictEqual(rowById(itemId).status, 'DEAD')
    assert.strictEqual(c3.body.item, null)
  })

  it('complete finalizes the item; foreign performer rejected', async () => {
    await call('POST', '/enqueue', { missionId: 'm7', payload: {} })
    const claim = await call('POST', '/claim', { performerId: 'node-1' })
    const itemId = claim.body.item.itemId

    // Foreign performer (not the lease holder) cannot complete
    const foreign = await call('POST', '/complete', {
      itemId, performerId: 'node-9', status: 'COMPLETED', result: {},
    })
    assert.strictEqual(foreign.body.success, false)
    assert.strictEqual(rowById(itemId).status, 'IN_PROGRESS')

    // Lease holder completes with verified outcome
    const done = await call('POST', '/complete', {
      itemId, performerId: 'node-1', status: 'COMPLETED', result: { verified: true },
    })
    assert.strictEqual(done.body.success, true)
    const final = rowById(itemId)
    assert.strictEqual(final.status, 'COMPLETED')
    assert.strictEqual(final.lease_holder, null)
    assert.strictEqual(JSON.parse(final.result_json).verified, true)
  })

  it('queue analytics reports operational metrics (P5)', async () => {
    await call('POST', '/enqueue', { missionId: 'm8', payload: {} })
    const report = await call('GET', '/', {})
    assert.strictEqual(report.body.success, true)
    const m = report.body.metrics
    assert.strictEqual(m.queue_depth, 1)
    assert.strictEqual(m.in_progress_count, 0)
    assert.strictEqual(m.dead_letter_count, 0)
    assert.strictEqual(m.lease_recovery_count, 0)
    assert.ok(m.oldest_queue_age_ms >= 0)
    assert.ok(typeof m.oldest_lease_age_ms === 'number')
  })

  it('P2: late commit rejected after lease expiry + reclaim', async () => {
    await call('POST', '/enqueue', { missionId: 'm9', payload: {} })
    const claimA = await call('POST', '/claim', { performerId: 'node-A' })
    const itemId = claimA.body.item.itemId
    // A "crashes" — force lease expiry
    db.prepare('UPDATE mission_queue SET lease_expires_at = ? WHERE item_id = ?')
      .run(Date.now() - 1000, itemId)
    // B reclaims
    const claimB = await call('POST', '/claim', { performerId: 'node-B' })
    assert.strictEqual(claimB.body.item.itemId, itemId)
    // A's late complete MUST be rejected (409 lease_not_held)
    const late = await call('POST', '/complete', {
      itemId, performerId: 'node-A', status: 'COMPLETED', result: {},
    })
    assert.strictEqual(late.body.success, false)
    assert.strictEqual(rowById(itemId).status, 'IN_PROGRESS')
    // B completes fine
    const ok = await call('POST', '/complete', {
      itemId, performerId: 'node-B', status: 'COMPLETED', result: { done: true },
    })
    assert.strictEqual(ok.body.success, true)
  })

  it('P3: claim carries target_state for the resumption handshake', async () => {
    await call('POST', '/enqueue', {
      missionId: 'm10', payload: {}, targetState: 'PERSISTED', stateObjectId: 'deal_1',
    })
    const claim = await call('POST', '/claim', { performerId: 'node-1' })
    assert.strictEqual(claim.body.item.targetState, 'PERSISTED')
    assert.strictEqual(claim.body.item.stateObjectId, 'deal_1')
  })
})

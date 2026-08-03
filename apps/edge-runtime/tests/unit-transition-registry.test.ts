/**
 * FRS-007 Observer→D1 Integration — Transition Registry tests
 *
 * Runs the REAL SQL from migrations/0025, 0026, 0027 against an
 * in-memory SQLite database (node:sqlite) through the D1-compatible
 * adapter, exercising: the A1 signature formula + L3 rejection gate,
 * the A2 UPSERT + lineage model, and the A3 4-state lifecycle with
 * SHADOW mission dispatch.
 */

// @ts-nocheck
import assert from 'node:assert'
import { describe, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { transitionsRouter } from '../src/api/transitions'

let db

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
  const handler = transitionsRouter.routes.find(
    (r) => r.method === method && r.path === path,
  )
  if (!handler) throw new Error(`no handler for ${method} ${path}`)
  return handler.handler
}

async function call(method, path, body, query = {}) {
  const ctx = makeContext()
  ctx.req.json = async () => body
  const url = new URL(`http://localhost${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  ctx.req.url = url
  ctx.req.method = method
  ctx.req.query = (key) => url.searchParams.get(key)
  return findHandler(method, path)(ctx, async () => undefined)
}

function rowBySignature(sig) {
  return db.prepare(
    'SELECT * FROM transition_registry WHERE candidate_signature = ?').get(sig)
}

function shadowRuns(sig) {
  return db.prepare(
    'SELECT run_seq, success FROM transition_shadow_runs WHERE signature = ? ORDER BY run_seq').all(sig)
}

function queuedMissions() {
  return db.prepare(
    'SELECT mission_id, payload_json FROM mission_queue WHERE status = ? ORDER BY mission_id')
    .all('QUEUED')
}

beforeEach(() => {
  const files = ['0025_create_mission_queue.sql', '0026_add_resumption_handshake.sql',
                 '0027_create_transition_registry.sql']
  db = new DatabaseSync(':memory:')
  for (const f of files) {
    db.exec(readFileSync(join(dirname(__dirname), 'migrations', f), 'utf8'))
  }
})

const basePayload = {
  objectType: 'Deal',
  transitionName: 'totalBusinessIncome',
  sourceState: 'totalBusinessIncome_DRAFT',
  targetState: 'PERSISTED',
  elementSelectors: [{ strict: "input[data-test-id='income-total']" }],
  dualGateSpec: {
    preCheck: { type: 'external_api', target: 'deal/2bc60884/income' },
    postCheck: { type: 'external_api', endpoint: '/api/v1/deals/2bc60884', expectedKey: 'income.total' },
  },
  verificationClass: 'L1',
  telemetry: {
    totalObservedRuns: 10, successRate: 1.0, distinctTransactionPasses: 4,
  },
}

describe('FRS-007 Transition Registry — observer→D1 integration (real SQL)', () => {
  it('A1: promote stores the mined payload as PENDING_APPROVAL with computed signature', async () => {
    const r = await call('POST', '/promote', basePayload)
    assert.strictEqual(r.body.success, true)
    assert.strictEqual(r.body.status, 'PENDING_APPROVAL')
    assert.match(r.body.candidateSignature, /^[0-9a-f]{64}$/)
    const row = rowBySignature(r.body.candidateSignature)
    assert.strictEqual(row.transition_family_id, 'Deal_totalBusinessIncome')
    assert.strictEqual(row.verification_class, 'L1')
    assert.strictEqual(JSON.parse(row.telemetry_json).total_observed_runs, 10)
  })

  it('A1: verification_class L3 is REJECTED (cached DOM / no reload)', async () => {
    const r = await call('POST', '/promote', { ...basePayload, verificationClass: 'L3' })
    assert.strictEqual(r.body.success, false)
    assert.match(r.body.error, /L3/)
    assert.strictEqual(r.body.status, undefined)
  })

  it('A1: client signature mismatch is rejected (server is authoritative)', async () => {
    const r = await call('POST', '/promote', {
      ...basePayload, candidateSignature: 'f'.repeat(64),
    })
    assert.strictEqual(r.body.success, false)
    assert.match(r.body.error, /mismatch/)
  })

  it('A1: signature is deterministic — same payload, same signature', async () => {
    const r1 = await call('POST', '/promote', basePayload)
    const r2 = await call('POST', '/promote', basePayload)
    assert.strictEqual(r1.body.candidateSignature, r2.body.candidateSignature)
  })

  it('A2: UPSERT on candidate_signature — re-promote refreshes telemetry, preserves status', async () => {
    const r1 = await call('POST', '/promote', basePayload)
    const sig = r1.body.candidateSignature
    // same version with updated telemetry
    const r2 = await call('POST', '/promote', {
      ...basePayload,
      telemetry: { totalObservedRuns: 12, successRate: 0.96, distinctTransactionPasses: 5 },
    })
    assert.strictEqual(r2.body.candidateSignature, sig)
    const row = rowBySignature(sig)
    assert.strictEqual(JSON.parse(row.telemetry_json).total_observed_runs, 12)
    // still one row — UPSERT did not duplicate
    const n = db.prepare('SELECT COUNT(*) AS n FROM transition_registry').get().n
    assert.strictEqual(n, 1)
  })

  it('A2: selector drift → NEW signature = NEW version row (lineage, never overwrite)', async () => {
    const r1 = await call('POST', '/promote', basePayload)
    const drifted = await call('POST', '/promote', {
      ...basePayload,
      elementSelectors: [{ strict: "input[data-test-id='income-total-v2']" }],
    })
    assert.notStrictEqual(drifted.body.candidateSignature, r1.body.candidateSignature)
    const n = db.prepare('SELECT COUNT(*) AS n FROM transition_registry').get().n
    assert.strictEqual(n, 2)  // two immutable versions of one family
    const fams = db.prepare(
      'SELECT DISTINCT transition_family_id FROM transition_registry').all()
    assert.strictEqual(fams.length, 1)  // same family, two versions
  })

  it('A3: approve flips to APPROVED_FOR_VALIDATION and enqueues 3 SHADOW missions', async () => {
    const sig = (await call('POST', '/promote', basePayload)).body.candidateSignature
    const r = await call('POST', '/approve', { signature: sig })
    assert.strictEqual(r.body.success, true)
    assert.strictEqual(r.body.status, 'APPROVED_FOR_VALIDATION')
    assert.strictEqual(r.body.shadowMissionsEnqueued, 3)
    const missions = queuedMissions()
    assert.strictEqual(missions.length, 3)
    for (const m of missions) {
      const payload = JSON.parse(m.payload_json)
      assert.strictEqual(payload.type, 'SHADOW')
      assert.strictEqual(payload.candidate_signature, sig)
    }
    assert.match(missions[0].mission_id, /^shadow-[0-9a-f]{8}-1$/)
    assert.match(missions[2].mission_id, /^shadow-[0-9a-f]{8}-3$/)
  })

  it('A3: approve on non-pending transition → 409 (no double dispatch)', async () => {
    const sig = (await call('POST', '/promote', basePayload)).body.candidateSignature
    await call('POST', '/approve', { signature: sig })
    const again = await call('POST', '/approve', { signature: sig })
    assert.strictEqual(again.body.success, false)
    assert.strictEqual(again.body.status, undefined)
    // still exactly 3 shadow missions — no duplicate enqueue
    assert.strictEqual(queuedMissions().length, 3)
  })

  it('A3: 3 consecutive shadow successes → ACTIVE', async () => {
    const sig = (await call('POST', '/promote', basePayload)).body.candidateSignature
    await call('POST', '/approve', { signature: sig })
    for (const runSeq of [1, 2, 3]) {
      const r = await call('POST', '/shadow-result', { signature: sig, runSeq, success: true })
      assert.strictEqual(r.body.status, runSeq < 3 ? 'APPROVED_FOR_VALIDATION' : 'ACTIVE')
    }
    assert.strictEqual(rowBySignature(sig).status, 'ACTIVE')
    assert.strictEqual(shadowRuns(sig).length, 3)
  })

  it('A3: any shadow failure → REJECTED', async () => {
    const sig = (await call('POST', '/promote', basePayload)).body.candidateSignature
    await call('POST', '/approve', { signature: sig })
    await call('POST', '/shadow-result', { signature: sig, runSeq: 1, success: true })
    const r = await call('POST', '/shadow-result', { signature: sig, runSeq: 2, success: false })
    assert.strictEqual(r.body.status, 'REJECTED')
    assert.strictEqual(rowBySignature(sig).status, 'REJECTED')
  })

  it('A3: shadow-result accepted only while APPROVED_FOR_VALIDATION → 409', async () => {
    const sig = (await call('POST', '/promote', basePayload)).body.candidateSignature
    const r = await call('POST', '/shadow-result', { signature: sig, runSeq: 1, success: true })
    assert.strictEqual(r.body.success, false)
    assert.strictEqual(r.body.status, undefined)
  })

  it('GET / lists transitions + pending approval count (Telegram cron poll)', async () => {
    await call('POST', '/promote', basePayload)
    // structurally distinct payload → distinct signature → second version.
    // (transition_name is a label, NOT part of the A1 signature formula —
    //  drift in selectors / states / spec changes the version.)
    await call('POST', '/promote', {
      ...basePayload,
      targetState: 'CALCULATED',
      sourceState: 'totalBusinessIncome_PERSISTED',
    })
    const r = await call('GET', '/', {})
    assert.strictEqual(r.body.success, true)
    assert.strictEqual(r.body.pendingApprovals, 2)
    assert.strictEqual(r.body.transitions.length, 2)
    const filtered = await call('GET', '/', {}, { status: 'PENDING_APPROVAL' })
    assert.strictEqual(filtered.body.transitions.length, 2)
  })
})

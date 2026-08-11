/**
 * EdgeGDE Transition Registry API — FRS-007 Observer→D1 Integration
 *
 * Item A1 — Payload contract: ONLY structural metadata crosses the
 * boundary. ZERO raw values / PII (values live in evidence.db as hashes;
 * this registry stores selectors + dual-gate specs + telemetry).
 *
 *   candidate_signature = SHA256(object_type + source_state +
 *                                target_state + selector_chain_hash +
 *                                dual_gate_spec_hash)
 *
 *   selector_chain_hash  = SHA256(canonicalJSON(element_selectors))
 *   dual_gate_spec_hash  = SHA256(canonicalJSON(dual_gate_spec))
 *   canonicalJSON        = recursively sorted-key JSON (deterministic
 *                          regardless of client field order)
 *
 * verification_class gate: L1 (independent external API) and L2 (hard
 * page reload + DOM scrape) are accepted; L3 (cached DOM / local read
 * without reload) is REJECTED.
 *
 * Item A3 — 4-state lifecycle (D1 shadow dispatch):
 *   PENDING_APPROVAL → APPROVED_FOR_VALIDATION → ACTIVE | REJECTED
 *   - POST /promote       → PENDING_APPROVAL (Telegram prompt via cron)
 *   - POST /approve       → APPROVED_FOR_VALIDATION + enqueue 3 SHADOW
 *                           missions for the signature
 *   - POST /shadow-result → 3 consecutive successes → ACTIVE;
 *                           any failure → REJECTED
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { D1Database } from '@cloudflare/workers-types'

const transitionsRouter = new Hono()

// ── payload contract (A1) ─────────────────────────────────────────────
const PromoteSchema = z.object({
  candidateSignature: z.string().min(1).optional(), // cross-check only
  objectType: z.string().min(1),
  transitionName: z.string().min(1),
  sourceState: z.string().min(1),
  targetState: z.string().min(1),
  elementSelectors: z.array(z.record(z.string(), z.unknown())).min(1),
  dualGateSpec: z.object({
    preCheck: z.object({ type: z.string(), target: z.string() }),
    postCheck: z.object({
      type: z.string(), endpoint: z.string(), expectedKey: z.string(),
    }),
  }),
  verificationClass: z.enum(['L1', 'L2', 'L3']),
  telemetry: z.object({
    totalObservedRuns: z.number().int().min(0),
    successRate: z.number().min(0).max(1),
    distinctTransactionPasses: z.number().int().min(0),
  }),
})

const ApproveSchema = z.object({ signature: z.string().min(1) })

const ShadowResultSchema = z.object({
  signature: z.string().min(1),
  runSeq: z.number().int().min(1).max(3),
  success: z.boolean(),
})

const SHADOW_REQUIRED_RUNS = 3
const PENDING_APPROVAL = 'PENDING_APPROVAL'
const APPROVED_FOR_VALIDATION = 'APPROVED_FOR_VALIDATION'
const ACTIVE = 'ACTIVE'
const REJECTED = 'REJECTED'

function db(env: Record<string, unknown>): D1Database {
  const e = env as { DB?: D1Database }
  if (!e.DB) {
    throw new Error('D1 binding DB not configured')
  }
  return e.DB
}

// ── deterministic hashing (A1 signature formula) ─────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Recursively sorted-key canonical JSON — field order cannot change the hash. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(',')}]`
  }
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

async function computeSignature(parsed: z.infer<typeof PromoteSchema>): Promise<string> {
  const selectorChainHash = await sha256Hex(canonical(parsed.elementSelectors))
  const dualGateSpecHash = await sha256Hex(canonical(parsed.dualGateSpec))
  return sha256Hex(
    parsed.objectType + parsed.sourceState + parsed.targetState
    + selectorChainHash + dualGateSpecHash)
}

// ═════════════════════════════════════════════════════════════════════
// POST /api/v1/transitions/promote — mined payload arrives from the
// Observer pipeline. PENDING_APPROVAL; human gets the Telegram prompt.
// ═════════════════════════════════════════════════════════════════════
transitionsRouter.post('/promote', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = PromoteSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const p = parsed.data

    // ── verification_class gate: L3 is REJECTED (cached DOM / no reload)
    if (p.verificationClass === 'L3') {
      return c.json({
        success: false,
        error: `verification_class L3 (cached DOM / local read without reload) is REJECTED — L1 or L2 required`,
      }, 400)
    }

    // ── server-authoritative signature (A1 formula)
    const signature = await computeSignature(p)
    if (p.candidateSignature && p.candidateSignature !== signature) {
      return c.json({
        success: false,
        error: `candidate_signature mismatch: client supplied ${p.candidateSignature}, server computed ${signature}`,
      }, 400)
    }

    const familyId = `${p.objectType}_${p.transitionName}`
    const telemetryJson = JSON.stringify({
      total_observed_runs: p.telemetry.totalObservedRuns,
      success_rate: p.telemetry.successRate,
      distinct_transaction_passes: p.telemetry.distinctTransactionPasses,
    })

    // ── idempotent UPSERT on candidate_signature: same version re-promote
    //    refreshes telemetry only (status preserved — never downgrade an
    //    APPROVED/ACTIVE row back to PENDING). Selector or verification
    //    drift produces a NEW signature = NEW version row (lineage).
    await db(c.env as Record<string, unknown>).prepare(
      `INSERT INTO transition_registry
         (transition_family_id, candidate_signature, object_type,
          source_state, target_state, element_selectors_json,
          dual_gate_spec_json, verification_class, telemetry_json,
          promoted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (unixepoch() * 1000), (unixepoch() * 1000))
       ON CONFLICT(candidate_signature) DO UPDATE
         SET telemetry_json = excluded.telemetry_json,
             updated_at = (unixepoch() * 1000)`,
    ).bind(familyId, signature, p.objectType, p.sourceState, p.targetState,
           JSON.stringify(p.elementSelectors), JSON.stringify(p.dualGateSpec),
           p.verificationClass, telemetryJson).run()

    const row = await db(c.env as Record<string, unknown>).prepare(
      `SELECT status, promoted_at FROM transition_registry
        WHERE candidate_signature = ?`,
    ).bind(signature).first()
    return c.json({
      success: true,
      candidateSignature: signature,
      transitionFamilyId: familyId,
      status: (row as { status: string }).status,
      message: 'pending human approval',
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════
// POST /api/v1/transitions/approve — human approves. D1 does NOT go to
// production: it enqueues 3 SHADOW missions for the signature.
// ═════════════════════════════════════════════════════════════════════
transitionsRouter.post('/approve', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = ApproveSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const { signature } = parsed.data
    const d1 = db(c.env as Record<string, unknown>)

    const row = await d1.prepare(
      `SELECT status, object_type, target_state, transition_family_id
         FROM transition_registry WHERE candidate_signature = ?`,
    ).bind(signature).first()
    if (!row) {
      return c.json({ success: false, error: 'transition_not_found', signature }, 404)
    }
    if (row.status !== PENDING_APPROVAL) {
      return c.json({
        success: false, error: `transition is ${row.status}, not ${PENDING_APPROVAL}`,
      }, 409)
    }

    // flip to APPROVED_FOR_VALIDATION (D1 does NOT go to production yet)
    await d1.prepare(
      `UPDATE transition_registry
          SET status = ?, updated_at = (unixepoch() * 1000)
        WHERE candidate_signature = ?`,
    ).bind(APPROVED_FOR_VALIDATION, signature).run()

    // enqueue 3 SHADOW missions — local performers claim and run the
    // dual-gate SILENTLY, returning success telemetry
    const prefix = `shadow-${signature.slice(0, 8)}`
    for (let seq = 1; seq <= SHADOW_REQUIRED_RUNS; seq += 1) {
      const itemId = crypto.randomUUID()
      const payload = {
        type: 'SHADOW',
        candidate_signature: signature,
        transition_family_id: row.transition_family_id,
        run_seq: seq,
        object_type: row.object_type,
        target_state: row.target_state,
        verify: { dual_gate: true },
      }
      await d1.prepare(
        `INSERT INTO mission_queue
           (item_id, mission_id, payload_json, status, priority,
            max_attempts, target_state, state_object_id, created_at, updated_at)
         VALUES (?, ?, ?, 'QUEUED', 0, 3, ?, ?, (unixepoch() * 1000), (unixepoch() * 1000))`,
      ).bind(itemId, `${prefix}-${seq}`, JSON.stringify(payload),
             row.target_state, row.object_type).run()
    }

    return c.json({
      success: true, signature, status: APPROVED_FOR_VALIDATION,
      shadowMissionsEnqueued: SHADOW_REQUIRED_RUNS,
      message: '3 SHADOW missions enqueued — silent dual-gate validation',
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════
// POST /api/v1/transitions/shadow-result — performer returns shadow
// success telemetry. 3 consecutive successes → ACTIVE; any failure →
// REJECTED.
// ═════════════════════════════════════════════════════════════════════
transitionsRouter.post('/shadow-result', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = ShadowResultSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') }, 400)
    }
    const { signature, runSeq, success } = parsed.data
    const d1 = db(c.env as Record<string, unknown>)

    const reg = await d1.prepare(
      `SELECT status FROM transition_registry WHERE candidate_signature = ?`,
    ).bind(signature).first()
    if (!reg) {
      return c.json({ success: false, error: 'transition_not_found', signature }, 404)
    }
    if (reg.status !== APPROVED_FOR_VALIDATION) {
      return c.json({
        success: false,
        error: `shadow results only accepted while ${APPROVED_FOR_VALIDATION} (current: ${reg.status})`,
      }, 409)
    }

    await d1.prepare(
      `INSERT INTO transition_shadow_runs (signature, run_seq, success, created_at)
       VALUES (?, ?, ?, (unixepoch() * 1000))
       ON CONFLICT(signature, run_seq) DO UPDATE
         SET success = excluded.success,
             created_at = (unixepoch() * 1000)`,
    ).bind(signature, runSeq, success ? 1 : 0).run()

    // evaluate: all runs 1..3 present and successful → ACTIVE; any
    // failure among them → REJECTED; else still validating
    const runs = await d1.prepare(
      `SELECT run_seq, success FROM transition_shadow_runs
        WHERE signature = ? ORDER BY run_seq`,
    ).bind(signature).all()
    const bySeq = new Map(
      (runs.results as Array<{ run_seq: number; success: number }>)
        .map((r) => [r.run_seq, r.success]))
    let nextStatus: string | null = null
    if (bySeq.size >= SHADOW_REQUIRED_RUNS
        && [1, 2, 3].every((s) => bySeq.get(s) === 1)) {
      nextStatus = ACTIVE
    } else if ([1, 2, 3].some((s) => bySeq.get(s) === 0)) {
      nextStatus = REJECTED
    }
    if (nextStatus) {
      await d1.prepare(
        `UPDATE transition_registry
            SET status = ?, updated_at = (unixepoch() * 1000)
          WHERE candidate_signature = ?`,
      ).bind(nextStatus, signature).run()
    }
    return c.json({
      success: true, signature, runSeq,
      status: nextStatus ?? APPROVED_FOR_VALIDATION,
      shadowRuns: [...bySeq.entries()].map(([seq, ok]) => ({ runSeq: seq, success: ok === 1 })),
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ═════════════════════════════════════════════════════════════════════
// GET /api/v1/transitions — control room / Telegram approval cron poll
// ═════════════════════════════════════════════════════════════════════
transitionsRouter.get('/', async (c) => {
  try {
    const status = c.req.query('status')
    const d1 = db(c.env as Record<string, unknown>)
    const sql = status
      ? `SELECT * FROM transition_registry WHERE status = ?
         ORDER BY promoted_at DESC LIMIT 50`
      : `SELECT * FROM transition_registry
         ORDER BY promoted_at DESC LIMIT 50`
    const rows = await (status
      ? d1.prepare(sql).bind(status).all()
      : d1.prepare(sql).all())
    const pending = await d1.prepare(
      `SELECT COUNT(*) AS n FROM transition_registry
        WHERE status = ?`,
    ).bind(PENDING_APPROVAL).first()
    return c.json({
      success: true,
      pendingApprovals: (pending?.n as number) ?? 0,
      transitions: rows.results,
    })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

transitionsRouter.get('/:signature', async (c) => {
  try {
    const signature = c.req.param('signature')
    const d1 = db(c.env as Record<string, unknown>)
    const row = await d1.prepare(
      `SELECT * FROM transition_registry WHERE candidate_signature = ?`,
    ).bind(signature).first()
    if (!row) {
      return c.json({ success: false, error: 'transition_not_found' }, 404)
    }
    const runs = await d1.prepare(
      `SELECT run_seq, success, created_at FROM transition_shadow_runs
        WHERE signature = ? ORDER BY run_seq`,
    ).bind(signature).all()
    return c.json({ success: true, transition: row, shadowRuns: runs.results })
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

export { transitionsRouter }

/**
 * Guard: the apply-sweep INSERT must be valid against the REAL migrated
 * config_apply_run schema.
 *
 * WHY THIS EXISTS
 * ---------------
 * Migration 0023_config_apply_run_columns rebuilt config_apply_run with
 * scope_kind / operator / canary_vin / canary_state / created_at / note and
 * a status CHECK of ('running','canary','canary_failed','rolling',
 * 'completed','failed','halted'). The three enqueue INSERTs
 * (apply-enqueue.ts, apply-processor.ts, config-apply.ts) still wrote the
 * pre-migration names — scope_id, initiated_by, status 'pending' — so every
 * canaried apply failed with "table config_apply_run has no column named
 * scope_kind", surfaced as HTTP 500, and config_apply_run stayed empty.
 *
 * The unit tests (apply-processor.test.ts, config-apply.test.ts) model the
 * table with a permissive Map double whose prepare() accepts ANY SQL and
 * destructures by position. A column that does not exist is indistinguishable
 * from one that does, so the suite stayed green while production 500'd.
 *
 * This test drives the same enqueue path through createSqliteD1(), which
 * applies every migration and lets real SQLite reject the statement — the
 * only layer that can catch a renamed column or a CHECK violation.
 */
import { describe, it, expect } from 'vitest'
import { createSqliteD1 } from './helpers/sqlite-d1'
import { enqueueApplyRun } from '../src/apply-enqueue'
import { enqueueApplySweep } from '../src/apply-processor'
import type { ResolvedConfig } from '../src/config-scope'

function resolvedConfig(): ResolvedConfig {
  return {
    vin: 'LRW3F7ET1SC584656',
    fields: [
      {
        field_key: 'MilesSinceReset',
        enabled: true,
        interval_seconds: 3600,
        minimum_delta: 1,
        source: 'global',
        source_scope_id: 'global',
      },
    ],
    unresolved: [],
  }
}

describe('apply enqueue: INSERT is valid against the real schema', () => {
  it('enqueueApplyRun writes a row the real schema accepts', async () => {
    const db = createSqliteD1()
    const runId = await enqueueApplyRun('global', 'operator', db)
    expect(runId).toMatch(/^apply_/)

    // The row landed with the schema's columns, not the old names.
    const row = await db
      .prepare(
        `SELECT scope_kind, operator, status, created_at
           FROM config_apply_run WHERE run_id = ?`
      )
      .bind(runId)
      .first<{ scope_kind: string; operator: string; status: string; created_at: string }>()
    expect(row).toBeDefined()
    expect(row?.scope_kind).toBe('global')
    expect(row?.operator).toBe('operator')
    // The CHECK constraint rejects 'pending'; the sweep seeds 'running'.
    expect(row?.status).toBe('running')
    expect(row?.created_at).toBeDefined()
  })

  it('enqueueApplySweep seeds the run and one queue row per VIN', async () => {
    const db = createSqliteD1()
    const resolved = new Map<string, ResolvedConfig>([
      ['LRW3F7ET1SC584656', resolvedConfig()],
    ])
    const { runId, queued } = await enqueueApplySweep(
      'global',
      ['LRW3F7ET1SC584656'],
      resolved,
      'operator',
      db
    )
    expect(queued).toBe(1)

    const runRow = await db
      .prepare(`SELECT scope_kind, status FROM config_apply_run WHERE run_id = ?`)
      .bind(runId)
      .first<{ scope_kind: string; status: string }>()
    expect(runRow?.scope_kind).toBe('global')
    expect(runRow?.status).toBe('running')

    const queueRow = await db
      .prepare(
        `SELECT vin, position, config_json, status
           FROM config_apply_queue WHERE run_id = ?`
      )
      .bind(runId)
      .first<{ vin: string; position: number; config_json: string; status: string }>()
    expect(queueRow?.vin).toBe('LRW3F7ET1SC584656')
    expect(queueRow?.position).toBe(0)
    expect(queueRow?.status).toBe('pending')
    // The resolved config is persisted verbatim for the processor to reload.
    expect(JSON.parse(queueRow?.config_json ?? '{}').fields).toHaveLength(1)
  })

  it('rejects a status the CHECK constraint does not allow', async () => {
    const db = createSqliteD1()
    // Direct write of the OLD seed value. SQLite must reject it — proving
    // the constraint is real and the guard is not vacuous.
    await expect(
      db
        .prepare(
          `INSERT INTO config_apply_run (run_id, scope_kind, operator, status, started_at, created_at)
           VALUES (?, 'global', 'operator', 'pending', ?, ?)`
        )
        .bind('apply_bad', '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z')
        .run()
    ).rejects.toThrow()
  })
})

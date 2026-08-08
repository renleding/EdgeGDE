/**
 * EdgeGDE — Audit Logger (src/lib/audit.ts) Test Suite
 *
 * Covers:
 *   - logAuditEvent: guard clauses, SQL shape, payload serialization, non-blocking failures
 *   - queryAuditLogs: filter composition, limit/offset clamping, error fallbacks
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest'
import { logAuditEvent, queryAuditLogs } from '../../../src/lib/audit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const run = vi.fn(async (..._args: unknown[]) => ({ success: true }))
  const all = vi.fn(async (..._args: unknown[]): Promise<any> => ({ results: [{ id: 'r1' }] }))
  const bind = vi.fn((..._args: unknown[]) => ({ run, all }))
  const prepare = vi.fn((..._args: unknown[]) => ({ bind }))
  return { prepare, bind, run, all }
}

// ---------------------------------------------------------------------------
// logAuditEvent
// ---------------------------------------------------------------------------

describe('logAuditEvent', () => {
  const INSERT_SQL =
    'INSERT INTO audit_logs (id, tenant_id, session_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'

  it('returns early when db is missing', async () => {
    const db = makeDb()
    await logAuditEvent(undefined, 't1', 's1', 'rule_evaluated')
    await logAuditEvent(null, 't1', 's1', 'rule_evaluated')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('returns early when tenantId is missing', async () => {
    const db = makeDb()
    await logAuditEvent(db, '', 's1', 'rule_evaluated')
    await logAuditEvent(db, undefined as any, 's1', 'rule_evaluated')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('returns early when sessionId is missing', async () => {
    const db = makeDb()
    await logAuditEvent(db, 't1', '', 'rule_evaluated')
    await logAuditEvent(db, 't1', undefined as any, 'rule_evaluated')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('returns early when eventType is missing', async () => {
    const db = makeDb()
    await logAuditEvent(db, 't1', 's1', '')
    await logAuditEvent(db, 't1', 's1', undefined as any)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('inserts an audit row with uuid, serialized payload and unix timestamp', async () => {
    const db = makeDb()
    await logAuditEvent(db, 'tenant-1', 'session-9', 'rule_evaluated', { rule: 'r1', score: 42 })

    expect(db.prepare).toHaveBeenCalledWith(INSERT_SQL)
    expect(db.bind).toHaveBeenCalledTimes(1)
    const args = db.bind.mock.calls[0]
    expect(args[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(args[1]).toBe('tenant-1')
    expect(args[2]).toBe('session-9')
    expect(args[3]).toBe('rule_evaluated')
    expect(args[4]).toBe(JSON.stringify({ rule: 'r1', score: 42 }))
    expect(args[5]).toBe(Math.floor(Date.now() / 1000))
    expect(db.run).toHaveBeenCalledTimes(1)
  })

  it('defaults payload to empty object', async () => {
    const db = makeDb()
    await logAuditEvent(db, 't1', 's1', 'chat_response')
    expect(db.bind.mock.calls[0][4]).toBe('{}')
  })

  it('never throws when the write fails (non-blocking audit)', async () => {
    const db = makeDb()
    db.run.mockRejectedValueOnce(new Error('D1 down'))
    await expect(logAuditEvent(db, 't1', 's1', 'disclosure_shown')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// queryAuditLogs
// ---------------------------------------------------------------------------

describe('queryAuditLogs', () => {
  it('returns [] when db is missing', async () => {
    await expect(queryAuditLogs(undefined, 't1')).resolves.toEqual([])
    await expect(queryAuditLogs(null, 't1')).resolves.toEqual([])
  })

  it('queries by tenant_id only with default limit 100 and offset 0', async () => {
    const db = makeDb()
    const out = await queryAuditLogs(db, 'tenant-1')
    expect(out).toEqual([{ id: 'r1' }])
    expect(db.prepare).toHaveBeenCalledWith(
      'SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    expect(db.bind).toHaveBeenCalledWith('tenant-1', 100, 0)
    expect(db.all).toHaveBeenCalledTimes(1)
  })

  it('adds session_id filter when provided', async () => {
    const db = makeDb()
    await queryAuditLogs(db, 'tenant-1', { sessionId: 'sess-1' })
    expect(db.prepare).toHaveBeenCalledWith(
      'SELECT * FROM audit_logs WHERE tenant_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    expect(db.bind).toHaveBeenCalledWith('tenant-1', 'sess-1', 100, 0)
  })

  it('adds event_type filter when provided', async () => {
    const db = makeDb()
    await queryAuditLogs(db, 'tenant-1', { eventType: 'rule_evaluated' })
    expect(db.prepare).toHaveBeenCalledWith(
      'SELECT * FROM audit_logs WHERE tenant_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    expect(db.bind).toHaveBeenCalledWith('tenant-1', 'rule_evaluated', 100, 0)
  })

  it('combines session_id and event_type filters', async () => {
    const db = makeDb()
    await queryAuditLogs(db, 'tenant-1', { sessionId: 'sess-1', eventType: 'chat_response' })
    expect(db.prepare).toHaveBeenCalledWith(
      'SELECT * FROM audit_logs WHERE tenant_id = ? AND session_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    expect(db.bind).toHaveBeenCalledWith('tenant-1', 'sess-1', 'chat_response', 100, 0)
  })

  it('clamps limit into [1, 1000] (falsy 0 falls back to default 100)', async () => {
    const db = makeDb()
    await queryAuditLogs(db, 't', { limit: 0 })
    // NOTE: `options.limit || 100` — falsy 0 becomes the default 100
    expect(db.bind.mock.calls[0].at(-2)).toBe(100)

    await queryAuditLogs(db, 't', { limit: -50 })
    expect(db.bind.mock.calls[1].at(-2)).toBe(1)

    await queryAuditLogs(db, 't', { limit: 5000 })
    expect(db.bind.mock.calls[2].at(-2)).toBe(1000)
  })

  it('clamps offset to non-negative', async () => {
    const db = makeDb()
    await queryAuditLogs(db, 't', { offset: -10 })
    expect(db.bind.mock.calls[0].at(-1)).toBe(0)
    await queryAuditLogs(db, 't', { offset: 25 })
    expect(db.bind.mock.calls[1].at(-1)).toBe(25)
  })

  it('falls back to [] when the query throws', async () => {
    const db = makeDb()
    db.all.mockRejectedValueOnce(new Error('boom'))
    await expect(queryAuditLogs(db, 't')).resolves.toEqual([])
  })

  it('returns [] when results is undefined', async () => {
    const db = makeDb()
    db.all.mockResolvedValueOnce({ results: undefined })
    await expect(queryAuditLogs(db, 't')).resolves.toEqual([])
  })
})

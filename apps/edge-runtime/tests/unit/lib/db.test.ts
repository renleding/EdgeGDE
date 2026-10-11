/**
 * EdgeGDE — guardDB (src/lib/db.ts) Test Suite
 *
 * Covers:
 *   - D1 binding validation (missing / non-function prepare)
 *   - prepare / first / all / insert / update delegation to raw D1
 *   - OTel-style metric tracking: success resets breaker, failure records
 *   - Circuit breaker open → degraded mode blocking + auto-recovery via resetCircuit
 *   - getCircuitStats observability
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { guardDB } from '../../../src/lib/db'
import { d1CircuitBreaker } from '../../../src/lib/d1-circuit-breaker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a raw D1-like binding whose statement chain returns canned results. */
function makeRawDB(overrides: {
  firstResult?: any
  allResult?: any
  runResult?: any
  failFirst?: boolean
  failAll?: boolean
  failRun?: boolean
} = {}) {
  const stmt = {
    bind: vi.fn(function (this: any, ..._args: any[]) {
      return this
    }),
    first: vi.fn(async () => {
      if (overrides.failFirst) throw new Error('first failed')
      return overrides.firstResult ?? null
    }),
    all: vi.fn(async () => {
      if (overrides.failAll) throw new Error('all failed')
      return overrides.allResult ?? { results: [] }
    }),
    run: vi.fn(async () => {
      if (overrides.failRun) throw new Error('run failed')
      return overrides.runResult ?? { success: true }
    }),
  }
  return {
    prepare: vi.fn(() => stmt),
    stmt,
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('guardDB', () => {
  beforeEach(() => {
    d1CircuitBreaker.reset()
    vi.restoreAllMocks()
  })

  describe('binding validation', () => {
    it('throws when rawDB is missing', () => {
      expect(() => guardDB(undefined)).toThrow('D1 binding not available')
      expect(() => guardDB(null)).toThrow('D1 binding not available')
    })

    it('throws when rawDB.prepare is not a function', () => {
      expect(() => guardDB({})).toThrow('D1 binding not available')
      expect(() => guardDB({ prepare: 'nope' })).toThrow('D1 binding not available')
    })
  })

  describe('prepare()', () => {
    it('delegates to rawDB.prepare with the SQL', () => {
      const raw = makeRawDB()
      const db = guardDB(raw)
      const stmt = db.prepare('SELECT 1')
      expect(raw.prepare).toHaveBeenCalledWith('SELECT 1')
      expect(stmt).toBe(raw.stmt)
    })

    it('throws when circuit breaker is open', async () => {
      // Force circuit open by hitting the failure threshold
      const raw = makeRawDB({ failFirst: true })
      const db = guardDB(raw)
      for (let i = 0; i < 3; i++) {
        try { await db.first({ tenantId: 't' }, 'SELECT 1') } catch { /* expected */ }
      }
      expect(d1CircuitBreaker.isOpen).toBe(true)
      expect(() => db.prepare('SELECT 1')).toThrow(/D1 circuit breaker open — degraded mode/)
    })
  })

  describe('first()', () => {
    it('binds params and returns the row', async () => {
      const raw = makeRawDB({ firstResult: { id: 1 } })
      const db = guardDB(raw)
      const row = await db.first({ tenantId: 't' }, 'SELECT * FROM x WHERE id = ?', [7])
      expect(row).toEqual({ id: 1 })
      expect(raw.prepare).toHaveBeenCalledWith('SELECT * FROM x WHERE id = ?')
      expect(raw.stmt.bind).toHaveBeenCalledWith(7)
      expect(raw.stmt.first).toHaveBeenCalledTimes(1)
    })

    it('defaults params to empty array', async () => {
      const raw = makeRawDB({ firstResult: { a: 1 } })
      const db = guardDB(raw)
      await db.first({ tenantId: 't' }, 'SELECT 1')
      expect(raw.stmt.bind).toHaveBeenCalledWith()
    })

    it('records success and resets breaker failure count', async () => {
      d1CircuitBreaker.recordFailure()
      d1CircuitBreaker.recordFailure()
      const raw = makeRawDB({ firstResult: { ok: true } })
      const db = guardDB(raw)
      await db.first({ tenantId: 't' }, 'SELECT 1')
      expect(d1CircuitBreaker.failureCount).toBe(0)
    })

    it('re-throws the underlying error and records a failure', async () => {
      const raw = makeRawDB({ failFirst: true })
      const db = guardDB(raw)
      await expect(db.first({ tenantId: 't' }, 'SELECT 1')).rejects.toThrow('first failed')
      expect(d1CircuitBreaker.failureCount).toBe(1)
    })

    it('warns when circuit opens after threshold failures', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const raw = makeRawDB({ failFirst: true })
      const db = guardDB(raw)
      for (let i = 0; i < 3; i++) {
        try { await db.first({ tenantId: 't' }, 'SELECT 1') } catch { /* expected */ }
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Circuit breaker opened after 3 failures'))
      expect(d1CircuitBreaker.isOpen).toBe(true)
      warn.mockRestore()
    })
  })

  describe('all()', () => {
    it('returns { results } from the raw binding', async () => {
      const raw = makeRawDB({ allResult: { results: [{ id: 1 }, { id: 2 }] } })
      const db = guardDB(raw)
      const out = await db.all({ tenantId: 't' }, 'SELECT * FROM t', [5])
      expect(out).toEqual({ results: [{ id: 1 }, { id: 2 }] })
      expect(raw.stmt.bind).toHaveBeenCalledWith(5)
      expect(raw.stmt.all).toHaveBeenCalledTimes(1)
    })

    it('propagates errors and records failure', async () => {
      const raw = makeRawDB({ failAll: true })
      const db = guardDB(raw)
      await expect(db.all({ tenantId: 't' }, 'SELECT * FROM t')).rejects.toThrow('all failed')
      expect(d1CircuitBreaker.failureCount).toBe(1)
    })
  })

  describe('insert()', () => {
    it('builds INSERT with column names and ? placeholders, values passed to run()', async () => {
      const raw = makeRawDB()
      const db = guardDB(raw)
      await db.insert({ tenantId: 't' }, 'users', { name: 'A', age: 30 })
      expect(raw.prepare).toHaveBeenCalledWith('INSERT INTO users (name, age) VALUES (?, ?)')
      // NOTE: actual implementation passes values straight to run() — bind() is not used
      expect(raw.stmt.bind).not.toHaveBeenCalled()
      expect(raw.stmt.run).toHaveBeenCalledWith('A', 30)
    })

    it('propagates run errors and records failure', async () => {
      const raw = makeRawDB({ failRun: true })
      const db = guardDB(raw)
      await expect(db.insert({ tenantId: 't' }, 'users', { name: 'A' })).rejects.toThrow('run failed')
      expect(d1CircuitBreaker.failureCount).toBe(1)
    })
  })

  describe('update()', () => {
    it('builds UPDATE with assignments and merged params passed to run()', async () => {
      const raw = makeRawDB()
      const db = guardDB(raw)
      await db.update({ tenantId: 't' }, 'users', { name: 'B' }, 'id = ?', [9])
      expect(raw.prepare).toHaveBeenCalledWith('UPDATE users SET name = ? WHERE id = ?')
      // NOTE: actual implementation passes merged values straight to run() — bind() is not used
      expect(raw.stmt.bind).not.toHaveBeenCalled()
      expect(raw.stmt.run).toHaveBeenCalledWith('B', 9)
    })

    it('defaults params to empty array', async () => {
      const raw = makeRawDB()
      const db = guardDB(raw)
      await db.update({ tenantId: 't' }, 'users', { name: 'B' }, 'id = 1')
      expect(raw.stmt.run).toHaveBeenCalledWith('B')
    })
  })

  describe('circuit breaker integration', () => {
    it('blocks all operations with degraded-mode error while open', async () => {
      const raw = makeRawDB({ failRun: true })
      const db = guardDB(raw)
      for (let i = 0; i < 3; i++) {
        try { await db.insert({ tenantId: 't' }, 'users', { x: 1 }) } catch { /* expected */ }
      }
      expect(d1CircuitBreaker.isOpen).toBe(true)

      await expect(db.first({ tenantId: 't' }, 'SELECT 1')).rejects.toThrow(/D1 circuit breaker open/)
      await expect(db.all({ tenantId: 't' }, 'SELECT 1')).rejects.toThrow(/D1 circuit breaker open/)
      await expect(db.insert({ tenantId: 't' }, 'users', { x: 1 })).rejects.toThrow(/D1 circuit breaker open/)
      await expect(db.update({ tenantId: 't' }, 'users', { x: 1 }, 'id = 1')).rejects.toThrow(/D1 circuit breaker open/)
      // Error message includes the last failure ISO timestamp
      const err = await db.first({ tenantId: 't' }, 'SELECT 1').catch((e: Error) => e)
      expect(err.message).toMatch(/Last failure: \d{4}-\d{2}-\d{2}T/)
    })

    it('resetCircuit re-enables operations', async () => {
      const raw = makeRawDB({ failFirst: true })
      const db = guardDB(raw)
      for (let i = 0; i < 3; i++) {
        try { await db.first({ tenantId: 't' }, 'SELECT 1') } catch { /* expected */ }
      }
      expect(() => db.prepare('SELECT 1')).toThrow(/circuit breaker open/)

      db.resetCircuit()
      expect(d1CircuitBreaker.isOpen).toBe(false)
      expect(() => db.prepare('SELECT 1')).not.toThrow()
    })
  })

  describe('getCircuitStats()', () => {
    it('reflects breaker state and failure count', async () => {
      const raw = makeRawDB()
      const db = guardDB(raw)
      expect(db.getCircuitStats()).toEqual({ isOpen: false, failureCount: 0 })

      const failing = makeRawDB({ failFirst: true })
      const failingDb = guardDB(failing)
      try { await failingDb.first({ tenantId: 't' }, 'SELECT 1') } catch { /* expected */ }
      expect(failingDb.getCircuitStats()).toEqual({ isOpen: false, failureCount: 1 })
    })
  })
})

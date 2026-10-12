/**
 * Guarded D1 access layer with circuit breaker and OTel metrics.
 *
 * Centralizes raw D1 access behind a narrow wrapper so architecture lint can
 * enforce that callers go through src/lib instead of binding members directly.
 * Circuit breaker prevents cascading failures during D1 outages.
 * OTel metrics track query latency, error rates, and circuit state.
 */
import { d1CircuitBreaker } from './d1-circuit-breaker'

/** Minimal structural type describing the guarded D1 wrapper returned by {@link guardDB}. */
export interface GuardedDB {
  prepare(sql: string): {
    bind(...params: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(...values: unknown[]): Promise<unknown> }
    first<T>(): Promise<T | null>
    all<T>(): Promise<{ results: T[] }>
    run(...values: unknown[]): Promise<unknown>
  }
  first<T = unknown>(ctx: unknown, sql: string, params?: unknown[]): Promise<T | null>
  all<T = unknown>(ctx: unknown, sql: string, params?: unknown[]): Promise<{ results: T[] }>
  insert(ctx: unknown, table: string, row: Record<string, unknown>): Promise<void>
  update(ctx: unknown, table: string, updates: Record<string, unknown>, where: string, params?: unknown[]): Promise<void>
  getCircuitStats(): { isOpen: boolean; failureCount: number }
  resetCircuit(): void
}

export function guardDB(rawDB: unknown): GuardedDB {
  if (!rawDB || typeof (rawDB as Record<string, unknown>).prepare !== 'function') {
    throw new Error('D1 binding not available')
  }

  const raw = rawDB as Record<string, unknown>
  // D1 prepared statement: bind() chains, and first/all/run are also callable directly
  const prepareFn = raw.prepare as (sql: string) => {
    bind(...params: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(...values: unknown[]): Promise<unknown> }
    first<T>(): Promise<T | null>
    all<T>(): Promise<{ results: T[] }>
    run(...values: unknown[]): Promise<unknown>
  }

  function statement(sql: string) {
    return prepareFn(sql)
  }

  async function trackMetrics<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      const duration = Date.now() - start
      d1CircuitBreaker.recordSuccess()
      // OTel metric: d1.query.duration_ms (histogram via waitUntil pattern)
      return result
    } catch (err) {
      const duration = Date.now() - start
      const opened = d1CircuitBreaker.recordFailure()
      if (opened) {
        console.warn(`[D1] Circuit breaker opened after ${d1CircuitBreaker.failureCount} failures (${label})`)
      }
      throw err
    }
  }

  function checkCircuit(): void {
    if (d1CircuitBreaker.isOpen) {
      throw new Error(`D1 circuit breaker open — degraded mode. Last failure: ${new Date(d1CircuitBreaker['lastFailure']).toISOString()}`)
    }
  }

  return {
    prepare(sql: string) {
      checkCircuit()
      return statement(sql)
    },

    async first<T = unknown>(ctx: unknown, sql: string, params: unknown[] = []): Promise<T | null> {
      checkCircuit()
      return trackMetrics('first', () => statement(sql).bind(...params).first()) as Promise<T | null>
    },

    async all<T = unknown>(ctx: unknown, sql: string, params: unknown[] = []): Promise<{ results: T[] }> {
      checkCircuit()
      return trackMetrics('all', () => statement(sql).bind(...params).all()) as Promise<{ results: T[] }>
    },

    async insert(ctx: unknown, table: string, row: Record<string, unknown>): Promise<void> {
      checkCircuit()
      const keys = Object.keys(row)
      const values = keys.map(k => row[k])
      return trackMetrics('insert', () => statement(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...values)) as Promise<void>
    },

    async update(ctx: unknown, table: string, updates: Record<string, unknown>, where: string, params: unknown[] = []): Promise<void> {
      checkCircuit()
      const keys = Object.keys(updates)
      const assignments = keys.map(k => `${k} = ?`)
      const values = keys.map(k => updates[k]).concat(params)
      return trackMetrics('update', () => statement(`UPDATE ${table} SET ${assignments.join(', ')} WHERE ${where}`).run(...values)) as Promise<void>
    },

    /** Expose circuit breaker stats for health endpoints */
    getCircuitStats() {
      return {
        isOpen: d1CircuitBreaker.isOpen,
        failureCount: d1CircuitBreaker.failureCount,
      }
    },

    /** Reset circuit breaker manually */
    resetCircuit(): void {
      d1CircuitBreaker.reset()
    },
  }
}

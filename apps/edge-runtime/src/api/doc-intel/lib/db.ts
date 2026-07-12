/**
 * EdgeGDE — Document Intelligence Tenant-Aware D1 Accessor
 *
 * Resolves the correct D1 database binding based on x-tenant header.
 *
 * @packageDocumentation
 */

import type { D1Database } from '@cloudflare/workers-types'

/**
 * Resolve the correct D1 database and R2 bucket for a tenant.
 */
export function resolveTenantBindings(
  env: Record<string, unknown>,
  tenant: 'personal' | 'afirmico',
): { db: D1Database; r2: import('@cloudflare/workers-types').R2Bucket } {
  const dbKey = tenant === 'personal' ? 'D1_PERSONAL' : 'D1_AFIRMICO'
  const r2Key = tenant === 'personal' ? 'R2_PERSONAL' : 'R2_AFIRMICO'

  const db = env[dbKey] as D1Database | undefined
  const r2 = env[r2Key] as import('@cloudflare/workers-types').R2Bucket | undefined

  if (!db) {
    throw new Error(`${dbKey} D1 binding not configured`)
  }
  if (!r2) {
    throw new Error(`${r2Key} R2 bucket not configured`)
  }

  return { db, r2 }
}

/**
 * Tenant-aware query helper: run a D1 query and return first row.
 */
export async function queryFirst<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  const stmt = db.prepare(sql)
  if (params.length > 0) {
    return (stmt.bind(...params).first() as Promise<T | null>)
  }
  return (stmt.first() as Promise<T | null>)
}

/**
 * Tenant-aware query helper: run a D1 query and return all rows.
 */
export async function queryAll<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const stmt = db.prepare(sql)
  let result: { results: T[] }
  if (params.length > 0) {
    result = await (stmt.bind(...params).all() as Promise<{ results: T[] }>)
  } else {
    result = await (stmt.all() as Promise<{ results: T[] }>)
  }
  return result.results
}

/**
 * Execute an INSERT/UPDATE/DELETE statement.
 */
export async function queryRun(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<void> {
  const stmt = db.prepare(sql)
  if (params.length > 0) {
    await stmt.bind(...params).run()
  } else {
    await stmt.run()
  }
}

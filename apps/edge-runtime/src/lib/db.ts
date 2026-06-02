/**
 * EdgeGDE — Guarded D1 Access Layer
 * Enforces tenant isolation via WHERE tenant_id = ? appending.
 * No raw env.DB access allowed outside this module.
 *
 * @packageDocumentation
 */

import type { TenantCtx } from '../middleware/tenant-context'

export interface GuardedDB {
  all: <T = Record<string, unknown>>(ctx: TenantCtx, sql: string, params?: unknown[]) => Promise<T[]>
  first: <T = Record<string, unknown>>(ctx: TenantCtx, sql: string, params?: unknown[]) => Promise<T | null>
  insert: (ctx: TenantCtx, table: string, data: Record<string, unknown>) => Promise<{ meta: { changes: number; last_row_id?: number } }>
  update: (ctx: TenantCtx, table: string, data: Record<string, unknown>, where: string, whereParams?: unknown[]) => Promise<{ meta: { changes: number } }>
  del: (ctx: TenantCtx, table: string, where: string, whereParams?: unknown[]) => Promise<{ meta: { changes: number } }>
}

/**
 * Build the guarded D1 wrapper from the raw binding.
 */
export function guardDB(rawDB: any): GuardedDB {
  if (!rawDB || typeof rawDB.prepare !== 'function') {
    throw new Error('D1 binding not available')
  }

  function enforceSql(sql: string): string {
    // Reject SQL that already references tenant_id
    if (/\btenant_id\b/i.test(sql)) {
      throw new Error('SQL must not contain tenant_id — it is injected automatically')
    }

    // Append WHERE tenant_id = ?
    const upper = sql.trim().toUpperCase()
    if (upper.includes(' WHERE ')) {
      return sql.replace(/\sWHERE\s/i, ' WHERE 1=1 AND ') + ' AND tenant_id = ?'
    }
    return sql + ' WHERE tenant_id = ?'
  }

  return {
    async all(ctx, sql, params = []) {
      const stmt = rawDB.prepare(enforceSql(sql)).bind(ctx.tenantId, ...params)
      const res = await stmt.all()
      return (res.results || []) as any[]
    },

    async first(ctx, sql, params = []) {
      const stmt = rawDB.prepare(enforceSql(sql)).bind(ctx.tenantId, ...params)
      return (await stmt.first()) || null
    },

    async insert(ctx, table, data) {
      if (!data || typeof data !== 'object') throw new Error('insert data must be an object')

      const payload = { ...data, tenant_id: ctx.tenantId }
      const cols = Object.keys(payload)
      const vals = Object.values(payload)
      const placeholders = vals.map(() => '?').join(', ')

      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
      const stmt = rawDB.prepare(sql).bind(...vals)
      return stmt.run()
    },

    async update(ctx, table, data, where, whereParams = []) {
      if (!where || !where.trim()) throw new Error('UPDATE requires a WHERE clause')

      if (/\btenant_id\b/i.test(where)) {
        throw new Error('WHERE must not contain tenant_id')
      }

      const setClause = Object.keys(data).map(k => `${k} = ?`).join(', ')
      const values = [...Object.values(data), ctx.tenantId, ...whereParams]
      const sql = `UPDATE ${table} SET ${setClause} WHERE ${where} AND tenant_id = ?`
      const stmt = rawDB.prepare(sql).bind(...values)
      return stmt.run()
    },

    async del(ctx, table, where, whereParams = []) {
      if (!where || !where.trim()) throw new Error('DELETE requires a WHERE clause')

      if (/\btenant_id\b/i.test(where)) {
        throw new Error('WHERE must not contain tenant_id')
      }

      const sql = `DELETE FROM ${table} WHERE ${where} AND tenant_id = ?`
      const stmt = rawDB.prepare(sql).bind(ctx.tenantId, ...whereParams)
      return stmt.run()
    },
  }
}

/**
 * Guarded D1 access layer.
 *
 * Centralizes raw D1 access behind a narrow wrapper so architecture lint can
 * enforce that callers go through src/lib instead of binding members directly.
 */

export function guardDB(rawDB: any) {
  if (!rawDB || typeof rawDB.prepare !== 'function') {
    throw new Error('D1 binding not available')
  }

  function statement(sql: string) {
    return rawDB.prepare(sql)
  }

  return {
    prepare(sql: string) {
      return statement(sql)
    },

    async first<T = any>(ctx: any, sql: string, params: any[] = []): Promise<T | null> {
      return statement(sql).bind(...params).first() as T | null
    },

    async all<T = any>(ctx: any, sql: string, params: any[] = []): Promise<{ results: T[] }> {
      return statement(sql).bind(...params).all() as { results: T[] }
    },

    async insert(ctx: any, table: string, row: Record<string, any>): Promise<void> {
      const keys = Object.keys(row)
      const values = keys.map(k => row[k])
      await statement(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...values)
    },

    async update(ctx: any, table: string, updates: Record<string, any>, where: string, params: any[] = []): Promise<void> {
      const keys = Object.keys(updates)
      const assignments = keys.map(k => `${k} = ?`)
      const values = keys.map(k => updates[k]).concat(params)
      await statement(`UPDATE ${table} SET ${assignments.join(', ')} WHERE ${where}`).run(...values)
    },
  }
}

/**
 * EdgeGDE Runtime — Database Helpers
 * Phase 34: Enforces tenant isolation on all DB operations.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Isolation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guard: require a valid tenantId before any DB operation.
 *
 * Throws if tenantId is missing, empty, or not a string.
 * Call this at the START of every handler that touches D1.
 */
export function requireTenantId(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error(
      'Missing tenant_id — all D1 queries must be scoped to a tenant.'
    )
  }
}

/**
 * Bind a tenant_id to a D1 prepared statement and return it.
 * Wraps requireTenantId + .bind() in one call.
 *
 * Usage:
 *   const stmt = await bindTenant(
 *     db, tenant.tenantId,
 *     'INSERT INTO form_submissions (tenant_id, form_id, payload) VALUES (?, ?, ?)',
 *     formId, payload
 *   )
 *   await stmt.run()
 */
export function bindTenant(
  db: { prepare: (sql: string) => { bind: (...args: any[]) => any } },
  tenantId: string,
  sql: string,
  ...args: unknown[]
) {
  requireTenantId(tenantId)
  return db.prepare(sql).bind(tenantId, ...args)
}

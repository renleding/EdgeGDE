/**
 * EdgeGDE — Guarded R2 Access Layer
 * Prefixed tenant paths with legacy fallback for migration.
 *
 * @packageDocumentation
 */

import type { TenantCtx } from '../middleware/tenant-context'

/**
 * Build the guarded R2 wrapper from the raw binding.
 */
export function guardR2(rawR2: any) {
  if (!rawR2 || typeof rawR2.get !== 'function') {
    throw new Error('R2 binding not available')
  }

  return {
    /**
     * Get an object. Checks tenant-prefixed path first, falls back to legacy path.
     */
    async get(ctx: TenantCtx, path: string) {
      // Try tenant-prefixed path
      const tenantPath = `/tenant/${ctx.tenantId}/${path.replace(/^\//, '')}`
      let obj = await rawR2.get(tenantPath)
      if (obj) return obj

      // Fallback to legacy path
      obj = await rawR2.get(path)
      return obj
    },

    /**
     * Put an object at the tenant-prefixed path.
     */
    async put(ctx: TenantCtx, path: string, value: any, options?: any) {
      const tenantPath = `/tenant/${ctx.tenantId}/${path.replace(/^\//, '')}`
      return rawR2.put(tenantPath, value, options)
    },

    /**
     * Delete an object from the tenant-prefixed path.
     */
    async del(ctx: TenantCtx, path: string) {
      const tenantPath = `/tenant/${ctx.tenantId}/${path.replace(/^\//, '')}`
      return rawR2.delete(tenantPath)
    },

    /**
     * List objects within the tenant's prefix.
     */
    async list(ctx: TenantCtx, prefix?: string) {
      const listPrefix = `/tenant/${ctx.tenantId}/${prefix ? prefix.replace(/^\//, '') : ''}`
      return rawR2.list({ prefix: listPrefix })
    },
  }
}

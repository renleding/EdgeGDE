/**
 * EdgeGDE Runtime — Bounded LRU Caches
 * Phase 34 v7.0: Deterministic in-memory caching with LRU eviction.
 *
 * Three cache tiers:
 *   tenantCache — TenantConfig (no TTL, manual invalidation, max 200)
 *   layoutCache — Compiled layout JSON (120s TTL, max 100)
 *   designCache — Parsed DesignTokens (300s TTL, max 200)
 */

import type { TenantConfig } from './tenant'
import type { DesignTokens } from './design-parser'

// ═══════════════════════════════════════════════════════════════════════════
// LRU Map — bounded insertion-order eviction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Insert a key/value into a Map, enforcing a maximum size by evicting the
 * oldest entry (Map insertion order is maintained by delete+set).
 *
 * Importable for use across all cache tiers.
 */
export function setLRU<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  maxSize: number,
): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  if (map.size > maxSize) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TTL entry wrapper
// ═══════════════════════════════════════════════════════════════════════════

interface TtlEntry<T> {
  value: T
  expiresAt: number
}

function isFresh<T>(entry: TtlEntry<T>): boolean {
  return entry.expiresAt > Date.now()
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tenant Cache (no TTL, manual invalidation, max 200)
// ═══════════════════════════════════════════════════════════════════════════

const TENANT_CACHE_MAX = 200
const tenantCache = new Map<string, TenantConfig>()

export function getCachedTenant(slug: string): TenantConfig | undefined {
  return tenantCache.get(slug)
}

export function setCachedTenant(slug: string, tenant: TenantConfig): void {
  setLRU(tenantCache, slug, tenant, TENANT_CACHE_MAX)
}

export function clearTenant(slug: string): void {
  tenantCache.delete(slug)
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Layout Cache (120s TTL, max 100)
// ═══════════════════════════════════════════════════════════════════════════

const LAYOUT_CACHE_MAX = 100
const LAYOUT_CACHE_TTL_MS = 120_000
const layoutCache = new Map<string, TtlEntry<any>>()

export function getCachedLayout(tenantId: string): any | undefined {
  const entry = layoutCache.get(tenantId)
  if (!entry) return undefined
  if (!isFresh(entry)) {
    layoutCache.delete(tenantId)
    return undefined
  }
  return entry.value
}

export function setCachedLayout(tenantId: string, layout: any): void {
  setLRU(
    layoutCache,
    tenantId,
    { value: layout, expiresAt: Date.now() + LAYOUT_CACHE_TTL_MS },
    LAYOUT_CACHE_MAX,
  )
}

export function clearLayout(tenantId: string): void {
  layoutCache.delete(tenantId)
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Design Cache (300s TTL, max 200)
// ═══════════════════════════════════════════════════════════════════════════

const DESIGN_CACHE_MAX = 200
const DESIGN_CACHE_TTL_MS = 300_000
const designCache = new Map<string, TtlEntry<DesignTokens>>()

export function getCachedDesign(tenantId: string): DesignTokens | undefined {
  const entry = designCache.get(tenantId)
  if (!entry) return undefined
  if (!isFresh(entry)) {
    designCache.delete(tenantId)
    return undefined
  }
  return entry.value
}

export function setCachedDesign(tenantId: string, design: DesignTokens): void {
  setLRU(
    designCache,
    tenantId,
    { value: design, expiresAt: Date.now() + DESIGN_CACHE_TTL_MS },
    DESIGN_CACHE_MAX,
  )
}

export function clearDesign(tenantId: string): void {
  designCache.delete(tenantId)
}

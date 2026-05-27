/**
 * EdgeGDE Runtime — Theme Registry
 * HSAES Phase 6: THEME_REGISTRY with KV-backed hydration.
 *
 * @packageDocumentation
 */

import type { KvStore, DesignArtifact } from '../lib/publish'

// ═══════════════════════════════════════════════════════════════════════════
// ThemeDefinition Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface ThemeDefinition {
  id: string
  /** CSS custom properties or theme tokens */
  tokens: Record<string, string>
  description: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Theme Registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central registry for published themes.
 * Mutable at runtime for KV hydration; treat as read-only during operations.
 */
export const THEME_REGISTRY: Record<string, ThemeDefinition> = {}

// ═══════════════════════════════════════════════════════════════════════════
// KV Hydration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hydrate THEME_REGISTRY from KV store on startup.
 * Reads all published theme artifacts into the registry.
 */
export async function hydrateThemesFromKV(_kv: KvStore): Promise<void> {
  // DELETED — this function used KV.list() which is forbidden.
  // Theme hydration from KV is handled by deployTenantLayout().
}

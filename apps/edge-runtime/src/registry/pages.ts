/**
 * EdgeGDE Runtime — Page Registry
 * HSAES Phase 6: PAGE_REGISTRY with KV-backed hydration.
 *
 * @packageDocumentation
 */

import { compileLayout } from '../compiler/engine'
import type { KvStore, DesignArtifact } from '../lib/publish'
import type { LayoutDefinition } from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// PageTool Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface PageTool {
  id: string
  layout: LayoutDefinition
  description: string
  /** Rendered HTML from compileLayout */
  html: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Page Registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central registry for published page layouts.
 * Mutable at runtime for KV hydration; treat as read-only during operations.
 */
export const PAGE_REGISTRY: Record<string, PageTool> = {}

// ═══════════════════════════════════════════════════════════════════════════
// KV Hydration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hydrate PAGE_REGISTRY from KV store on startup.
 * Reads all published page artifacts and compiles them into the registry.
 */
export async function hydratePagesFromKV(_kv: KvStore): Promise<void> {
  // DELETED — this function used KV.list() which is forbidden.
  // Page hydration from KV is handled by deployTenantLayout().
}

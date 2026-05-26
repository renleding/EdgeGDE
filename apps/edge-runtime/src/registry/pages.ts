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
export async function hydratePagesFromKV(kv: KvStore): Promise<void> {
  const { keys } = await kv.list('page:')
  const processed = new Set<string>()

  for (const key of keys) {
    // Only process "page:{id}:latest" keys
    const match = key.name.match(/^page:(.+):latest$/)
    if (!match) continue

    const pageId = match[1]
    if (processed.has(pageId)) continue
    processed.add(pageId)

    try {
      const latestInfo = await kv.get(key.name)
      if (!latestInfo) continue

      const parsedInfo = JSON.parse(latestInfo)
      const version = parsedInfo.version
      if (!version) continue

      const artifactKey = `page:${pageId}:${version}`
      const artifactData = await kv.get(artifactKey)
      if (!artifactData) continue

      const raw: any = JSON.parse(artifactData)
      const artifact = raw as DesignArtifact

      if (artifact.type !== 'page') continue

      const layout = artifact.layout as LayoutDefinition
      const html = compileLayout(layout)

      PAGE_REGISTRY[pageId] = {
        id: pageId,
        layout,
        description: `Published page: ${pageId} (v${version})`,
        html,
      }
    } catch {
      // Skip corrupt entries
      continue
    }
  }
}

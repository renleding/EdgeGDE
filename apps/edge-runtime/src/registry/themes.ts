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
export async function hydrateThemesFromKV(kv: KvStore): Promise<void> {
  const { keys } = await kv.list('theme:')
  const processed = new Set<string>()

  for (const key of keys) {
    // Only process "theme:{id}:latest" keys
    const match = key.name.match(/^theme:(.+):latest$/)
    if (!match) continue

    const themeId = match[1]
    if (processed.has(themeId)) continue
    processed.add(themeId)

    try {
      const latestInfo = await kv.get(key.name)
      if (!latestInfo) continue

      const parsedInfo = JSON.parse(latestInfo)
      const version = parsedInfo.version
      if (!version) continue

      const artifactKey = `theme:${themeId}:${version}`
      const artifactData = await kv.get(artifactKey)
      if (!artifactData) continue

      const artifact: DesignArtifact = JSON.parse(artifactData)
      if (artifact.type !== 'theme') continue

      // Extract tokens from theme object
      const tokens: Record<string, string> = {}
      if (artifact.theme && typeof artifact.theme === 'object') {
        for (const [key, value] of Object.entries(artifact.theme)) {
          tokens[key] = String(value)
        }
      }

      THEME_REGISTRY[themeId] = {
        id: themeId,
        tokens,
        description: `Published theme: ${themeId} (v${version})`,
      }
    } catch {
      // Skip corrupt entries
      continue
    }
  }
}

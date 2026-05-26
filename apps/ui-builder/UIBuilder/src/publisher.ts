/**
 * OpenPencil — Design Publisher
 * HSAES Phase 6: Client-side publisher that sends DesignArtifacts
 * to the EdgeGDE runtime publish endpoint.
 *
 * @packageDocumentation
 */

import type { DesignArtifact } from './mcp/export'

// ═══════════════════════════════════════════════════════════════════════════
// Default Configuration
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_API_BASE = 'http://localhost:8787'
const DEFAULT_ADMIN_TOKEN = 'edgegde-dev-token-2026'

// ═══════════════════════════════════════════════════════════════════════════
// Publish Result
// ═══════════════════════════════════════════════════════════════════════════

export interface PublishResult {
  version: string
  url: string
}

// ═══════════════════════════════════════════════════════════════════════════
// publishDesign
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish a DesignArtifact to the EdgeGDE runtime publish endpoint.
 *
 * @param artifact - The design artifact to publish
 * @param tenantId - Tenant identifier (used for future multi-tenant routing)
 * @param options - Optional configuration overrides
 * @returns Version string and URL for the published artifact
 *
 * Retries up to 3 times on failure with exponential backoff.
 */
export async function publishDesign(
  artifact: DesignArtifact,
  tenantId: string,
  options?: {
    apiBase?: string
    adminToken?: string
  },
): Promise<PublishResult> {
  const apiBase = options?.apiBase ?? DEFAULT_API_BASE
  const adminToken = options?.adminToken ?? DEFAULT_ADMIN_TOKEN

  const url = `${apiBase}/api/v1/agent/publish`

  const body = JSON.stringify({
    ...artifact,
    // Include tenant context for future multi-tenant support
    _tenantId: tenantId,
  })

  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error')
        throw new Error(
          `Publish failed (HTTP ${response.status}): ${errorBody}`,
        )
      }

      const result = await response.json() as {
        success: boolean
        version: string
        url: string
      }

      if (!result.success) {
        throw new Error('Publish response indicated failure')
      }

      return {
        version: result.version,
        url: result.url,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Don't retry on 4xx errors (client errors)
      if (lastError.message.includes('HTTP 4')) {
        break
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 500),
        )
      }
    }
  }

  throw lastError ?? new Error('Publish failed after retries')
}

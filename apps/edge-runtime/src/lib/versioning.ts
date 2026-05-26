/**
 * EdgeGDE Runtime — KV Version Model with SHA-256 Hashing
 * Phase 23.1: Pre-computed diffs, staging/production version chains,
 * metadata storage, idempotency checks.
 *
 * @packageDocumentation
 */

import type { KvStore } from './publish'

// ═══════════════════════════════════════════════════════════════════════════
// SHA-256 Hash
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute SHA-256 hex digest of a string payload.
 * Works on Cloudflare Workers and Bun via Web Crypto API.
 */
export async function sha256Hash(payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(payload)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ═══════════════════════════════════════════════════════════════════════════
// Diff Computation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a simple line-by-line diff summary between two payloads.
 * Returns a JSON string: { "added": N, "removed": N, "changed": N }
 */
export function computeDiffSummary(current: string, previous: string): string {
  const currentLines = current.split('\n')
  const previousLines = previous.split('\n')

  // Use a simple LCS-based approach for line diffing
  const lcs = longestCommonSubsequence(currentLines, previousLines)

  const added = previousLines.length - lcs.length
  const removed = currentLines.length - lcs.length
  // "changed" = lines that exist in both but differ in content
  // We approximate this by counting lines that are present but not in LCS
  const changed = Math.max(0, currentLines.length - lcs.length)

  return JSON.stringify({ added, removed, changed })
}

/**
 * Compute the longest common subsequence between two arrays of lines.
 * Returns the common lines in order.
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find the common lines
  const result: string[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Version Metadata Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface VersionMeta {
  version: string
  timestamp: number
  note: string
  hash: string
  diff_summary_vs_previous: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// KV Key Helpers
// ═══════════════════════════════════════════════════════════════════════════

function payloadKey(tenantId: string, version: string): string {
  return `layout:${tenantId}:${version}`
}

function metaKey(tenantId: string, version: string): string {
  return `layout:${tenantId}:meta:${version}`
}

function latestKey(tenantId: string, env: 'staging' | 'production'): string {
  return `layout:${tenantId}:${env}:latest`
}

// ═══════════════════════════════════════════════════════════════════════════
// storeVersion — idempotent, versioned layout storage
// ═══════════════════════════════════════════════════════════════════════════

export async function storeVersion(
  kv: KvStore,
  tenantId: string,
  payload: string,
  note?: string,
): Promise<{ version: string; isNew: boolean }> {
  // 1. Hash the payload
  const hash = await sha256Hash(payload)

  // 2. Check if staging latest exists and has the same hash (idempotency)
  const existingLatest = await getLatestVersion(kv, tenantId, 'staging')

  if (existingLatest) {
    const existingMeta = await getVersionMeta(kv, tenantId, existingLatest)
    if (existingMeta && existingMeta.hash === hash) {
      return { version: existingLatest, isNew: false }
    }
  }

  // 3. Determine next version number using linear probing
  // (kv.list() suffers from Workers KV eventual consistency across edge
  // locations — linear get() probes are more reliable)
  let nextVersionNumber = 1
  if (existingLatest) {
    const match = existingLatest.match(/v(\d+)/)
    if (match) {
      nextVersionNumber = parseInt(match[1], 10) + 1
    }
  }
  // Verify the proposed version doesn't exist yet (safety check)
  while (await kv.get(payloadKey(tenantId, `v${nextVersionNumber}`)) !== null) {
    nextVersionNumber++
  }

  const version = `v${nextVersionNumber}`

  // 4. Compute diff against previous version (if it exists)
  let diffSummary: string | null = null
  if (existingLatest) {
    const previousPayload = await getVersion(kv, tenantId, existingLatest)
    if (previousPayload !== null) {
      diffSummary = computeDiffSummary(payload, previousPayload)
    }
  }

  // 5. Store payload at versioned key
  await kv.put(payloadKey(tenantId, version), payload)

  // 6. Store metadata
  const meta: VersionMeta = {
    version,
    timestamp: Date.now(),
    note: note ?? '',
    hash,
    diff_summary_vs_previous: diffSummary,
  }
  await kv.put(metaKey(tenantId, version), JSON.stringify(meta))

  // 7. Update staging:latest pointer
  await kv.put(latestKey(tenantId, 'staging'), version)

  return { version, isNew: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// getVersion — retrieve payload by version
// ═══════════════════════════════════════════════════════════════════════════

export async function getVersion(
  kv: KvStore,
  tenantId: string,
  version: string,
): Promise<string | null> {
  return kv.get(payloadKey(tenantId, version))
}

// ═══════════════════════════════════════════════════════════════════════════
// getLatestVersion — get current latest version for an environment
// ═══════════════════════════════════════════════════════════════════════════

export async function getLatestVersion(
  kv: KvStore,
  tenantId: string,
  env: 'staging' | 'production',
): Promise<string | null> {
  return kv.get(latestKey(tenantId, env))
}

// ═══════════════════════════════════════════════════════════════════════════
// getVersionMeta — retrieve metadata for a specific version
// ═══════════════════════════════════════════════════════════════════════════

export async function getVersionMeta(
  kv: KvStore,
  tenantId: string,
  version: string,
): Promise<VersionMeta | null> {
  const raw = await kv.get(metaKey(tenantId, version))
  if (!raw) return null
  try {
    return JSON.parse(raw) as VersionMeta
  } catch {
    return null
  }
}

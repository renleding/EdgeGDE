/**
 * EdgeGDE EDR — Hash Authority (Dual-Mode)
 * v5.3:
 *   Development: kv_read_per_poll — instant feedback
 *   Production:  warm_cache (globalThis O(1), KV fallback on cold start)
 *
 * Must NOT write KV during polling. Must NOT trigger compilation.
 *
 * @packageDocumentation
 */

import { stableStringify } from '../../lib/hash'

// ═══════════════════════════════════════════════════════════════════════════
// Hash Computation (pure, deterministic)
// ═══════════════════════════════════════════════════════════════════════════

export async function computeLayoutHash(layout: any): Promise<string> {
  const input = stableStringify(layout)
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// ═══════════════════════════════════════════════════════════════════════════
// Hash Lookup (Dual-Mode: Dev / Production)
// ═══════════════════════════════════════════════════════════════════════════

declare const globalThis: any

/**
 * Get the latest AST hash.
 *
 * DEV MODE (dev=true): reads from KV every call — no caching.
 *   Latency: ~5ms KV read per poll. Ensures publish → sentinel picks up
 *   on the very next tick. No worker restart required.
 *
 * PRODUCTION MODE (dev=false): warm cache via globalThis (O(1)).
 *   Cold start falls back to KV once per isolate lifecycle.
 */
export async function getLatestHash(
  opts?: {
    kv?: { get: (key: string, type: 'json') => Promise<any> }
    dev?: boolean
    manifestKey?: string
  },
): Promise<string> {
  const kv = opts?.kv
  const key = opts?.manifestKey || 'latest_ast_manifest'

  // ── DEV MODE: always read fresh from KV ─────────────────────────────
  if (opts?.dev && kv) {
    try {
      const manifest = await kv.get(key, 'json')
      if (manifest?.hash) {
        // Update warm cache for consistency, but still return fresh value
        globalThis.EDR_LATEST_HASH = manifest.hash
        return manifest.hash
      }
    } catch {
      // KV miss — fall through
    }
    return 'default-hash'
  }

  // ── PRODUCTION MODE: warm cache (O(1)) ──────────────────────────────
  if (globalThis.EDR_LATEST_HASH) {
    return globalThis.EDR_LATEST_HASH
  }

  // Cold start — hydrate from KV (once per isolate lifecycle)
  if (kv) {
    try {
      const manifest = await kv.get(key, 'json')
      if (manifest?.hash) {
        globalThis.EDR_LATEST_HASH = manifest.hash
        return manifest.hash
      }
    } catch {
      // KV miss — fall through
    }
  }

  globalThis.EDR_LATEST_HASH = 'default-hash'
  return 'default-hash'
}

/**
 * Set the latest AST hash in both memory and KV.
 * Called at publish time only — never during polling.
 */
export async function setLatestHash(
  hash: string,
  layout: any,
  kv: { put: (key: string, value: string) => Promise<void> },
): Promise<void> {
  globalThis.EDR_LATEST_HASH = hash
  const manifest = JSON.stringify({ hash, timestamp: Date.now() })
  await kv.put('latest_ast_manifest', manifest)
}

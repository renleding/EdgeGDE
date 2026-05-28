/**
 * EdgeGDE EDR — Hash Authority (Warm-Cache Pattern)
 * v4.9.1: Hybrid warm-cache hash lookup for dev feedback loop.
 * Fast path: globalThis.EDR_LATEST_HASH (O(1))
 * Cold start: KV read once per isolate lifecycle
 *
 * @packageDocumentation
 */

import { stableStringify } from '../../lib/hash'

// ═══════════════════════════════════════════════════════════════════════════
// Hash Computation (pure, deterministic)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a deterministic hash from a layout AST.
 * Uses stableStringify + SHA-256 for byte-identical results.
 */
export async function computeLayoutHash(layout: any): Promise<string> {
  const input = stableStringify(layout)
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// ═══════════════════════════════════════════════════════════════════════════
// Hash Lookup (Hybrid Warm Cache)
// ═══════════════════════════════════════════════════════════════════════════

declare const globalThis: any

/**
 * Get the latest AST hash.
 * - Fast path: globalThis (O(1), no IO)
 * - Cold start: KV read once, hydrate memory
 *
 * Must NOT write KV during polling. Must NOT trigger compilation.
 */
export async function getLatestHash(
  kv?: { get: (key: string, type: 'json') => Promise<any> },
): Promise<string> {
  // Fast path — already in memory
  if (globalThis.EDR_LATEST_HASH) {
    return globalThis.EDR_LATEST_HASH
  }

  // Cold start — hydrate from KV (once per isolate lifecycle)
  if (kv) {
    try {
      const manifest = await kv.get('latest_ast_manifest', 'json')
      if (manifest?.hash) {
        globalThis.EDR_LATEST_HASH = manifest.hash
        return manifest.hash
      }
    } catch {
      // KV miss — fall through to default
    }
  }

  // Default fallback
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

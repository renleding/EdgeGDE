/**
 * EdgeGDE — Safe Counter Utilities
 * Phase 30: O(1) counter reads for KV telemetry.
 * Replaces kv.list() calls to stay within Cloudflare Workers KV free tier.
 *
 * CRITICAL: First argument is the specific KV binding (e.g., c.env.ARTIFACT_KV),
 * NOT the global env object. This ensures correct namespace targeting.
 *
 * @packageDocumentation
 */

/**
 * Read a counter value from a specific KV namespace.
 * Returns 0 if the key doesn't exist or on any error.
 * Guaranteed never to throw.
 */
export async function getCounter(kvBinding: any, key: string): Promise<number> {
  try {
    const raw = await kvBinding.get(key)
    let count = parseInt(raw || '0', 10)
    if (isNaN(count)) count = 0
    return count
  } catch {
    return 0
  }
}

/**
 * Increment a counter in a specific KV namespace.
 * On failure, tries to initialize the key to 1.
 * Silent on error — telemetry never breaks the main flow.
 */
export async function incrementCounter(kvBinding: any, key: string): Promise<void> {
  try {
    const current = await getCounter(kvBinding, key)
    await kvBinding.put(key, String(current + 1))
  } catch {
    // Fallback: ensure key exists
    try {
      await kvBinding.put(key, '1')
    } catch {
      // Fail silently — counters must never crash the request
    }
  }
}

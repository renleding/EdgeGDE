/**
 * EdgeGDE Runtime — Correlation Enforcement Middleware
 *
 * Enforces the Action ↔ Trace binding policy:
 *   "Every executed action MUST emit a trace with the same correlationId
 *    as its audit event."
 *
 * BEHAVIOUR:
 *   - If X-Correlation-Id header is present → sets c.var.correlationId
 *   - If absent → auto-injects a UUID v4 correlation ID
 *   - Never rejects — the correlation ID is mandatory for tracing, but
 *     the request always proceeds. Missing correlation IDs are logged as
 *     telemetry warnings for later investigation.
 *
 * This MUST be mounted before the tenant resolver to ensure every request
 * has a correlationId from the earliest possible point.
 *
 * @see docs/OTEL-ATTRIBUTES.md
 * @see docs/FRs-001-compensation-replay-reconcile-dryrun.md (Q4 resolution)
 */

import type { Context, Next } from 'hono'

/**
 * Generate a simple UUID v4 (no external dependency).
 * Cloudflare Workers support crypto.randomUUID() or Web Crypto API.
 */
function generateCorrelationId(): string {
  // Cloudflare Workers: crypto.randomUUID() is available via nodejs_compat
  // Fallback: manual construction for environments without it
  try {
    return crypto.randomUUID()
  } catch {
    // Manual UUID v4 fallback
    const hex = '0123456789abcdef'
    const sections = [8, 4, 4, 4, 12]
    return sections
      .map((len, i) => {
        let s = ''
        for (let j = 0; j < len; j++) {
          s += hex[Math.floor(Math.random() * 16)]
        }
        return i === 2 ? `4${s.slice(1)}` : s
      })
      .join('-')
  }
}

export async function correlationMiddleware(c: Context, next: Next): Promise<void> {
  // 1. Read correlation ID from header
  let correlationId = c.req.header('x-correlation-id')

  // 2. Auto-inject if missing
  if (!correlationId) {
    correlationId = generateCorrelationId()
    // Log the auto-injection — visible in Worker analytics
    console.warn(
      `[correlation] auto-injected correlationId=${correlationId} for ${c.req.method} ${c.req.url}`,
    )
  }

  // 3. Store on context for downstream handlers and telemetry
  c.set('correlationId', correlationId)

  // 4. Also store mission and action IDs if provided
  const missionId = c.req.header('x-mission-id')
  const actionId = c.req.header('x-action-id')
  if (missionId) c.set('missionId', missionId)
  if (actionId) c.set('actionId', actionId)

  // 5. Set response header for traceability
  c.header('x-correlation-id', correlationId)

  await next()
}

/**
 * Helper to read the current correlationId from the Hono context.
 * Returns the auto-injected value if none was provided in the request.
 */
export function getCorrelationId(c: Context): string {
  return (c.get('correlationId') as string) ?? ''
}

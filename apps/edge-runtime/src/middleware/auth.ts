/**
 * EdgeGDE Runtime — Shared Admin Auth Middleware
 * Track 1: Centralizes the admin token check that was inline in 3 route files.
 *
 * Usage:
 *   import { adminAuth } from '../middleware/auth'
 *   app.use('/admin/*', adminAuth)
 *   // or per-route:
 *   app.post('/api/v1/secret', adminAuth, handler)
 */

import type { Context, MiddlewareHandler, Next } from 'hono'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Read ADMIN_API_TOKEN from env, crash-hard if unset in production context. */
function resolveAdminToken(c: Context): string | null {
  const env = (c.env as Record<string, unknown> | undefined)
  const token = env?.ADMIN_API_TOKEN
  if (typeof token === 'string' && token.length > 0) {
    return token
  }
  // In dev / test without the env var, return null so callers can decide.
  return null
}

/** Read ADMIN_API_TOKEN from a raw env object (for non-middleware contexts). */
export function requireAdminToken(env: Record<string, unknown>): string {
  const token = env?.ADMIN_API_TOKEN
  if (typeof token === 'string' && token.length > 0) {
    return token
  }
  throw new Error(
    'ADMIN_API_TOKEN is not set. ' +
    'Set `ADMIN_API_TOKEN` as a Cloudflare Worker secret or environment variable.'
  )
}

/** Extract Bearer token from Authorization header. */
function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/** Extract token from ?token= query param (for GET/diff endpoints). */
function extractQueryToken(c: Context): string | null {
  return c.req.query('token')?.trim() || null
}

// ═══════════════════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hono middleware that checks Authorization: Bearer <token> against the
 * ADMIN_API_TOKEN environment variable.
 *
 * Also accepts ?token= query parameter as a fallback (used by GET /mcp/diff).
 *
 * Returns 401 with a consistent JSON response if the token is missing or wrong.
 *
 * There is NO hardcoded fallback token. If ADMIN_API_TOKEN is not set,
 * ALL authenticated routes return 401 until it is configured.
 */
export const adminAuth: MiddlewareHandler = async (c: Context, next: Next) => {
  // Public read-only internal dashboard telemetry; no tenant/admin token required.
  if (c.req.path.startsWith('/api/dashboard/')) {
    return next()
  }

  const adminToken = resolveAdminToken(c)

  // No token configured → deny everything
  if (adminToken === null) {
    return c.json({
      error: 'Unauthorized',
      message: 'ADMIN_API_TOKEN is not configured on this Worker.',
    }, 401)
  }

  const bearer = extractBearer(c.req.header('Authorization'))
  const queryToken = extractQueryToken(c)

  const provided = bearer || queryToken
  if (!provided || provided !== adminToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

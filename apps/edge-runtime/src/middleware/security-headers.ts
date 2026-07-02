/**
 * EdgeGDE — Security Headers Middleware
 *
 * Sets secure defaults for CSP, HSTS, X-Content-Type-Options, and
 * X-Frame-Options on every response.  Per-route overrides are
 * applied after this middleware runs, so routes that need relaxed
 * policies (e.g. the embed/chat widget) must set their own headers.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono'

export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next()

  // Only set headers that haven't already been set by the route handler.
  // This lets per-route overrides win while still providing a secure default.

  if (!c.res.headers.has('Content-Security-Policy')) {
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "img-src 'self' data: https:",
        "connect-src 'self' https://cdn.jsdelivr.net",
        "font-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    )
  }

  if (!c.res.headers.has('Strict-Transport-Security')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  if (!c.res.headers.has('X-Content-Type-Options')) {
    c.header('X-Content-Type-Options', 'nosniff')
  }

  if (!c.res.headers.has('X-Frame-Options')) {
    c.header('X-Frame-Options', 'SAMEORIGIN')
  }
}

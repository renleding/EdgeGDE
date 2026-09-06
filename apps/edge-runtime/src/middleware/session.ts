/**
 * EdgeGDE — Session Middleware (JWT Cookie)
 *
 * HTTP-only Secure cookie-based session using HMAC-SHA256 JWT.
 * Native Workers crypto — no npm dependencies.
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { envFromContext } from '../lib/env'
import { verifyPassword } from '../lib/password'

// ═══════════════════════════════════════════════════════════════════════════
// JWT helpers
// ═══════════════════════════════════════════════════════════════════════════

function base64Url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return base64Url(sig)
}

export interface SessionPayload {
  tenantId: string
  slug: string
  name: string
  iat: number
  exp: number
}

/**
 * Variables set on the Hono context by requireSession().
 */
export interface SessionVars {
  tenantSession: SessionPayload
  tenantId: string
  slug: string
}

export type SessionContext = Context<{ Variables: SessionVars }>

/**
 * Create a signed JWT session token.
 * Expiry defaults to 24 hours.
 */
export async function createSessionToken(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 86400,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claims: SessionPayload = { ...payload, iat: now, exp: now + expiresInSeconds }
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = base64Url(new TextEncoder().encode(JSON.stringify(claims)))
  const sig = await hmacSha256(secret, `${header}.${body}`)
  return `${header}.${body}.${sig}`
}

/**
 * Verify and decode a JWT session token.
 * Returns null if invalid or expired.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, bodyB64, sigB64] = parts
    const expectedSig = await hmacSha256(secret, `${headerB64}.${bodyB64}`)
    if (sigB64 !== expectedSig) return null

    const body = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(bodyB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    )) as SessionPayload

    if (body.exp < Math.floor(Date.now() / 1000)) return null
    return body
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════════════════

const COOKIE_NAME = 'edgegde_session'

/**
 * Hono middleware that requires a valid session cookie.
 * Sets c.var.tenantSession with the decoded payload on success.
 * Returns 401 if missing or invalid.
 */
export function requireSession(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const jwtSecret = envFromContext(c).JWT_SECRET
    if (!jwtSecret) {
      return c.json({ error: 'JWT_SECRET not configured on this Worker' }, 500)
    }

    const cookie = c.req.header('Cookie') || ''
    const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
    if (!match) {
      return c.json({ error: 'Unauthorized — no session' }, 401)
    }

    const payload = await verifySessionToken(match[1], jwtSecret)
    if (!payload) {
      return c.json({ error: 'Unauthorized — invalid session' }, 401)
    }

    // Set tenant context for downstream handlers
    const ctx = c as SessionContext
    ctx.set('tenantSession', payload)
    ctx.set('tenantId', payload.tenantId)
    ctx.set('slug', payload.slug)

    await next()
  }
}

/**
 * Set the session cookie on the response.
 */
export function setSessionCookie(c: Context, token: string): void {
  c.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
  )
}

/**
 * Clear the session cookie (logout).
 */
export function clearSessionCookie(c: Context): void {
  c.header(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  )
}

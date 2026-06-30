/**
 * EdgeGDE — Login Endpoint
 *
 * Authenticates a tenant by slug + password, returns a JWT session cookie.
 *
 * @see docs/execution-multi-tenant-onboarding.md
 */

import { Hono } from 'hono'
import { verifyPassword } from '../lib/password'
import { envFromContext } from '../lib/env'
import { createSessionToken, setSessionCookie } from '../middleware/session'

const router = new Hono()

/**
 * POST /login — Authenticate and return session cookie.
 */
router.post('/', async (c) => {
  try {
    const body: any = await c.req.json()
    const slug = (body.slug || '').trim()
    const password = body.password || ''

    if (!slug || !password) {
      return c.json({ error: 'Slug and password are required' }, 400)
    }

    // ── 1. Look up tenant ──────────────────────────────────────────────
    const env = envFromContext(c)
    const TENANT_KV = env.TENANT_KV
    if (!TENANT_KV || typeof TENANT_KV.get !== 'function') {
      return c.json({ error: 'Authentication unavailable' }, 500)
    }

    const tenant: any = await TENANT_KV.get(`tenant:${slug}`, 'json')
    if (!tenant) {
      return c.json({ error: 'Invalid slug or password' }, 401)
    }

    // ── 2. Verify password ─────────────────────────────────────────────
    const credentials: any = await TENANT_KV.get(`tenant:${slug}:credentials`, 'json')
    if (!credentials?.passwordHash) {
      return c.json({ error: 'Invalid slug or password' }, 401)
    }

    const valid = await verifyPassword(password, credentials.passwordHash)
    if (!valid) {
      return c.json({ error: 'Invalid slug or password' }, 401)
    }

    // ── 3. Create session ──────────────────────────────────────────────
    const jwtSecret = env.JWT_SECRET
    if (!jwtSecret) {
      return c.json({ error: 'JWT_SECRET not configured' }, 500)
    }

    const token = await createSessionToken(
      { tenantId: tenant.tenantId, slug: tenant.slug, name: tenant.name },
      jwtSecret,
    )

    setSessionCookie(c, token)

    return c.json({
      tenantId: tenant.tenantId,
      slug: tenant.slug,
      name: tenant.name,
    })

  } catch (err: any) {
    return c.json({ error: err.message || 'Login failed' }, 500)
  }
})

export { router as loginRouter }

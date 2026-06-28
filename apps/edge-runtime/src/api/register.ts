/**
 * EdgeGDE — Registration Endpoint
 *
 * Public self-service tenant registration.
 * Creates tenant in KV, seeds default layout, mirrors to D1, generates API key.
 *
 * @see docs/execution-multi-tenant-onboarding.md
 */

import { Hono } from 'hono'
import { validateSlug } from '../lib/tenant'
import { hashPassword } from '../lib/password'

interface RegisterBody {
  companyName: string
  email: string
  password: string
  slug: string
  plan?: 'free' | 'pro'
  captchaToken: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Turnstile verification helper
// ═══════════════════════════════════════════════════════════════════════════

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const data: any = await res.json()
    return data.success === true
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

const router = new Hono()

/**
 * POST /register — Create a new tenant account.
 */
router.post('/', async (c) => {
  try {
    const body: RegisterBody = await c.req.json()
    const env = c.env as Record<string, unknown>

    // ── 1. Verify captcha ──────────────────────────────────────────────
    const turnstileSecret = env.TURNSTILE_SECRET_KEY as string | undefined
    if (turnstileSecret) {
      const valid = await verifyTurnstile(body.captchaToken, turnstileSecret)
      if (!valid) {
        return c.json({ error: 'Captcha verification failed. Please try again.' }, 400)
      }
    }

    // ── 2. Validate slug ───────────────────────────────────────────────
    let slug: string
    try {
      slug = validateSlug(body.slug)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }

    // ── 3. Validate email (basic) ──────────────────────────────────────
    const email = (body.email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: 'Valid email is required' }, 400)
    }

    // ── 4. Validate password strength ──────────────────────────────────
    const pw = body.password || ''
    if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      return c.json({ error: 'Password must be at least 8 characters with 1 uppercase and 1 digit' }, 400)
    }

    // ── 5. Check duplicate slug ────────────────────────────────────────
    const TENANT_KV = (env.TENANT_KV as any)
    if (!TENANT_KV || typeof TENANT_KV.get !== 'function') {
      return c.json({ error: 'Tenant storage unavailable' }, 500)
    }

    const existing = await TENANT_KV.get(`tenant:${slug}`, 'json')
    if (existing) {
      return c.json({ error: `Slug "${slug}" is already taken` }, 409)
    }

    // ── 6. Hash password ───────────────────────────────────────────────
    const passwordHash = await hashPassword(pw)

    // ── 7. Create tenant ───────────────────────────────────────────────
    const tenantId = crypto.randomUUID()
    const now = new Date().toISOString()
    const plan = body.plan === 'pro' ? 'pro' : 'free'

    const tenant = {
      tenantId,
      slug,
      name: body.companyName || slug,
      email,
      createdAt: now,
      plan,
      verified: false,
    }

    // ── 8. Generate API key ────────────────────────────────────────────
    const apiKey = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const credentials = {
      passwordHash,
      apiKeyHash: await hashPassword(apiKey),
      apiKeyPlaintext: apiKey,  // temporary — shown once during onboarding, then removed
      createdAt: now,
    }

    // ── 9. Seed default layout ─────────────────────────────────────────
    const defaultLayout = {
      type: 'Page',
      children: [
        {
          type: 'Header',
          props: { logo: tenant.name, links: ['Home', 'Products', 'Contact'] },
        },
        {
          type: 'Section:Hero',
          props: { title: `${tenant.name}`, subtitle: 'Powered by EdgeGDE' },
        },
        { type: 'Footer' },
      ],
    }

    // ── 10. Persist to KV (atomic batch) ───────────────────────────────
    await Promise.all([
      TENANT_KV.put(`tenant:${slug}`, JSON.stringify(tenant)),
      TENANT_KV.put(`tenant:${slug}:credentials`, JSON.stringify(credentials)),
      TENANT_KV.put(`tenant:${tenantId}:layout:latest`, JSON.stringify(defaultLayout)),
      TENANT_KV.put(`tenant:${tenantId}:design`, '## Colors\nprimary: #1a73e8\nbackground: #ffffff\ntext: #111111'),
    ])

    // ── 11. Mirror to D1 (non-fatal) ───────────────────────────────────
    const DB = env.DB as any
    if (DB && typeof DB.prepare === 'function') {
      try {
        await DB.prepare(
          `INSERT OR IGNORE INTO tenants (slug, tenant_id, name, plan, email) VALUES (?, ?, ?, ?, ?)`
        ).bind(slug, tenantId, tenant.name, plan, email).run()
      } catch {
        // D1 mirror is non-fatal — KV is source of truth
      }
    }

    // ── 12. Return ─────────────────────────────────────────────────────
    return c.json({
      tenantId,
      slug,
      name: tenant.name,
      apiKey,
      dashboardUrl: `/onboarding?step=1&slug=${slug}`,
    }, 201)

  } catch (err: any) {
    return c.json({ error: err.message || 'Registration failed' }, 500)
  }
})

export { router as registerRouter }

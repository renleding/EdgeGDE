/**
 * EdgeGDE — Email Verification
 *
 * Sends 6-digit verification codes via Resend API.
 * POST /verify — confirm code
 * POST /verify/resend — send new code with 60s cooldown
 *
 * Requires RESEND_API_KEY env var to send emails.
 * Without it, the endpoint returns 501 (not implemented).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'

const router = new Hono()

function genCode(): string {
  const bytes = new Uint8Array(3)
  crypto.getRandomValues(bytes)
  const code = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1_000_000
  return String(code).padStart(6, '0')
}

async function sendEmail(apiKey: string, to: string, code: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'EdgeGDE <noreply@edgegde.com>',
        to,
        subject: 'Verify your EdgeGDE account',
        text: `Your EdgeGDE verification code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * POST /verify — Confirm email verification code.
 */
router.post('/', async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>
    const slug = String(body.slug ?? '').trim()
    const code = String(body.code ?? '').trim()
    if (!slug || !code) return c.json({ error: 'Slug and code are required' }, 400)

    const env = envFromContext(c)
    const TENANT_KV = env.TENANT_KV
    if (!TENANT_KV) return c.json({ error: 'Verification unavailable' }, 500)

    const record = await TENANT_KV.get<{ expiresAt?: number; attempts?: number; code?: string }>(`tenant:${slug}:email_verification`, 'json')
    if (!record) return c.json({ error: 'No verification code found. Request a new one.' }, 400)

    if (Date.now() > (record.expiresAt ?? 0)) {
      await TENANT_KV.delete(`tenant:${slug}:email_verification`)
      return c.json({ error: 'Verification code expired. Request a new one.' }, 400)
    }

    if ((record.attempts ?? 0) >= 5) {
      return c.json({ error: 'Too many failed attempts. Request a new code.' }, 429)
    }

    if (record.code !== code) {
      const attempts = (record.attempts ?? 0) + 1
      await TENANT_KV.put(`tenant:${slug}:email_verification`, JSON.stringify({ ...record, attempts }))
      return c.json({ error: 'Invalid code', remaining: 5 - attempts }, 400)
    }

    // Mark tenant as verified
    const tenant = await TENANT_KV.get<Record<string, unknown>>(`tenant:${slug}`, 'json')
    if (tenant) {
      await TENANT_KV.put(`tenant:${slug}`, JSON.stringify({ ...tenant, verified: true }))
    }

    await TENANT_KV.delete(`tenant:${slug}:email_verification`)
    return c.json({ success: true, verified: true })

  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Verification failed' }, 500)
  }
})

/**
 * POST /verify/resend — Send a new verification code (60s cooldown).
 */
router.post('/resend', async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>
    const slug = String(body.slug ?? '').trim()
    if (!slug) return c.json({ error: 'Slug is required' }, 400)

    const env = envFromContext(c)
    const TENANT_KV = env.TENANT_KV
    if (!TENANT_KV) return c.json({ error: 'Verification unavailable' }, 500)

    // Load tenant to get email
    const tenant = await TENANT_KV.get<{ verified?: boolean; email?: string; name?: string }>(`tenant:${slug}`, 'json')
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (tenant.verified) return c.json({ error: 'Already verified' }, 400)

    // Cooldown check
    const existing = await TENANT_KV.get<{ sentAt?: number }>(`tenant:${slug}:email_verification`, 'json')
    if (existing && Date.now() - (existing.sentAt ?? 0) < 60_000) {
      const wait = Math.ceil((60_000 - (Date.now() - (existing.sentAt ?? 0))) / 1000)
      return c.json({ error: `Please wait ${wait}s before requesting a new code` }, 429)
    }

    // Generate and store code
    const code = genCode()
    const record = {
      code,
      expiresAt: Date.now() + 15 * 60 * 1000,  // 15 minutes
      attempts: 0,
      sentAt: Date.now(),
    }
    await TENANT_KV.put(`tenant:${slug}:email_verification`, JSON.stringify(record))

    // Send email
    const resendKey = env.RESEND_API_KEY
    if (resendKey && tenant.email) {
      const sent = await sendEmail(resendKey, tenant.email, code)
      if (!sent) {
        return c.json({ error: 'Failed to send email. Please try again.' }, 500)
      }
    } else {
      // No Resend configured — return code directly (dev mode)
      return c.json({ success: true, code, note: 'No RESEND_API_KEY configured — dev mode' })
    }

    return c.json({ success: true })

  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to resend code' }, 500)
  }
})

export { router as verifyRouter }

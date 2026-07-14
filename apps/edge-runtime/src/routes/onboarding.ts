/**
 * EdgeGDE — Onboarding Wizard (HTMX)
 *
 * 3-step onboarding flow after registration:
 *   Step 1: Welcome + workspace URL
 *   Step 2: API key display + copy button + warning
 *   Step 3: First steps links → redirect to dashboard
 *
 * Progress tracked in KV so users can resume where they left off.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { requireSession } from '../middleware/session'
import { verifySessionToken } from '../middleware/session'
import { envFromContext } from '../lib/env'

const router = new Hono()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Read the session slug from the JWT cookie, if present. */
async function getSessionSlug(c: any): Promise<string | null> {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/edgegde_session=([^;]+)/)
  if (!match) return null
  const jwtSecret = c.env?.JWT_SECRET as string | undefined
  if (!jwtSecret) return null
  const payload = await verifySessionToken(match[1], jwtSecret)
  return payload?.slug ?? null
}

/** Styles shared across wizard steps. */
const STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:12px;padding:32px;max-width:520px;width:100%;margin:24px}
  .step-dots{display:flex;gap:8px;justify-content:center;margin-bottom:24px}
  .step-dot{width:10px;height:10px;border-radius:50%;background:#2d3140;display:inline-block}
  .step-dot.active{background:#3fb950;width:12px;height:12px}
  .step-dot.done{background:#238636}
  h1{font-size:20px;color:#f0f6fc;margin-bottom:8px}
  p{color:#8b949e;margin-bottom:16px;line-height:1.5}
  .key-box{background:#0d1117;border:1px solid #2d3140;border-radius:8px;padding:12px;font-family:monospace;font-size:13px;color:#f0f6fc;word-break:break-all;margin-bottom:12px;user-select:all}
  .btn{display:inline-block;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;text-decoration:none;cursor:pointer;border:none}
  .btn-primary{background:#238636;color:#fff}
  .btn-primary:hover{background:#2ea043}
  .btn-secondary{background:#1c2128;color:#e1e4e8;border:1px solid #2d3140}
  .btn-secondary:hover{background:#2d3140}
  .btn:disabled{opacity:0.5;cursor:not-allowed}
  .warn{background:#d2992220;border:1px solid #d29922;border-radius:8px;padding:12px;font-size:12px;color:#d29922;margin-bottom:16px}
  .links{list-style:none;margin-bottom:16px}
  .links li{padding:8px 0;border-bottom:1px solid #1c2128}
  .links a{color:#58a6ff;text-decoration:none}
  .links a:hover{text-decoration:underline}
`

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — EdgeGDE</title>
<style>${STYLES}</style>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`
}

function steps(current: number): string {
  let dots = ''
  for (let i = 1; i <= 3; i++) {
    const cls = i === current ? 'active' : i < current ? 'done' : ''
    dots += `<span class="step-dot ${cls}"></span>\n`
  }
  return `<div class="step-dots">${dots}</div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /onboarding
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', async (c) => {
  const slug = c.req.query('slug') || (await getSessionSlug(c))
  const stepParam = c.req.query('step')
  const TENANT_KV = (c.env as { TENANT_KV?: { get: Function; put: Function } })?.TENANT_KV

  if (!slug) {
    return c.html(page('Welcome', `
      <h1>Welcome to EdgeGDE</h1>
      <p>Your account has been created. Please <a href="/login" style="color:#58a6ff">log in</a> to continue.</p>
      <a href="/login" class="btn btn-primary">Log in</a>
    `))
  }

  // Load progress from KV
  let progress: any = { step1: false, step2: false, step3: false }
  if (TENANT_KV) {
    try {
      const raw = await TENANT_KV.get(`tenant:${slug}:onboarding`, 'json')
      if (raw) progress = raw
    } catch {}
  }

  // Determine current step
  let step = 1
  if (stepParam) {
    step = parseInt(stepParam, 10)
  } else if (!progress.step1) { step = 1 }
  else if (!progress.step2) { step = 2 }
  else if (!progress.step3) { step = 3 }

  const tenant: any = TENANT_KV ? await TENANT_KV.get(`tenant:${slug}`, 'json') : null
  const name = tenant?.name || slug

  // Save step progress
  if (TENANT_KV && step >= 1) {
    progress.step1 = true
    await TENANT_KV.put(`tenant:${slug}:onboarding`, JSON.stringify(progress))
  }

  if (step === 1) {
    return c.html(page('Welcome — EdgeGDE', `
      ${steps(1)}
      <h1>Welcome, ${escapeHtml(name)}</h1>
      <p>Your workspace is ready.</p>
      <p>You can access your dashboard at:</p>
      <div class="key-box">https://${escapeHtml(slug)}.edgegde.com</div>
      <p style="font-size:12px;color:#4a4d55">Your tenant slug is <strong>${escapeHtml(slug)}</strong>. You'll use this to log in and access your workspace.</p>
      <a href="/onboarding?step=2&slug=${encodeURIComponent(slug)}" class="btn btn-primary">Next: Get your API key →</a>
    `))
  }

  if (step === 2) {
    // Need session to show API key
    const sessionSlug = await getSessionSlug(c)
    if (sessionSlug !== slug) {
      return c.html(page('Login required — EdgeGDE', `
        ${steps(2)}
        <h1>Login Required</h1>
        <p>Please log in to view your API key.</p>
        <a href="/login?redirect=/onboarding?step=2&slug=${encodeURIComponent(slug)}" class="btn btn-primary">Log in</a>
      `))
    }

    // Load credentials from KV
    let apiKey = '••••••••'
    let apiKeyDisplay = false
    if (TENANT_KV) {
      try {
        const creds: any = await TENANT_KV.get(`tenant:${slug}:credentials`, 'json')
        if (creds?.apiKeyPlaintext) {
          apiKey = creds.apiKeyPlaintext
          apiKeyDisplay = true
        }
      } catch {}
    }

    if (TENANT_KV && step >= 2) {
      progress.step2 = true
      await TENANT_KV.put(`tenant:${slug}:onboarding`, JSON.stringify(progress))
      // Remove plaintext key — shown once only
      const creds: any = await TENANT_KV.get(`tenant:${slug}:credentials`, 'json')
      if (creds?.apiKeyPlaintext) {
        delete creds.apiKeyPlaintext
        await TENANT_KV.put(`tenant:${slug}:credentials`, JSON.stringify(creds))
      }
    }

    return c.html(page('API Key — EdgeGDE', `
      ${steps(2)}
      <h1>Your API Key</h1>
      <p>This key is shown <strong>once</strong>. Store it securely.</p>
      <div class="warn">⚠ This key will not be shown again. If you lose it, you can regenerate it from your dashboard.</div>
      <div class="key-box" id="api-key">${escapeHtml(apiKey)}</div>
      <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${escapeHtml(apiKey).replace(/'/g, "\\'")}');this.textContent='Copied!'" style="margin-right:8px">Copy key</button>
      <a href="/onboarding?step=3&slug=${encodeURIComponent(slug)}" class="btn btn-primary">I've saved it. Next →</a>
    `))
  }

  if (step === 3) {
    if (TENANT_KV) {
      progress.step3 = true
      await TENANT_KV.put(`tenant:${slug}:onboarding`, JSON.stringify(progress))
    }

    return c.html(page('Ready — EdgeGDE', `
      ${steps(3)}
      <h1>You're all set!</h1>
      <p>Here are some next steps to get started:</p>
      <ul class="links">
        <li><a href="/admin/drift">📊 View your admin dashboard</a></li>
        <li><a href="/api/v1/loan-repayment">🧮 Try the calculator API</a></li>
        <li><a href="/admin/blueprints">📐 Configure your blueprint</a></li>
      </ul>
      <a href="/tenant/dashboard" class="btn btn-primary">Go to dashboard →</a>
    `))
  }

  return c.redirect(`/onboarding?step=1&slug=${encodeURIComponent(slug)}`)
})

export { router as onboardingRouter }

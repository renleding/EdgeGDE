/**
 * AFIRMICO Auto — Tesla Fleet API surface (Tier 1).
 *
 * Scope at this stage (FRS-010 F02):
 *   1. Serve the Tesla partner public key so Tesla can verify this domain
 *      during developer-app registration.
 *   2. Provide the member onboarding entry point that starts virtual-key pairing.
 *
 * This worker owns only these two paths, attached as Cloudflare Routes on
 * `auto.afirmi.co`. Every other path on the hostname is still served by the
 * existing splash worker, so the live landing page is untouched.
 *
 * The public key file on disk is the single source of truth; this handler only
 * attaches the content type. That keeps the served bytes identical to the
 * committed file, which is what the verification step checks.
 */

import { Hono } from 'hono'

export interface Env {
  /** Static assets binding, auto-provided by the `assets` config in wrangler.json. */
  ASSETS: Fetcher
}

/** Path Tesla fetches to verify domain ownership (F02-R01). */
const PUBLIC_KEY_PATH = '/.well-known/appspecific/com.tesla.3p.public-key.pem'

/**
 * Content type for the public key.
 *
 * FRS-010 F02-R01 specifies `application/x-pem-file`. That value is NOT yet
 * confirmed against Tesla's onboarding validator (SDD-010 O-9), so this is the
 * single place to change it once confirmed.
 */
const PUBLIC_KEY_CONTENT_TYPE = 'application/x-pem-file'

/** Tesla deep link that adds this app's virtual key to the member's vehicle. */
const PAIRING_URL = 'https://tesla.com/_ak/auto.afirmi.co'

const app = new Hono<{ Bindings: Env }>()

/**
 * Tesla public key.
 *
 * Served from the committed asset rather than an imported string so the
 * response is byte-identical to the file the repository records.
 */
app.get(PUBLIC_KEY_PATH, async (c) => {
  const assetUrl = new URL(PUBLIC_KEY_PATH, c.req.url)
  const asset = await c.env.ASSETS.fetch(new Request(assetUrl, c.req.raw))

  if (!asset.ok) {
    return c.text('Public key not found', 404)
  }

  const body = await asset.text()
  return c.body(body, 200, {
    'content-type': PUBLIC_KEY_CONTENT_TYPE,
    'cache-control': 'public, max-age=300',
  })
})

/**
 * Member onboarding entry point.
 *
 * Pairing itself is user-in-the-loop and happens in the Tesla app; this page
 * cannot complete it. It explains the step and hands off to Tesla.
 *
 * Status note: partner registration (FRS-010 R-01) has not been completed, so
 * the pairing link is not yet functional. The page says so rather than implying
 * a working flow.
 */
app.get('/connect', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your Tesla — AFIRMICO Auto</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#090909;color:#fff;font-family:Arial,Helvetica,sans-serif;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto;padding:48px 24px}
  .logo{font-size:28px;font-weight:700;letter-spacing:1px}
  h1{font-size:44px;line-height:1.15;margin:32px 0 16px}
  p{color:#d5d5d5;font-size:18px}
  .steps{counter-reset:s;list-style:none;padding:0;margin:32px 0}
  .steps li{counter-increment:s;position:relative;padding:18px 18px 18px 64px;background:#151515;border-radius:14px;margin-bottom:14px}
  .steps li::before{content:counter(s);position:absolute;left:18px;top:18px;width:30px;height:30px;border-radius:50%;background:#42ff8c;color:#08130c;font-weight:700;display:flex;align-items:center;justify-content:center}
  .cta{display:inline-block;margin-top:8px;padding:14px 22px;border-radius:10px;background:#0b5ed7;color:#fff;text-decoration:none;font-weight:700}
  .note{margin-top:32px;padding:16px;border-left:3px solid #f5a623;background:#1a1508;color:#f0d9a8;border-radius:8px;font-size:15px}
  a{color:#8ab4ff}
  footer{margin-top:48px;color:#7a7a7a;font-size:14px}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">AFIRMICO Auto</div>

  <h1>Connect your Tesla</h1>

  <p>AFIRMICO Auto asks your Tesla for two numbers only: total kilometres driven, and how many of
  those were driven on Full Self-Driving. Nothing else is collected, and you can revoke it at any time
  from your Tesla account.</p>

  <ol class="steps">
    <li>Open the Tesla app on your phone.</li>
    <li>Find <strong>Security &rarr; Third-Party Apps</strong> (or <em>Manage Keys</em>) and choose to add a key.</li>
    <li>Use the link below to hand off to Tesla and approve the AFIRMICO Auto key.</li>
  </ol>

  <a class="cta" href="${PAIRING_URL}">Continue to Tesla</a>

  <div class="note">
    <strong>Not live yet.</strong> Tesla developer-app registration for this platform has not been
    completed, so this hand-off will not work until it is. This page is being staged ahead of that step.
  </div>

  <footer>AFIRMICO Auto | EV Data | Home Energy Statistics | Benefit Optimisation</footer>
</div>
</body>
</html>`
  return c.html(html)
})

/** Liveness check for deployment verification. */
app.get('/healthz', (c) =>
  c.json({ status: 'ok', service: 'afirmico-tesla' }),
)

/**
 * Anything else under the attached routes is passed back to the origin, which
 * keeps the existing splash site serving normally.
 */
app.notFound((c) => fetch(c.req.raw))

export default app

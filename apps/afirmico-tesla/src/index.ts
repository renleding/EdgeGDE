/**
 * AFIRMICO Auto — Tesla Fleet API surface (Tier 1).
 *
 * Scope (FRS-010):
 *   - F02-R01  serve the Tesla partner public key so Tesla can verify the domain
 *   - F02-R04  OAuth: client_credentials (partner) + authorization_code (member)
 *   - F01-R04  consent is revocable by the member at any time
 *   - R-13     the member-facing connect -> consent -> dashboard path
 *
 * This worker owns only the Tesla-facing paths on `auto.afirmi.co`, attached as
 * Cloudflare Routes. Routes take precedence over a Custom Domain, so every path
 * this worker does not claim is still served by the existing splash worker and
 * the live landing page is untouched.
 *
 * Explicitly NOT in scope yet: telemetry ingest, vehicle data storage, TOCA
 * membership gating, admin dashboard. Those land with the Oracle relay and the
 * D1 schema (SDD-010).
 */

import { Hono } from 'hono'
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  TESLA_AUDIENCE,
  TESLA_REVOKE_URL,
  TESLA_SCOPES,
  type VehicleSummary,
  assertConfigured,
  buildAuthorizeUrl,
  clearCookie,
  exchangeCode,
  fetchVehicles,
  generateCodeVerifier,
  generateState,
  parseCookies,
  s256Challenge,
  serializeCookie,
  verifyState,
} from './oauth'

export interface Env {
  /** Static assets binding, provided by the `assets` config in wrangler.json. */
  ASSETS: Fetcher
  /** OAuth session + PKCE transients. */
  OAUTH_SESSIONS: KVNamespace
  /** Tesla developer app client id (public value — appears in the authorize URL). */
  TESLA_CLIENT_ID: string
  /** Tesla developer app client secret. Worker secret; never leaves the server. */
  TESLA_CLIENT_SECRET: string
  /** HMAC key used to sign OAuth `state` values. Worker secret. */
  OAUTH_STATE_SECRET: string
  /** Fleet API base URL. Defaults to the NA base (Australia routes here). */
  TESLA_AUDIENCE?: string
}

/** Path Tesla fetches to verify domain ownership (F02-R01). */
const PUBLIC_KEY_PATH = '/.well-known/appspecific/com.tesla.3p.public-key.pem'

/**
 * Content type for the public key.
 *
 * FRS-010 F02-R01 specifies `application/x-pem-file`. Confirmed in production:
 * Tesla's registration call downloaded this key successfully with that type
 * (partner record created 2026-10-02). SDD-010 O-9 / FRS R-14 are settled.
 */
const PUBLIC_KEY_CONTENT_TYPE = 'application/x-pem-file'

/** Tesla deep link that adds this app's virtual key to the member's vehicle. */
const PAIRING_URL = 'https://tesla.com/_ak/auto.afirmi.co'

/** Registered redirect URI. Must match Tesla's app config byte for byte. */
const REDIRECT_PATH = '/auth/callback'

/** The single URL Tesla returned to after consent (registered in the app). */
const DASHBOARD_PATH = '/dashboard'

/** PKCE verifier lifetime: the member has 10 minutes to complete consent. */
const PKCE_TTL_SECONDS = 600

/** Session lifetime. Refresh tokens outlive this and are refreshed server-side. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90

interface SessionRecord {
  createdAt: string
  scope: string
  refreshToken?: string
  accessTokenExpiresAt: string
  vehicles: VehicleSummary[]
}

const app = new Hono<{ Bindings: Env }>()

/* -------------------------------------------------------------------------- */
/* Shared rendering                                                           */
/* -------------------------------------------------------------------------- */

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#090909;color:#fff;font-family:Arial,Helvetica,sans-serif;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto;padding:48px 24px}
  .logo{font-size:28px;font-weight:700;letter-spacing:1px}
  h1{font-size:44px;line-height:1.15;margin:32px 0 16px}
  h2{font-size:20px;margin:32px 0 8px}
  p{color:#d5d5d5;font-size:18px}
  .steps{counter-reset:s;list-style:none;padding:0;margin:32px 0}
  .steps li{counter-increment:s;position:relative;padding:18px 18px 18px 64px;background:#151515;border-radius:14px;margin-bottom:14px}
  .steps li::before{content:counter(s);position:absolute;left:18px;top:18px;width:30px;height:30px;border-radius:50%;background:#42ff8c;color:#08130c;font-weight:700;display:flex;align-items:center;justify-content:center}
  .cta{display:inline-block;margin-top:8px;padding:14px 22px;border-radius:10px;background:#0b5ed7;color:#fff;text-decoration:none;font-weight:700}
  .card{background:#151515;border-radius:14px;padding:20px;margin:16px 0}
  .ok{border-left:3px solid #42ff8c}
  .note{margin-top:32px;padding:16px;border-left:3px solid #f5a623;background:#1a1508;color:#f0d9a8;border-radius:8px;font-size:15px}
  .err{border-left:3px solid #ff5c5c;background:#1a0808;color:#ffb3b3}
  .meta{color:#8a8a8a;font-size:14px}
  code{background:#1d1d1d;padding:2px 6px;border-radius:4px;font-size:15px}
  a{color:#8ab4ff}
  footer{margin-top:48px;color:#7a7a7a;font-size:14px}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">AFIRMICO Auto</div>
  ${body}
  <footer>AFIRMICO Auto | EV Data | Home Energy Statistics | Benefit Optimisation</footer>
</div>
</body>
</html>`
}

/* -------------------------------------------------------------------------- */
/* Tesla public key (F02-R01)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Served from the committed asset rather than an imported string, so the
 * response is byte-identical to the file the repository records.
 */
app.get(PUBLIC_KEY_PATH, async (c) => {
  const asset = await c.env.ASSETS.fetch(new Request(new URL(PUBLIC_KEY_PATH, c.req.url), c.req.raw))
  if (!asset.ok) return c.text('Public key not found', 404)
  return c.body(await asset.text(), 200, {
    'content-type': PUBLIC_KEY_CONTENT_TYPE,
    'cache-control': 'public, max-age=300',
  })
})

/* -------------------------------------------------------------------------- */
/* Onboarding entry (R-13)                                                    */
/* -------------------------------------------------------------------------- */

app.get('/connect', (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const already = sessionId
    ? `<div class="card ok"><strong>Already connected.</strong> <a href="${DASHBOARD_PATH}">View your dashboard</a></div>`
    : ''

  return c.html(page('Connect your Tesla — AFIRMICO Auto', `
  <h1>Connect your Tesla</h1>

  <p>AFIRMICO Auto asks your Tesla for two numbers only: total kilometres driven, and how many of
  those were driven on Full Self-Driving. Nothing else is collected, and you can revoke it at any time
  from your Tesla account.</p>

  ${already}

  <ol class="steps">
    <li>Sign in with your Tesla account and approve the data access we request.</li>
    <li>Open the Tesla app to approve the AFIRMICO Auto key on your vehicle.</li>
    <li>Return to your dashboard to see the vehicles we can read.</li>
  </ol>

  <a class="cta" href="/auth/start">Continue to Tesla</a>

  <h2>What we request</h2>
  <p class="meta">${TESLA_SCOPES.join(' · ')} — identity, a refresh token so you don\\'t have to sign in
  again, and read access to vehicle data. We never request the ability to send commands to your car.</p>
  `))
})

/* -------------------------------------------------------------------------- */
/* OAuth: start (F02-R04)                                                     */
/* -------------------------------------------------------------------------- */

app.get('/auth/start', async (c) => {
  const problems = assertConfigured({
    clientId: c.env.TESLA_CLIENT_ID,
    stateSecret: c.env.OAUTH_STATE_SECRET,
  })
  if (problems.length) return c.text(`Not configured: ${problems.join('; ')}`, 503)

  const verifier = generateCodeVerifier()
  const state = await generateState(c.env.OAUTH_STATE_SECRET, PKCE_TTL_SECONDS)
  const redirectUri = new URL(REDIRECT_PATH, c.req.url).toString()

  // The PKCE verifier is held server-side against the signed state value; only
  // the state travels through the browser.
  await c.env.OAUTH_SESSIONS.put(`pkce:${state}`, verifier, {
    expirationTtl: PKCE_TTL_SECONDS,
  })

  const url = buildAuthorizeUrl({
    clientId: c.env.TESLA_CLIENT_ID,
    redirectUri,
    state,
    challenge: await s256Challenge(verifier),
  })

  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      'set-cookie': serializeCookie(STATE_COOKIE, state, { maxAge: PKCE_TTL_SECONDS }),
      'cache-control': 'no-store',
    },
  })
})

/* -------------------------------------------------------------------------- */
/* OAuth: callback (R-13) — the path Tesla redirects to                       */
/* -------------------------------------------------------------------------- */

app.get(REDIRECT_PATH, async (c) => {
  // Check configuration before touching state verification: without the signing
  // key a callback cannot be validated, and reporting a config gap is far more
  // useful than a 500 from inside the crypto call.
  const problems = assertConfigured({
    clientId: c.env.TESLA_CLIENT_ID,
    clientSecret: c.env.TESLA_CLIENT_SECRET,
    stateSecret: c.env.OAUTH_STATE_SECRET,
  })
  if (problems.length) return c.redirect('/auth/error?reason=not_configured', 303)

  const query = c.req.query()

  // Tesla can bounce back with an error instead of a code.
  if (query.error) {
    return c.redirect(
      `/auth/error?reason=${encodeURIComponent(query.error)}` +
      `&detail=${encodeURIComponent(query.error_description ?? '')}`,
      303,
    )
  }

  const code = query.code
  const stateParam = query.state
  const cookieState = parseCookies(c.req.header('cookie'))[STATE_COOKIE]

  if (!code) return c.redirect('/auth/error?reason=missing_code', 303)
  if (!stateParam || !cookieState || stateParam !== cookieState) {
    // CSRF: the callback must arrive in the browser that started the flow.
    return c.redirect('/auth/error?reason=state_mismatch', 303)
  }

  const verdict = await verifyState(stateParam, c.env.OAUTH_STATE_SECRET)
  if (!verdict.ok) return c.redirect(`/auth/error?reason=${verdict.reason}`, 303)

  // Single use: the PKCE verifier is consumed here whatever happens next.
  const pkceKey = `pkce:${stateParam}`
  const verifier = await c.env.OAUTH_SESSIONS.get(pkceKey)
  await c.env.OAUTH_SESSIONS.delete(pkceKey)
  if (!verifier) return c.redirect('/auth/error?reason=verifier_missing', 303)

  let tokens
  try {
    tokens = await exchangeCode({
      clientId: c.env.TESLA_CLIENT_ID,
      clientSecret: c.env.TESLA_CLIENT_SECRET,
      code,
      redirectUri: new URL(REDIRECT_PATH, c.req.url).toString(),
      verifier,
      audience: c.env.TESLA_AUDIENCE ?? TESLA_AUDIENCE,
    })
  } catch (error) {
    const codeName = (error as { code?: string }).code ?? 'exchange_failed'
    return c.redirect(`/auth/error?reason=${encodeURIComponent(codeName)}`, 303)
  }

  // Best-effort enumeration; a failure here must not lose the grant.
  let vehicles: VehicleSummary[] = []
  try {
    vehicles = await fetchVehicles(tokens.accessToken, c.env.TESLA_AUDIENCE ?? TESLA_AUDIENCE)
  } catch {
    vehicles = []
  }

  const sessionId = crypto.randomUUID()
  const record: SessionRecord = {
    createdAt: new Date().toISOString(),
    scope: tokens.scope ?? TESLA_SCOPES.join(' '),
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    vehicles,
  }
  await c.env.OAUTH_SESSIONS.put(`sess:${sessionId}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  })

  const headers = new Headers({ location: DASHBOARD_PATH, 'cache-control': 'no-store' })
  headers.append('set-cookie', clearCookie(STATE_COOKIE))
  headers.append('set-cookie', serializeCookie(SESSION_COOKIE, sessionId, { maxAge: SESSION_TTL_SECONDS }))
  return new Response(null, { status: 303, headers })
})

/* -------------------------------------------------------------------------- */
/* OAuth: error explanation                                                   */
/* -------------------------------------------------------------------------- */

const ERROR_COPY: Record<string, string> = {
  state_mismatch: 'The sign-in attempt did not come from the browser that started it, so it was refused.',
  bad_signature: 'The sign-in response could not be verified and was refused.',
  expired: 'This sign-in attempt expired before it was completed. Start again and finish within ten minutes.',
  malformed: 'The sign-in response was incomplete. Start again.',
  verifier_missing: 'This sign-in attempt was already used or expired. Start again.',
  missing_code: 'Tesla did not return an authorization code. Start again.',
  not_configured: 'The service is not fully configured yet, so it cannot complete a sign-in. Please try again shortly.',
  login_required: 'Tesla needs you to sign in again.',
  invalid_auth_code: 'The authorization code expired before it reached us. Start again — it is valid only briefly.',
}

app.get('/auth/error', (c) => {
  const reason = c.req.query('reason') ?? 'unknown'
  const detail = c.req.query('detail') ?? ''
  const explanation = ERROR_COPY[reason] ?? 'Tesla refused the sign-in attempt.'

  return c.html(page('Connection problem — AFIRMICO Auto', `
  <h1>We couldn\\'t finish connecting</h1>
  <div class="card err">
    <p><strong>${explanation}</strong></p>
    <p class="meta">Reason: <code>${reason}</code>${detail ? ` &middot; ${detail}` : ''}</p>
  </div>
  <p><a href="/auth/start">Try again</a> or return to the <a href="/connect">connect page</a>.</p>
  <p class="meta">Nothing was stored and no data has been collected.</p>
  `), 400)
})

/* -------------------------------------------------------------------------- */
/* Dashboard (registered returned URL)                                        */
/* -------------------------------------------------------------------------- */

app.get(DASHBOARD_PATH, async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const raw = sessionId ? await c.env.OAUTH_SESSIONS.get(`sess:${sessionId}`) : null

  if (!raw) {
    return c.html(page('Your Tesla — AFIRMICO Auto', `
    <h1>Not connected yet</h1>
    <p>No Tesla account is linked to this browser session. Connecting takes about a minute and does not
    collect anything until your vehicle starts reporting.</p>
    <a class="cta" href="/connect">Connect your Tesla</a>
    `))
  }

  const session = JSON.parse(raw) as SessionRecord
  const vehicleRows = session.vehicles.length
    ? session.vehicles.map((vehicle) => `
      <div class="card ok">
        <strong>${vehicle.displayName ?? vehicle.vin}</strong>
        <div class="meta">VIN ${vehicle.vin}${vehicle.state ? ` &middot; ${vehicle.state}` : ''}</div>
      </div>`).join('')
    : `<div class="note">Tesla returned no vehicles for this account. If you have a vehicle on this Tesla
       account, check that it is not a leased or business-managed vehicle.</div>`

  const revokeUrl = `${TESLA_REVOKE_URL}?revoke_client_id=${encodeURIComponent(c.env.TESLA_CLIENT_ID)}` +
    `&back_url=${encodeURIComponent(new URL(DASHBOARD_PATH, c.req.url).toString())}`

  return c.html(page('Your Tesla — AFIRMICO Auto', `
  <h1>Connected</h1>
  <div class="card ok">
    <p>Tesla access granted. We can read vehicle data for the vehicles below.</p>
    <p class="meta">Granted scopes: <code>${session.scope}</code><br>
    Connected: ${session.createdAt}</p>
  </div>

  <h2>Your vehicles</h2>
  ${vehicleRows}

  <h2>Next step</h2>
  <p>Approve the AFIRMICO Auto key on your vehicle in the Tesla app to start receiving data.</p>
  <a class="cta" href="${PAIRING_URL}">Approve the key in the Tesla app</a>

  <h2>Data we collect</h2>
  <p>Odometer (kilometres) and Full Self-Driving kilometres. Nothing else.</p>

  <h2>Revoke access</h2>
  <p>You can withdraw access at any time on your Tesla account. Revoking stops collection at the vehicle.</p>
  <p><a href="${revokeUrl}">Revoke AFIRMICO Auto access</a> &middot; <a href="/auth/logout">Sign out of this browser</a></p>
  `))
})

/** Drop the local session without touching the Tesla grant. */
app.get('/auth/logout', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  if (sessionId) await c.env.OAUTH_SESSIONS.delete(`sess:${sessionId}`)
  return new Response(null, {
    status: 303,
    headers: {
      location: '/connect',
      'set-cookie': clearCookie(SESSION_COOKIE),
      'cache-control': 'no-store',
    },
  })
})

/** Liveness check for deployment verification. */
app.get('/healthz', (c) => {
  const problems = assertConfigured({
    clientId: c.env.TESLA_CLIENT_ID,
    clientSecret: c.env.TESLA_CLIENT_SECRET,
    stateSecret: c.env.OAUTH_STATE_SECRET,
  })
  return c.json({ status: problems.length ? 'degraded' : 'ok', service: 'afirmico-tesla', problems })
})

/**
 * Anything else under the attached routes is passed back to the origin, which
 * keeps the existing splash site serving normally.
 */
app.notFound((c) => fetch(c.req.raw))

export default app

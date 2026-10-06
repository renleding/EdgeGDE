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
import type { ScheduledController, ExecutionContext, ExportedHandler } from '@cloudflare/workers-types'
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
  decodeIdToken,
  exchangeCode,
  fetchVehicles,
  generateCodeVerifier,
  generateState,
  getPartnerToken,
  parseCookies,
  s256Challenge,
  serializeCookie,
  verifyState,
} from './oauth'
import { adminApp } from './admin'
import { splashPage } from './splash'
import { ineosSplashPage } from './ineos-splash'
import {
  CONSENTED_FIELDS,
  CONSENT_POLICY_VERSION,
  CONSENT_TEXT,
  sha256Hex,
} from './consent-policy'
import {
  activeConsent,
  audit,
  createSession,
  ensureConsentPolicy,
  memberMayBeCollected,
  newId,
  recordConsent,
  recordRejections,
  revokeConsent,
  storeTokens,
  timingSafeEqual,
  upsertMember,
  upsertTelemetryConfig,
  upsertVehicles,
  vehicleExists,
  vinsForMember,
  collectedFields,
  markConfigRemoved,
  telemetryTarget,
} from './store'
import { TokenKeyMissingError } from './crypto'
import { InvalidDetail, memberDetailGaps, saveMemberDetails } from './onboarding'
import { AGGREGATION_VERSION, buildGroupExport } from './analytics'
import {
  PACKAGE_VERSION,
  ReleaseBlocked,
  activePolicyHold,
  buildQuotePackage,
  issueDownloadToken,
  redeemDownloadToken,
} from './release'
import {
  costReport,
  extractDatums,
  finishIngestRun,
  normalise,
  persistDatums,
  recordSignals,
  resolveTiers,
  startIngestRun,
} from './telemetry'
import {
  buildTelemetryConfig,
  buildConfigRecord,
  mapSkipReason,
  proxyConfigured,
  upstreamErrorDetail,
  validateConfigInput,
  type CollectedField,
} from './vehicle-config'
import { MIN_MARGIN_RATIO, evaluateBillingGuard, monthWindow } from './billing'
import {
  checkAndUpdateKeyPairing,
  cronPollAllKeyPairing,
  getMemberAccessToken,
  type KeyPairingResult,
} from './key-pairing'
import { openToken } from './crypto'

export interface Env {
  /** Static assets binding, provided by the `assets` config in wrangler.json. */
  ASSETS: Fetcher
  /** OAuth session + PKCE transients. */
  OAUTH_SESSIONS: KVNamespace
  /** Tesla data: members, consent, tokens, vehicles, telemetry (F08). */
  D1_TESLA: D1Database
  /**
   * Raw relay payloads (F04-R15, F04 AC7). Storing the bytes before
   * normalisation is what makes a parsing change replayable: without it, a
   * mis-parsed field is unrecoverable once the fact rows are wrong.
   */
  RAW_PAYLOADS: R2Bucket
  /**
   * Shared secret the relay presents on ingest (F04-R13).
   *
   * The relay is a span port with no database, so it cannot authenticate per
   * member; this authenticates the *relay* and the payload's VIN carries the
   * member identity. Without it the ingest endpoint is an open write into the
   * telemetry fact stream.
   */
  INGEST_SHARED_SECRET?: string
  /** Tesla developer app client id (public value — appears in the authorize URL). */
  TESLA_CLIENT_ID: string
  /** Tesla developer app client secret. Worker secret; never leaves the server. */
  TESLA_CLIENT_SECRET: string
  /** HMAC key used to sign OAuth `state` values. Worker secret. */
  OAUTH_STATE_SECRET: string
  /** AES-GCM key (32 bytes, base64) encrypting refresh tokens at rest. */
  TOKEN_ENCRYPTION_KEY: string
  /** Fleet API base URL. Defaults to the NA base (Australia routes here). */
  TESLA_AUDIENCE?: string
  /**
   * Base URL of `tesla-http-proxy` (F02-R11), used SOLELY as the configuration
   * signer: it holds the application private key and signs the config JWS.
   *
   * Optional and deliberately not defaulted. Absent means telemetry
   * configuration cannot be sent, and the code records `pending` with
   * `proxy_not_configured` rather than pretending a config was applied.
   */
  TESLA_PROXY_URL?: string
  /**
   * The CA certificate chain Tesla must trust, as PEM *contents* (F02-R11,
   * SDD-010 §4.1). Tesla requires the bytes inline, not a path — a path is
   * accepted locally and rejected only by Tesla, which is how the relay failed
   * on its first run. A Worker secret so the chain renews without a code change.
   */
  TELEMETRY_CA_PEM?: string
  /**
   * Tesla billing limit, in USD, as configured in the developer dashboard
   * (F02-R13).
   *
   * Deliberately optional and deliberately not defaulted: an unset limit is
   * reported by `/healthz` as `unconfigured` rather than assumed generous. A
   * breach strips every telemetry config and Tesla does not restore them, so
   * "we never set a limit" and "we have 10x headroom" must not look alike.
   */
  TESLA_BILLING_LIMIT_USD?: string
  /** Secret for authenticating cron job calls (e.g., key pairing poll). */
  CRON_SECRET?: string
  /** Shared secret for the config signer (nginx front door on signer host). */
  SIGNER_SHARED_SECRET?: string
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

/**
 * Download-link lifetime for a released package (F07-R05/R06).
 *
 * Short by design: the link is single-use, so the window only has to be long
 * enough for the recipient to fetch it. A long-lived link is an uncontrolled copy
 * of a member's personal data sitting in an inbox.
 */
const DOWNLOAD_TTL_SECONDS = 60 * 60

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

/**
 * Escape text for HTML embedding.
 *
 * Consent text is embedded verbatim, and `page()` interpolates raw strings, so
 * anything member- or Tesla-supplied must go through here. Escaping the apex
 * characters is sufficient for both element and attribute contexts given every
 * interpolation below is double-quoted.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Shared site icon (FRS-010 F01-R11).
 *
 * One icon for every page on the host. It is held here as a constant rather
 * than as a file under public/ so that there is exactly one definition: an
 * asset file plus a worker route would be two sources that can drift.
 *
 * /favicon.ico is the fixed location browsers request unprompted; it used to
 * fall through to the static splash and answer with 3.7 KB of HTML and
 * content-type text/html, so a tab showed either nothing or a broken icon.
 */
const FAVICON_HREF = '/favicon.svg'
const FAVICON_CONTENT_TYPE = 'image/svg+xml'
const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="AFIRMICO Auto">` +
  `<rect width="32" height="32" rx="6" fill="#0b5ed7"/>` +
  `<text x="16" y="23.5" font-size="21" text-anchor="middle" fill="#ffffff" ` +
  `font-family="Arial, Helvetica, sans-serif" font-weight="bold">A</text></svg>`

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="${FAVICON_CONTENT_TYPE}" href="${FAVICON_HREF}">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="${FAVICON_HREF}">
<title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#090909;color:#fff;font-family:Arial,Helvetica,sans-serif;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto;padding:48px 24px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  .logo{font-size:28px;font-weight:700;letter-spacing:1px}
  .partner-mark{width:120px;height:auto}
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
  .policy{white-space:pre-wrap;font-size:15px;color:#c9c9c9;max-height:340px;overflow-y:auto;background:#101010;border-radius:10px;padding:16px}
  .check{display:flex;gap:12px;align-items:flex-start;cursor:pointer;margin-bottom:18px}
  .check input{margin-top:4px;width:18px;height:18px;flex:0 0 auto}
  button.cta{border:0;cursor:pointer;font-size:16px;font-family:inherit}
  .cta.danger{background:#8a2020}
  code{background:#1d1d1d;padding:2px 6px;border-radius:4px;font-size:15px}
  a{color:#8ab4ff}
  footer{margin-top:48px;color:#7a7a7a;font-size:14px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">AFIRMICO Auto</div>
    <img class="partner-mark" src="/toca-logo.png" alt="Tesla Owners Club Australia">
  </div>
  ${body}
  <footer>AFIRMICO Auto | EV Data | Home Energy Statistics | Benefit Optimisation</footer>
</div>
</body>
</html>`
}

/* -------------------------------------------------------------------------- */
/* Shared site icon (F01-R11)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The one icon for every page on the host.
 *
 * Registered ahead of everything else, including the routes that come before
 * the onboarding entry below, because it must win over the static asset
 * fallback for both /favicon.svg and /favicon.ico.
 */
app.get('/favicon.svg', (c) => {
  return c.body(FAVICON_SVG, 200, {
    'content-type': FAVICON_CONTENT_TYPE,
    'cache-control': 'public, max-age=86400',
  })
})

app.get('/favicon.ico', (c) => {
  return c.body(FAVICON_SVG, 200, {
    'content-type': FAVICON_CONTENT_TYPE,
    'cache-control': 'public, max-age=86400',
  })
})

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

/**
 * The old onboarding path, kept as a redirect (F01-R13).
 *
 * The page was at `/connect` before it moved under the TOCA framing. Anything
 * still pointing at the old path — a bookmark, a link already published inside
 * the member site — must not 404, because a member hitting a dead end during
 * onboarding has no way to tell it apart from a broken platform.
 *
 * 301, not a temporary redirect: the move is permanent, and the cached redirect
 * saves a round trip for every stale link. `app.get` only, so a POST to the old
 * path is not silently accepted.
 */
app.get('/connect', (c) => c.redirect('/toca-connect', 301))

/**
 * Onboarding entry (F01-R01..R03, R-13).
 *
 * The consent step was missing: the flow went straight from "connect" to the
 * Tesla handshake, so no consent was ever captured and F01-R02/R03 were
 * unsatisfied by a flow that appeared to work. The member must now explicitly
 * accept the authorisation text, whose exact bytes are recorded.
 *
 * Path is `/toca-connect` (F01-R13): the member reaches this page from inside
 * the TOCA member site, so the name says which membership the connection
 * belongs to.
 */
app.get('/toca-connect', (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const already = sessionId
    ? `<div class="card ok"><strong>Already connected.</strong> <a href="${DASHBOARD_PATH}">View your dashboard</a></div>`
    : ''

  return c.html(page('Connect your Tesla — AFIRMICO Auto', `
  <h1>Connect your Tesla</h1>

  <p>Your authorisation is required as below, and you can revoke it at any
  time. Nothing is collected until you approve AFRIMICO Auto in the Tesla app.</p>

  ${already}

  <form method="POST" action="/auth/consent">
    <div class="card">
      <h2>Authorisation</h2>
      <p class="meta">Version <code>${CONSENT_POLICY_VERSION}</code></p>
      <div class="policy">${escapeHtml(CONSENT_TEXT)}</div>
    </div>

    <div class="card">
      <label class="check">
        <input type="checkbox" name="agree" value="yes" required>
        <span>I have read and agree to this authorisation.</span>
      </label>
      <button class="cta" type="submit">Agree and continue to Tesla</button>
    </div>
  </form>
  `))
})

/**
 * Record consent, then hand off to Tesla (F01-R02/R03, F01 AC1).
 *
 * Split from `/connect` so the grant is captured before Tesla is involved: a
 * member who abandons at the Tesla screen has still consented on the record,
 * and a member who is refused there has a consent row that was never used.
 */
app.post('/auth/consent', async (c) => {
  const form = await c.req.parseBody()
  if (form.agree !== 'yes') {
    return c.html(page('Consent needed — AFIRMICO Auto', `
    <h1>Consent is required</h1>
    <p>We cannot connect to your Tesla without your authorisation. Nothing has been recorded.</p>
    <a class="cta" href="/toca-connect">Back to the authorisation</a>
    `), 400)
  }

  // Anonymous consent: the Tesla identity arrives at the callback, so the member
  // row is created then. The consent row is attached to that member at callback
  // time; here we only need the member to have accepted, which we carry forward
  // in the signed state rather than by trusting a client round-trip.
  const state = await generateState(c.env.OAUTH_STATE_SECRET, PKCE_TTL_SECONDS)

  return new Response(null, {
    status: 303,
    headers: {
      location: `/auth/start?state=${encodeURIComponent(state)}`,
      'set-cookie': serializeCookie(STATE_COOKIE, state, { maxAge: PKCE_TTL_SECONDS }),
      'cache-control': 'no-store',
    },
  })
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

  // Reuse the state minted by /auth/consent when present, so the cookie set
  // there and the value signed into the Tesla redirect are the same string.
  // Minting a second state here would leave two different values and the
  // callback's cookie comparison would fail.
  const provided = c.req.query('state')
  const cookieState = parseCookies(c.req.header('cookie'))[STATE_COOKIE]
  const reused = provided && cookieState && provided === cookieState ? provided : null
  const state = reused ?? (await generateState(c.env.OAUTH_STATE_SECRET, PKCE_TTL_SECONDS))

  const verifier = generateCodeVerifier()
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

  const headers = new Headers({ location: url, 'cache-control': 'no-store' })
  if (!reused) {
    headers.append('set-cookie', serializeCookie(STATE_COOKIE, state, { maxAge: PKCE_TTL_SECONDS }))
  }
  return new Response(null, { status: 302, headers })
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

  const identity = decodeIdToken(tokens.idToken)
  const nowIso = new Date().toISOString()
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()

  // ---------------------------------------------------------------------------
  // Persist to D1 (F01-R02/R03/R05, F02-R05, F01 AC1).
  //
  // This block is why the callback no longer stops at KV. A session in KV is a
  // cache entry that expires and cannot be queried; a member who connected left
  // no durable record of who they were, what they agreed to, or that they had
  // granted anything. Without this, F01 and F02-R05 were unmet by a flow that
  // appeared to work.
  //
  // Failure here is NOT silent. A grant that is not recorded is a compliance
  // problem, so the member is told the connection could not be saved rather than
  // shown a dashboard implying success.
  // ---------------------------------------------------------------------------
  let memberId: string | null = null
  let consentId: string | null = null
  let policySha256: string | null = null
  try {
    memberId = await upsertMember(c.env.D1_TESLA, {
      teslaSub: identity?.sub,
      teslaEmail: identity?.email,
      displayName: identity?.name,
    })

    await ensureConsentPolicy(c.env.D1_TESLA, nowIso)

    const consent = await recordConsent(c.env.D1_TESLA, {
      memberId,
      scope: tokens.scope ?? TESLA_SCOPES.join(' '),
      ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
      nowIso,
    })
    consentId = consent.consentId
    policySha256 = consent.policySha256

    await upsertVehicles(c.env.D1_TESLA, memberId, vehicles, nowIso)

    if (tokens.refreshToken) {
      await storeTokens(c.env.D1_TESLA, {
        memberId,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope ?? TESLA_SCOPES.join(' '),
        expiresAt,
        teslaSub: identity?.sub ?? null,
        encryptionKey: c.env.TOKEN_ENCRYPTION_KEY,
        nowIso,
      })
    }

    await createSession(c.env.D1_TESLA, {
      sessionId,
      memberId,
      scope: tokens.scope ?? TESLA_SCOPES.join(' '),
      expiresAt,
      userAgent: c.req.header('user-agent'),
      nowIso,
    })

    await audit(c.env.D1_TESLA, {
      action: 'member.connect',
      actorType: 'member',
      actor: memberId,
      subjectType: 'member',
      subjectId: memberId,
      detail: { consentId, policyVersion: CONSENT_POLICY_VERSION, vehicles: vehicles.length },
      nowIso,
    })
  } catch (error) {
    const reason = error instanceof TokenKeyMissingError ? 'token_key_missing' : 'persist_failed'
    // Still hand back a session so the member is not stranded, but tell them
    // plainly that the connection was not recorded and must be retried.
    await audit(c.env.D1_TESLA, {
      action: 'member.connect.failed',
      actorType: 'system',
      subjectType: 'member',
      detail: { reason, message: (error as Error).message },
      nowIso,
    }).catch(() => undefined)
    return c.redirect(`/auth/error?reason=${reason}`, 303)
  }

  // KV keeps only the browser-session pointer and PKCE transients. D1 is the
  // system of record; the token itself is never stored here.
  const record: SessionRecord = {
    createdAt: nowIso,
    scope: tokens.scope ?? TESLA_SCOPES.join(' '),
    accessTokenExpiresAt: expiresAt,
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
  persist_failed: 'Tesla approved the connection, but we could not record it on our side. Nothing was saved, so nothing was collected. Start again — and if it keeps happening, contact us.',
  token_key_missing: 'The service is not fully configured, so a connection could not be stored securely. Nothing was saved. Please try again shortly.',
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
  <p><a href="/auth/start">Try again</a> or return to the <a href="/toca-connect">connect page</a>.</p>
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
    <a class="cta" href="/toca-connect">Connect your Tesla</a>
    `))
  }

  const session = JSON.parse(raw) as SessionRecord

  // Read the durable state from D1 (F01-R07): consent version, what was agreed,
  // and the vehicles on record. The KV session is a cache; D1 is the record.
  const member = sessionId
    ? await c.env.D1_TESLA.prepare(
        `SELECT m.member_id, m.display_name, m.email, m.tesla_email, m.tier, m.toca_status, c.consent_id,
                c.policy_version, c.policy_sha256, c.granted_at
           FROM tesla_auth_session s
           JOIN tesla_member m ON m.member_id = s.member_id
           LEFT JOIN tesla_consent c ON c.member_id = m.member_id AND c.revoked_at IS NULL
          WHERE s.session_id = ?
          ORDER BY c.granted_at DESC
          LIMIT 1`,
      )
        .bind(sessionId)
        .first<{
          member_id: string
          display_name: string | null
          email: string | null
          tesla_email: string | null
          tier: string
          toca_status: string
          consent_id: string | null
          policy_version: string | null
          policy_sha256: string | null
          granted_at: string | null
        }>()
    : null

  const vehiclesOnRecord = member
    ? await c.env.D1_TESLA.prepare(
        `SELECT vin, display_name, model FROM tesla_vehicle WHERE member_id = ? ORDER BY first_seen_at`,
      )
        .bind(member.member_id)
        .all<{ vin: string; display_name: string | null; model: string | null }>()
    : { results: [] as Array<{ vin: string; display_name: string | null; model: string | null }> }

  // F02-R09a/F02-R09b: Check and update key pairing state on dashboard load
  // This detects when the member has approved the virtual key in the Tesla app
  const pairingResults = member
    ? await checkAndUpdateKeyPairing(c.env, member.member_id)
    : []

  // Build a map of VIN -> keyState for display
  const keyStateMap = new Map(pairingResults.map(r => [r.vin, r.keyState]))

  const list = vehiclesOnRecord.results.length
    ? vehiclesOnRecord.results
    : session.vehicles.map((v) => ({ vin: v.vin, display_name: v.displayName ?? null, model: null }))

  const vehicleRows = list.length
    ? list.map((vehicle) => {
        const keyState = keyStateMap.get(vehicle.vin) ?? 'unpaired'
        const isPaired = keyState === 'paired'
        const keyStateIcon = isPaired ? '✅' : '⏳'
        const keyStateLabel = isPaired ? 'Paired' : 'Pending approval'
        const keyStateClass = isPaired ? 'ok' : 'warn'
        const pairingLink = isPaired ? '' : `<a class="cta" href="${PAIRING_URL}?vin=${encodeURIComponent(vehicle.vin)}" style="margin-top:8px;display:inline-block">Approve key for ${escapeHtml(vehicle.display_name ?? vehicle.vin)}</a>`
        return `
      <div class="card ok">
        <strong>${escapeHtml(vehicle.display_name ?? vehicle.vin)}</strong>
        <div class="meta">VIN ${escapeHtml(vehicle.vin)}${vehicle.model ? ` &middot; ${escapeHtml(vehicle.model)}` : ''}</div>
        <div class="meta"><span class="${keyStateClass}">${keyStateIcon} Key: ${keyStateLabel}</span></div>
        ${pairingLink}
      </div>`
      }).join('')
    : `<div class="note">Tesla returned no vehicles for this account. If you have a vehicle on this Tesla
       account, check that it is not a leased or business-managed vehicle.</div>`

  const revokeUrl = `${TESLA_REVOKE_URL}?revoke_client_id=${encodeURIComponent(c.env.TESLA_CLIENT_ID)}` +
    `&back_url=${encodeURIComponent(new URL(DASHBOARD_PATH, c.req.url).toString())}`

  // F01-R05: surface the gap rather than letting it fail later. Without this the
  // member discovers their profile is incomplete only when a release is blocked or
  // an insurer package arrives with a blank where their contact details should be.
  const gaps = member ? await memberDetailGaps(c.env.D1_TESLA, member.member_id) : []
  
  // F02-R16: Check if token is missing vehicle_cmds scope (required for telemetry config)
  const missingVehicleCmds = member && session.scope && !session.scope.includes('vehicle_cmds')
  const reconsentPrompt = missingVehicleCmds
    ? `<div class="note">
      <strong>Re-authorisation required.</strong>
      Your Tesla token is missing the <code>vehicle_cmds</code> scope needed to configure telemetry.
      <div style="margin-top:12px"><a class="cta" href="/toca-connect">Re-authorize with updated scopes</a></div>
    </div>`
    : ''

  const detailsPrompt = gaps.length
    ? `
  <div class="note">
    <strong>Two details still needed.</strong>
    Tesla does not provide your mobile number or postcode, so we have to ask.
    Without them we cannot segment regional statistics, and your quote package would
    carry a blank where the insurer expects contact details.
    <div style="margin-top:12px"><a class="cta" href="/details">Add your details</a></div>
  </div>`
    : `
  <div class="card ok">
    <p class="meta">Contact details on record. <a href="/details">Change them</a></p>
  </div>`

  // F01-R07: show the member what they agreed to, and prove byte-identity by
  // comparing the rendered text's hash with the hash stored on their consent row.
  const currentHash = await sha256Hex(CONSENT_TEXT)
  const textMatches = member?.policy_sha256 ? member.policy_sha256 === currentHash : null

  const consentBlock = member?.consent_id
    ? `
  <div class="card ok">
    <h2>Your authorisation</h2>
    <p class="meta">Version <code>${escapeHtml(member.policy_version ?? 'unknown')}</code> &middot;
    granted ${escapeHtml(member.granted_at ?? '')}</p>
    <p class="meta">${textMatches === true
      ? 'The text shown on the connect page matches this authorisation exactly.'
      : 'This authorisation was granted under an earlier version of the text.'}</p>
    <form method="POST" action="/auth/revoke">
      <button class="cta danger" type="submit">Revoke Authorisation</button>
    </form>
  </div>`
    : `
  <div class="note">No current authorisation on record. <a href="/toca-connect">Grant one</a> to start collecting.</div>`

  return c.html(page('Your Tesla — AFIRMICO Auto', `
  <h1>Connected</h1>
  <div class="card ok">
    <p>Tesla access granted. We can read vehicle data for the vehicles below.</p>
    <p class="meta">Granted scopes: <code>${escapeHtml(session.scope)}</code><br>
    Connected: ${escapeHtml(session.createdAt)}</p>
  </div>

  <h2>Next step</h2>
    <p>Approve the AFIRMICO Auto key on your vehicle in the Tesla app to start sending data.</p>
    <a class="cta" href="${PAIRING_URL}">Approve the key in the Tesla app</a>

  ${reconsentPrompt}

  <h2>Your vehicles</h2>
  ${vehicleRows}

  ${detailsPrompt}

    ${consentBlock}
  `))
})

/**
 * Withdraw consent (F01-R04, F01 AC2/R04).
 *
 * F10-R04 requires the applicable retention rule to be shown to the member at
 * the point of revocation, so the confirmation page states which rule applies
 * and the revocation is only performed on the POST that follows it.
 */
app.post('/auth/revoke', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const raw = sessionId ? await c.env.OAUTH_SESSIONS.get(`sess:${sessionId}`) : null
  if (!raw) return c.redirect('/toca-connect', 303)

  const member = await c.env.D1_TESLA.prepare(
    `SELECT m.member_id FROM tesla_auth_session s
       JOIN tesla_member m ON m.member_id = s.member_id
      WHERE s.session_id = ?`,
  )
    .bind(sessionId)
    .first<{ member_id: string }>()
  if (!member) return c.redirect('/toca-connect', 303)

  const nowIso = new Date().toISOString()

  // F10-R01 vs F10-R02: an active policy changes the retention rule, and
  // F10-R03 forbids applying one rule to both cases.
  const policy = await c.env.D1_TESLA.prepare(
    `SELECT quote_request_id FROM tesla_quote_request
      WHERE member_id = ? AND status IN ('sent','accepted')
      LIMIT 1`,
  )
    .bind(member.member_id)
    .first<{ quote_request_id: string }>()

  const revoked = await revokeConsent(c.env.D1_TESLA, member.member_id, 'member_revoked', nowIso)

  // F02-R12: removal must be aimed at the vehicle. Revoking the member and
  // discarding inbound data would leave the car transmitting — Tesla keeps
  // billing for signals we no longer want, and the vehicle keeps sending. The
  // member-facing text below has always claimed "collection has stopped"; this
  // is what makes that true at the source rather than at our boundary.
  const vins = await vinsForMember(c.env.D1_TESLA, member.member_id)
  const removals = await Promise.all(
    vins.map(async (vin) => {
      const removed = await markConfigRemoved(c.env.D1_TESLA, vin, nowIso)
      const ok = await removeVehicleConfig(c.env, vin, member.member_id)
      await audit(c.env.D1_TESLA, {
        action: 'telemetry.config_removed',
        actorType: 'member',
        actor: member.member_id,
        subjectType: 'vehicle',
        subjectId: vin,
        // `recorded` and `sent` are recorded separately on purpose: the row can
        // be marked removed while the delete to Tesla did not go out (no proxy
        // configured). Collapsing them would report a teardown that did not
        // happen, which is the one failure mode this requirement exists to stop.
        detail: { rows_marked: removed, delete_sent: ok.sent, error: ok.error ?? null },
        nowIso,
      })
      return { vin, rows: removed, sent: ok.sent }
    }),
  )

  await audit(c.env.D1_TESLA, {
    action: 'member.consent_revoked',
    actorType: 'member',
    actor: member.member_id,
    subjectType: 'member',
    subjectId: member.member_id,
    detail: {
      revoked,
      retention: policy ? 'policy_linked' : 'immediate_deletion',
      vehicles_removed: removals.filter((r) => r.rows > 0).length,
      deletes_sent: removals.filter((r) => r.sent).length,
    },
    nowIso,
  })

  return c.html(page('Authorisation withdrawn — AFIRMICO Auto', `
  <h1>Authorisation withdrawn</h1>
  <div class="card ok">
    <p>Collection has stopped. Your authorisation is recorded as withdrawn at ${escapeHtml(nowIso)}.</p>
  </div>

  <h2>What happens to your data</h2>
  ${policy
    ? `<p>You hold a policy obtained through AFIRMICO. Your data is retained until that policy expires,
       after which it is deleted. This is recorded against your file.</p>`
    : `<p>You hold no policy obtained through AFIRMICO, so your individual data — vehicle records,
       telemetry, and any derived profile — will be deleted.</p>`}

  <p>Anonymised postcode-level statistics are retained; they contain nothing that identifies you.</p>
  <p><a href="/toca-connect">Grant a new authorisation</a></p>
  `))
})

/** Drop the local session without touching the Tesla grant. */
app.get('/auth/logout', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  if (sessionId) await c.env.OAUTH_SESSIONS.delete(`sess:${sessionId}`)
  return new Response(null, {
    status: 303,
    headers: {
      location: '/toca-connect',
      'set-cookie': clearCookie(SESSION_COOKIE),
      'cache-control': 'no-store',
    },
  })
})

/**
 * Telemetry ingest (F04-R01, F04-R13, F04 AC1-AC7).
 *
 * Called by the Oracle relay, which terminates Tesla's mTLS on :443 and forwards
 * the raw bytes. The relay holds no database and performs no derivation — every
 * decision below is made here, so the relay stays a span port and a compromise of
 * it yields no member data at rest.
 *
 * Failure policy: this endpoint returns 200 for any payload it *understood*,
 * including one where every datum was rejected, because a non-2xx makes the relay
 * retry a payload that will fail identically. It returns 4xx/5xx only when it
 * could not safely process the payload at all — and it never partially applies a
 * batch, so a retry is always safe.
 */
app.post('/ingest/telemetry', async (c) => {
  const nowIso = new Date().toISOString()

  // --- authenticate the relay ---------------------------------------------
  const secret = c.env.INGEST_SHARED_SECRET
  if (!secret) {
    return c.json({ ok: false, error: 'ingest_not_configured' }, 503)
  }
  const presented = c.req.header('x-ingest-secret') ?? ''
  if (!timingSafeEqual(presented, secret)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  // --- read the body once; R2 needs the bytes, parsing needs the text ------
  const raw = await c.req.text()
  if (raw.length > 512 * 1024) {
    return c.json({ ok: false, error: 'payload_too_large' }, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    // Unparseable input is the relay's bug or corruption; a retry cannot help.
    return c.json({ ok: false, error: 'malformed_json' }, 400)
  }

  const extracted = extractDatums(body)
  if (!extracted.length) {
    return c.json({ ok: true, datumsAccepted: 0, note: 'no datums in payload' })
  }

  const runId = await startIngestRun(c.env.D1_TESLA, { cadence: 'push', nowIso })

  // --- raw payload first, so a later parse failure is still replayable -----
  const sha256 = await sha256Hex(raw)
  const batchId = newId()
  const vin = extracted.find((e) => e.vin)?.vin ?? null
  const r2Key = `telemetry/${nowIso.slice(0, 10)}/${vin ?? 'unknown'}/${batchId}.json`

  let r2Stored = true
  try {
    await c.env.RAW_PAYLOADS.put(r2Key, raw, {
      httpMetadata: { contentType: c.req.header('content-type') ?? 'application/json' },
      customMetadata: { sha256, vin: vin ?? '', runId },
    })
  } catch (error) {
    // A payload we cannot archive is still worth processing, but the loss of
    // replayability must be visible rather than silent.
    r2Stored = false
    console.error('raw payload archive failed', (error as Error).message)
  }

  await c.env.D1_TESLA.prepare(
    `INSERT INTO tesla_telemetry_batch
       (batch_id, vin, received_at, payload_bytes, r2_key, payload_sha256,
        datum_count, is_resend, content_type, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      batchId,
      vin,
      nowIso,
      raw.length,
      r2Stored ? r2Key : '',
      sha256,
      extracted.length,
      c.req.header('content-type') ?? 'application/json',
      // F06-AC6: the run this batch belongs to. Without it a fact could reach its raw
      // payload but not the run that ingested it, so "which run produced this figure"
      // had no answer. Recorded here because the batch is already the join between
      // payload and facts, and the value never changes after insert.
      runId,
    )
    .run()

  // --- resolve tiers, normalise, persist ----------------------------------
  const tiers = await resolveTiers(c.env.D1_TESLA, extracted.map((e) => e.datum.key))
  const { normalised, skippedUnknown, skippedUncollected, invalidValues } = normalise(
    extracted,
    tiers,
    nowIso,
  )

  const errors: Array<{ vin: string; code: string }> = []
  let written = { factsWritten: 0, snapshotsWritten: 0 }

  // Consent gate (F04-R14, F04 AC5). A revoked member with no active policy must
  // not have data collected — and the check is here rather than only at the
  // relay because the relay has no database to check against.
  const permitted = vin ? await memberMayBeCollected(c.env.D1_TESLA, vin) : false

  if (!vin) {
    errors.push({ vin: 'unknown', code: 'missing_vin' })
  } else if (!(await vehicleExists(c.env.D1_TESLA, vin))) {
    // A vehicle Tesla knows about but we have never seen means a member granted
    // consent on a different Tesla account, or a stale telemetry config.
    errors.push({ vin, code: 'unknown_vehicle' })
    await recordRejections(c.env.D1_TESLA, {
      runId,
      vin,
      fieldKeys: normalised.map((d) => d.fieldKey),
      reason: 'bad_vin',
      observedAt: nowIso,
      createdAt: nowIso,
    })
  } else if (!permitted) {
    errors.push({ vin, code: 'consent_revoked' })
  } else {
    try {
      written = await persistDatums(c.env.D1_TESLA, {
        batchId,
        vin,
        datums: normalised,
        receivedAt: nowIso,
      })
      await recordSignals(c.env.D1_TESLA, { vin, datumCount: extracted.length, nowIso })
    } catch (error) {
      // One vehicle's failure must not lose the run (F04-R11).
      errors.push({ vin, code: `persist_failed: ${(error as Error).message.slice(0, 80)}` })
    }
  }

  // Record what was refused and why, so "collection is correctly narrow" is
  // distinguishable from "collection is broken".
  if (skippedUnknown) {
    await recordRejections(c.env.D1_TESLA, {
      runId,
      vin,
      fieldKeys: extracted.filter((e) => !tiers.has(e.datum.key)).map((e) => e.datum.key),
      reason: 'unknown_field',
      observedAt: nowIso,
      createdAt: nowIso,
    })
  }
  if (skippedUncollected) {
    await recordRejections(c.env.D1_TESLA, {
      runId,
      vin,
      fieldKeys: extracted
        .filter((e) => tiers.get(e.datum.key)?.collected === 0)
        .map((e) => e.datum.key),
      reason: 'not_collected',
      observedAt: nowIso,
      createdAt: nowIso,
    })
  }
  if (invalidValues) {
    await recordRejections(c.env.D1_TESLA, {
      runId,
      vin,
      fieldKeys: normalised.filter((d) => d.valueKind === 'invalid').map((d) => d.fieldKey),
      reason: 'invalid_value',
      observedAt: nowIso,
      createdAt: nowIso,
    })
  }

  const cost = await costReport(c.env.D1_TESLA, nowIso.slice(0, 7))
  await finishIngestRun(c.env.D1_TESLA, runId, {
    nowIso,
    attempted: vin ? 1 : 0,
    succeeded: written.factsWritten + written.snapshotsWritten > 0 ? 1 : 0,
    failed: errors.length,
    errors,
    costUsd: cost.costUsd,
  })

  return c.json({
    ok: true,
    runId,
    batchId,
    vin,
    rawArchived: r2Stored,
    datumsAccepted: normalised.length,
    factsWritten: written.factsWritten,
    snapshotsWritten: written.snapshotsWritten,
    skippedUnknown,
    skippedUncollected,
    invalidValues,
    errors,
    monthToDate: { signals: cost.signals, costUsd: cost.costUsd },
  })
})

/**
 * The details form, shared by the GET and the validation-failure path.
 *
 * Re-renders with the member's own submitted values on failure: clearing the form
 * on a typo makes the member retype both fields, and the field that was fine is
 * the one they are least likely to check.
 */
function detailsForm(mobile: string | null, postcode: string | null, error: string | null): string {
  return page('Your details — AFIRMICO Auto', `
  <h1>Your contact details</h1>
  <p>We need two things Tesla does not provide. They are used to prepare your quote and to
  group anonymous statistics by region — never to locate your vehicle.</p>
  ${error ? `<div class="note" role="alert"><strong>${escapeHtml(error)}</strong></div>` : ''}
  <form method="POST" action="/details" class="card">
    <label for="mobile">Mobile number</label>
    <input id="mobile" name="mobile" type="tel" inputmode="tel" autocomplete="tel"
           value="${escapeHtml(mobile ?? '')}" placeholder="0412 345 678" required>
    <label for="postcode">Residential postcode</label>
    <input id="postcode" name="postcode" type="text" inputmode="numeric" autocomplete="postal-code"
           pattern="\\d{4}" maxlength="4" value="${escapeHtml(postcode ?? '')}"
           placeholder="2335" required>
    <p class="meta">Both are required together. Your postcode is kept exactly as entered — a
    leading zero is part of it.</p>
    <button class="cta" type="submit">Save details</button>
  </form>
  `)
}

/**
 * Member details form (F01-R05).
 *
 * This step exists because the Tesla handshake cannot supply it: Tesla returns a
 * subject, an email and a name, and none of those is a mobile or a postcode. Until
 * these are captured the insurer package ships a blank where the insurer expects
 * contact details, and F06 group aggregates cannot segment on postcode at all.
 */
app.get('/details', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const raw = sessionId ? await c.env.OAUTH_SESSIONS.get(`sess:${sessionId}`) : null
  if (!raw) return c.redirect('/toca-connect', 303)

  const member = await c.env.D1_TESLA.prepare(
    `SELECT m.member_id, m.mobile, m.postcode
       FROM tesla_auth_session s
       JOIN tesla_member m ON m.member_id = s.member_id
      WHERE s.session_id = ?`,
  )
    .bind(sessionId)
    .first<{ member_id: string; mobile: string | null; postcode: string | null }>()
  if (!member) return c.redirect('/toca-connect', 303)

  return c.html(detailsForm(member.mobile, member.postcode, null))
})

/**
 * Save member details (F01-R05).
 *
 * Rejects both fields together rather than storing half: a profile with a postcode
 * and no mobile is the state that makes the release path ambiguous, and the member
 * would have no way to tell it had not worked.
 */
app.post('/details', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const raw = sessionId ? await c.env.OAUTH_SESSIONS.get(`sess:${sessionId}`) : null
  if (!raw) return c.redirect('/toca-connect', 303)

  const member = await c.env.D1_TESLA.prepare(
    'SELECT member_id FROM tesla_auth_session WHERE session_id = ?',
  )
    .bind(sessionId)
    .first<{ member_id: string }>()
  if (!member) return c.redirect('/toca-connect', 303)

  const form = await c.req.parseBody()
  const mobile = typeof form.mobile === 'string' ? form.mobile : ''
  const postcode = typeof form.postcode === 'string' ? form.postcode : ''
  const nowIso = new Date().toISOString()

  try {
    const saved = await saveMemberDetails(c.env.D1_TESLA, {
      memberId: member.member_id,
      mobile,
      postcode,
      nowIso,
    })

    if (saved.changed) {
      await audit(c.env.D1_TESLA, {
        nowIso,
        actor: member.member_id,
        actorType: 'member',
        action: 'member_details_updated',
        subjectType: 'tesla_member',
        subjectId: member.member_id,
        // Only the fact of the change, never the values: an audit row is not a
        // second place personal data has to be protected.
        detail: { fields: ['mobile', 'postcode'] },
      })
    }

    return c.redirect(DASHBOARD_PATH, 303)
  } catch (error) {
    if (error instanceof InvalidDetail) {
      const message = error.field === 'mobile'
        ? 'That does not look like an Australian mobile number. Use 04xx xxx xxx or +61 4xx xxx xxx.'
        : 'That does not look like an Australian postcode. It should be four digits, for example 2335 or 0800.'
      return c.html(detailsForm(mobile, postcode, message), 400)
    }
    console.error('saving member details failed', error)
    return c.text('Could not save your details.', 500)
  }
})

/**
 * Quote package request (F07-R01).
 *
 * The member asks for a quote; this builds the package and mints a single-use,
 * time-limited link. Called by the member's own dashboard, so the member is
 * resolved from the session and never from the request body — otherwise anyone
 * could request anyone's PII by changing an id.
 */
app.post('/quote/request', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const raw = sessionId ? await c.env.OAUTH_SESSIONS.get(`sess:${sessionId}`) : null
  if (!raw) return c.redirect('/toca-connect', 303)

  const form = await c.req.parseBody()
  const vin = typeof form.vin === 'string' ? form.vin : ''
  const periodStart = typeof form.period_start === 'string' ? form.period_start : ''
  const periodEnd = typeof form.period_end === 'string' ? form.period_end : ''
  if (!vin || !periodStart || !periodEnd) return c.text('vin, period_start and period_end are required', 400)

  const member = await c.env.D1_TESLA.prepare(
    'SELECT member_id FROM tesla_auth_session WHERE session_id = ?',
  )
    .bind(sessionId)
    .first<{ member_id: string }>()
  if (!member) return c.redirect('/toca-connect', 303)

  const nowIso = new Date().toISOString()
  try {
    const pkg = await buildQuotePackage(c.env.D1_TESLA, {
      memberId: member.member_id,
      vin,
      periodStart,
      periodEnd,
      nowIso,
      requestedBy: `member:${member.member_id}`,
    })

    // F07-R05/R15: the artifact is stored in R2 and the link is handed out; data
    // is never emailed as an attachment and never returned inline to a browser.
    const key = `releases/${pkg.releaseId}.csv`
    await c.env.RAW_PAYLOADS.put(key, pkg.csv, {
      httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    })
    await c.env.D1_TESLA.prepare('UPDATE tesla_release SET r2_key = ? WHERE release_id = ?')
      .bind(key, pkg.releaseId)
      .run()

    const link = await issueDownloadToken(c.env.D1_TESLA, {
      releaseId: pkg.releaseId,
      issuedTo: `member:${member.member_id}`,
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
      nowIso,
    })

    await audit(c.env.D1_TESLA, {
      nowIso,
      actor: member.member_id,
      actorType: 'member',
      action: 'quote_package_requested',
      subjectType: 'tesla_release',
      subjectId: pkg.releaseId,
      detail: { vin, sha256: pkg.sha256 },
    })

    return c.html(page('Quote package ready — AFIRMICO Auto', `
    <h1>Your package is ready</h1>
    <div class="card ok">
      <p><strong>Package version:</strong> ${escapeHtml(PACKAGE_VERSION)}</p>
      <p><strong>Integrity (SHA-256):</strong> <code>${escapeHtml(pkg.sha256)}</code></p>
      <p class="meta">This link works once and expires in ${Math.round(DOWNLOAD_TTL_SECONDS / 60)} minutes.
      It is the only copy; downloading it is logged.</p>
      <a class="cta" href="/download/${escapeHtml(link.token)}">Download your package</a>
    </div>
    `))
  } catch (error) {
    if (error instanceof ReleaseBlocked) {
      // F07-R02: block, and say why. A refused release that reads as a system
      // error invites the member to retry forever.
      const hold = await activePolicyHold(c.env.D1_TESLA, member.member_id, nowIso)
      const extra = hold.held
        ? `<p>Your data cannot be released because a consent is required. Note: your policy runs to
           <strong>${escapeHtml(hold.coverEnd ?? '')}</strong>, and terminating collection before then
           would invalidate it (F07-R10).</p>`
        : ''
      return c.html(page('Release blocked — AFIRMICO Auto', `
      <h1>We can't release your data</h1>
      <div class="card">
        <p>The reason recorded is <code>${escapeHtml(error.reason)}</code>.</p>
        ${extra}
        <p>Reconnect and accept the authorisation to enable release.</p>
        <a class="cta" href="/toca-connect">Review authorisation</a>
      </div>
      `), 409)
    }
    console.error('quote package failed', error)
    return c.text('Could not build the quote package.', 500)
  }
})

/**
 * Tokenised download (F07-R05, F07-R06).
 *
 * The token is the credential, and every attempt — successful or not — is logged,
 * because an attempted download of a member's data is itself an event worth
 * recording.
 */
app.get('/download/:token', async (c) => {
  const token = c.req.param('token')
  const nowIso = new Date().toISOString()
  const ip = c.req.header('cf-connecting-ip') ?? ''
  const ua = c.req.header('user-agent') ?? null

  const result = await redeemDownloadToken(c.env.D1_TESLA, {
    token,
    nowIso,
    // Hashed, never raw: an IP is personal data and a download log is not a
    // reason to retain one in the clear.
    ipHash: ip ? await sha256Hex(ip) : null,
    userAgent: ua,
    loadArtifact: async (releaseId) => {
      const row = await c.env.D1_TESLA.prepare('SELECT r2_key FROM tesla_release WHERE release_id = ?')
        .bind(releaseId)
        .first<{ r2_key: string | null }>()
      if (!row?.r2_key) return null
      const object = await c.env.RAW_PAYLOADS.get(row.r2_key)
      return object ? await object.text() : null
    },
  })

  if (!result.ok) {
    return c.html(page('Link unavailable — AFIRMICO Auto', `
    <h1>This link is no longer usable</h1>
    <div class="card">
      <p>Reason: <code>${escapeHtml(result.reason)}</code>.</p>
      <p class="meta">Links are single-use and time-limited, and stop working if the member revokes
      their authorisation.</p>
      <a class="cta" href="/dashboard">Back to your dashboard</a>
    </div>
    `), 410)
  }

  return new Response(result.csv ?? '', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // Never cached: a cached data export is an uncontrolled copy.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      'content-disposition': `attachment; filename="afirmico-quote-${result.releaseId}.csv"`,
    },
  })
})

/**
 * Record an insurer's quote response (F07-R07, F07-R08).
 *
 * Authenticated by the shared ingest secret, because this is a system-to-system
 * call from an insurer integration rather than a member action.
 */
app.post('/quote/response', async (c) => {
  const provided = c.req.header('x-ingest-secret') ?? ''
  const expected = c.env.INGEST_SHARED_SECRET ?? ''
  if (!expected || !timingSafeEqual(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const body = await c.req.json<{
    quote_request_id?: string
    insurer_ref?: string
    insurer_name?: string
    premium_amount?: number
    excess_amount?: number
    cover_type?: string
    terms?: unknown
    release_id?: string
  }>()

  if (!body.quote_request_id || !body.insurer_ref) {
    return c.json({ error: 'quote_request_id and insurer_ref are required' }, 400)
  }

  const nowIso = new Date().toISOString()
  const responseId = newId()
  const request = await c.env.D1_TESLA.prepare(
    'SELECT quote_request_id, member_id FROM tesla_quote_request WHERE quote_request_id = ?',
  )
    .bind(body.quote_request_id)
    .first<{ quote_request_id: string; member_id: string }>()
  if (!request) return c.json({ error: 'unknown quote_request_id' }, 404)

  await c.env.D1_TESLA.batch([
    c.env.D1_TESLA.prepare(
      `INSERT INTO tesla_quote_response
         (response_id, quote_request_id, insurer_ref, insurer_name, premium_amount,
          premium_currency, excess_amount, cover_type, terms_json, status, received_at, release_id)
       VALUES (?, ?, ?, ?, ?, 'AUD', ?, ?, ?, 'received', ?, ?)`,
    ).bind(
      responseId,
      body.quote_request_id,
      body.insurer_ref,
      body.insurer_name ?? null,
      body.premium_amount ?? null,
      body.excess_amount ?? null,
      body.cover_type ?? null,
      body.terms ? JSON.stringify(body.terms) : null,
      nowIso,
      body.release_id ?? null,
    ),
    c.env.D1_TESLA.prepare(
      `INSERT INTO tesla_audit_event
         (event_id, occurred_at, actor, actor_type, action, subject_type, subject_id, detail_json)
       VALUES (?, ?, ?, 'system', 'quote_response_received', 'tesla_quote_response', ?, ?)`,
    ).bind(
      newId(),
      nowIso,
      `insurer:${body.insurer_ref}`,
      responseId,
      JSON.stringify({ quote_request_id: body.quote_request_id, premium: body.premium_amount ?? null }),
    ),
  ])

  return c.json({ ok: true, response_id: responseId })
})

/**
 * Member accepts or declines a quote (F07-R08).
 *
 * The decision writes both the response status and the policy binding in one
 * batch, so a member can never hold an accepted quote with no policy recorded —
 * the state that would leave their cover unverifiable.
 */
app.post('/quote/decide', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const raw = sessionId ? await c.env.OAUTH_SESSIONS.get(`sess:${sessionId}`) : null
  if (!raw) return c.redirect('/toca-connect', 303)

  const member = await c.env.D1_TESLA.prepare(
    'SELECT member_id FROM tesla_auth_session WHERE session_id = ?',
  )
    .bind(sessionId)
    .first<{ member_id: string }>()
  if (!member) return c.redirect('/toca-connect', 303)

  const form = await c.req.parseBody()
  const responseId = typeof form.response_id === 'string' ? form.response_id : ''
  const decision = typeof form.decision === 'string' ? form.decision : ''
  if (!responseId || !['accept', 'decline'].includes(decision)) {
    return c.text('response_id and decision (accept|decline) are required', 400)
  }

  const response = await c.env.D1_TESLA.prepare(
    `SELECT r.response_id, r.quote_request_id, r.insurer_ref, r.insurer_name, r.cover_type, r.release_id,
            q.member_id, q.vin
       FROM tesla_quote_response r
       JOIN tesla_quote_request q ON q.quote_request_id = r.quote_request_id
      WHERE r.response_id = ?`,
  )
    .bind(responseId)
    .first<{
      response_id: string
      quote_request_id: string
      insurer_ref: string
      insurer_name: string | null
      cover_type: string | null
      release_id: string | null
      member_id: string
      vin: string
    }>()
  if (!response) return c.text('unknown response_id', 404)
  // A member may only decide on their own quote; without this check any session
  // could accept or decline another member's offer.
  if (response.member_id !== member.member_id) return c.text('not your quote', 403)

  const nowIso = new Date().toISOString()
  const accept = decision === 'accept'

  if (!accept) {
    await c.env.D1_TESLA.prepare(
      `UPDATE tesla_quote_response SET status = 'declined', decided_at = ?, decision_reason = 'member_declined'
        WHERE response_id = ?`,
    )
      .bind(nowIso, responseId)
      .run()
    await audit(c.env.D1_TESLA, {
      nowIso, actor: member.member_id, actorType: 'member',
      action: 'quote_declined', subjectType: 'tesla_quote_response', subjectId: responseId,
    })
    return c.redirect(DASHBOARD_PATH, 303)
  }

  // Cover is annual at MVP; the insurer of record owns the actual period and this
  // is our record of the binding (F07-R09). Recorded explicitly so F07-R10 has a
  // date to check rather than an assumption.
  const coverStart = nowIso
  const coverEnd = new Date(Date.parse(nowIso) + 365 * 24 * 60 * 60 * 1000).toISOString()
  const policyId = newId()

  await c.env.D1_TESLA.batch([
    c.env.D1_TESLA.prepare(
      `UPDATE tesla_quote_response SET status = 'accepted', decided_at = ?, decision_reason = 'member_accepted'
        WHERE response_id = ?`,
    ).bind(nowIso, responseId),
    c.env.D1_TESLA.prepare(
      `UPDATE tesla_quote_request SET status = 'accepted', decided_at = ? WHERE quote_request_id = ?`,
    ).bind(nowIso, response.quote_request_id),
    c.env.D1_TESLA.prepare(
      `INSERT INTO tesla_policy
         (policy_id, member_id, vin, response_id, insurer_ref, insurer_name, cover_start, cover_end,
          status, bound_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
      policyId, response.member_id, response.vin, responseId, response.insurer_ref,
      response.insurer_name, coverStart, coverEnd, nowIso, nowIso, nowIso,
    ),
    c.env.D1_TESLA.prepare(
      `INSERT INTO tesla_audit_event
         (event_id, occurred_at, actor, actor_type, action, subject_type, subject_id, detail_json)
       VALUES (?, ?, ?, 'member', 'quote_accepted', 'tesla_policy', ?, ?)`,
    ).bind(
      newId(), nowIso, member.member_id, policyId,
      JSON.stringify({
        insurer_ref: response.insurer_ref,
        quote_request_id: response.quote_request_id,
        release_id: response.release_id,
        cover_end: coverEnd,
      }),
    ),
  ])

  return c.redirect(DASHBOARD_PATH, 303)
})

/**
 * Group-level anonymised export (F06-R01/R07).
 *
 * Restricted to the operator. F06-R01 publishes postcode-level aggregates that
 * describe members in aggregate, and F06-R08 can flag a cohort of one — so this is
 * not a member-reachable route. Authentication is the shared operator secret; a real
 * admin identity is F09's job and is not built.
 *
 * The response carries the CSV plus the small-cell warnings, because F06-R08 requires
 * the operator to be **warned** when a cohort is small enough to be re-identifiable.
 * A warning that only reaches a log is not a warning.
 */
app.post('/analytics/group-export', async (c) => {
  const provided = c.req.header('x-ingest-secret') ?? ''
  const expected = c.env.INGEST_SHARED_SECRET ?? ''
  if (!expected || !timingSafeEqual(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const body = await c.req.json<{
    period_start?: string
    period_end?: string
    postcode?: string | null
    requested_by?: string
    format?: string
  }>()

  if (!body.period_start || !body.period_end) {
    return c.json({ error: 'period_start and period_end are required' }, 400)
  }
  if (body.postcode && !/^\d{4}$/.test(body.postcode)) {
    return c.json({ error: 'postcode must be four digits' }, 400)
  }

  const nowIso = new Date().toISOString()
  const requestedBy = body.requested_by?.trim() || 'unknown'

  try {
    const result = await buildGroupExport(c.env.D1_TESLA, {
      periodStart: body.period_start,
      periodEnd: body.period_end,
      postcode: body.postcode ?? null,
      requestedBy,
      nowIso,
    })

    // F06-R06: keep the delivered bytes so a figure can be reconciled later. Stored
    // under the export id, which is derived from the content hash — so an identical
    // re-run is idempotent rather than creating a second copy.
    await c.env.RAW_PAYLOADS.put(`group-exports/${result.exportId}.csv`, result.csv, {
      httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    })
    await c.env.D1_TESLA.prepare('UPDATE tesla_group_export SET r2_key = ? WHERE export_id = ?')
      .bind(`group-exports/${result.exportId}.csv`, result.exportId)
      .run()

    if (body.format === 'json') {
      return c.json({
        export_id: result.exportId,
        sha256: result.sha256,
        row_count: result.rowCount,
        vehicle_count: result.vehicleCount,
        aggregation_version: AGGREGATION_VERSION,
        members_excluded_no_postcode: result.membersExcludedNoPostcode,
        small_cells: result.smallCells,
        rows: result.rows,
      })
    }

    // The warning travels with the artifact, in a header the operator's tooling can
    // read, so a small cohort cannot be missed by someone who only opens the file.
    return new Response(result.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate, private',
        'content-disposition': `attachment; filename="afirmico-group-${result.exportId}.csv"`,
        'x-export-id': result.exportId,
        'x-export-sha256': result.sha256,
        'x-export-aggregation-version': AGGREGATION_VERSION,
        'x-export-small-cells': String(result.smallCells.length),
        'x-export-excluded-no-postcode': String(result.membersExcludedNoPostcode),
      },
    })
  } catch (error) {
    console.error('group export failed', error)
    return c.json({ error: 'group export failed' }, 500)
  }
})

/* -------------------------------------------------------------------------- */
/* Telemetry configuration transport (F02-R11, F02-R12)                        */
/* -------------------------------------------------------------------------- */

/**
 * The CA Tesla must trust, as certificate *contents* (F02-R11, SDD-010 §4.1).
 *
 * Tesla requires the chain inline in the config, not a path — a path string is
 * accepted by our own code and rejected only remotely, which is exactly how the
 * relay failed on its first run. Held as a Worker secret so the chain can be
 * renewed without a code change.
 */
function telemetryCa(env: Env): string {
  return env.TELEMETRY_CA_PEM ?? ''
}

/**
 * Where a signed config or delete is POSTed.
 *
 * `TESLA_PROXY_URL` points at `tesla-http-proxy` from `teslamotors/vehicle-command`,
 * used SOLELY as the configuration signer: it signs the JWS with the application
 * private key (the key never reaches this Worker) and forwards to Tesla
 * (F02-R11). */
function proxyBase(env: Env): string | null {
  return proxyConfigured(env) ? (env.TESLA_PROXY_URL as string).replace(/\/+$/, '') : null
}

/**
 * Send a telemetry configuration for one VIN.
 *
 * Returns `{ sent: false, error }` rather than throwing whenever the proxy is
 * absent or Tesla rejects the call, because the caller must record the outcome
 * per VIN and continue with the rest of the fleet — one vehicle with a missing
 * key must not stop the others being configured (F02-R11's per-VIN skip states).
 */
async function sendVehicleConfig(
  env: Env,
  vin: string,
  nowIso: string,
  memberId: string,
): Promise<{ sent: boolean; state: 'active' | 'pending' | 'skipped' | 'failed'; skipReason?: string; error?: string }> {
  const base = proxyBase(env)
  if (!base) {
    // Honest state: recorded, not applied. Claiming `active` here would be the
    // silent-false-success class this platform has already been bitten by.
    return { sent: false, state: 'pending', error: 'proxy_not_configured' }
  }

  const fields = (await collectedFields(env.D1_TESLA)) as CollectedField[]
  const target = await telemetryTarget(env.D1_TESLA)
  const input = {
    vins: [vin],
    hostname: target.hostname,
    port: target.port,
    ca: telemetryCa(env),
    fields,
  }

  // Caller bugs must not be recorded against the vehicle — a config with no CA
  // is our error, and surfacing it as a Tesla-side failure would blame the car.
  const problems = validateConfigInput(input)
  if (problems.length) return { sent: false, state: 'failed', error: `invalid_config:${problems.join(',')}` }

  try {
    // Use member's access token (required for fleet_telemetry_config via proxy)
    const accessToken = await getMemberAccessToken(env, memberId)
    if (!accessToken) {
      return { sent: false, state: 'failed', error: 'no_member_access_token' }
    }
    const res = await fetch(`${base}/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signer-secret': env.SIGNER_SHARED_SECRET ?? '',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildTelemetryConfig(input)),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

    // Per-VIN outcomes nest under `skipped_vehicles`; map each to its own state.
    const skipped = Array.isArray(body.skipped_vehicles) ? (body.skipped_vehicles as Record<string, unknown>[]) : []
    const mine = skipped.find((s) => s && (s.vin === vin || s.VIN === vin))
    if (mine) {
      const reason = (mine.reason ?? mine.skip_reason ?? mine.error) as unknown
      const mapped = mapSkipReason(reason) ?? String(reason ?? 'unknown')
      return { sent: true, state: 'skipped', skipReason: mapped }
    }
    if (!res.ok) {
      // Capture WHY, not just the status. `http_404` alone is ambiguous across
      // three different repairs and is what made this failure unactionable.
      return { sent: false, state: 'failed', error: upstreamErrorDetail(res.status, JSON.stringify(body)) }
    }
    return { sent: true, state: 'active' }
  } catch (error) {
    return { sent: false, state: 'failed', error: `transport:${(error as Error).message}` }
  }
}

/**
 * Remove a vehicle's telemetry configuration (F02-R12).
 *
 * The delete is aimed at the vehicle so collection ceases at the source. As with
 * the send, an absent proxy is reported as `sent: false` with a reason — the
 * caller records that separately from the row state, so a teardown that did not
 * reach Tesla is never reported as complete.
 */
async function removeVehicleConfig(env: Env, vin: string, memberId: string): Promise<{ sent: boolean; error?: string }> {
  const base = proxyBase(env)
  if (!base) return { sent: false, error: 'proxy_not_configured' }
  try {
    // Use member's access token (required for fleet_telemetry_config via proxy)
    const accessToken = await getMemberAccessToken(env, memberId)
    if (!accessToken) {
      return { sent: false, error: 'no_member_access_token' }
    }
    const res = await fetch(`${base}/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, {
      method: 'DELETE',
      headers: {
        'x-signer-secret': env.SIGNER_SHARED_SECRET ?? '',
        authorization: `Bearer ${accessToken}`,
      },
    })
    if (!res.ok) {
      // Same reasoning as the send path: a bare status cannot distinguish a
      // moved endpoint from a VIN the account cannot see, and a teardown that
      // silently did not happen leaves the car transmitting.
      const body = await res.text().catch(() => '')
      return { sent: false, error: upstreamErrorDetail(res.status, body) }
    }
    return { sent: true }
  } catch (error) {
    return { sent: false, error: `transport:${(error as Error).message}` }
  }
}

/**
 * Operator endpoint: configure (or re-apply) telemetry for the fleet (F02-R11).
 *
 * This is the re-apply half of the F02-R13 runbook — after a billing breach
 * strips every config, this is what puts them back. It is deliberately idempotent
 * (row `config_id` is derived, and Tesla treats a repeat config as an update), so
 * running it twice is harmless and running it after a breach is the whole point.
 *
 * Guarded by the same shared secret as ingest: it is an authenticated operator
 * action, not a public one, and it must never be reachable by a member.
 */
app.post('/admin/telemetry/apply', async (c) => {
  const secret = c.env.INGEST_SHARED_SECRET
  if (!secret) return c.json({ ok: false, error: 'not_configured' }, 503)
  if (!timingSafeEqual(c.req.header('x-ingest-secret') ?? '', secret)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const nowIso = new Date().toISOString()

  // Optional `vin` narrows to one vehicle; default is every paired vehicle.
  const body = (await c.req.json().catch(() => ({}))) as { vin?: string }
  const rows = body.vin
    ? await c.env.D1_TESLA.prepare('SELECT vin FROM tesla_vehicle WHERE vin = ?').bind(body.vin).all<{ vin: string }>()
    : await c.env.D1_TESLA.prepare('SELECT vin FROM tesla_vehicle ORDER BY vin').all<{ vin: string }>()
  const vins = (rows.results ?? []).map((r) => r.vin)

  const results: { vin: string; state: string; skip_reason?: string; error?: string }[] = []
  for (const vin of vins) {
    // Get member_id for this VIN
    const vehicleRow = await c.env.D1_TESLA.prepare('SELECT member_id FROM tesla_vehicle WHERE vin = ?')
      .bind(vin)
      .first<{ member_id: string }>()
    if (!vehicleRow) {
      results.push({ vin, state: 'failed', error: 'vehicle_not_found' })
      continue
    }
    const outcome = await sendVehicleConfig(c.env, vin, nowIso, vehicleRow.member_id)
    const rec = buildConfigRecord({
      vin,
      hostname: (await telemetryTarget(c.env.D1_TESLA)).hostname,
      port: 443,
      fields: (await collectedFields(c.env.D1_TESLA)) as CollectedField[],
      now: nowIso,
    })
    await upsertTelemetryConfig(c.env.D1_TESLA, {
      ...rec,
      state: outcome.state,
      skip_reason: outcome.skipReason ?? null,
      applied_at: outcome.state === 'active' ? nowIso : null,
      last_error: outcome.error ?? null,
    })
    await audit(c.env.D1_TESLA, {
      action: 'telemetry.config_applied',
      actorType: 'admin',
      subjectType: 'vehicle',
      subjectId: vin,
      detail: { state: outcome.state, skip_reason: outcome.skipReason ?? null, error: outcome.error ?? null },
      nowIso,
    })
    results.push({ vin, state: outcome.state, skip_reason: outcome.skipReason, error: outcome.error })
  }

  // `proxy_configured` is reported so an operator reading this response can tell
    // "no vehicles" apart from "no transport" — both produce an empty fleet result.
    return c.json({
      ok: true,
      proxy_configured: proxyConfigured(c.env),
      vehicles: vins.length,
      results,
    })
  })

  /* -------------------------------------------------------------------------- */
  /* Cron: Virtual Key Pairing Poll (F02-R09a)                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Scheduled cron job to poll all vehicles for key pairing status.
   * Triggered by Cloudflare Cron Trigger (every 5 minutes).
   * Expects CRON_SECRET in env for authentication.
   */
  app.get('/cron/key-pairing-poll', async (c) => {
    const cronSecret = c.env.CRON_SECRET
    if (!cronSecret) return c.json({ ok: false, error: 'not_configured' }, 503)
    const provided = c.req.header('x-cron-secret') ?? ''
    if (!timingSafeEqual(provided, cronSecret)) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    try {
      const result = await cronPollAllKeyPairing(c.env)
      return c.json({ ok: true, ...result })
    } catch (error) {
      console.error('[cron] error:', error)
      return c.json({ ok: false, error: `internal: ${(error as Error).message}` }, 500)
    }
  })

  /* -------------------------------------------------------------------------- */
  /* Liveness and readiness.                                                    */
  /* -------------------------------------------------------------------------- */

  /**
   * Liveness and readiness.
   */
app.get('/healthz', async (c) => {
  const problems = assertConfigured({
    clientId: c.env.TESLA_CLIENT_ID,
    clientSecret: c.env.TESLA_CLIENT_SECRET,
    stateSecret: c.env.OAUTH_STATE_SECRET,
    tokenKey: c.env.TOKEN_ENCRYPTION_KEY,
  })

  const checks: Record<string, string> = {}

  try {
    const row = await c.env.D1_TESLA.prepare(
      `SELECT (SELECT count(*) FROM tesla_field_catalog) AS fields,
              (SELECT count(*) FROM tesla_consent_policy) AS policies`,
    ).first<{ fields: number; policies: number }>()
    checks.d1 = 'ok'
    checks.fields = String(row?.fields ?? 0)
    checks.policies = String(row?.policies ?? 0)
  } catch (error) {
    checks.d1 = `error: ${(error as Error).message.slice(0, 120)}`
    problems.push('D1_TESLA is not reachable or the migrations have not been applied')
  }

  // F01 AC5 depends on the rendered consent text hashing to the version on the
  // member's consent row, so a mismatch here would silently break auditability.
  try {
    const row = await c.env.D1_TESLA.prepare(
      'SELECT policy_sha256 FROM tesla_consent_policy WHERE policy_version = ?',
    )
      .bind(CONSENT_POLICY_VERSION)
      .first<{ policy_sha256: string }>()
    const current = await sha256Hex(CONSENT_TEXT)
    checks.consent_text = row ? (row.policy_sha256 === current ? 'ok' : 'STALE_TEXT_HASH') : 'not_seeded'
  } catch {
    checks.consent_text = 'unavailable'
  }

  // F01 AC6: the catalog's collected set and CONSENTED_FIELDS are two independent
  // representations of the same decision. R-10 is exactly what happens when
  // nothing compares them — the catalog and CONSENTED_FIELDS said
  // fourteen, and both gates passed. Asserted in the build (verify-store.ts) and
  // reported here so the drift is visible in production, not only in CI.
  try {
    const rows = await c.env.D1_TESLA.prepare(
      'SELECT field_key FROM tesla_field_catalog WHERE collected = 1 ORDER BY field_key',
    ).all<{ field_key: string }>()
    const catalog = rows.results
      .map((r) => r.field_key)
      .sort()
      .join(',')
    const declared = [...CONSENTED_FIELDS].sort().join(',')
    checks.collected_fields = String(rows.results.length)
    checks.consent_field_set =
      catalog === declared
        ? 'ok'
        : `MISMATCH catalog=${rows.results.length} declared=${CONSENTED_FIELDS.length}`
    if (catalog !== declared) {
      problems.push('F01 AC6: the catalog collected set and CONSENTED_FIELDS disagree')
    }
  } catch {
    checks.consent_field_set = 'unavailable'
  }

  // F02-R13 / R-07: a Tesla billing breach strips every telemetry config and
  // Tesla does not restore them, so this check is the earliest Tier 1 can see it
  // coming. The limit is read from config rather than defaulted: an unset limit
  // is reported as unconfigured, never as healthy, because "no limit" and "plenty
  // of headroom" are not the same claim.
  try {
    const limitRaw = c.env.TESLA_BILLING_LIMIT_USD
    const limitUsd = limitRaw === undefined || limitRaw === '' ? null : Number(limitRaw)
    const nowIso = new Date().toISOString()
    const { month, daysElapsed, daysInMonth } = monthWindow(nowIso)
    const report = await costReport(c.env.D1_TESLA, month)
    const guard = evaluateBillingGuard({
      signalsMtd: report.signals,
      daysElapsed,
      daysInMonth,
      limitUsd: limitUsd !== null && Number.isFinite(limitUsd) ? limitUsd : null,
    })

    checks.billing_margin = guard.configured
      ? guard.marginRatio === null
        ? 'no_usage_yet'
        : `${guard.marginRatio}x${guard.marginOk ? '' : ' BELOW_MIN'}`
      : 'unconfigured'
    checks.billing_projected_usd = guard.projectedMonthUsd.toFixed(4)
    checks.billing_consumed = guard.consumedFraction === null ? 'n/a' : guard.consumedFraction.toFixed(3)

    if (!guard.configured) {
      problems.push('F02-R13: TESLA_BILLING_LIMIT_USD is not set — the 10x safety margin cannot be verified')
    } else if (guard.marginRatio !== null && !guard.marginOk) {
      problems.push(
        `F02-R13: billing margin ${guard.marginRatio}x is below the required ${MIN_MARGIN_RATIO}x (projected $${guard.projectedMonthUsd.toFixed(2)}/mo)`,
      )
    }
    if (guard.alertBreach) {
      problems.push('R-07: billing limit BREACHED — Tesla configs are stripped and not restored; run the re-apply runbook')
    } else if (guard.alertWarn) {
      problems.push('F02-R13: billing limit is at or above 80% consumed')
    }
  } catch (error) {
    checks.billing_margin = `error: ${(error as Error).message.slice(0, 120)}`
  }

  return c.json({
    status: problems.length ? 'degraded' : 'ok',
    service: 'afirmico-tesla',
    version: CONSENT_POLICY_VERSION,
    problems,
    checks,
  })
})

/**
 * Anything not handled above is served the splash out of this worker's own
 * asset layer (F01-R12).
 *
 * This used to proxy the request back to "the origin" so the older splash site
 * could keep answering. That is no longer right: afirmico-tesla holds the whole
 * host now, so proxying an unmatched path either recurses into this same worker
 * or reaches the retired catch-all worker that served the splash with its own
 * inline icon. Serving the one repository copy keeps the icon identical on
 * every path.
 */
app.notFound(async (c) => {
  const splash = await c.env.ASSETS.fetch(
    new Request(new URL('/', c.req.url), { headers: c.req.raw.headers }),
  )
  return new Response(splash.body, { status: 404, headers: splash.headers })
})

/* -------------------------------------------------------------------------- */
/* INEOS QLD splash (partner variant)                                         */
/* -------------------------------------------------------------------------- */

app.get('/ineos-qld', (c) => c.html(ineosSplashPage()))

app.route('/admin', adminApp)

/* -------------------------------------------------------------------------- */
/* Scheduled event handler (Cron Triggers)                                    */
/* -------------------------------------------------------------------------- */

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Only run the key pairing poll cron
    if (controller.cron === '*/5 * * * *') {
      const result = await cronPollAllKeyPairing(env)
      console.warn(`[cron] key-pairing-poll: checked=${result.checked} paired=${result.paired} failed=${result.failed}`)
      if (result.errors.length) {
        console.error(`[cron] key-pairing-poll errors:`, result.errors)
      }
    }
  },
} satisfies ExportedHandler<Env>

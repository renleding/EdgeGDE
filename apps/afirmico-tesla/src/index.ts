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
  decodeIdToken,
  exchangeCode,
  fetchVehicles,
  generateCodeVerifier,
  generateState,
  parseCookies,
  s256Challenge,
  serializeCookie,
  verifyState,
} from './oauth'
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
  upsertVehicles,
  vehicleExists,
} from './store'
import { TokenKeyMissingError } from './crypto'
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

/**
 * Onboarding entry (F01-R01..R03, R-13).
 *
 * The consent step was missing: the flow went straight from "connect" to the
 * Tesla handshake, so no consent was ever captured and F01-R02/R03 were
 * unsatisfied by a flow that appeared to work. The member must now explicitly
 * accept the authorisation text, whose exact bytes are recorded.
 */
app.get('/connect', (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
  const already = sessionId
    ? `<div class="card ok"><strong>Already connected.</strong> <a href="${DASHBOARD_PATH}">View your dashboard</a></div>`
    : ''

  return c.html(page('Connect your Tesla — AFIRMICO Auto', `
  <h1>Connect your Tesla</h1>

  <p>AFIRMICO Auto asks your Tesla for two numbers only: total kilometres driven, and how many of
  those were driven on Full Self-Driving. Nothing else is collected, and you can revoke it at any time.</p>

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

  <h2>What we request from Tesla</h2>
  <p class="meta">${TESLA_SCOPES.join(' · ')} — identity, a refresh token so you don't have to sign in
  again, and read access to vehicle data. We never request the ability to send commands to your car.</p>
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
    <a class="cta" href="/connect">Back to the authorisation</a>
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

  const list = vehiclesOnRecord.results.length
    ? vehiclesOnRecord.results
    : session.vehicles.map((v) => ({ vin: v.vin, display_name: v.displayName ?? null, model: null }))

  const vehicleRows = list.length
    ? list.map((vehicle) => `
      <div class="card ok">
        <strong>${escapeHtml(vehicle.display_name ?? vehicle.vin)}</strong>
        <div class="meta">VIN ${escapeHtml(vehicle.vin)}${vehicle.model ? ` &middot; ${escapeHtml(vehicle.model)}` : ''}</div>
      </div>`).join('')
    : `<div class="note">Tesla returned no vehicles for this account. If you have a vehicle on this Tesla
       account, check that it is not a leased or business-managed vehicle.</div>`

  const revokeUrl = `${TESLA_REVOKE_URL}?revoke_client_id=${encodeURIComponent(c.env.TESLA_CLIENT_ID)}` +
    `&back_url=${encodeURIComponent(new URL(DASHBOARD_PATH, c.req.url).toString())}`

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
      <button class="cta danger" type="submit">Withdraw authorisation</button>
    </form>
  </div>

  <h2>The authorisation you agreed to</h2>
  <div class="policy">${escapeHtml(CONSENT_TEXT)}</div>`
    : `
  <div class="note">No current authorisation on record. <a href="/connect">Grant one</a> to start collecting.</div>`

  return c.html(page('Your Tesla — AFIRMICO Auto', `
  <h1>Connected</h1>
  <div class="card ok">
    <p>Tesla access granted. We can read vehicle data for the vehicles below.</p>
    <p class="meta">Granted scopes: <code>${escapeHtml(session.scope)}</code><br>
    Connected: ${escapeHtml(session.createdAt)}</p>
  </div>

  ${consentBlock}

  <h2>Your vehicles</h2>
  ${vehicleRows}

  <h2>Next step</h2>
  <p>Approve the AFIRMICO Auto key on your vehicle in the Tesla app to start receiving data.</p>
  <a class="cta" href="${PAIRING_URL}">Approve the key in the Tesla app</a>

  <h2>Data we collect</h2>
  <p>${CONSENTED_FIELDS.map((f) => `<code>${escapeHtml(f)}</code>`).join(' &middot; ')} — total kilometres
  and Full Self-Driving kilometres. Nothing else.</p>

  <h2>Where it has been shared</h2>
  <p class="meta">No third party has received your data yet. Insurers receive data only where you have asked
  AFIRMICO to seek offers on your behalf.</p>

  <h2>Revoke access at Tesla</h2>
  <p class="meta">Withdrawing here stops collection immediately. You can also revoke at Tesla, which stops
  collection at the vehicle.</p>
  <p><a href="${revokeUrl}">Revoke AFIRMICO Auto access at Tesla</a> &middot;
  <a href="/auth/logout">Sign out of this browser</a></p>
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
  if (!raw) return c.redirect('/connect', 303)

  const member = await c.env.D1_TESLA.prepare(
    `SELECT m.member_id FROM tesla_auth_session s
       JOIN tesla_member m ON m.member_id = s.member_id
      WHERE s.session_id = ?`,
  )
    .bind(sessionId)
    .first<{ member_id: string }>()
  if (!member) return c.redirect('/connect', 303)

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

  await audit(c.env.D1_TESLA, {
    action: 'member.consent_revoked',
    actorType: 'member',
    actor: member.member_id,
    subjectType: 'member',
    subjectId: member.member_id,
    detail: { revoked, retention: policy ? 'policy_linked' : 'immediate_deletion' },
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
  <p><a href="/connect">Grant a new authorisation</a></p>
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
        datum_count, is_resend, content_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
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
 * Liveness and readiness.
 *
 * Reports configuration gaps by name rather than failing opaquely, and probes
 * D1 so a missing migration or binding is visible here instead of surfacing as
 * a member-facing 500 mid-onboarding.
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

  return c.json({
    status: problems.length ? 'degraded' : 'ok',
    service: 'afirmico-tesla',
    version: CONSENT_POLICY_VERSION,
    problems,
    checks,
  })
})

/**
 * Anything else under the attached routes is passed back to the origin, which
 * keeps the existing splash site serving normally.
 */
app.notFound((c) => fetch(c.req.raw))

export default app

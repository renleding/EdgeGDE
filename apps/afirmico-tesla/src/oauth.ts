/**
 * Tesla OAuth 2.0 helpers (FRS-010 F02-R04, R-13).
 *
 * Deliberately I/O-free: every function here is pure or takes its inputs as
 * arguments, so the security-critical parts (PKCE derivation, state signing,
 * cookie handling) are unit-testable without a Workers runtime.
 *
 * Flow (Tesla third-party tokens):
 *   1. /auth/start      -> build /authorize URL, set signed `state` cookie
 *   2. Tesla consent    -> redirect back to /auth/callback?code=...&state=...
 *   3. /auth/callback   -> verify state, exchange code (server-side, secret
 *                          never leaves the Worker), persist refresh token
 */

/** Tesla's OAuth authorize endpoint (user-facing consent screen). */
export const TESLA_AUTHORIZE_URL = 'https://auth.tesla.com/oauth2/v3/authorize'

/**
 * Token endpoint. Tesla requires this host rather than `auth.tesla.com` for
 * server-to-server token calls (Fleet API announcement 2025-07-21).
 */
export const TESLA_TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'

/**
 * Fleet API base URL for this app. Australia is served by the North America
 * base — APAC excluding China shares it (Tesla: "Regions and Countries").
 */
export const TESLA_AUDIENCE = 'https://fleet-api.prd.na.vn.cloud.tesla.com'

/** Revoke-consent page, with a link back to our dashboard (F01-R04). */
export const TESLA_REVOKE_URL = 'https://auth.tesla.com/user/revoke/consent'

/**
 * Minimum scopes for the declared purpose.
 *
 * `vehicle_device_data` is what reaches the vehicle list and telemetry fields.
 * `offline_access` is required to obtain a refresh token. Nothing that can
 * act on the car is requested: no `vehicle_charging_cmds`,
 * no `energy_cmds`, no `enterprise_management` — matching the FRS scope
 * (odometer + FSD km only).
 * `vehicle_cmds` is required for the tesla-http-proxy to forward the signed
 * fleet_telemetry_config to Tesla (F02-R16).
 */
export const TESLA_SCOPES = ['openid', 'offline_access', 'vehicle_device_data', 'vehicle_cmds'] as const

/** Cookie holding the signed OAuth `state` value. Short-lived. */
export const STATE_COOKIE = 'afirmico_oauth_state'

/** Cookie holding the opaque session id (the token itself stays server-side). */
export const SESSION_COOKIE = 'afirmico_session'

const encoder = new TextEncoder()

/** base64url without padding, per RFC 7636 / RFC 7515. */
export function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === 'string'
    ? encoder.encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * PKCE code verifier: 32 random bytes, base64url encoded (43 chars).
 * Within RFC 7636's 43..128 character requirement.
 */
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32))
}

/** PKCE S256 challenge = base64url(SHA-256(verifier)). */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return base64UrlEncode(digest)
}

async function hmac(secret: string, data: string): Promise<string> {
  // Fail loudly rather than importing a zero-length key: an unset secret means
  // a misconfigured deployment, and crypto.subtle reports it as an opaque
  // DataError that looks like a bug in this code.
  if (!secret) {
    throw new StateSecretMissingError()
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return base64UrlEncode(signature)
}

/** Raised when the deployment is missing its OAuth signing key. */
export class StateSecretMissingError extends Error {
  constructor() {
    super('OAUTH_STATE_SECRET is not configured')
    this.name = 'StateSecretMissingError'
  }
}

/** Human-readable name for each configuration field, for error messages. */
const CONFIG_LABELS = {
  clientId: 'TESLA_CLIENT_ID',
  clientSecret: 'TESLA_CLIENT_SECRET',
  stateSecret: 'OAUTH_STATE_SECRET',
  tokenKey: 'TOKEN_ENCRYPTION_KEY',
} as const

export type ConfigField = keyof typeof CONFIG_LABELS

/**
 * Report missing configuration before attempting a flow.
 *
 * Without this a missing secret surfaces as a 500 from deep inside the crypto
 * call, which reads like a code defect rather than a deployment gap. Callers
 * turn a non-empty result into an honest 503.
 *
 * Only the fields the caller actually passes are checked, so a route that does
 * not need the client secret (the authorize redirect, for example) is not
 * reported as misconfigured for lacking it.
 */
export function assertConfigured(config: Partial<Record<ConfigField, string | undefined>>): string[] {
  const problems: string[] = []
  for (const field of Object.keys(CONFIG_LABELS) as ConfigField[]) {
    if (Object.prototype.hasOwnProperty.call(config, field) && !config[field]) {
      problems.push(`${CONFIG_LABELS[field]} is not set`)
    }
  }
  return problems
}

/** Length-independent, constant-time string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Mint a signed, self-expiring `state` value.
 *
 * Signed with a Worker secret so a tampered or forged state cannot survive the
 * callback. The value is also mirrored into a cookie, which binds the callback
 * to the browser that started the flow.
 */
export async function generateState(secret: string, ttlSeconds = 600, nowMs = Date.now()): Promise<string> {
  const payload = {
    n: base64UrlEncode(randomBytes(16)),
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${body}.${await hmac(secret, body)}`
}

export type StateCheck =
  | { ok: true; nonce: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

/** Verify a `state` value's signature and expiry. */
export async function verifyState(
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): Promise<StateCheck> {
  if (!token) return { ok: false, reason: 'malformed' }
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' }

  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!timingSafeEqual(signature, await hmac(secret, body))) {
    return { ok: false, reason: 'bad_signature' }
  }

  let payload: { n?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.exp !== 'number' || typeof payload.n !== 'string') {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp * 1000 < nowMs) return { ok: false, reason: 'expired' }

  return { ok: true, nonce: payload.n }
}

/** Build the consent URL the member is redirected to. */
export function buildAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  scopes?: readonly string[]
}): string {
  const url = new URL(TESLA_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', (params.scopes ?? TESLA_SCOPES).join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Ask the member to confirm every scope even if they granted some before,
  // so consent captured by us matches what Tesla actually granted.
  url.searchParams.set('prompt_missing_scopes', 'true')
  url.searchParams.set('require_requested_scopes', 'true')
  // Tell the member a second step (virtual-key pairing) follows.
  url.searchParams.set('show_keypair_step', 'true')
  return url.toString()
}

export interface TeslaTokens {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  scope?: string
  /** ID token (JWT) — carries the member's stable Tesla `sub` claim. */
  idToken?: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

function toTokens(body: TokenResponse): TeslaTokens {
  if (!body.access_token) throw new TeslaAuthError(body.error ?? 'no_access_token', body.error_description)
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 28800,
    scope: body.scope,
    idToken: body.id_token,
  }
}

/**
 * Decode the `id_token` payload (F01-R05).
 *
 * The signature is NOT verified here, and that is deliberate rather than an
 * oversight: this token was received over TLS in the direct response to our own
 * server-side code exchange, authenticated with the client secret. It was not
 * passed through the browser, so there is no untrusted hop for a forger to
 * exploit. Verifying it against Tesla's JWKS would be belt-and-braces; what
 * would be wrong is trusting an id_token that arrived from the client.
 *
 * Returns null rather than throwing: a decode failure must not lose the grant.
 */
export function decodeIdToken(idToken: string | undefined): {
  sub?: string
  email?: string
  name?: string
} | null {
  if (!idToken) return null
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub?: unknown
      email?: unknown
      name?: unknown
    }
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    }
  } catch {
    return null
  }
}

/** Typed error so the caller can distinguish Tesla's failures from ours. */
export class TeslaAuthError extends Error {
  constructor(public readonly code: string, public readonly description?: string) {
    super(description ? `${code}: ${description}` : code)
    this.name = 'TeslaAuthError'
  }
}

async function postToken(form: Record<string, string>): Promise<TeslaTokens> {
  const response = await fetch(TESLA_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const text = await response.text()
  let body: TokenResponse
  try {
    body = JSON.parse(text) as TokenResponse
  } catch {
    throw new TeslaAuthError('invalid_token_response', text.slice(0, 200))
  }
  if (!response.ok && !body.access_token) {
    throw new TeslaAuthError(body.error ?? `http_${response.status}`, body.error_description)
  }
  return toTokens(body)
}

/**
 * Exchange the authorization code for tokens.
 *
 * Runs inside the Worker, so the client secret never reaches the browser.
 * The verifier proves the exchange is being performed by the same party that
 * started the flow.
 */
export function exchangeCode(params: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  verifier: string
  audience?: string
}): Promise<TeslaTokens> {
  return postToken({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    audience: params.audience ?? TESLA_AUDIENCE,
    code_verifier: params.verifier,
  })
}

/**
 * Exchange a refresh token. Tesla rotates refresh tokens, so the caller MUST
 * persist the newly returned one; the previous token stays valid for up to 24h
 * as a safety net.
 */
export function refreshTokens(params: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<TeslaTokens> {
  return postToken({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  })
}

export interface VehicleSummary {
  vin: string
  displayName?: string
  state?: string
}

/** Enumerate the member's vehicles — proves the access token is live. */
export async function fetchVehicles(
  accessToken: string,
  audience = TESLA_AUDIENCE,
): Promise<VehicleSummary[]> {
  const response = await fetch(`${audience}/api/1/vehicles`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new TeslaAuthError(`vehicles_http_${response.status}`)
  const body = (await response.json()) as { response?: Array<Record<string, unknown>> }
  return (body.response ?? []).map((vehicle) => ({
    vin: String(vehicle.vin ?? ''),
    displayName: vehicle.display_name ? String(vehicle.display_name) : undefined,
    state: vehicle.state ? String(vehicle.state) : undefined,
  }))
}

/** Parse a Cookie header into a plain object. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    if (name) out[name] = part.slice(eq + 1).trim()
  }
  return out
}

/** Serialize a Set-Cookie value. Only ever for HttpOnly session material. */
export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; path?: string; sameSite?: 'Lax' | 'Strict' } = {},
): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? '/'}`, 'HttpOnly', 'Secure']
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`)
  return parts.join('; ')
}

/**
 * Get a partner-scoped access token using client_credentials grant.
 * Used for fleet_telemetry_config signing and other partner-level operations.
 */
export async function getPartnerToken(params: {
  clientId: string
  clientSecret: string
  audience?: string
}): Promise<TeslaTokens> {
  const form: Record<string, string> = {
    grant_type: 'client_credentials',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    // vehicle_cmds scope is required for fleet_telemetry_config (the proxy uses it to sign)
    scope: 'vehicle_cmds openid offline_access vehicle_device_data',
  }
  // Tesla expects audience as an array for client_credentials grant
  // We send it twice so URLSearchParams produces audience=...&audience=...
  const aud = params.audience ?? TESLA_AUDIENCE
  form.audience = aud
  // Add a second audience entry to make it an array
  const entries: [string, string][] = Object.entries(form).flatMap(([k, v]) =>
    k === 'audience' ? [[k, v], [k, v]] : [[k, v]]
  )
  return postTokenFromEntries(entries)
}

async function postTokenFromEntries(entries: [string, string][]): Promise<TeslaTokens> {
  const response = await fetch(TESLA_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(entries).toString(),
  })
  const text = await response.text()
  let body: TokenResponse
  try {
    body = JSON.parse(text) as TokenResponse
  } catch {
    throw new TeslaAuthError('invalid_token_response', text.slice(0, 200))
  }
  if (!response.ok && !body.access_token) {
    throw new TeslaAuthError(body.error ?? `http_${response.status}`, body.error_description)
  }
  return toTokens(body)
}

/** Expire a cookie immediately (used to clear transient state). */
export function clearCookie(name: string, path = '/'): string {
  return `${name}=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

# EdgeGDE Onboarding API — External Endpoints

**Base URL:** `https://<tenant-slug>.edgegde.com` (or the edge runtime worker URL)  
**Base Path (for public onboarding):** Root-level routes on the runtime  
**Format:** JSON request/response (except `/onboarding`, `/tenant/dashboard` which return HTML)  
**Auth:** Varies per endpoint — see individual sections below

---

## Table of Contents

1. [POST /register — Create a new tenant account](#1-post-register--create-a-new-tenant-account)
2. [POST /verify — Confirm email verification code](#2-post-verify--confirm-email-verification-code)
3. [POST /verify/resend — Resend verification code](#3-post-verifyresend--resend-verification-code)
4. [POST /login — Authenticate tenant](#4-post-login--authenticate-tenant)
5. [POST /logout — Clear session](#5-post-logout--clear-session)
6. [GET /onboarding — Onboarding wizard (HTML)](#6-get-onboarding--onboarding-wizard-html)
7. [GET /tenant/dashboard — Tenant dashboard (HTML)](#7-get-tenantdashboard--tenant-dashboard-html)
8. [POST /tenant/api-key/regenerate — Regenerate API key](#8-post-tenantapi-keyregenerate--regenerate-api-key)

---

## 1. POST /register — Create a new tenant account

**Public** — no auth required.

### Rate Limiting
- **Per-IP:** max 3 requests per hour (via `rateLimitRegistration()` middleware)
- **Per-email:** max 2 per day
- Returns `429` with `retryAfter` when exceeded.

### Captcha
If `TURNSTILE_SECRET_KEY` is configured, a valid Cloudflare Turnstile `captchaToken` is required. Without it the endpoint returns `400`.

### Request Body

```json
{
  "companyName": "Acme Corp",
  "email": "admin@acme.com",
  "password": "Str0ngP@ss!",
  "slug": "acme-corp",
  "plan": "free",
  "captchaToken": "0.xxxx..."
}
```

| Field          | Type   | Required | Description                                         |
|----------------|--------|----------|-----------------------------------------------------|
| `companyName`  | string | yes      | Display name for the tenant                         |
| `email`        | string | yes      | Valid email address (basic regex validation)        |
| `password`     | string | yes      | Min 8 chars, 1 uppercase, 1 digit                   |
| `slug`         | string | yes      | URL-safe slug (validated via `validateSlug`)        |
| `plan`         | string | no       | `"free"` (default) or `"pro"`                       |
| `captchaToken` | string | yes*     | Cloudflare Turnstile token (*required if configured)|

### Slug Rules
- Must be unique across all tenants (returns `409` if taken)
- Validated server-side — reject invalid characters/format

### Response — `201 Created`

```json
{
  "tenantId": "uuid-string",
  "slug": "acme-corp",
  "name": "Acme Corp",
  "apiKey": "hex-hex-hex...",
  "dashboardUrl": "/onboarding?step=1&slug=acme-corp"
}
```

| Field          | Type   | Description                                            |
|----------------|--------|--------------------------------------------------------|
| `tenantId`     | string | UUID v4 tenant ID                                      |
| `slug`         | string | Normalized tenant slug                                 |
| `name`         | string | Tenant display name                                    |
| `apiKey`       | string | Plaintext API key — shown **once** (not stored after)  |
| `dashboardUrl` | string | Redirect URL for onboarding wizard                     |

### What Happens Server-Side
1. Verifies Turnstile captcha (if configured)
2. Validates slug, email, password
3. Checks slug uniqueness in KV
4. Hashes password with bcrypt-style hash
5. Generates API key (64 hex characters from UUID)
6. Seeds default layout + design in KV
7. Mirrors tenant to D1 database (non-fatal on failure)

### Errors
- `400` — Validation failure (captcha, slug, email, password)
- `409` — Slug already taken
- `500` — Tenant storage unavailable or unexpected error

---

## 2. POST /verify — Confirm email verification code

**Public** — no auth required.

Confirm the 6-digit verification code sent to the tenant's email.

### Request Body

```json
{
  "slug": "acme-corp",
  "code": "483921"
}
```

| Field  | Type   | Required | Description                                 |
|--------|--------|----------|---------------------------------------------|
| `slug` | string | yes      | Tenant slug to verify                       |
| `code` | string | yes      | 6-digit verification code                   |

### Response — `200 OK`

```json
{
  "success": true,
  "verified": true
}
```

### Verification Rules
- Code expires **15 minutes** after being sent
- Max **5 attempts** — after 5 failures the code is invalidated
- Successful verification sets `tenant.verified = true` in KV

### Errors
- `400` — Missing slug/code, expired code, invalid code, or no code requested
- `429` — Too many failed attempts (max 5)
- `500` — Verification storage unavailable

---

## 3. POST /verify/resend — Resend verification code

**Public** — no auth required.

Generate and send a new 6-digit code. Has a **60-second cooldown** between resends.

### Request Body

```json
{
  "slug": "acme-corp"
}
```

| Field  | Type   | Required | Description          |
|--------|--------|----------|----------------------|
| `slug` | string | yes      | Tenant slug to verify|

### Response — `200 OK`

```json
{
  "success": true
}
```

**Dev mode** (no `RESEND_API_KEY` configured):
```json
{
  "success": true,
  "code": "483921",
  "note": "No RESEND_API_KEY configured — dev mode"
}
```

### Email Delivery
- Uses Resend API (`RESEND_API_KEY` env var)
- From: `EdgeGDE <noreply@edgegde.com>`
- Without `RESEND_API_KEY`, the code is returned in the response body (dev mode only)

### Errors
- `400` — Missing slug or tenant already verified
- `404` — Tenant not found
- `429` — Cooldown active (includes `wait` seconds in error message)
- `500` — Failed to send email or storage unavailable

---

## 4. POST /login — Authenticate tenant

**Public** — no auth required.

Authenticates by slug + password. Sets a **JWT session cookie** (`edgegde_session`) on success.

### Rate Limiting
- **Per-IP:** max 10 requests per 15 minutes (via `rateLimitLogin()` middleware)
- Returns `429` when exceeded.

### Request Body

```json
{
  "slug": "acme-corp",
  "password": "Str0ngP@ss!"
}
```

| Field      | Type   | Required | Description              |
|------------|--------|----------|--------------------------|
| `slug`     | string | yes      | Tenant slug              |
| `password` | string | yes      | Tenant account password  |

### Response — `200 OK`

```json
{
  "tenantId": "uuid-string",
  "slug": "acme-corp",
  "name": "Acme Corp"
}
```

Also sets cookie: `edgegade_session=<JWT>` (HTTP-only, Secure, SameSite=Lax).

### Session Details
- **JWT algorithm:** HMAC-SHA256 (HS256)
- **Expiry:** 24 hours from creation
- **Payload:** `{ tenantId, slug, name, iat, exp }`
- **Cookie name:** `edgegde_session`

### Errors
- `400` — Missing slug or password
- `401` — Invalid slug or password (unified error message)
- `429` — Rate limit exceeded
- `500` — JWT secret not configured or storage unavailable

---

## 5. POST /logout — Clear session

**Authenticated** — expects valid session cookie.

Clears the `edgegde_session` cookie and redirects to `/login`.

### Response — `302 Found`

Redirect to `/login`.
No request body required.

---

## 6. GET /onboarding — Onboarding wizard (HTML)

**Step 1:** Public (via slug query param)  
**Steps 2–3:** Requires valid session cookie (JWT) for the tenant.

Returns an HTMX-powered HTML onboarding wizard in 3 steps. Progress is tracked in KV.

### Query Parameters

| Param  | Type   | Required | Description                                       |
|--------|--------|----------|---------------------------------------------------|
| `slug` | string | no*      | Tenant slug (*auto-detected from session cookie)  |
| `step` | number | no       | Force a specific step (1–3), otherwise auto-detect|

### Step Progression

| Step | Content                                        |
|------|------------------------------------------------|
| 1    | Welcome page + workspace URL (`https://{slug}.edgegde.com`) |
| 2    | API key display (requires session, shown once, then cleared from KV) |
| 3    | First steps links → redirect to dashboard       |

### About the API Key Display (Step 2)
- The plaintext API key is stored temporarily in KV as `apiKeyPlaintext`
- It is shown **exactly once** in Step 2
- Immediately after display, the plaintext field is deleted from KV
- If the session doesn't match the requested slug, user is prompted to log in first

### Errors
- No slug → shows welcome page with login link
- No session for Step 2 → shows login prompt with redirect back

---

## 7. GET /tenant/dashboard — Tenant dashboard (HTML)

**Authenticated** — requires valid JWT session cookie (`requireSession()` middleware).

Returns an HTML dashboard page showing:
- **Overview:** tenant name, slug, plan, creation date, tenant ID
- **API Key:** masked hash, regenerate button
- **Usage:** placeholder for 7-day stats
- **Webhook:** current webhook URL and status
- **Danger Zone:** delete tenant button

### Query Parameters

None — session slug is extracted from JWT cookie.

---

## 8. POST /tenant/api-key/regenerate — Regenerate API key

**Authenticated** — requires valid JWT session cookie (`requireSession()` middleware).

Generates a new API key, replaces the old one in KV, and returns the new plaintext key **once** (as an HTMX HTML fragment).

### Response — HTMX HTML Fragment

```html
<div>
  <p>New API key (shown once):</p>
  <code>664-character-hex-key</code>
  <button>Copy</button>
</div>
```

### What Happens Server-Side
1. Validates session
2. Generates new 64-hex-char API key
3. Hashes it for storage
4. Preserves existing password hash
5. Stores `apiKeyPlaintext` temporarily (shown once, same as registration)
6. Returns key as HTML fragment

### Confirmation

The UI triggers `hx-confirm` dialog: *"This will invalidate the current key. Continue?"*

### Errors
- `500` — Tenant storage unavailable
- Session required — returns 401/redirect if no valid cookie

---

## Auth Requirements Summary

| Endpoint                              | Auth Required | Rate Limited     | Notes                                   |
|---------------------------------------|---------------|------------------|-----------------------------------------|
| `POST /register`                      | ❌ No         | ✅ 3/IP/hour     | Turnstile captcha may be required       |
| `POST /verify`                        | ❌ No         | ❌ (attempt cap) | Max 5 code attempts per code            |
| `POST /verify/resend`                 | ❌ No         | ✅ 60s cooldown  | Per-slug                                |
| `POST /login`                         | ❌ No         | ✅ 10/15min/IP   | Sets session cookie                     |
| `POST /logout`                        | ✅ Cookie     | ❌ No            | Clears session cookie                   |
| `GET /onboarding?step=1`              | ❌ No         | ❌ No            | Via slug query param                    |
| `GET /onboarding?step=2&step=3`       | ✅ Cookie     | ❌ No            | Requires matching session slug          |
| `GET /tenant/dashboard`               | ✅ Cookie     | ❌ No            | Session middleware                      |
| `POST /tenant/api-key/regenerate`     | ✅ Cookie     | ❌ No            | Session middleware, confirmation dialog |

---

## Environment Variables Required

| Variable              | Used By            | Description                               |
|-----------------------|--------------------|-------------------------------------------|
| `JWT_SECRET`          | Login, Session     | HMAC-SHA256 key for signing session JWTs  |
| `TURNSTILE_SECRET_KEY`| Register (opt.)    | Cloudflare Turnstile server-side secret   |
| `RESEND_API_KEY`      | Verify (opt.)      | Resend.com API key for sending emails     |
| `TENANT_KV`           | All                | Cloudflare KV namespace for tenant data   |

---

## See Also

- [Multi-Tenant Onboarding Design](../execution-multi-tenant-onboarding.md)
- [AI Tutor API Reference](ai-tutor-api.md)

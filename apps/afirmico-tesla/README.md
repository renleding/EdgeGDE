# AFIRMICO Auto — Tesla Fleet API surface (Tier 1)

Cloudflare Worker that owns the Tesla-facing paths on `auto.afirmi.co`.

## What it does

| Path | Purpose |
|------|---------|
| `/.well-known/appspecific/com.tesla.3p.public-key.pem` | Serves the Tesla partner public key. Tesla fetches this to verify domain ownership (FRS-010 F02-R01). |
| `/toca-connect` | Member onboarding entry point. Explains what the authorisation covers and starts the Tesla sign-in (F01-R13). `/connect` 301s here. |
| `/auth/start` | Builds the Tesla `/authorize` URL with PKCE (S256) and a signed `state`, then redirects. |
| `/auth/callback` | Tesla's registered redirect URI. Verifies `state`, exchanges the code, enumerates vehicles, opens a session. |
| `/auth/error` | Human-readable explanation of a refused or failed sign-in. |
| `/dashboard` | Registered returned URL. Shows the grant, the vehicles Tesla returns, and how to revoke. |
| `/auth/logout` | Drops the local session without touching the Tesla grant. |
| `/healthz` | Liveness + configuration check. Returns `degraded` with reasons rather than failing silently. |

## Why a Route, not a Custom Domain

`auto.afirmi.co` is bound as a **Custom Domain** to the legacy splash worker. A Cloudflare Route takes
precedence over a Custom Domain on the same hostname, so this worker owns only the paths above while
every other path keeps serving the existing splash page. Nothing about the live landing page changes —
verified after every deploy.

Moving the whole hostname to this worker is the eventual target (SDD-010 §2), but that requires the
member portal, consent store and D1 schema to exist first.

## Data model

`migrations/` holds the FRS-010 F08 schema: 28 tables, 4 guard triggers and the four catalogs
(272 fields, 18,436 alerts, 107 endpoints, 247 enum values). See `migrations/README.md` for the
storage design.

The one thing to know: **the catalog holds every field Tesla can send; the collected subset is a
flag.** `tesla_field_catalog` carries all 272 fields of `vehicle_data.proto`, of which 14 are marked
`collected = 1`. Widening what we collect later means flipping a flag and re-seeding, not altering a
table — which is why the fact table is narrow rather than one column per field.

```bash
bun run verify:schema      # applies all migrations to a throwaway SQLite db, asserts FRS ACs
```

These migrations are **inert until applied**: no D1 binding exists yet, and repo policy is
CI-only migration application. The binding and the CI apply step have to land together.

## Required configuration

Registered on developer.tesla.com and **authoritative** — Tesla validates these, so they cannot be
inferred at runtime (FRS-010 F02-R14):

| Field | Value |
|-------|-------|
| App name | `AFIRMICO Auto` |
| Allowed Origin | `https://auto.afirmi.co` |
| Allowed Redirect URI | `https://auto.afirmi.co/auth/callback` |
| Allowed Returned URL | `https://auto.afirmi.co/dashboard` |
| Grant types | `client-credentials`, `authorization-code` |
| Registered domain | `auto.afirmi.co` — **not** `afirmi.co` |

Non-secret config lives in `wrangler.json` `vars` (`TESLA_CLIENT_ID`). Secrets are Worker secrets:

```bash
wrangler secret put TESLA_CLIENT_SECRET   # from Bitwarden Secrets, never on disk
wrangler secret put OAUTH_STATE_SECRET    # HMAC key for signing OAuth state
```

`/healthz` reports any that are missing.

## Scopes

`openid offline_access vehicle_device_data` — identity, a refresh token, and read access to vehicle
data. Deliberately **no** `vehicle_cmds`, `energy_cmds`, `energy_device_data` or
`enterprise_management`: the platform collects odometer and FSD kilometres and never acts on the car.
A unit test asserts the command scopes are never requested.

## Key custody (FRS-010 F02-R02)

- The **public** key is committed at `public/.well-known/appspecific/com.tesla.3p.public-key.pem`.
- The **private** key exists only in Bitwarden Secrets (`TESLA_FLEET_PRIVATE_KEY`). Never committed,
  never in D1, never logged.
- **Once registered with Tesla the key pair must not be rotated.** Tesla requires the registered public
  key to remain hosted; rotating it invalidates the key on every paired vehicle and forces each owner
  to re-pair.

## Content type

Served as `application/x-pem-file` per FRS-010 F02-R01. This is no longer an open question: Tesla's
partner-registration call downloaded the key with this type and created the partner record
(2026-10-02), so the value is confirmed in production. Defined once as `PUBLIC_KEY_CONTENT_TYPE`.

## Local development

```bash
bun install
cp .dev.vars.example .dev.vars   # or write your own; .dev.vars is gitignored
bun run dev                      # wrangler dev on localhost
bun run typecheck
bun test
```

`.dev.vars` holds a dummy `TESLA_CLIENT_SECRET` so the redirect/state/PKCE path is exercisable locally.
The real secret is a Worker secret and is deliberately not mirrored to disk, so a **real code exchange
cannot complete locally** — verify that against the deployed Worker.

`wrangler dev --local` does not read remote secrets; without `.dev.vars` the flow returns a `503` with
the missing variable named, rather than an opaque `500`.

## Deploy

```bash
bun run deploy   # wrangler deploy -> afirmico-tesla, attaches the routes
```

## Verification

```bash
B=https://auto.afirmi.co

# key must be PEM (not HTML) and must parse
curl -sD - "$B/.well-known/appspecific/com.tesla.3p.public-key.pem" | head -5
curl -s "$B/.well-known/appspecific/com.tesla.3p.public-key.pem" | openssl ec -pubin -noout -text

# config is complete
curl -s "$B/healthz"          # expect {"status":"ok",...,"problems":[]}

# authorize redirect carries the registered redirect URI and PKCE
curl -sD - -o /dev/null "$B/auth/start" | grep -i '^location:'

# splash must be unchanged
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' "$B/"
```

The served key bytes must match the committed file exactly; the handler reads the asset rather than
duplicating the key as a string.

## Not built yet

Telemetry ingest, the D1 schema, the consent store (F01-R02/R03 — a session is **not** a consent
record), TOCA membership gating, and the admin dashboard. `/toca-connect` is currently **ungated**.

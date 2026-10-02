# AFIRMICO Auto — Tesla Fleet API surface (Tier 1)

Cloudflare Worker that owns the two Tesla-facing paths on `auto.afirmi.co`.

## What it does

| Path | Purpose |
|------|---------|
| `/.well-known/appspecific/com.tesla.3p.public-key.pem` | Serves the Tesla partner public key. Tesla fetches this to verify domain ownership during developer-app registration (FRS-010 F02-R01). |
| `/connect` | Member onboarding entry point. Explains the vehicle-pairing step and hands off to Tesla. |
| `/healthz` | Liveness check for deployment verification. |

## Why a Route, not a Custom Domain

`auto.afirmi.co` is currently bound as a **Custom Domain** to the legacy splash worker. A Cloudflare
Route takes precedence over a Custom Domain on the same hostname, so this worker can own
`/.well-known/*` and `/connect` while every other path on the hostname keeps serving the existing
splash page. Nothing about the live landing page changes.

Moving the whole hostname to this worker is the eventual target (SDD-010 §2), but that requires the
member portal, OAuth callback and D1 schema to exist first.

## Key custody (FRS-010 F02-R02)

- The **public** key is committed at `public/.well-known/appspecific/com.tesla.3p.public-key.pem`.
- The **private** key exists only in the secrets store (Bitwarden Secrets, `TESLA_FLEET_PRIVATE_KEY`).
  It is never committed, never in D1, never in logs.
- **Once registered with Tesla the key pair must not be rotated.** Tesla requires the registered public
  key to remain hosted; rotating it invalidates the key on every paired vehicle and forces each owner
  to re-pair.

## Content type

Served as `application/x-pem-file` per FRS-010 F02-R01. This value is **not yet confirmed** against
Tesla's onboarding validator (SDD-010 O-9). It is defined once, as `PUBLIC_KEY_CONTENT_TYPE` in
`src/index.ts` — change it there if Tesla expects something else.

## Development

```bash
bun install
bun run dev        # wrangler dev on localhost
bun run typecheck
bun test           # key format, curve, ordering, and keypair correspondence
```

## Deploy

```bash
bun run deploy     # wrangler deploy -> afirmico-tesla, attaches the two routes
```

## Verification

```bash
# key must be PEM, not HTML, and must parse
curl -sD - https://auto.afirmi.co/.well-known/appspecific/com.tesla.3p.public-key.pem | head -5
curl -s https://auto.afirmi.co/.well-known/appspecific/com.tesla.3p.public-key.pem \
  | openssl ec -pubin -noout -text

# splash must be unchanged
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' https://auto.afirmi.co/
```

The served bytes must match the committed file exactly; the handler reads the asset rather than
duplicating the key as a string.

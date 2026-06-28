# Functional Requirement Spec: Multi-Tenant Self-Service Onboarding

**Status:** Draft · **Version:** 0.1.0
**Depends on:** PR #21 (merged), tenant provisioning API exists

---

## 1. Objective

Allow new tenants to register themselves via a web form, receive automatic provisioning of KV namespaces, D1 database records, blueprints, and credentials — without admin intervention.

Currently tenant creation requires:
- Admin API call to `POST /api/tenants` (authenticated)
- Manual seeding of `TENANT_KV` entries
- Manual D1 record creation
- No self-service path exists

---

## 2. Current Baseline

### 2.1 Existing Tenant System

| Capability | Location | Status |
|-----------|----------|--------|
| Tenant CRUD API | `src/api/tenants.ts` | ✅ Admin-only POST/GET/DELETE |
| Tenant model | `src/lib/tenant.ts` — `TenantConfig` | ✅ |
| Slug validation | `src/lib/tenant.ts` — `validateSlug()` | ✅ |
| Tenant resolver | `src/middleware/tenant-resolver.ts` | ✅ Hostname/KV-based |
| Default layout seeding | `POST /api/tenants` → KV put | ✅ |
| D1 mirror | `INSERT INTO tenants` on create | ✅ |
| Webhook config | Per-tenant webhook URL storage | ✅ |
| Blueprint system | `src/api/admin-blueprints.ts` | ✅ Admin UI |
| Factory system | `src/api/admin-factory.ts` | ✅ Admin UI |
| Plans | `free` | `pro` | `TenantConfig.plan` | ✅ |

### 2.2 Gaps

| Gap | Impact |
|-----|--------|
| No registration form | Can't sign up without admin |
| No domain provisioning | Custom subdomain not auto-allocated |
| No rate limiting on create | Abuse vector |
| No email verification | Can't validate ownership |
| No API key generation | No programmatic access |
| No onboarding wizard | New tenants have empty config |

---

## 3. Requirements

### 3.1 P0 — Must Have (functional self-service)

**R1 – Registration Form**
- Public GET/POST at `/register`
- Fields:
  - Company name (required, 2-100 chars)
  - Email (required, validated format)
  - Password (required, min 8 chars, min 1 uppercase + 1 digit)
  - Subdomain preference (required, validated via `validateSlug()`, availability checked live via AJAX)
  - Plan selection: Free / Pro (Pro defers to payment — see non-goals)
- CAPTCHA (turnstile or equivalent)
- No admin token required

**R2 – Automatic Provisioning**
On successful registration, the system must atomically:

1. Create tenant record in `TENANT_KV` (`tenant:{slug}`)
2. Create D1 record in `tenants` table
3. Seed default layout + design (same as admin API)
4. Allocate a blueprint reference (default blank blueprint)
5. Generate API credentials (see R3)
6. Log the event to the audit ledger

If any step fails, all must roll back (best-effort — KV is source of truth).

**R3 – API Credentials**
- Generate `API_KEY` (32-byte hex, via `crypto.randomUUID`)
- Store hashed key in `TENANT_KV` (`tenant:{slug}:credentials`)
- Return plaintext key exactly once (on registration success)
- Display in onboarding wizard

**R4 – Onboarding Wizard**
After registration, redirect to a 3-step wizard:

1. **Welcome** — "Your workspace is ready at `https://{slug}.edgegde.com`"
2. **API Key** — Show the key with "Copy" button + warning "This will not be shown again"
3. **First steps** — Links to: calculator docs, admin panel, MCP setup

### 3.2 P1 — Should Have

**R5 – Email Verification**
- Send verification email with 6-digit code
- Account is "unverified" until code is confirmed
- Unverified tenants can't publish or access admin
- Resend cooldown: 60 seconds
- Code expiry: 15 minutes

**R6 – Rate Limiting**
- Per-IP: max 3 registration attempts per hour
- Per-email: max 2 registration attempts per day
- Uses existing rate limiter at `src/lib/rate-limiter.ts`
- Returns 429 with retry-after header

**R7 – Tenant Dashboard**
- After login, show `/tenant/dashboard` with:
  - Current plan and usage stats
  - API key management (regenerate with confirmation)
  - Webhook config UI
  - Team members (future)
  - Billing link (future)

### 3.3 P2 — Nice to Have

**R8 – Custom Domain**
- Allow tenants to configure a custom domain
- SSL certificate provisioning via Cloudflare API
- DNS verification (TXT record)

**R9 – Plan Upgrade**
- Free: 1 site, 3 calculators, 100 API calls/day
- Pro: Unlimited sites, all calculators, 10k API calls/day
- Upgrade via admin panel or Stripe (future)

**R10 – Team Members**
- Invite via email
- Roles: Admin, Developer, Viewer
- Audit log of member actions

---

## 4. Architecture

### 4.1 Provisioning Pipeline

```
Registration Form
  → Validate input (captcha, slug, email format, password strength)
  → Create tenant (KV + D1)
  → Generate credentials
  → Seed default layout/blueprint
  → Queue verification email
  → Return session + API key
```

### 4.2 Database / KV Schema

**TENANT_KV keys:**

```
tenant:{slug}                          — TenantConfig JSON
tenant:{slug}:credentials              — { apiKey, apiKeyHash, createdAt }
tenant:{slug}:email_verification       — { code, expiresAt, attempts }
tenant:{slug}:layout:latest            — Default layout
tenant:{slug}:design                   — Default design config
```

**D1 table addition:**

```sql
ALTER TABLE tenants ADD COLUMN email TEXT;
ALTER TABLE tenants ADD COLUMN verified INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN api_key_hash TEXT;
```

### 4.3 Registration Handler

```typescript
// src/api/register.ts

interface RegistrationRequest {
  companyName: string
  email: string
  password: string           // hashed server-side before storage
  slug: string
  plan: 'free' | 'pro'
  captchaToken: string
}

interface RegistrationResponse {
  tenantId: string
  slug: string
  apiKey: string             // shown once
  dashboardUrl: string
}
```

### 4.4 Email Provider

For MVP, use a lightweight email sending approach:
- Resend.com API (free tier: 100 emails/day)
- Or SendGrid via webhook
- Email template: plain text + minimal HTML
- No dedicated email infrastructure

---

## 5. Implementation Phases

| Phase | Items | Effort |
|-------|-------|--------|
| **1** | Registration form + provisioning pipeline + API key generation | 2d |
| **2** | Onboarding wizard + tenant dashboard | 1.5d |
| **3** | Email verification + rate limiting | 1d |
| **4** | Custom domain + plan upgrade + team members | 1.5d |
| **Total** | | **~6d** |

---

## 6. Open Questions

- Email provider API key: stored where? (wrangler secret vs KV)
- Password storage: bcrypt or argon2? (Workers `nodejs_compat` supports crypto)
- CAPTCHA: Cloudflare Turnstile (free, no privacy concerns)?
- What email address sends the verification? (noreply@edgegde.com?)
- Login session: JWT or session cookie?

These must be answered before Phase 1 implementation begins.

---

## 7. Non-Goals (explicitly out of scope)

- Stripe/payment integration (just plan tracking)
- SAML/SSO
- Multi-region tenant isolation
- Tenant data export / GDPR compliance tooling
- White-label custom branding per tenant

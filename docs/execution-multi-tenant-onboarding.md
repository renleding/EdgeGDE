# EdgeGDE — Multi-Tenant Onboarding: Execution Plan

**Based on:** FRS-multi-tenant-self-service-onboarding.md
**Sequence:** Total 6 days, 8 ordered tasks, 4 explicit gating questions resolved

---

## Gating Answers (locked)

| Question | Answer | Why |
|----------|--------|-----|
| CAPTCHA | Cloudflare Turnstile | Native to Workers, free-tier, no extra dep |
| Session | HTTP-only signed JWT cookie | Works with HTMX, no header plumbing, Workers-compatible |
| Password | WebCrypto PBKDF2 + salt | Available in Workers runtime, no Node deps |
| Email | Resend.com API | Free tier 100/day, simple REST, Workers-friendly |

---

## Task 1 — Registration endpoint + provisioning pipeline (2d)

### 1a — Registration endpoint (1d)

**File:** `src/api/register.ts`

```
POST /register  (public, no auth)
Content-Type: application/json
```

**Request body:**
```json
{
  "companyName": "Acme Corp",
  "email": "admin@acme.com",
  "password": "Str0ng!Pass",
  "slug": "acme-corp",
  "plan": "free",
  "captchaToken": "0x...."
}
```

**Handler logic (strict order):**
1. Validate Turnstile captcha token via Cloudflare API
2. Validate slug via `validateSlug()`
3. Check slug availability in TENANT_KV
4. Validate email format (basic regex)
5. Hash password: PBKDF2 with 32-byte random salt, 100k iterations, SHA-256
6. Generate tenantId via `crypto.randomUUID()`
7. Create `TenantConfig` record → `TENANT_KV.put(tenant:{slug}, ...)`
8. Seed default layout + design (same as admin POST /api/tenants does)
9. Insert D1 record into `tenants` table
10. Generate API key (32-byte hex, `crypto.randomUUID()`), store hash in KV
11. Return 201 with `{ tenantId, slug, apiKey (plaintext), dashboardUrl }`

**Failure semantics:**
- KV write failure → 500, no partial state
- D1 failure → non-fatal (KV is source of truth), log warning
- Slug already taken → 400 with descriptive message

**Verification:**
```bash
curl -X POST https://staging.edgegde.workers.dev/register \
  -H "Content-Type: application/json" \
  -d '{ "companyName":"Test", "email":"t@t.com", "password":"Abc12345", "slug":"test-co", "plan":"free", "captchaToken":"..." }'
# → 201 { tenantId, slug, apiKey, dashboardUrl }

curl -X POST https://staging.edgegde.workers.dev/register -d '...slug:"test-co"...'
# → 400 "slug already taken"
```

**Exit criteria:** Registration endpoint works end-to-end in staging.

### 1b — Password hashing utility (part of 1a, 0d extra)

**File:** `src/lib/password.ts`

```typescript
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }>
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean>
```

Uses `crypto.subtle.importKey` + `PBKDF2` + `SHA-256` (native to Workers).

### 1c — Login endpoint + session cookie (1d)

**File:** `src/api/login.ts`

```
POST /login  (public, no auth)
Content-Type: application/json
Body: { "slug": "acme-corp", "password": "..." }
```

**Handler logic:**
1. Look up tenant by slug in TENANT_KV
2. If not found → 401
3. Load `tenant:{slug}:credentials` from KV (contains `passwordHash`, `passwordSalt`)
4. Verify password via `verifyPassword()`
5. Generate JWT: `{ tenantId, slug, name, iat, exp }` signed with `JWT_SECRET` env var
6. Set HTTP-only Secure cookie named `edgegde_session`
7. Return 200 with `{ tenantId, slug }`

**Middleware for protected routes:**

**File:** `src/middleware/session.ts`

```typescript
export async function requireSession(c: Context, next: Next): Promise<void>
```

- Reads `edgegde_session` cookie
- Verifies JWT signature
- Sets `c.set('tenant', ...)` for downstream handlers
- Returns 401 if missing/invalid

**Verification:**
```bash
curl -X POST https://staging/register -d '...'  # get apiKey
curl -X POST https://staging/login -d '{"slug":"test-co","password":"Abc12345"}' -c cookies.txt
# → 200, sets cookie

curl https://staging/tenant/dashboard -b cookies.txt
# → 200, renders dashboard
```

**Exit criteria:** Login + session middleware works, protected routes return 401 without cookie.

---

## Task 2 — Onboarding wizard + tenant dashboard (1.5d)

### 2a — 3-step onboarding wizard (1d)

**File:** `src/routes/onboarding.ts`

After registration, redirect to:

```
GET /onboarding?step=1&slug=test-co  (requires session cookie)
```

**Step 1 — Welcome**
- "Your workspace is ready at `https://{slug}.edgegde.com`"
- Shows tenant name, plan, created date
- Button: "Next: Get your API key"

**Step 2 — API Key**
- Shows the key in a monospace box
- "Copy" button (JS `navigator.clipboard.writeText`)
- Warning banner: "This key will not be shown again. Store it securely."
- Button: "I've saved it. Next →"

**Step 3 — First steps**
- Links to: calculator API docs, admin panel, MCP setup guide
- "Start building" button → redirects to `/tenant/dashboard`

**State tracking:**
- `TENANT_KV.put(tenant:{slug}:onboarding, '{ "step1": true, "step2": false, "step3": false }')`
- Each step updates the record
- If user returns later, jump to first incomplete step

### 2b — Tenant dashboard page (0.5d)

**File:** `src/routes/tenant-dashboard.ts`

```
GET /tenant/dashboard  (requires session cookie)
```

HTMX page with:
- **Overview card:** tenant name, slug, plan, created date
- **API key card:** show masked key (`abc....def`), "Regenerate" button
- **Usage card:** (placeholder) daily API calls, active missions
- **Webhook card:** current URL, enable/disable toggle
- **Danger zone:** "Delete tenant" (admin-only)

**Verification:**
```bash
curl https://staging/tenant/dashboard -b cookies.txt
# → HTML with overview, API key, webhook sections
```

**Exit criteria:** Wizard completes end-to-end, dashboard renders all sections.

---

## Task 3 — Email verification (1d)

**File:** `src/api/verify.ts`

### 3a — Send verification email

On registration (after step 1a):
1. Generate 6-digit code via `crypto.getRandomValues`
2. Store in `K V.put(tenant:{slug}:email_verification, '{ "code": "...", "expiresAt": ..., "attempts": 0 }')`
3. POST to Resend API: `{ from: "noreply@edgegde.com", to: email, subject: "Verify your EdgeGDE account", text: "Your code: 123456" }`

**Resend API call:**
```typescript
const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: 'EdgeGDE <noreply@edgegde.com>', to: email, subject: '...', text: '...' })
})
```

### 3b — Verification endpoint

```
POST /verify  (public, no auth)
Body: { "slug": "test-co", "code": "123456" }
```

- Load verification record from KV
- Check expiry (15 min)
- Check attempts (< 5)
- Compare code
- On success: update tenant record, mark verified, clear code
- On failure: increment attempts, return 400

### 3c — Resend endpoint

```
POST /verify/resend  (public, no auth)
Body: { "slug": "test-co" }
```

- Check cooldown (60s since last send)
- Generate new code, update KV, call Resend

**Verification:** Email arrives at test inbox, code verified via API, expired codes rejected.

---

## Task 4 — Rate limiting (1d)

### 4a — Rate limit registration

**File:** `src/middleware/rate-limit.ts` (extend existing)

```typescript
// Per-IP: max 3 registrations per hour
// Per-email: max 2 registrations per day

const ipKey = `ratelimit:register:ip:${clientIp}`
const emailKey = `ratelimit:register:email:${hash(email)}`
```

Use existing `RateLimiter` Durable Object or KV with TTL.

On breach:
```json
// 429
{ "error": "Too many registration attempts. Try again later.", "retryAfter": 3600 }
```

### 4b — Rate limit login

```typescript
// Per-IP: max 10 login attempts per 15 minutes
const loginKey = `ratelimit:login:ip:${clientIp}`
```

**Verification:** 4th registration from same IP returns 429.

---

## Task 5 — API key management (1d)

### 5a — Regenerate API key

```
POST /tenant/api-key/regenerate  (requires session cookie)
```

- Confirm dialog (HTMX confirm or separate endpoint with `"confirm": true`)
- Generate new 32-byte hex key
- Store hash in KV
- Return plaintext key (shown once)
- Old key stops working immediately

### 5b — Authenticated request flow

Modify tenant resolution middleware to accept `Authorization: Bearer <apiKey>`:

**File:** `src/middleware/tenant-resolver.ts`

```typescript
// 3. API Key header
const authHeader = c.req.header('Authorization')
if (authHeader?.startsWith('Bearer ')) {
  const key = authHeader.slice(7)
  // Look up tenant by iterating? No — store key → slug mapping
  // Better: store key hash in tenant record, check against it
}
```

**Design decision:** Store `apiKeyHash` on the tenant record itself, so a single KV get of `tenant:{slug}:credentials` can verify. The route must know the slug before authenticating — so API key auth works for routes where `X-Tenant-ID` or hostname already identifies the tenant.

**Simpler alternative:** Add `X-API-Key` header support. The tenant resolver already supports `?tenant=` query param + hostname. Add `X-API-Key` as a third option, lookup the key in a reverse-index KV key `apikey:{hash}` that maps to `{ slug }`.

---

## Task 6 — Custom domain (P2, optional)

See FRS section 3.3 R8. Implement only after core flow is stable.

---

## Task 7 — Plan upgrade (P2, optional)

See FRS section 3.3 R9. Requires billing integration.

---

## Dependencies

```
Task 1a (register endpoint)
  ├── Task 1b (password hashing) — inlined in 1a
  └── Task 4a (rate limiting) — optional, can be added after
Task 1c (login + session) — depends on 1a + 1b
  └── Task 4b (login rate limit) — optional
Task 2a (onboarding wizard) — depends on 1c
Task 2b (tenant dashboard) — depends on 1c
Task 3a (email send) — depends on 1a
  ├── Task 3b (verify) — depends on 3a
  └── Task 3c (resend) — depends on 3a
Task 5 (API key mgmt) — depends on 1a
```

## Critical Path

```
Day 1-2:  Task 1a (register) + Task 1c (login/session)  ← START HERE
Day 3:    Task 2a (wizard) + Task 2b (dashboard)
Day 4:    Task 3a+3b (email)
Day 5:    Task 5 (API key mgmt)
Day 6:    Task 4 (rate limiting), integration test, deploy
```

## Verification (end-to-end)

```bash
# 1. Register
curl -X POST https://staging/register -d '{"companyName":"Test","email":"a@b.com","password":"Abc12345","slug":"demo-co","plan":"free","captchaToken":"..."}'
# → { tenantId, slug: "demo-co", apiKey: "...", dashboardUrl: "/onboarding?step=1&slug=demo-co" }

# 2. Login
curl -X POST https://staging/login -d '{"slug":"demo-co","password":"Abc12345"}' -c cookies.txt
# → 200

# 3. Onboarding
curl https://staging/onboarding?step=2\&slug=demo-co -b cookies.txt
# → HTML showing API key

# 4. Use API key
curl -X POST https://staging/api/v1/loan-repayment \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"principal":500000,"annualRate":6.25,"termYears":30}'
# → 200 { summary: {...} }
```

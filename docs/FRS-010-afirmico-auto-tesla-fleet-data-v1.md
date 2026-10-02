# Functional Requirements Specification (FRS): AFIRMICO Auto — Tesla Fleet Data Platform

**Document ID:** FRS-010  \
**Version:** 1.12  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-10-02  \
**Source:** Requirements interview with Warren (TOCA/AFIRMICO), 2026-09-29 (22 numbered questions answered);
`apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv` (239 fields) and `alert_dictionary.csv`
(18,436 alerts); https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api

---

## 1. Objective

Build the data platform behind **AFIRMICO Auto** — a Tesla Fleet API application that collects
Tesla vehicle and Powerwall data from **TOCA (Tesla Owners Club of Australia) members** under explicit
consent, and makes it available in two controlled forms: **group-level analytics anonymised to postcode**
for insurer market pricing, and **individual-level quote packages** carrying member PII plus a derived
driver profile for a named quote request. The platform is **not** a member-facing app at this stage —
it is the **connector** between member vehicles and the offer pipeline, plus an **admin dashboard** for
the operator. Offers (motor insurance first, then loans and energy) are produced by third parties and
presented back to the member through AFIRMICO Auto; on acceptance the policy is bound to AFIRMICO Auto
and written by the insurer.

The platform MUST store the **complete Fleet API field universe** as a maintained reference catalog
(239 telemetry fields, the full endpoint registry, and the 18,436-entry alert dictionary) even though
only a subset is collected at launch, so that scope can expand without a schema migration.

---

## 2. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-09-29 | Initial specification. Scope confirmed as MVP; polling transport; local telemetry host; 1,500-member target. |
| 1.1 | 2026-09-29 | Corrected the alert dictionary key: `signal_name` is **not** unique (17,579 distinct across 18,436 rows; 853 names carry model-specific variants). Added F03-R04a/R04b and AC7/AC8. Expanded R-02 with verbatim Tesla sourcing and three decision options (R-02a/b/c); corrected an earlier unsupported claim that FSD state could be collected from the vehicle UI. |
| 1.2 | 2026-09-29 | **Clean-slate reset (pre-build).** All parallel prototype work was removed by owner decision — nothing is yet built and the spec is the only artifact of record. Deleted: `apps/tesla-fleet-worker/` (agent p9 prototype), the untracked `.well-known` PEM copy, the `afirmico-tesla-fleet-vehicles` D1 database (contained schema, 0 rows), and the placement of R-08's coordination note. Resolved R-08 accordingly. Corrected F02-R02: the private key is required for **both** Vehicle Commands **and Fleet Telemetry** setup (Tesla: pairing "is required to send Vehicle Commands and setup Fleet Telemetry"), so a keypair is load-bearing if R-02b is chosen. Recorded that the private key **cannot be regenerated** — it is held in Bitwarden and is the only copy. |
| 1.3 | 2026-09-29 | **Corrected a factually wrong claim carried in v1.2.** v1.2 recorded that a Tesla key pair exists in Bitwarden and "cannot be regenerated". Neither is true: Bitwarden holds only the Client ID and Client Secret, and no key pair exists anywhere. The p9 public key was **orphaned** — its private half was never located in the repo, on disk, in the secrets store, or in the retained deletion snapshots (scanned for a `PRIVATE KEY` header; zero occurrences). Re-verified 2026-09-29. Corrected F02-R02, Section 3.3, R-08, and the Dependencies table. Registered the real constraint: a key pair **MUST be generated** before registration, and once registered **MUST NOT be rotated** (Tesla requires the registered public key to *remain* hosted; rotation invalidates the key on every paired vehicle and forces re-pairing). Also clarified that the key pair is required for **registration itself** (F02) — not only for Fleet Telemetry — so it is **not** a discriminator between the R-02 FSD options. |
| 1.4 | 2026-09-29 | **Transport pivot: polling → Fleet Telemetry (owner decision).** The MVP now uses Tesla Fleet Telemetry as its **sole** transport, with a minimal field set (odometer, miles-since-reset, FSD miles-since-reset, battery level, located-at-home/work) and a **6-hour refresh**. This reverses §3.6 and the former Out-of-Scope exclusion. Rewrote §3.6; F04 changed from polling to telemetry ingest; F02 gained pairing, mTLS-relay and billing-limit requirements; F05 gained FSD counter-reset semantics (F05-R14). **R-02 RESOLVED** — `SelfDrivingMilesSinceReset` is a telemetry field, so F05-R03 is satisfied with no proxy or approximation; options R-02a/b/c withdrawn. **R-07 made worse** — under polling there were no telemetry configs to lose, but a billing-limit breach now de-configures every member vehicle and Tesla does not restore them; mitigation is now a launch blocker. **Cost, measured rather than estimated:** the field set yields ~525 signals/vehicle/month → $0.0035/vehicle/month → **$5.25/month for 1,500 vehicles**, fully absorbed by Tesla's $10/month account credit, so Tesla API cost is nil and total system cost is the infrastructure line. Design recorded in SDD-010. |
| 1.5 | 2026-10-02 | **Hosting decision: Tier 1 is a NEW dedicated Cloudflare Worker (owner decision).** Investigated the live `auto.afirmi.co` binding and found it is a Workers **Custom Domain** (not a route) → worker `aged-cherry-8781`, a catch-all that returns one ~3,721-byte HTML document for *every* path (including the `/.well-known` key path), with **zero bindings** (no D1/KV/R2) and no declaring config in the repo. Owner ruled it is the calculator/splash worker and **must not be repurposed for Tesla**. Corrected §3.1 and §3.5, which previously implied `edgegde-calculator` would host the Tesla surface. Tier 1 is now specified as a new worker that owns the `auto.afirmi.co` hostname, which serves the Tesla key ahead of its own SPA fallback and so removes the route-separation conflict in F02-R01 by construction. No build performed — owner decision was that the key is **not** shipped ahead of the full Tier 1 work. Recorded new open item O-9 (public-key `Content-Type` contradiction: F02-R01 `application/x-pem-file` vs SDD `text/plain`). |
| 1.12 | 2026-10-02 | **Group-level anonymised analytics is built (F06, P1) — and building it surfaced a defect that would have made every export useless without ever raising an error.** `src/analytics.ts` plus `POST /analytics/group-export` now produce postcode-level aggregates with a recorded SHA-256, a persisted export log, and stated caveats. **(1) The defect: F06-R03 was silently unsatisfiable.** The first version read `tesla_vehicle.model` and fell back to `'Unknown'`. That fallback was reached *every time*, because `upsertVehicles` writes only `vin`, `display_name`, `first_seen_at` and `last_seen_at` — no production code path has ever populated `model`. Every export would therefore have segmented the entire membership into a single cell called `Unknown`: F06-R01 satisfied to the letter, F06-R03 defeated, and nothing anywhere reporting a problem. It was found by inspecting the *writers* of the column rather than reading the analytics code, which looked correct. Segmentation now reads the once-tier snapshot, which is where `CarType` actually lands, and every row carries a `segment_source` so a resolved model is distinguishable from a derived one. **(2) Model year does not exist in Tesla's data.** Verified against the seeded 272-field catalog: no model-year field, and `Version` is firmware rather than model year. It is derived from VIN position 10 per ISO 3779 and **disclosed as derived** — a `model_year_derived` caveat counts the affected vehicles, because a derived year is a weaker claim than a reported one. **(3) F06-AC6 was not satisfied and could not be checked.** AC6 requires the dataset generation run to be traceable. The intended chain was fact → batch → run, but `tesla_telemetry_batch` had **no run_id column**, so a fact could reach its raw payload in R2 and never the run that ingested it. Two things hid this: the run id *is* stored in the R2 object's `customMetadata`, but only as a forensic breadcrumb, not a queryable relation; and the test harness seeded no batches, so the lookup returned an empty list — which reads as "no runs in this window" rather than "the join is broken". Migration `0010` adds the link, the ingest handler now writes it, and the harness seeds a real run→batch→fact chain to prove it joins. **(4) A wrong claim of my own, withdrawn before it shipped.** A draft migration comment asserted the run id was derived from an ISO-8601 timestamp and could collide within a millisecond. Both halves were false: `startIngestRun` uses `newId()`, a 48-bit millisecond timestamp plus 80 bits of randomness. The claim was removed rather than left standing in a migration. **(5) Two Must/Should conflicts resolved explicitly.** F06-R04 (Must) requires a single-member cohort to be published with no minimum size, while F06-R08 (Should) asks for small cells to be suppressed. Must beats Should, so nothing is suppressed — instead every small cell is counted, returned in a response header, and persisted, so "was the operator warned?" is answerable later rather than being a claim about a console message nobody kept. And **charging behaviour distribution is removed from F06-R05**: the energy scopes were never granted, so no charging datum exists and the metric was cut rather than invented. **Two things stated rather than hidden.** PII is prevented *structurally*: output rows are a `GroupRow` type whose fields are all numbers or non-PII strings, so a VIN or member id cannot be attached because no field can carry one — and the F06-N01 scan asserts against the real PII values from the source data, with a test proving the scan *can* fail (a scan that never fires proves nothing). **And the live endpoint is deployed but NOT exercised end to end** — the auth gate is verified (401/400) but no group export has been pulled in production, because there is no telemetry data to aggregate until the Oracle relay exists. Verification: 135 unit tests (33 new), `verify-store.ts` 137/137 (including a real run→batch→fact chain), `verify-schema.sh` 43/43, typecheck clean. Aggregation version moved `1.0.0` → `2.0.0` because the output columns changed, so v1 and v2 reports cannot be reconciled and the version is the only thing that says so. |
| 1.11 | 2026-10-02 | **F01-R05 is built — the last schema column that nothing wrote to now has a path into it.** Since v1.8 `tesla_member.mobile` and `.postcode` existed but were never populated, which quietly broke three things: F06 group aggregates had no postcode to segment on and could not be produced at all, the insurer package (F07-R01) shipped a blank where the insurer expects contact details, and nothing surfaced either fault until a release was attempted. The cause is structural rather than an oversight — the Tesla OAuth handshake returns a subject, an email and a name, and **none of those is a phone number or a postcode**, so it has to be asked for. `/details` now collects both and the dashboard prompts until they are present. Two failure modes are written against explicitly. (1) **A postcode losing its leading zero:** Australian postcodes include `0200` and `0800`, and stored through anything that coerces to a number `0800` becomes `800` — not a postcode but a phantom bucket that aggregates Northern Territory members with nobody and reports it as a real segment. Both normalisers return `string`, never `number`, and a test pins it plus an assertion that the D1 round trip preserves the text. (2) **One human becoming two members:** `0412 345 678`, `+61 412 345 678` and `0412345678` are one number; stored as typed, a member's enquiries split across three spellings and the same person can be matched twice. Input normalises to E.164. **A bug in the normaliser itself was caught by its own test:** the first version required a 10-digit local form and so rejected `+61 412 345 678`, because the national significant number is 9 digits, not 10 — the argument for writing the all-spellings test first. Deliberate choices: both fields are required together (a half-saved profile is the ambiguous state that makes release unpredictable); a refused save leaves both fields untouched, asserted rather than assumed; re-submitting identical values is not a change so the audit trail does not churn; the audit row records which fields changed and **never their values**, because an audit table should not become a second place personal data has to be protected. Verification: 106 unit tests (20 new), `verify-store.ts` 104/104 (11 new, against the real migrations), `verify-schema.sh` 41/41, typecheck clean; live `GET /details` 303 to `/connect` without a session, splash unchanged at 3,721 bytes. **Not verified:** the authenticated form path (session present, and the `400` on bad input) is not exercised live, since that needs a real Tesla authorisation — the validation logic is covered against the real database but the route's error branch is not. |
| 1.10 | 2026-10-02 | **Quote package, consent-based release and policy binding are built (F07, P0), and a consent gate that silently did not apply has been fixed.** The release path is where personal data leaves the system, so the build treats the gate and the audit row as the feature and the CSV as the easy part. What exists: `POST /quote/request` builds the member's package and returns a single-use, time-limited link; `GET /download/:token` serves it from R2 with `no-store`; `POST /quote/response` records an insurer's offer; `POST /quote/decide` records the member's decision and, on acceptance, binds the policy in the same batch. **A real bug was found by testing, and it was the dangerous kind.** Revocation was checked at download time by resolving the member through `tesla_quote_request.release_id` — but that back-reference only exists when a quote-request row happens to have been written. A package built without one therefore skipped the consent re-check entirely and kept downloading after the member revoked: a consent gate that reads as enforced and does not apply, which is worse than no gate at all. Releases now record `subject_member_id` and `subject_vin` directly (migration 0008), so the check is unconditional, and a quote package with no recorded subject is **refused** rather than disclosed. Other properties held: the download token is stored only as a SHA-256 hash and is single-use (replay → `already_used`); an expired link → `expired`; a token minted while consent was live stops working the moment consent is revoked (`consent_revoked`, F07-N03); release and its audit row are written in one batch so they cannot diverge (F07-N01); and the CSV is RFC 4180-escaped and byte-reproducible with a recorded SHA-256 (F07-R04, F06-R06). **F01-R05 is now satisfiable** — `tesla_member.mobile` and `.postcode` exist (added in migration 0005) and are filled by an onboarding step, because the Tesla handshake returns a subject, an email and a name and none of those is a mobile or a postcode. They are deliberately NULLable: an empty-string postcode would aggregate into a real bucket named `""` and corrupt F06 output, whereas NULL can be excluded from a release with a visible reason. **Still open:** TOCA membership verification (F01-R01) is by network position only, the onboarding step that actually collects mobile/postcode is not built, and no insurer integration exists to call `POST /quote/response`. Verification: `verify-store.ts` 93/93, `verify-schema.sh` 41/41, 94 unit tests, typecheck clean; live gates confirmed in production (no secret → 401, wrong secret → 401, unknown request → 404, bad download token → 410). |
| 1.9 | 2026-10-02 | **Telemetry ingest and driver-profile derivation are built, and three requirements that could not be satisfied have been withdrawn.** (1) **Ingest (F04)** — `POST /ingest/telemetry` accepts relay payloads and owns every decision: tier routing, consent gating, cost metering, the run log, and the raw-payload archive to R2. Live-verified against production: a payload for an unconsented VIN writes **zero** fact rows and is recorded as a `failed` run with `unknown_vehicle`, while the raw bytes are still archived for replay. Refusals are recorded per field with a distinct reason — `unknown_field` (Tesla added a signal we have not catalogued), `not_collected` (the consented scope working as intended), `invalid_value` (the vehicle declined the signal) — because otherwise "correctly narrow" and "silently broken" are indistinguishable from outside. (2) **Derivation (F05)** — distance, FSD share, counter-reset handling, confidence and per-metric provenance, deterministic (identical input → byte-identical output). The FSD share is a ratio of the two since-reset counters and is **never** a distance; where either is missing the profile reports `unavailable` **with a reason** rather than substituting an estimate. Two real bugs were found by testing and fixed: a single observation produced a `0 km` distance — a *fabricated claim* that the vehicle did not move — now reported as unknown; and a window whose collection began mid-period could never yield a profile at all, now opened from the first in-window reading. (3) **Three Must requirements withdrawn as unsatisfiable, not quietly dropped.** **F04-R05** demanded speed, gear, power, brake/pedal, acceleration, TPMS, climate and seat-belt fields while **F04-R01a** (same document) forbade high-frequency behaviour fields and the owner's decision was explicit — odometer and FSD kilometres only. Two Musts could not both hold; R05 is withdrawn and replaced by **F04-R05a** (the collected set MUST equal the consent text's field set). **F04-R08** (Powerwall) is withdrawn because the Tesla app was seeded without the energy scopes, so it is deferred rather than silently failing. **F05-R05/R06** (charging behaviour, home-charging indicator) are withdrawn with it. New migration `0007` adds `tesla_ingest_run`, `tesla_ingest_rejection` and a billing-position view. Verification: `verify-store.ts` 72/72 (runs the real ingest and derivation against the real schema), `verify-schema.sh` 40/40, 83 unit tests. **Not yet reachable in production:** nothing calls the ingest endpoint until the Oracle relay exists (F02-R10/R11), and `/ingest/*` is authenticated by a shared secret but not by mTLS. |
| 1.8 | 2026-10-02 | **The member onboarding flow now persists to D1, and a consent step that did not exist has been added.** The OAuth flow shipped in v1.6/v1.7 completed a Tesla handshake and stored everything in KV — the session, the refresh token, the vehicle list. KV is a cache with TTL eviction and no query surface, so **a member who connected left no durable record at all**: no member row, no consent, no token. That means F01-R02/R03 (consent), F01-R05 (member record) and F02-R05 (token lifecycle) were **not satisfied by a flow that appeared to work end to end**. Four changes. (1) **Consent is now captured before Tesla is involved** — `/connect` presents a versioned authorisation text and `/auth/consent` records acceptance prior to the handshake, so a member who abandons at the Tesla screen still has a consent row on the record. (2) **The consent text is authoritative in `src/consent-policy.ts`** and its SHA-256 is recorded on both `tesla_consent.policy_sha256` and `tesla_consent_policy`, with a generated seed migration (`0006`) and an assertion at `/healthz`. F01 AC5 ("the portal shows the exact text agreed to, byte-identical to the stored version") is now mechanically checkable rather than a matter of trust; a divergence reports `STALE_TEXT_HASH` instead of passing silently. (3) **Member, vehicle, consent, session and audit records persist to D1**, and the callback **fails loudly** rather than redirecting to a dashboard implying success if persistence fails — an unrecorded grant is a compliance problem. (4) **Refresh tokens are stored encrypted** (AES-GCM, `TOKEN_ENCRYPTION_KEY` as a Worker secret) with the rotated-out token retained in `previous_*` for the 24h grace window, because losing a rotated refresh token strands the member and Tesla rate-limits re-authorisation. New migration `0005` adds `tesla_oauth_token` and `tesla_consent_policy`; F02-R05/R06 are now built. **Two honest gaps remain: F01-R01 (TOCA gating) is NOT built** — `/connect` is public, so gating is by network position alone — **and F01-R05's mobile and postcode are not collected**, because the Tesla handshake supplies neither. Both remain launch blockers, not details. Verification: `verify-schema.sh` 38/38 and a new `verify-store.ts` (35/35) which runs the real `store.ts` against the real migrations and asserts the guard triggers fire, so a column renamed in one and not the other fails CI instead of failing at member-connect time. |
| 1.7 | 2026-10-02 | **Data storage model built (F08) and the catalog corrected from 239 to 272 fields.** Two changes of substance. (1) **The field universe was under-counted.** F03/F08 specified the catalog as the 239 rows of `fleet_streaming_fields.csv`, but that CSV is not the authoritative source — Tesla's own `vehicle_data.proto` (teslamotors/fleet-telemetry) defines **272** Field entries. The 33 absent from the CSV include whole firmware-2026.32 additions (`GpsAccuracyMeters`, `NominalFullPackEnergyKwh`, `SoftwareUpdateInProgress`, `RemoteStartActive`, and others) plus `ScheduledDepartureTime` and `LifetimeEnergyGainedRegen`, whose absence from the CSV appears to be a documentation gap rather than a deliberate exclusion. Had we shipped the CSV alone, the first vehicle reporting any of them would have forced a migration — exactly what F03-R07 exists to prevent. The catalog is now the proto universe: 272 rows, 14 collected, 258 retained with `collected = 0`. F03-N01, F03 AC1, F08-R05 and F08 AC7 updated accordingly. (2) **The F08 schema is implemented** — 28 tables, 4 guard triggers, all four catalogs seeded, verified by `scripts/verify-schema.sh` (32/32 checks, exit code = failures). Corrections made while implementing: the alert catalog is keyed on the composite `(signal_name, models)` per F03-R04a, not on `signal_name`; `tesla_afirmico_site` and the fact-side energy snapshot were **withdrawn** because F02-R09 seeds the app with `energy_device_data` and `energy_cmds` **not** requested, so Powerwall data cannot be collected by this integration (F08-R07 is marked deferred, not dropped); there is one raw-payload table, not two; and the fact table rejects rows for uncollected fields or the wrong collection tier in the database rather than trusting application code (new F08-R13). **Not applied** — no D1 binding exists yet and migrations are CI-only, so these files are inert until the binding and the CI apply step land together. |
| 1.6 | 2026-10-02 | **R-01 CLEARED — the Tesla app is created, approved, registered, and the member OAuth flow is live.** Four corrections of prior fact, plus the first working build. (1) **The developer application existed all along** — it was created on developer.tesla.com on 2026-09-25 (its Client ID and Secret were vaulted that day); v1.5's "app not yet created" was wrong. (2) It is **ACTIVE** and the onboarding request was approved 2026-10-02 on the **proprietary/private** path (`Open Source Contribution: No`), with grants `client-credentials` **and** `authorization-code` — the same shape F02-R04 already required, so no requirement changed. (3) **Partner registration completed 2026-10-02** via `POST /api/1/partner_accounts`; Tesla recorded the app as `AFIRMICO Auto`, `enterprise_tier: pay_as_you_go`, and the public key it stores (`047ca1f0…b483d8`) is **byte-identical to the committed PEM** — which also **settles O-9 / R-14**: Tesla's own registration fetch succeeded with `Content-Type: application/x-pem-file`. **`auto.afirmi.co` is registered; `afirmi.co` is NOT** (Tesla's key-path fetch there returns 404 — nothing else needs registering). (4) **Tier 1 F02 surface is BUILT and LIVE** in `apps/afirmico-tesla/` — public key, `/connect`, `/auth/start` (PKCE S256), `/auth/callback`, `/auth/error`, `/dashboard`, `/auth/logout`, `/healthz` — attached as Cloudflare **Routes**, so the splash page is untouched (`/` still returns the original 3,721-byte document). Added F02-R14 (registered app config is authoritative) and F02-R15 (PKCE mandatory on the authorization-code flow); added the contact address `connect@afirmico.com` to the Dependencies table. **Still open:** telemetry ingest, the D1 schema, TOCA membership gating (F01), the admin dashboard (F07), and the Oracle relay; and note that a grant recorded on a session cookie is **not yet a consent record** (F01-R02) — session state is infrastructure, not the audit trail. |

---

## 3. Current Baseline

### 3.1 Public web surface

`https://auto.afirmi.co/` is live and serves a static splash page. The hostname is bound as a Workers
**Custom Domain** (not a route) to the Cloudflare Worker `aged-cherry-8781` in the **renleding** Cloudflare
account (confirmed owner: Warren; re-verified 2026-10-02). The mapping is a catch-all: `/`,
`/auth/callback`, `/dashboard`, `/api/health`, `/.well-known/mcp.json` and
`/.well-known/appspecific/com.tesla.3p.public-key.pem` all return the same ~3,721-byte HTML document.
The worker has **no bindings at all** (no D1, KV, or R2) and **no config in this repository declares it**.

**Gap:** ~~There is no Tesla OAuth callback handler... and the `.well-known` public key path is shadowed
by the SPA fallback.~~ **Superseded at v1.6.** The `/.well-known` key path, `/connect`, `/auth/*`,
`/dashboard` and `/healthz` are now served by the dedicated worker `afirmico-tesla`
(`apps/afirmico-tesla/`) via Cloudflare **Routes**, which take precedence over the Custom Domain. The
key path is no longer shadowed and the splash page is unchanged. What remains absent: telemetry
ingest, the D1 schema, the consent store, TOCA membership gating, and the admin dashboard. See §3.5
and SDD-010 §2.

`aged-cherry-8781` cannot take that role — it has no bindings and is the calculator/splash worker, which
the owner has ruled **must not be repurposed for Tesla** (see §3.5 and SDD-010 §2).

### 3.2 Credential state

Tesla Fleet API **client id and client secret** exist in Bitwarden Secrets (project accessible to
the agent). ~~The Tesla developer application itself has **not yet been created** on
developer.tesla.com — the credentials were provisioned ahead of app creation.~~

**Corrected twice at v1.6.** The developer application **was** created on developer.tesla.com on
**2026-09-25** — the credentials were not provisioned ahead of it; they were issued by it. It is
**ACTIVE**, and its onboarding request was **approved on 2026-10-02**.

Registered application configuration (authoritative — Tesla enforces this):

| Field | Value |
|-------|-------|
| App name | `AFIRMICO Auto` |
| Client ID | `f03d04ed-a6b0-43b3-bda4-5c19dec5dd2b` (public; also in `wrangler.json` `vars`) |
| Open Source Contribution | `No` — proprietary path |
| OAuth grant types | `client-credentials`, `authorization-code` |
| Allowed Origin(s) | `https://auto.afirmi.co` |
| Allowed Redirect URI(s) | `https://auto.afirmi.co/auth/callback` |
| Allowed Returned URL(s) | `https://auto.afirmi.co/dashboard` |
| Registered domain | `auto.afirmi.co` only — **not** `afirmi.co` |
| Partner tier (Tesla) | `pay_as_you_go` |
| Contact | `connect@afirmico.com` |

The redirect URI is a **single registered value, not a wildcard**, so it must match byte for byte and
the token exchange must present the same value. Region is **not** free to vary either: Australia has no
regional host of its own — APAC excluding China shares the North America base — so
`https://fleet-api.prd.na.vn.cloud.tesla.com` is the only valid `audience` for this app (F02-R08).

Partner registration **completed 2026-10-02.** Tesla's partner record for the app: name `AFIRMICO Auto`,
`enterprise_tier: pay_as_you_go`, `account_id` `2988373b-3db3-4436-bdfb-dcd204cfd4fb`, and
`public_key` `047ca1f0…b483d8` — **byte-identical to the committed PEM**. Registration requires the key
to be reachable at `/.well-known/` *before* the call, which is why the hosting fix (F02-R01) had to land
first.

**Gap:** ~~Without a created (and approved) developer application, no partner registration, token
exchange, telemetry config, or vehicle enumeration is possible.~~ **Closed at v1.6** — a
`client_credentials` exchange against `fleet-auth.prd.vn.cloud.tesla.com` succeeds and returns a live
token. What remains is the **telemetry** side (§3.5) and the consent audit trail: a grant held in a
Worker session is operational state, **not** the versioned consent record F01-R02/R03 require.

### 3.3 Local key material

**No key material exists in the repository.** An EC P-256 public key was previously produced by a
parallel agent session (agent p9) at
`apps/edge-runtime/public/.well-known/appspecific/com.tesla.3p.public-key.pem` (178 bytes, valid SPKI
header `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...`), untracked. It has been **deleted** as part of the
pre-build clean-slate reset (§2, v1.2). A byte-identical copy existed in the p9 prototype app, also deleted.

**Crucially, that public key was orphaned.** Its private half was never located — not in the repository,
not on disk, not in the secrets store, and not in the pre-deletion snapshots (scanned for a `PRIVATE KEY`
header; zero occurrences). An unpaired public key with no private half cannot sign anything and can never
be paired with a vehicle. It is not recoverable and it is not useful.

**Gap:** No public key is hosted, and **no key pair is held in any form**. A fresh EC P-256 (secp256r1) key
pair **MUST be generated** when F02 is built:

```
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem
```

The private half is stored in the secrets store and never committed; the public half is committed under
`public/.well-known/appspecific/`.

**The real constraint is rotation, not generation.** Tesla requires the registered public key to *remain*
hosted at `/.well-known/`. Regenerating the pair **after** registration invalidates the key registered on
every device already paired, forcing each owner to re-pair. Generate once, freeze, and never rotate without
a deliberate re-pairing migration. See F02-R02 and R-08.

Verified 2026-09-29 against three independent sources: Bitwarden Secrets (Tesla entries are Client ID and
Client Secret only — no key pair), a filesystem scan for `*.pem` under `apps/` and `~/.hermes`, and the
retained pre-deletion snapshots.

### 3.4 Reference data available in-repo

| File | Rows | Shape |
|------|------|-------|
| `apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv` | 239 | `Field, Category, Type, Vehicle Data Equivalent, Description, Proto Enum Name` |
| `apps/EdgeGDE - Document DB/Tesla APP DB/alert_dictionary.csv` | 18,436 | `SignalName, Condition, ClearCondition, Description, PotentialImpact, CustomerFacingMessage1, CustomerFacingMessage2, Audiences, Models` |

Field universe by category: Charging 56, Powertrain 35, Vehicle State 32, Climate 29, Service 19,
Safety 14, Vehicle Configuration 14, Location 13, Driving 11, Media 11, User Preference 5.
Types: real 89, enum 50, boolean 46, integer 27, string 17, timestamp 6, Location 3, time 1.
123 of 239 fields carry a legacy `vehicle_data` equivalent; 46 reference proto enums.

**Gap:** Neither file is ingested, versioned, or exposed to any consumer. There is no D1 schema.

### 3.5 Edge runtime

`apps/edge-runtime/wrangler.json` (worker `edgegde-calculator`) binds three D1 databases:
`DB → ebroker_leads`, `D1_PERSONAL → doc-intel-personal-staging`, `D1_AFIRMICO → doc-intel-afirmico-staging`.
Migrations `0001`–`0027` are applied and in sync. **Routes are unset** (`"routes": null`).

**Gap:** No Tesla-domain migration exists; `D1_AFIRMICO` carries document-intelligence tables only.
The Worker has no custom-domain or route binding for `auto.afirmi.co`.

**This worker is NOT the Tesla host.** `edgegde-calculator` is the mortgage-calculator app; its D1
bindings point at document-intelligence databases, and the owner has ruled it out as the Tesla surface.
Tier 1 is a **new, dedicated worker** that owns `auto.afirmi.co` and carries its own D1 (`D1_TESLA`) and
R2 (`R2_TESLA`) bindings per F08-R09 — see SDD-010 §2 and §5. The precedent for serving a `/.well-known`
file ahead of the SPA fallback already exists in this repo: `apps/edge-runtime/src/index.ts` registers
`GET /.well-known/mcp.json` as an explicit Hono route before the catch-all.

### 3.6 Telemetry transport decision

**The MVP uses Tesla Fleet Telemetry as its sole transport** (owner decision, v1.4). `vehicle_data`
polling is withdrawn: it is explicitly documented by Tesla as not recommended and expensive, and it
cannot return FSD usage at all. Vehicles push to a self-hosted `fleet-telemetry` server on a **6-hour
refresh**, and the vehicle sleeps between sends.

This **reinstates** the previously identified hosting constraint: a `fleet-telemetry` server must
terminate client-certificate mTLS on port 443 and is a long-lived stateful process, so it cannot run on
Cloudflare Workers. It runs on **one small relay host** that owns no data and no business logic
(see SDD-010). Pairing a virtual key to each vehicle is now **required**, where polling did not strictly
need it.

**Cost is dominated by field intervals, not by transport.** Signals bill on change, gated by a
per-field `interval_seconds`, and only while the vehicle is awake. A 6-field set at a 6-hour interval
yields ~525 signals/vehicle/month. High-frequency behaviour fields were rejected on cost grounds: the
same platform collecting them at 60 s costs roughly 39× more.

**Open:** whether `interval_seconds` accepts 21600 (6 h); the documented examples cover 1–60 s and a
10-minute case. If rejected, the fallback is 3600 (1 h), which remains inside the account credit.
See SDD-010 §4.1 and §9.

---

## 4. Requirements

### 4.1 FEATURE-01: Member Identity, Consent & Onboarding

**Priority:** P0  \
**Effort:** Medium (~4 days)

**User Story:** As a TOCA member, I link my Tesla account to AFIRMICO Auto and grant standing consent
to release my data to third parties for the purpose of finding me an offer; as the operator, I can prove
exactly what was consented to and when.

**Effort:** Medium (~4 days) — **member onboarding built 2026-10-02** in `apps/afirmico-tesla/`:
consent capture with a versioned, hash-verified policy text (F01-R02/R03, AC5), durable
member/vehicle records (F01-R05), member-visible consent state and revocation (F01-R04/R07).
**TOCA membership gating (F01-R01) is NOT built** — `/connect` is public, so gating is by network
position only and remains a launch blocker. Mobile and postcode (F01-R05) are not collected: the
Tesla handshake supplies neither, so an onboarding step is still required for them.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | The platform MUST authenticate members exclusively through the TOCA member funnel; non-TOCA members MUST be admitted through a separate paid tier. **Amended (v1.12) — membership is deliberately NOT verified (owner decision, 2026-10-02):** the funnel is enforced by network position alone. The URL sits behind the TOCA member site, and only members are given it. There is no membership-number check, no API call, and no manual admin verification. **The consequence MUST be understood by anyone reading this later:** with no membership proof, `toca_status` remains `unknown` for every member (the column's default, `CHECK (toca_status IN ('unknown','verified_toca','non_member','lapsed'))`), so the tier cannot be derived from it and the $250 non-member price cannot be enforced in software. Anyone holding the URL receives the TOCA-member treatment. That is an accepted risk for launch, not an oversight, and it is the first thing to revisit if the link becomes public or is shared outside the club. | Must |
| F01-R02 | The platform MUST record a standing consent from the member to AFIRMICO to release data to third parties for the purpose of obtaining offers, modelled on a credit-assistance-style authorisation, with no fixed expiry. | Must |
| F01-R03 | Consent MUST be versioned; each record MUST store the consent text version, timestamp, IP, and user agent. | Must |
| F01-R04 | Consent MUST be revocable by the member at any time, with the revocation timestamp recorded. | Must |
| F01-R05 | The platform MUST store, per member: name, email, mobile, residential postcode, TOCA membership status, and tier. **Built (v1.11):** name, email, TOCA status and tier come from the Tesla handshake and onboarding; `mobile` and `postcode` are collected by `/details` (`src/onboarding.ts`), since the handshake supplies neither. Both are normalised before storage — the mobile to E.164 so the spellings of one number cannot become two members, and the postcode kept as a string so a leading zero survives (`0800` coerced to a number becomes `800`, a phantom bucket in F06). Existing members are prompted on the dashboard until they complete it. | Must |
| F01-R06 | The platform SHOULD capture residential postcode separately from vehicle GPS location, and MUST use residential postcode for all anonymised group-tier aggregation. | Should |
| F01-R07 | The member MUST be able to view the current consent state, the field set collected, and the third parties that have received their data. | Must |
| F01-R08 | The onboarding flow SHOULD complete the TOCA membership check, consent capture, and Tesla OAuth handoff within a single uninterrupted session. | Should |
| F01-R09 | The platform SHOULD accept a member record created by the paid non-TOCA tier without a TOCA membership reference. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F01-N01 | Onboarding drop-off from first page to completed consent | < 30% |
| F01-N02 | Consent record durability | append-only; no destructive update |
| F01-N03 | Consent audience | Australian Privacy Act 1988 APPs; APP 8 cross-border disclosure on Tesla (US) and insurer recipients |

**Acceptance Criteria:**

```text
AC1: A TOCA member completes consent and Tesla OAuth; tesla_consent has one row with consent_version,
     granted_at, ip, user_agent and no revoked_at.
AC2: The same member revokes consent; revoked_at is set, the prior row is not mutated, and no further
     collection occurs for that VIN.
AC3: Re-granting consent creates a new versioned row; the full consent history remains queryable.
AC4: A member with no TOCA reference is admitted via the paid tier and is not blocked by the membership check.
AC5: The member portal shows the exact consent text version the member agreed to, byte-identical to the stored version.
```

---

### 4.2 FEATURE-02: Tesla Fleet API Client (App Registration & Token Lifecycle)

**Priority:** P0  \
**Effort:** Medium (~4 days) — **app created, approved and registered 2026-10-02; the key-serving, registration, partner-token, member OAuth parts AND the member-scope token store (F02-R05/R06) are built and live in `apps/afirmico-tesla/`.** Refresh tokens are persisted encrypted (AES-GCM) with rotation grace. Remaining effort is the telemetry config path (F02-R10/R11), which is gated on the Oracle relay.

**User Story:** As the operator, the platform holds a valid Tesla partner token and can enumerate
member vehicles and energy sites on demand.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | The platform MUST serve the Tesla public key at `https://auto.afirmi.co/.well-known/appspecific/com.tesla.3p.public-key.pem` with `Content-Type: application/x-pem-file`, excluded from the SPA fallback. | Must |
| F02-R02 | The platform MUST generate an EC P-256 (secp256r1) key pair and hold it outside the repository, storing the private key in the secrets store and never committing it. **No key pair currently exists** — one MUST be generated before registration. Once the public key is registered with Tesla it MUST NOT be rotated: Tesla requires the registered key to *remain* hosted at `/.well-known/`, and rotation invalidates the key on every paired vehicle, forcing each owner to re-pair. The key pair is required for **registration itself** (F02-R03) — not only for Vehicle Commands and Fleet Telemetry — so it is **not** a discriminator between the R-02 options. | Must |
| F02-R03 | The platform MUST register as a Tesla partner via `POST /api/1/partner_accounts` using a partner authentication token, and MUST succeed before any telemetry or vehicle call. | Must |
| F02-R04 | The platform MUST obtain tokens via `client_credentials` for partner-scope calls and `authorization-code` (with PKCE) for member-scope calls, against the region base URL `https://fleet-api.prd.na.vn.cloud.tesla.com`. | Must |
| F02-R05 | The platform MUST refresh and persist tokens, and MUST NOT block a scheduled collection run on a token refresh failure — the run MUST be deferred and alerted. | Must |
| F02-R06 | The platform SHOULD store the client id, client secret, partner token, and member refresh tokens as Worker secrets or in the secrets store, never in D1 in plaintext. | Should |
| F02-R07 | The platform MUST handle Tesla application approval status as an explicit state, surfacing "app not approved" distinctly from "token invalid". | Must |
| F02-R08 | The platform SHOULD route all fleet and vehicle calls through the single region base URL for AU (Asia-Pacific excluding China shares the NA base). | Should |
| F02-R09 | The platform MUST pair its virtual key to each member vehicle, and MUST detect and surface the states `paired`, `removed`, and `unknown` per VIN. Pairing is user-in-the-loop via `https://tesla.com/_ak/auto.afirmi.co` and cannot be completed by the platform alone. | Must |
| F02-R10 | The platform MUST host a `fleet-telemetry` receiver that terminates client-certificate mTLS on port 443, and MUST validate its certificate chain before any vehicle is configured. | Must |
| F02-R11 | The platform MUST configure each vehicle's telemetry via the vehicle-command HTTP proxy, signed with the application private key, and MUST record `skipped_vehicles` reasons per VIN as distinct states (`missing_key`, `unsupported_hardware`, `unsupported_firmware`, `max_configs`). | Must |
| F02-R12 | The platform MUST remove a vehicle's telemetry configuration on consent revocation, so collection ceases at the vehicle rather than by discarding inbound data. | Must |
| F02-R13 | The platform MUST maintain a billing-limit safety margin at least 10× projected monthly usage, MUST wire Tesla's 80% and 100% billing alerts to the operator, and MUST provide a tested runbook to re-apply telemetry configurations after a limit breach. | Must |
| F02-R14 | The registered Tesla application configuration MUST be treated as authoritative and MUST be kept in step with the deployed Worker: app name, client id, allowed origin, allowed redirect URI and returned URL are fixed by Tesla and cannot be inferred at runtime. A change to any of them MUST be made in the developer dashboard **and** in `apps/afirmico-tesla/wrangler.json` in the same change. | Must |
| F02-R15 | The authorization-code flow MUST use PKCE (S256) with a per-attempt verifier held server-side, and MUST validate the returned `state` against a signed, expiring, single-use value bound to the initiating browser. A callback whose `state` is absent, forged, expired or not bound to the initiating browser MUST be refused without attempting a token exchange. | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | Partner token exchange latency | < 2 s p95 |
| F02-N02 | Token failure surfacing | errors recorded with Tesla error code and body, never swallowed |
| F02-N03 | Secret exposure | zero secrets in repo, logs, or D1 plaintext |
| F02-N04 | Billing-limit resilience | a breach MUST NOT leave the fleet silently unconfigured; re-apply runbook tested |
| F02-N05 | Relay certificate validity | expiry monitored with alerting at 30/14/7 days; mTLS fails silently at expiry |

**Acceptance Criteria:**

```text
AC1: GET /.well-known/appspecific/com.tesla.3p.public-key.pem returns the PEM with the correct
     content type and a non-HTML body, and the byte length matches the committed key exactly.
AC2: A request to any other unknown path still returns the SPA fallback (no regression).
AC3: POST /api/1/partner_accounts succeeds and the partner token is cached with its expiry.
AC4: An invalid client id/secret produces a recorded error distinguishing unauthorized_client from
     app_not_approved in the run log.
AC5: No secret value ever appears in the mission log, the D1 database, or any committed file.
```

---

### 4.3 FEATURE-03: Complete Fleet API Registry (Field, Endpoint & Alert Catalogs)

**Priority:** P0  \
**Effort:** Medium (~3 days)

**User Story:** As the operator, the database carries the entire Fleet API surface — every telemetry
field, every endpoint, and every alert code — so future scope expansion is a flag change, not a migration.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F03-R01 | The system MUST load all 239 rows of `fleet_streaming_fields.csv` into a `tesla_field_catalog` table keyed by `field` (unique). | Must |
| F03-R02 | `tesla_field_catalog` MUST store `category`, `type`, `vehicle_data_equivalent`, `description`, and `proto_enum_name` for every field. | Must |
| F03-R03 | The system MUST load all 18,436 rows of `alert_dictionary.csv` into a `tesla_alert_dictionary` table keyed by the composite `(signal_name, models)`. | Must |
| F03-R04 | `tesla_alert_dictionary` MUST store `condition`, `clear_condition`, `description`, `potential_impact`, `customer_facing_message_1`, `customer_facing_message_2`, `audiences`, and `models`. | Must |
| F03-R04a | The system MUST NOT key the alert dictionary on `signal_name` alone. Only **17,579 of the 18,436 rows have a distinct `signal_name`**; 853 signal names carry up to 3 rows that are **not** duplicates but model-specific variants (e.g. `APP_w009_aebFault` exists once for `Cybertruck;Model 3 2017-2023;…` and once for `Model S 2012-2020;Model X 2015-2020`). A unique key on `signal_name` would silently drop 857 rows of operational safety content. | Must |
| F03-R04b | Alert events observed on a vehicle MUST resolve to the dictionary variant matching that vehicle's model, and MUST NOT resolve to an arbitrary variant when several share a signal name. | Must |
| F03-R05 | The system MUST maintain a `tesla_endpoint_catalog` covering the **complete** Fleet API endpoint registry, including families that are **not** enabled at MVP: Vehicle Commands, Energy Product Commands, and Enterprise management. | Must |
| F03-R06 | Each endpoint row MUST carry a family tag and an `enabled` flag; all command, energy-command, and enterprise families MUST be seeded `enabled = 0`. | Must |
| F03-R07 | Each field row MUST carry a `collected` flag and, when collected, its `collection_group` and `min_delta`. Fields outside the collected subset MUST be seeded `collected = 0` and retained. | Must |
| F03-R08 | Catalog loading MUST be idempotent: re-running the loader MUST NOT duplicate rows or alter rows whose source data is unchanged. | Must |
| F03-R09 | The catalog loader MUST record the source file checksum and load timestamp per catalog so staleness is auditable. | Must |
| F03-R10 | The system SHOULD provide a documented refresh procedure when Tesla adds fields or alerts, triggered by checksum change. | Should |
| F03-R11 | `Location` and `RouteLine` type fields SHOULD be stored with an explicit sensitivity classification, and `RouteLine` MUST be marked broken/not-collected. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F03-N01 | Field catalog completeness | **272 rows** (proto universe), zero silent drops; the 239-row CSV is a subset and is fully represented within it |
| F03-N02 | Alert catalog completeness | exactly 18,436 rows, zero silent drops; 17,579 distinct signal names retained simultaneously (853 names carry model-specific variants) |
| F03-N03 | Catalog load idempotency | running the loader twice produces zero row delta and zero content delta |
| F03-N04 | Catalog query latency | indexed lookup by field name < 20 ms |

**Acceptance Criteria:**

```text
AC1: SELECT COUNT(*) FROM tesla_field_catalog = 272; the 239 CSV rows are all present, and the 33
     proto-only fields are catalogued rather than dropped.
AC2: SELECT COUNT(*) FROM tesla_alert_dictionary = 18436; and the row count equals the CSV row count.
AC3: Every endpoint family named above exists in tesla_endpoint_catalog with enabled = 0 at first seed.
AC4: Running the loader a second time yields identical counts and an identical checksum of all catalog rows.
AC5: A field referenced by a collection config that does not exist in tesla_field_catalog is rejected.
AC6: The catalog load log records the source checksum for both CSV files.
AC7: Loading the alert dictionary does not collapse the 853 signal names that carry model-specific
     variants: SELECT COUNT(DISTINCT signal_name) = 17579 AND COUNT(*) = 18436 simultaneously.
AC8: A vehicle alert for a Model 3 resolves to the Model 3 variant of its signal name, not to the
     Model S/X variant that shares the same signal name.
```

---

### 4.4 FEATURE-04: Vehicle Telemetry Collection (Push, 6-Hour Refresh)

**Priority:** P0  \
**Effort:** Large (~6 days) — **ingest built and live 2026-10-02** in `apps/afirmico-tesla/src/telemetry.ts` with `POST /ingest/telemetry`, R2 raw-payload archive, tier routing, consent gating, cost metering and the run log. **The relay is the remaining half** (F02-R10/R11) and is gated on Oracle PAYG; without it nothing calls this endpoint except tests.

**User Story:** As the operator, the platform receives Tesla vehicle telemetry pushed by every consented
member's vehicle on a 6-hour refresh, using the minimum field set that supports insurance underwriting,
and logs every ingest with its signal cost.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F04-R01 | The system MUST collect vehicle data via Tesla **Fleet Telemetry push** to a self-hosted receiver, and MUST NOT poll `vehicle_data` at MVP. | Must |
| F04-R01a | The collected field set MUST be limited to odometer, miles-since-reset, FSD miles-since-reset, battery level, and located-at-home/work. High-frequency behaviour fields MUST NOT be collected at MVP. | Must |
| F04-R01b | Every collected field MUST carry an explicit `interval_seconds` no shorter than 6 hours except where Tesla imposes a tighter floor, and MUST carry an explicit `minimum_delta` where the field type supports it. | Must |
| F04-R02 | The system MUST support a configurable collection cadence of at least weekly and monthly, set per member or globally. | Must |
| F04-R03 | The collection field set MUST be declared explicitly and stored in configuration, not hardcoded, so cadence and field scope can change without a code release. | Must |
| F04-R04 | The default collected set MUST be the underwriting-relevant subset drawn from `vehicle_data` groups: charge_state, climate_state, drive_state, vehicle_config, vehicle_state, and gui_settings. | Must |
| F04-R05 | **WITHDRAWN (v1.9) — this requirement contradicted F04-R01a and the owner's scope decision, and it was not implementable as written.** It required speed, shift state/gear, power, brake and pedal state, lateral/longitudinal acceleration, TPMS, climate setpoints, seat belt state and located-at-home/work. F04-R01a (same document, Must) forbids high-frequency behaviour fields at MVP, and the owner's decision of 2026-10-02 is explicit: collect **only** odometer and FSD kilometres, "no behavior just kms and fsd kms". Two Must requirements could not both hold. The intent of R05 — so the profile supports rating — is now served by F05-R07 (vehicle configuration from the `once` tier) and F05-R05/R06, both of which are deferred or reconceived below rather than silently dropped. Recorded rather than deleted because a reader of past revisions needs to know why the field list shrank. | ~~Must~~ **Withdrawn** |
| F04-R05a | The collected set MUST be exactly the authorisation text's stated field set (`src/consent-policy.ts`, `CONSENTED_FIELDS`), and no field outside it MAY be collected, whether or not it is catalogued. A field is collected only when its catalog row has `collected = 1`, and a mismatch between the consent text and the catalog MUST fail the build rather than ship. | Must |
| F04-R06 | `media_info` and `media_detail` MUST NOT be collected, and MUST be excluded by configuration rather than by code path. | Must |
| F04-R07 | The system MUST request location data explicitly for vehicles on firmware 2023.38+, on the basis of member consent. | Must |
| F04-R08 | **WITHDRAWN (v1.7/v1.9).** Powerwall data cannot be collected: the Tesla app was seeded without `energy_device_data` / `energy_cmds`, so the energy scopes are not granted. See F08-R07 (deferred). Reinstating this requires re-seeding the Tesla app, which is a Tesla-side change, not a code change. | ~~Must~~ **Withdrawn** |
| F04-R09 | The system MUST NOT collect Vehicle Commands, Energy Product Commands, or Enterprise management data at MVP; those endpoint families remain disabled. | Must |
| F04-R10 | Each collection run MUST be recorded in a run log with: run id, cadence, start/end time, vehicles attempted, vehicles succeeded, vehicles failed, and per-vehicle error code. | Must |
| F04-R11 | A failure on one vehicle MUST NOT abort the run for other vehicles. | Must |
| F04-R12 | The system MUST respect Tesla rate limits and MUST NOT retry a rate-limited call more than the configured retry count. | Must |
| F04-R13 | The telemetry receiver MUST run on a dedicated relay host that holds no database and performs no derivation, and MUST forward records to the application for all persistence and processing. | Must |
| F04-R16 | The system MUST count signals received per VIN per day and record the derived cost, so collection cost is a first-class, continuously observable metric rather than an invoice-time surprise. | Must |
| F04-R14 | The system MUST skip vehicles whose member has revoked consent and no active policy. | Must |
| F04-R15 | The system SHOULD persist the raw API response payload per vehicle per run before normalisation, so a parsing change can be replayed. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F04-N01 | Per-vehicle poll wall time | < 30 s p95 |
| F04-N02 | Run fault isolation | one vehicle failure never fails the run |
| F04-N03 | Collection cost per vehicle per month | measured and reported per run; cost is a first-class run metric |
| F04-N04 | Concurrency | bounded worker pool; no unbounded fan-out against Tesla |
| F04-N05 | Idempotency | re-running a run for the same vehicle and window produces one snapshot, not duplicates |

**Acceptance Criteria:**

```text
AC1: A scheduled run collects data for every consented VIN and writes one run log row per run.
AC2: With one VIN forced to return an error, all other VINs still complete and the run is marked partial.
AC3: Configuring cadence = monthly and running twice in one window yields one snapshot for the window.
AC4: media_info and media_detail fields appear nowhere in the collected payload.
AC5: A vehicle whose member revoked consent with no active policy is not polled.
AC6: The run log states collection cost per vehicle for the run.
AC7: Raw payloads are retrievable for a past run and can be re-normalised.
```

---

### 4.5 FEATURE-05: Driver Profile Derivation

**Priority:** P0  \
**Effort:** Large (~6 days) — **derivation built 2026-10-02** in `apps/afirmico-tesla/src/derive.ts`: distance, FSD share, counter-reset handling, confidence and provenance notes, all deterministic. F05-R05/R06 (charging behaviour, home-charging indicator) are **withdrawn with F04-R08** — they depended on fields and energy data outside the consented set.

**User Story:** As an insurer evaluating a quote request, I receive a derived driver profile
(distance, usage pattern, FSD reliance, charging behaviour, safety indicators) rather than raw
telemetry, so I can price a premium.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F05-R01 | The system MUST derive a driver profile per vehicle per reporting period from normalised snapshots. | Must |
| F05-R02 | The profile MUST include annualised or period distance travelled, derived from odometer deltas across snapshots. | Must |
| F05-R03 | The profile MUST include **FSD usage as a percentage** of distance travelled, derived as `ΔSelfDrivingMilesSinceReset / ΔMilesSinceReset` over the reporting window. **Unblocked at v1.4** — these are Fleet Telemetry fields, so selecting telemetry satisfies this requirement directly (R-02 resolved). | Must |
| F05-R14 | The profile MUST label FSD usage as a **since-reset ratio**, never as lifetime usage, because both counters reset on software update, computer replacement, or factory reset. A decrease in either counter MUST be treated as a reset — the window is discarded and restarted from the post-reset value, and the discontinuity MUST be flagged rather than reported as negative travel. | Must |
| F05-R04 | The profile SHOULD include a driving-behaviour indicator set derived from speed, acceleration, and pedal/brake observations. | Should |
| F05-R05 | The profile MUST include charging behaviour: sessions, energy added, AC vs DC split, and charging power profile. | Must |
| F05-R06 | The profile MUST include a home-charging indicator derived from located-at-home observations. | Must |
| F05-R07 | The profile MUST include vehicle configuration (model, trim, year, wheel, exterior colour, RHD) needed for rating. | Must |
| F05-R08 | The profile MUST include a data-confidence score reflecting snapshot count, coverage window, and field completeness; a low-confidence profile MUST be flagged rather than presented as complete. | Must |
| F05-R09 | The derivation MUST be deterministic: the same snapshot set MUST always produce the identical profile. | Must |
| F05-R10 | Every derived metric MUST record its source snapshot range so the figure is auditable back to raw data. | Must |
| F05-R11 | Where FSD distance fields are unavailable from the vehicle, the profile MUST report FSD usage as unavailable and MUST NOT substitute an estimate. | Must |
| F05-R12 | The derivation version MUST be stored on each profile so historical profiles remain reproducible after a formula change. | Must |
| F05-R13 | The system SHOULD expose per-metric derivation notes sufficient for an underwriter to interpret the figure. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F05-N01 | Derivation determinism | identical inputs produce byte-identical profile output |
| F05-N02 | Auditability | every metric traces to a snapshot id range |
| F05-N03 | Explainability | no metric presented without a plain-language definition |
| F05-N04 | Graceful degradation | missing fields reduce confidence; they never produce a fabricated value |

**Acceptance Criteria:**

```text
AC1: Given a fixed snapshot set, two derivation runs produce identical profile JSON.
AC2: The profile exposes FSD usage percentage, with the underlying source field and range recorded.
AC3: With no FSD-capable source data, the profile reports FSD usage as unavailable and flags reduced confidence.
AC4: A profile derived from a single snapshot reports low confidence and is visually flagged in the admin view.
AC5: Every metric in the profile resolves to a stored snapshot id range.
AC6: Changing the derivation version creates a new profile and leaves the previous profile readable.
```

---

### 4.6 FEATURE-06: Group-Level Anonymised Analytics

**Priority:** P1  \
**Effort:** Medium (~5 days)

**User Story:** As an insurer assessing the Australian Tesla market, I can query anonymised,
postcode-level aggregate statistics with no PII, to inform pricing before I quote individual members.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F06-R01 | The system MUST produce group-level aggregates anonymised to **postcode** with all PII removed. | Must |
| F06-R02 | Group-tier output MUST NOT contain any member identifier, name, email, mobile, VIN, or precise vehicle location. | Must |
| F06-R03 | Group aggregates MUST be segmented by at least postcode and vehicle model/variant/year (e.g. "Model 3 2024 Long Range, postcode 2335"). **Built as postcode + model + model year (v1.12); the variant half is NOT satisfied and its cause is a scope decision, not an omission.** Two things had to be established before this could be satisfied at all, and the first was a live defect. (1) **There was no source for model.** The original implementation read `tesla_vehicle.model` and labelled blanks `'Unknown'` — which read as defensive and was in fact *always* the outcome, because `upsertVehicles` writes only `vin`, `display_name` and timestamps, and **nothing in production has ever populated that column**. Every export would have segmented all members into one cell named `Unknown`, satisfying the letter of F06-R01 while defeating R03 entirely, silently. Model and year now come from where the data actually is: the once-tier snapshot (`tesla_vehicle_snapshot`, written by `telemetry.ts` for `CarType`), with the vehicle row kept as an override for when something populates it. (2) **Tesla exposes no model-year field.** Verified against the seeded 272-field catalog: the only match for `/year/i` is an unrelated collision-sensitivity enum, and `Version` is *firmware*, not model year. Model year is therefore derived from VIN position 10 per ISO 3779 and is **marked as derived in the export** (`segment_source`, plus a `model_year_derived` caveat counting the affected vehicles) — a derived year is a weaker claim than a reported one and the recipient is entitled to know which they have. **Variant remains unsatisfiable without a decision.** A `Trim` field does exist in Tesla's catalog (`vehicle_config.trim_badging`), but it is seeded at tier `never` with `collected = 0`. Collecting it would enlarge the consented field set, which F04-R05a (Must) requires to equal the consent text exactly — so it cannot be switched on unilaterally. Until that decision is made, variant is absent from the segment, and that is stated in the export caveats rather than silently dropped. |
| F06-R04 | The system MUST permit publication of a postcode cohort containing a single member; no minimum cohort size is required. | Must |
| F06-R05 | Aggregate metrics MUST include at least: vehicle count, model mix, average odometer, average period distance, and average FSD usage percentage. **Charging behaviour distribution REMOVED (v1.12) — it was never collectable.** The original row required "charging behaviour distribution", but the collected field set is odometer and FSD kilometres only, and the energy scopes (`energy_device_data`, `energy_cmds`) were never granted to the Tesla app — the same reason F04-R08 (Powerwall) was withdrawn in v1.9. There is no charging datum in the database to distribute. Publishing a charging figure would mean inventing it, so the metric is removed rather than faked. FSD usage MUST be reported as a percentage **with its coverage** (how many vehicles contributed a usable FSD ratio) and MUST NOT treat an unavailable FSD period as zero usage — `tesla_driver_profile.fsd_availability` exists precisely to distinguish those two cases. | Must |
| F06-R06 | Group-tier output MUST be reproducible and versioned so a figure delivered to one insurer can be reconciled later. | Must |
| F06-R07 | The system MUST log every group-tier export with the query definition, the requesting party, and the timestamp. | Must |
| F06-R08 | The system SHOULD suppress or generalise any postcode cell whose underlying member count is so small that a segment becomes re-identifiable through combination with external data, and MUST warn the operator when this occurs. | Should |
| F06-R09 | The system SHOULD report aggregate coverage (members contributing) alongside each figure so the insurer can gauge representativeness. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F06-N01 | PII leakage into group tier | zero — verified by automated scan of every export |
| F06-N02 | Aggregate freshness | regenerated from the latest completed collection run |
| F06-N03 | Export reproducibility | identical query + identical dataset → identical output |

**Acceptance Criteria:**

```text
AC1: An automated scan of a group-tier export finds no name, email, mobile, VIN, or GPS coordinate.
     MET — scanForPii() runs against the real PII values present in the source data; a unit and an
     integration test both prove the scan CAN fail, so it is not a vacuous check.

AC2: A postcode containing exactly one member appears in the group output (no k-anonymity suppression).
     MET — asserted in verify-store.ts against an 0800 cohort of one, and the count is warned about
     (F06-R08) and persisted rather than suppressed.

AC3: The export is segmented to model/variant/year + postcode, matching the stated requirement example.
     PARTIALLY MET — postcode + model + model year are segmented and tested. VARIANT IS ABSENT.
     `Trim` exists in Tesla's catalog (vehicle_config.trim_badging) but is seeded tier `never` with
     collected = 0; collecting it would enlarge the consented field set, which F04-R05a (Must) requires
     to equal the consent text exactly. It therefore needs an owner scope decision and is not a build
     omission. Until then the export states the gap in its caveats rather than omitting it silently.

AC4: Re-running the same export against the same dataset produces identical figures.
     MET — two consecutive exports are asserted byte-identical with an equal SHA-256.

AC5: The export log records query definition, recipient, and timestamp.
     MET — asserted against the persisted tesla_group_export row.

AC6: The dataset generation run is recorded and traceable.
     MET as of migration 0010 — this was NOT satisfied before it. `tesla_telemetry_batch` had no
     run_id, so the chain fact -> batch -> run was broken and a figure could not be traced to the run
     that produced its data. The link is now written by the ingest handler and the join is asserted
     against a real run -> batch -> fact chain in verify-store.ts.
```

---

### 4.7 FEATURE-07: Individual Quote Package & Consent-Based Data Release

**Priority:** P0  \
**Effort:** Large (~7 days) — **built 2026-10-02** in `apps/afirmico-tesla/src/release.ts` with routes `POST /quote/request`, `GET /download/:token`, `POST /quote/response`, `POST /quote/decide`. **F01-R05 is now satisfiable**: `tesla_member.mobile` and `.postcode` exist (migration 0005) and are populated by an onboarding step, since the Tesla handshake supplies neither — see F01-R05.

**User Story:** As a member, I request a car insurance quote and the insurer receives my PII plus my
driver profile, prepares a quote, AFIRMICO Auto presents it to me, and I accept it; as the operator,
every release of personal data is logged and attributable to a consent.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F07-R01 | The system MUST support a quote request raised by or for a member, carrying the member's PII and derived driver profile. | Must |
| F07-R02 | Every individual data release MUST be authorised by a live standing consent and MUST be blocked if consent is revoked. | Must |
| F07-R03 | The system MUST record a data-release audit row per release: member, recipient, dataset version, fields released, consent version, and timestamp. | Must |
| F07-R04 | The system MUST produce the individual package in a machine-readable form suitable for insurer ingestion. | Must |
| F07-R05 | The system MUST deliver the individual package as a **CSV via a secure, time-limited download link** at MVP, and MUST NOT send data as an email attachment. | Must |
| F07-R06 | Download links MUST expire and MUST be single-recipient; access MUST be logged. | Must |
| F07-R07 | The system MUST record insurer quote responses and present them to the member for acceptance or decline. | Must |
| F07-R08 | On acceptance, the system MUST record the accepted quote, the binding to AFIRMICO Auto, and the issuing insurer. | Must |
| F07-R09 | The system MUST record that the policy is written by the insurer and bound to AFIRMICO Auto, and MUST track the policy's cover period. | Must |
| F07-R10 | The system MUST prevent collection termination for a member with an active policy until that policy expires, and MUST surface this constraint to the member at revocation time. | Must |
| F07-R11 | The system SHOULD support a standing quote request that remains open until the member revokes it, rather than requiring per-quote consent. | Should |
| F07-R12 | The system SHOULD NOT expose member PII to any party other than on a logged, consented release. | Should |
| F07-R13 | The system MUST distinguish the member tier (TOCA vs paid non-TOCA) in the quote package for insurer visibility. | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F07-N01 | Release traceability | 100% of releases attributable to a consent version and an operator/request actor |
| F07-N02 | Link expiry | secure link no longer usable after expiry |
| F07-N03 | Revocation enforcement | release blocked within one request of revocation taking effect |
| F07-N04 | Policy-hold enforcement | active-policy members are never collection-terminated early |

**Acceptance Criteria:**

```text
AC1: A quote request generates a CSV package containing member PII and the driver profile.
AC2: The package is delivered by secure download link; the email body contains no personal data values.
AC3: The link expires and a post-expiry fetch is refused, with the attempt logged.
AC4: Revoking consent blocks any subsequent individual release for that member.
AC5: An accepted quote records quote, insurer, binding to AFIRMICO Auto, and policy cover period.
AC6: A member holding an active policy cannot have collection terminated before policy expiry, and the
     portal states this at revocation.
AC7: The release audit row names the exact consent version that authorised the release.
```

---

### 4.8 FEATURE-08: Data Storage Model

**Priority:** P0  \
**Effort:** Medium (~4 days) — schema and all four catalogs built and verified 2026-10-02 (`apps/afirmico-tesla/migrations/`: 28 tables, 4 guard triggers, 32/32 acceptance checks passing). Not yet applied — the D1 binding and the CI apply step are still to be wired.
**User Story:** As the operator, the platform stores the complete field registry and the collected
subset efficiently, without a 239-column wide fact row and without D1 bloat, and can replay raw data
if a normalisation bug is found.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F08-R01 | The system MUST store vehicle telemetry as **narrow** fact rows (`vin`, `observed_at`, `field_key`, typed value columns) rather than one wide column per Fleet API field. Exactly one value column is populated per row, and the row records which one via `value_kind`, so an unsupported signal is storable as a fact (`value_kind = 'invalid'`) rather than being indistinguishable from missing data. | Must |
| F08-R02 | The narrow fact table MUST be keyed by vehicle and collection timestamp, and MUST be indexed to support per-vehicle time-range queries. | Must |
| F08-R03 | The system MUST store raw API payloads for each collection run in R2, referenced by key from D1, and MUST NOT store raw payloads inline in D1. | Must |
| F08-R04 | The system MUST store enum-valued fields as their enum name alongside the numeric value where Tesla returns both. | Must |
| F08-R05 | The system MUST retain the complete Fleet Telemetry catalog and the full endpoint catalog in D1 regardless of what is collected, per FEATURE-03. The catalog is the **272-field proto universe**, not only the 239 rows of `fleet_streaming_fields.csv`: the CSV omits 33 fields the proto defines, so the CSV alone would force a migration when a vehicle first reports one of them. | Must |
| F08-R06 | The system MUST store a vehicle record per VIN linked to its member, carrying configuration fields needed for rating. | Must |
| F08-R07 | The system MUST store a distinct energy-site record and energy snapshot series for members with a Powerwall. **DEFERRED (v1.7):** F02-R09 seeds the app with `energy_device_data` and `energy_cmds` **not** requested, so this integration cannot collect Powerwall data. The tables are withheld rather than created empty; adding them when the scopes are requested is a new migration, not a change to the fact model (the catalog-driven design absorbs new field families without altering existing tables). | Must (deferred) |
| F08-R08 | The system MUST store alert events observed on a vehicle, joined to the alert dictionary by `signal_name`, so alert severity and customer-facing text resolve without duplication. | Must |
| F08-R09 | The system MUST use a dedicated Tesla D1 database binding, separate from document-intelligence tables. | Must |
| F08-R10 | All Tesla D1 schema changes MUST land as numbered migrations applied by CI, never applied ad hoc from a local session. | Must |
| F08-R11 | The system SHOULD partition or age out high-volume telemetry tables on a defined retention boundary while retaining derived profiles. | Should |
| F08-R12 | The system SHOULD store data-access audit rows append-only. | Should |
| F08-R13 | A field's **collection tier** MUST determine its storage location, and the mapping MUST be enforced in the database rather than only in application code: `event` and `on_change` fields are stored as fact rows, `once` fields in the vehicle snapshot, and a fact row for a field marked `collected = 0` MUST be rejected. | Must |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F08-N01 | Fact-table width | narrow by design; no per-field column explosion |
| F08-N02 | Migration discipline | every schema change has a numbered migration; local ad-hoc apply forbidden |
| F08-N03 | Raw replay | any past run re-normalisable from R2 without re-polling Tesla |
| F08-N04 | Referential integrity | no fact row references a field_key absent from the catalog |

**Acceptance Criteria:**

```text
AC1: A collection run writes narrow fact rows; the fact table has no column named after an individual
     Fleet API field.
AC2: Raw payloads for a run are retrievable from R2 by the key recorded in D1.
AC3: The Tesla schema is created by a numbered migration and CI applies it; no ad-hoc local apply occurs.
AC4: An alert observed on a vehicle resolves to its dictionary row with severity and customer text.
AC5: A fact row referencing an unknown field_key is rejected; likewise a fact row for a field whose
     collected flag is 0, and a snapshot row for a field whose collection_tier is not 'once'.
AC6: The Tesla tables live in a binding distinct from the document-intelligence tables.
AC7: SELECT count(*) FROM tesla_field_catalog = 272 (the proto universe), of which 14 are collected and
     258 retained as collected = 0. Widening the collected set changes no table definition.
```

---

### 4.9 FEATURE-09: Admin Dashboard & Visualisation (MVP)

**Priority:** P1  \
**Effort:** Medium (~5 days)

**User Story:** As the operator (Warren), I can see the state of the member fleet, the collection
health, and the data quality on one dashboard, including a map of Australia showing where members are.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F09-R01 | The dashboard MUST be restricted to the operator role and MUST NOT be reachable by members. | Must |
| F09-R02 | The dashboard MUST show fleet size, consented vs revoked members, and TOCA vs paid-tier split. | Must |
| F09-R03 | The dashboard MUST render a **map of Australia** showing member distribution at postcode level. | Must |
| F09-R04 | The dashboard MUST show collection-run health: last run, success/failure counts, and stale vehicles. | Must |
| F09-R05 | The dashboard MUST show vehicle and model mix across the fleet. | Must |
| F09-R06 | The dashboard MUST show driver-profile visualisations: distance distribution, FSD usage percentage, and charging behaviour. | Must |
| F09-R07 | The dashboard MUST allow drill-down from a member to their vehicle, profile, consent state, and release history. | Must |
| F09-R08 | The dashboard MUST surface data-quality indicators, including low-confidence profiles and vehicles with missing fields. | Must |
| F09-R09 | The dashboard MUST indicate the age of the displayed data. | Must |
| F09-R10 | The dashboard SHOULD expose the quote pipeline: requests raised, quotes received, quotes accepted. | Should |
| F09-R11 | The dashboard SHOULD allow the operator to trigger a manual collection run for a single vehicle. | Should |
| F09-R12 | Reporting beyond the MVP visualisation set SHOULD be deferred until insurer requirements are received. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F09-N01 | Dashboard load time | < 3 s p95 for 1,500 members |
| F09-N02 | Access control | operator-only; no anonymous route |
| F09-N03 | Map rendering | geographic accuracy at postcode granularity |
| F09-N04 | Data freshness indicator | always visible, never implied |

**Acceptance Criteria:**

```text
AC1: An unauthenticated request to the dashboard is refused.
AC2: The dashboard renders an Australia map with postcode-level member distribution.
AC3: Fleet counts, consent state, and tier split match the D1 data exactly.
AC4: A member drill-down shows vehicle, profile, consent history, and data releases.
AC5: Stale and low-confidence records are visually distinguishable from healthy ones.
AC6: The displayed data age matches the last completed collection run timestamp.
```

---

### 4.10 FEATURE-10: Data Lifecycle, Revocation & Retention

**Priority:** P0  \
**Effort:** Medium (~4 days)

**User Story:** As a member, when I revoke consent my data is handled according to a clear rule —
deleted immediately if I hold no policy, retained only until my policy expires if I do.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F10-R01 | On revocation with **no policy held**, the system MUST delete the member's individual data immediately. | Must |
| F10-R02 | On revocation with an **active policy**, the system MUST retain the connection and the data until the policy expires, then delete. | Must |
| F10-R03 | The system MUST distinguish these two paths explicitly and MUST NOT apply one rule to both. | Must |
| F10-R04 | The system MUST present the applicable retention rule to the member at the point of revocation. | Must |
| F10-R05 | Deletion MUST cover member PII, vehicle telemetry, derived profiles, and raw payload references, and MUST leave nothing recoverable. | Must |
| F10-R06 | Deletion MUST be recorded in an audit log with what was deleted, when, and under which rule. | Must |
| F10-R07 | Anonymised group-tier aggregates MUST be retained after individual data deletion, as they contain no PII. | Must |
| F10-R08 | The system MUST stop collection immediately on revocation regardless of the retention path. | Must |
| F10-R09 | The system SHOULD notify the operator when a policy-linked retention reaches its expiry so deletion can be confirmed. | Should |
| F10-R10 | The system SHOULD expose a retention status per member on the admin dashboard. | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F10-N01 | Deletion completeness | zero recoverable individual data after deletion |
| F10-N02 | Collection stop | collection ceases on the next run after revocation, never later |
| F10-N03 | Audit durability | deletion audit survives the deletion |
| F10-N04 | Rule clarity | the member always sees which rule applies before confirming revocation |

**Acceptance Criteria:**

```text
AC1: Revoking with no policy deletes PII, telemetry, profiles and raw references, and the deletion is audited.
AC2: Revoking with an active policy stops collection, retains data, and records the retention expiry.
AC3: On policy expiry, the retained data is deleted and the deletion audited.
AC4: The revocation screen states the applicable rule before the member confirms.
AC5: Aggregated postcode statistics are unchanged by an individual deletion.
AC6: No individual data for the revoked member remains queryable after the applicable deletion.
```

---

## 5. Out of Scope

- **Member-facing mobile app.** There is no TOCA member app at MVP; the platform is the connector plus an admin dashboard.
- **Vehicle Commands, Energy Product Commands, and Enterprise management.** The endpoint families are catalogued but seeded disabled and MUST NOT be called.
- **`vehicle_data` polling.** Withdrawn at v1.4; Fleet Telemetry is the sole transport. No scheduled polling lane is specified.
- **High-frequency behaviour capture.** Lateral/longitudinal acceleration, brake-pedal position, and similar high-rate fields are excluded on cost grounds — they are ~39× the cost of the selected field set.
- **Real-time data.** Telemetry is throttled to a 6-hour refresh by design; the platform is not a live-tracking system.
- **Kafka/Redis/streaming dispatch and any messaging fabric.** The relay forwards batched records to the application directly; no intermediate broker is specified at MVP.
- **`media_info` / `media_detail`.** Excluded from collection.
- **Pre-2018 Model S/X without infotainment upgrade.** Cannot be supported.
- **AFSL/AR authorisation.** AFIRMICO does not currently hold an AR under an AFSL; obtaining that authorisation is a separate workstream. The FRS assumes data gathering precedes it.
- **Insurer reporting requirements.** Deferred until insurers provide their specifications; only the MVP visualisation set is specified.
- **Non-TOCA tier pricing/product design.** The tier exists (same data access, membership incentive) but its commercial design is not specified here.
- **Telemetry hosting high availability.** The relay is a single host by design at MVP (SDD-010); failover, multi-region relay, and horizontal scaling are not specified.
- **Payment, billing, and premium collection.** Out of scope.
- **Multi-region.** AU only, via the NA region base URL.

---

## 6. Dependencies & Related Documents

| Artifact | Relation |
|----------|----------|
| `apps/afirmico-tesla/src/consent-policy.ts` | **Authoritative consent text** (F01-R03). Versioned; the seeded D1 copy must hash-match it (F01 AC5) |
| `apps/afirmico-tesla/migrations/` | D1 schema and catalogs (F03, F08). Applied by the `tesla-schema` CI job |
| `apps/afirmico-tesla/scripts/verify-schema.sh` | Asserts the schema meets FRS-010's acceptance criteria, incl. D1 statement limits |
| `apps/afirmico-tesla/scripts/verify-store.ts` | Asserts `src/store.ts` agrees with the schema and that guard triggers fire |
| `apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv` | Source CSV for the catalog (F03). **Not authoritative and not complete** — the 272-field proto is the universe; this CSV is a 239-row subset |
| `apps/EdgeGDE - Document DB/Tesla APP DB/alert_dictionary.csv` | Source of truth for the 18,436-alert catalog (F03) |
| `apps/edge-runtime/wrangler.json` | D1 bindings; requires a dedicated Tesla binding (F08-R09) |
| `apps/edge-runtime/migrations/` | Numbered migration convention for all Tesla schema (F08-R10) |
| `apps/afirmico-tesla/` | **Home for the Tesla integration (owner decision, v1.5).** A new dedicated Worker that owns the `auto.afirmi.co` hostname. Supersedes the v1.2 decision to build inside `apps/edge-runtime/` (worker `edgegde-calculator`), which is ruled out — it is the calculator app and its D1 bindings point at document-intelligence databases. The p9 prototype (`apps/tesla-fleet-worker/`) has been removed; F02/F04/F08 are built in the new app. See SDD-010 §2 and §5. |
| Bitwarden Secrets — Tesla client id / client secret | Credential source. **App created 2026-09-25 and registered 2026-10-02 (R-01 resolved, v1.6).** Holds the client id and secret, and `TESLA_FLEET_PRIVATE_KEY` (the EC P-256 signing key, added 2026-10-02). The private key MUST NOT be rotated once registered (F02-R02). |
| `apps/afirmico-tesla/` — Tesla app config | **Registered app configuration is authoritative (F02-R14).** App `AFIRMICO Auto`, client id `f03d04ed-a6b0-43b3-bda4-5c19dec5dd2b`, origin `https://auto.afirmi.co`, redirect `https://auto.afirmi.co/auth/callback`, returned URL `https://auto.afirmi.co/dashboard`. Contact: **`connect@afirmico.com`**. |
| Browser-gating context (owner, 2026-10-02) | `auto.afirmi.co` will sit **behind the TOCA member site**, so in production only members reach it. This does **not** make F01-R01 optional — a member funnel must still be enforced server-side, and `/connect` is currently **ungated** pending F01. |
| Cloudflare account `renleding`, worker `aged-cherry-8781` | Serves `auto.afirmi.co` today as a catch-all SPA, bound as a Workers **Custom Domain** (re-verified 2026-10-02; **no repo config declares it**). Has **zero bindings**, so it cannot host Tier 1 and is **ruled out for Tesla** by the owner (it is the calculator/splash worker). Tier 1 is a new dedicated worker owning the hostname — see SDD-010 §2. |
| https://developer.tesla.com/docs/fleet-api/billing-and-limits | Billing limit behaviour; limit raised to $100, payment method added |
| https://developer.tesla.com/docs/fleet-api/fleet-telemetry | **Primary transport contract** — streaming semantics, per-field `interval_seconds`, `minimum_delta`, `include_fields` |
| https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints | Vehicle endpoint contract (`fleet_telemetry_config`, `fleet_status`, `list`) |
| https://github.com/teslamotors/fleet-telemetry | Relay reference implementation |
| https://github.com/teslamotors/vehicle-command | Config-signing HTTP proxy |
| [SDD-010](./SDD-010-afirmico-auto-telemetry-architecture-v1.md) | System design for this FRS |
| https://www.teslaowners.org.au/membership | TOCA member funnel; entry point for onboarding (F01-R01) |
| FRS-007 / SDD-007 / IDD-007 (action ledger, budget guardrails) | Related governance pattern for audited releases and budget controls |
| FRS-006 (lender doc ingestion) | Related D1 + R2 + ingestion conventions |

---

## 7. Risks & Open Decisions

| ID | Risk / Decision | Impact | Status |
|----|----------------|--------|--------|
| R-01 | **Tesla developer app — RESOLVED (v1.6).** The app **was never missing**: it was created on developer.tesla.com on **2026-09-25** and is **ACTIVE**, onboarding approved 2026-10-02. Partner registration completed 2026-10-02 (`POST /api/1/partner_accounts` → `enterprise_tier: pay_as_you_go`, public key recorded byte-identical to the committed PEM), and a `client_credentials` exchange returns a live token. The prior text ("app not yet created", "Tier 1 worker must land before registration") was a **false blocker** carried from v1.5 and is retracted. The public key was reachable at `/.well-known/` before registration, so the ordering constraint was satisfied in practice. | Was the headline blocker; nothing downstream is gated on it now | **RESOLVED (v1.6)** |
| R-02 | **FSD usage — RESOLVED (v1.4) by choosing telemetry.** `MilesSinceReset` / `SelfDrivingMilesSinceReset` are Fleet Telemetry fields, so selecting Fleet Telemetry as the transport satisfies F05-R03 directly with the authoritative source and no approximation. Resolved as **telemetry-only**, accepting the two coverage caveats: the fields are HW4-only (excludes older Model 3/Y) and firmware 2025.44.25.5+, and both counters reset on software update, computer replacement, or factory reset, so the metric is a *since-reset* ratio rather than lifetime (see F05-R14). Non-HW4 vehicles report FSD as unavailable, not zero. | Was the headline blocker; now a coverage caveat rather than an open decision | **RESOLVED (v1.4)** |
| R-02a | Options A (MVP without FSD), B (minimal FSD-first telemetry) and C (polled proxy indicator) — **all withdrawn at v1.4.** The owner selected Fleet Telemetry as the sole transport, which resolves the decision that generated these options. | — | WITHDRAWN (v1.4) |
| R-02b | Superseded — **this option is now the architecture.** Retained only to show the decision path: the minimal FSD-first telemetry configuration it described is what SDD-010 implements, extended with battery level and located-at-home/work fields. The earlier cost note in this row (scaling Tesla's per-hour figures) was superseded on v1.4 by a **measured** model: ~525 signals/vehicle/month → **$5.25/month for 1,500 vehicles**, inside Tesla's $10/month account credit. | — | ADOPTED (v1.4) |
| R-02c | Option C — **withdrawn.** It would have substituted a derived *indicator* for the real measurement and required labelling it so as never to be read as "FSD usage %". Choosing telemetry removes the need for any proxy. | — | WITHDRAWN (v1.4) |
| R-03 | **Member authentication path from Member Jungle undecided** (Q11). SSO, signed magic link, or separate login — all unconfirmed. | Blocks F01-R01 implementation | OPEN — Warren |
| R-04 | **Tesla key-pairing UX undecided** (Q12) — same session as connect flow, or separate step. | Affects F01-R08 seamlessness target | OPEN — Warren |
| R-05 | **No AFSL/AR authorisation yet.** AFIRMICO is not an AR; the plan is to gather data first and seek AR approval. | May constrain or rework the offer/binding flow in F07 | OPEN — separate workstream |
| R-06 | **Consent and privacy wording not authored** (Q6, "TBA"). | Blocks F01-R02 and F01-R03 from being finalised | OPEN — Warren |
| R-07 | **Billing limit behaviour is destructive — and telemetry makes it worse (v1.4).** Exceeding the limit suspends API access AND removes Fleet Telemetry configurations, which Tesla does **not** restore. Under the withdrawn polling design there were no configurations to lose; under telemetry a breach silently de-configures **every member vehicle** and recovery requires an operator re-apply run across the fleet. Limit is now $100. | **High** — fleet-wide silent collection failure with no member-visible symptom | OPEN — **launch blocker.** Mitigation required by F02-R13, F02-N04, F04-R16 |
| R-08 | **Key custody and recoverability.** RESOLVED (v1.3). The collision risk was removed by the clean-slate reset, and the "cannot be regenerated" premise is **retracted as factually wrong** — no key pair exists. The p9 public key was orphaned (private half never located; snapshots scanned, zero `PRIVATE KEY` occurrences) and Bitwarden holds only the Client ID and Client Secret. A fresh key pair MUST be generated before registration. What remains is a **custody discipline**, not a recoverability problem: private key in the secrets store only, and once registered the key MUST NOT be rotated without a deliberate re-pairing migration. | No longer blocks F02 (hosting still gated by R-01) | RESOLVED |
| R-09 | **Postcode-to-lat/long mapping.** The group tier is postcode-segmented and the dashboard maps Australia at postcode level, but Tesla returns GPS coordinates — no mapping is defined. | Blocks F06-R03 and F09-R03 | OPEN — design decision |
| R-10 | **Tesla rate limits are per device, per account** and shared across multiple apps on one account, but the published numeric limits were not retrievable. | Run sizing and retry policy cannot be finalised | OPEN — verify before build |
| R-11 | **Backup and export linkage.** No backup/restore requirement is specified for the Tesla D1 database or R2 raw payloads. | Data-loss exposure | OPEN — likely a later FRS |
| R-12 | **No PII field-level classification** in the catalog beyond Location. | Deletion completeness (F10-N01) depends on knowing exactly which fields are PII | OPEN — design decision |
| R-13 | **Splash-page cutover — deferred, not required (v1.6).** The concern was that moving `auto.afirmi.co` to the new worker would change what the public URL serves, and that the splash content is not in the repo so it could not be preserved automatically. **This no longer applies:** the Tesla surface is attached by **Route**, which takes precedence over the Custom Domain, so the splash worker still serves every path this worker does not claim. Verified live: `/` returns the original 3,721-byte document, and a byte-identical copy is now committed at `apps/afirmico-tesla/public/index.html` — the preservation gap is closed as a side effect. A full cutover only becomes necessary if the whole hostname must move to one worker, at which point the committed copy is the diffable baseline. | No member-facing breakage | **DEFERRED (v1.6)** |
| R-14 | **Public-key `Content-Type` — RESOLVED (v1.6).** FRS F02-R01 specified `application/x-pem-file`; SDD-010 previously said `text/plain`. Settled empirically: Tesla's own registration call downloaded the key successfully with `application/x-pem-file`, and the partner record was created. F02-R01's wording stands. The related "excluded from the SPA fallback" phrasing is also settled — the worker is attached by **Route**, so the splash worker never sees the key path at all. | Was a possible registration blocker; closed by the successful registration | **RESOLVED (v1.6)** |

---

## 8. Suggested Phasing

| Phase | Scope |
|-------|-------|
| 0 | Resolve R-01 (create Tesla developer app), **R-02 FSD decision (a/b/c — gates F05-R03 and whether a telemetry host is needed at all)**, R-03/R-04 (auth + pairing UX), R-06 (consent wording), R-09 (postcode mapping) |
| 1 | FEATURE-02: public key route, partner registration, token lifecycle — the hard gate |
| 2 | FEATURE-03: full field, endpoint, and alert catalogs loaded and verified |
| 3 | FEATURE-08: D1 schema and migrations; R2 raw payload storage |
| 4 | FEATURE-04: telemetry relay + config push, one vehicle, then the consented fleet. **Gate: confirm `interval_seconds` accepts 6 h (SDD-010 §9 O-1).** |
| 5 | FEATURE-05: driver profile derivation incl. FSD usage |
| 6 | FEATURE-09: admin dashboard, Australia map, fleet and quality visualisation |
| 7 | FEATURE-06 + FEATURE-07: group-tier aggregates and individual quote packages with secure delivery |
| 8 | FEATURE-10: revocation, deletion, and retention lifecycle |
| 9 | Insurer requirements received → separate reporting FRS |

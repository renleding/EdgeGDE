# Functional Requirements Specification (FRS): AFIRMICO Auto — Tesla Fleet Data Platform

**Document ID:** FRS-010  \
**Version:** 1.1  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-09-29  \
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

---

## 3. Current Baseline

### 3.1 Public web surface

`https://auto.afirmi.co/` is live and serves a static splash page. The page is served by the
Cloudflare Worker `aged-cherry-8781.renleding.workers.dev` in the **renleding** Cloudflare account
(confirmed owner: Warren). There is currently **no route-level separation**: `/`, `/auth/callback`,
`/dashboard`, `/api/health` and `/.well-known/appspecific/com.tesla.3p.public-key.pem` all return the
same ~3,727-byte HTML document via a catch-all SPA fallback.

**Gap:** There is no Tesla OAuth callback handler, no member portal, no consent store, no admin
dashboard, no D1 schema for Tesla data, and no data collection of any kind. The `.well-known` public key
path is shadowed by the SPA fallback and cannot serve the registration PEM.

### 3.2 Credential state

Tesla Fleet API **client id and client secret** exist in Bitwarden Secrets (project accessible to
the agent). The Tesla developer application itself has **not yet been created** on
developer.tesla.com — the credentials were provisioned ahead of app creation.

**Gap:** Without a created (and approved) developer application, no partner registration, token
exchange, telemetry config, or vehicle enumeration is possible. A client-credentials exchange against
`https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token` is expected to fail until the app exists.

### 3.3 Local key material

An EC P-256 public key exists at
`apps/edge-runtime/public/.well-known/appspecific/com.tesla.3p.public-key.pem` (178 bytes, valid SPKI
header `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...`). This file is **untracked** and was produced by a
**parallel agent session (agent p9)**.

**Gap:** The key is not committed, not routed, and the paired private key is not under
documented custody. Concurrent work by p9 on the same path is an active collision risk (see R-08).

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

### 3.6 Telemetry transport decision

Per requirements interview (Q17/Q18), the **MVP polls** `vehicle_data` on a schedule
(once per week or per month) rather than streaming via Fleet Telemetry. This **removes** the
previously identified blocker that a `fleet-telemetry` server must terminate client-certificate mTLS
on port 443 and therefore cannot run on Cloudflare Workers: **no telemetry server is required for MVP**.
Q18 specifies the polling worker runs locally for now.

---

## 4. Requirements

### 4.1 FEATURE-01: Member Identity, Consent & Onboarding

**Priority:** P0  \
**Effort:** Medium (~4 days)

**User Story:** As a TOCA member, I link my Tesla account to AFIRMICO Auto and grant standing consent
to release my data to third parties for the purpose of finding me an offer; as the operator, I can prove
exactly what was consented to and when.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F01-R01 | The platform MUST authenticate members exclusively through the TOCA member funnel; non-TOCA members MUST be admitted through a separate paid tier. | Must |
| F01-R02 | The platform MUST record a standing consent from the member to AFIRMICO to release data to third parties for the purpose of obtaining offers, modelled on a credit-assistance-style authorisation, with no fixed expiry. | Must |
| F01-R03 | Consent MUST be versioned; each record MUST store the consent text version, timestamp, IP, and user agent. | Must |
| F01-R04 | Consent MUST be revocable by the member at any time, with the revocation timestamp recorded. | Must |
| F01-R05 | The platform MUST store, per member: name, email, mobile, residential postcode, TOCA membership status, and tier. | Must |
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
**Effort:** Medium (~4 days) — gated on the Tesla developer app existing

**User Story:** As the operator, the platform holds a valid Tesla partner token and can enumerate
member vehicles and energy sites on demand.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F02-R01 | The platform MUST serve the Tesla public key at `https://auto.afirmi.co/.well-known/appspecific/com.tesla.3p.public-key.pem` with `Content-Type: application/x-pem-file`, excluded from the SPA fallback. | Must |
| F02-R02 | The private key MUST be held outside the repository in the secrets store and MUST never be committed. | Must |
| F02-R03 | The platform MUST register as a Tesla partner via `POST /api/1/partner_accounts` using a partner authentication token, and MUST succeed before any telemetry or vehicle call. | Must |
| F02-R04 | The platform MUST obtain tokens via `client_credentials` for partner-scope calls and `authorization-code` (with PKCE) for member-scope calls, against the region base URL `https://fleet-api.prd.na.vn.cloud.tesla.com`. | Must |
| F02-R05 | The platform MUST refresh and persist tokens, and MUST NOT block a scheduled collection run on a token refresh failure — the run MUST be deferred and alerted. | Must |
| F02-R06 | The platform SHOULD store the client id, client secret, partner token, and member refresh tokens as Worker secrets or in the secrets store, never in D1 in plaintext. | Should |
| F02-R07 | The platform MUST handle Tesla application approval status as an explicit state, surfacing "app not approved" distinctly from "token invalid". | Must |
| F02-R08 | The platform SHOULD route all fleet and vehicle calls through the single region base URL for AU (Asia-Pacific excluding China shares the NA base). | Should |

**Non-Functional Requirements:**

| ID | Requirement | Target |
|----|------------|--------|
| F02-N01 | Partner token exchange latency | < 2 s p95 |
| F02-N02 | Token failure surfacing | errors recorded with Tesla error code and body, never swallowed |
| F02-N03 | Secret exposure | zero secrets in repo, logs, or D1 plaintext |

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
| F03-N01 | Field catalog completeness | exactly 239 rows, zero silent drops |
| F03-N02 | Alert catalog completeness | exactly 18,436 rows, zero silent drops |
| F03-N03 | Catalog load idempotency | running the loader twice produces zero row delta and zero content delta |
| F03-N04 | Catalog query latency | indexed lookup by field name < 20 ms |

**Acceptance Criteria:**

```text
AC1: SELECT COUNT(*) FROM tesla_field_catalog = 239; and the row count equals the CSV row count.
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

### 4.4 FEATURE-04: Scheduled Vehicle Data Collection (Polling)

**Priority:** P0  \
**Effort:** Large (~6 days)

**User Story:** As the operator, the platform collects Tesla vehicle and Powerwall data for every
consented member on a weekly or monthly schedule, using the minimum field set that supports insurance
underwriting, and logs every collection run.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F04-R01 | The system MUST collect vehicle data by polling `GET /api/1/vehicles/{vin}/vehicle_data`, not by Fleet Telemetry streaming, at MVP. | Must |
| F04-R02 | The system MUST support a configurable collection cadence of at least weekly and monthly, set per member or globally. | Must |
| F04-R03 | The collection field set MUST be declared explicitly and stored in configuration, not hardcoded, so cadence and field scope can change without a code release. | Must |
| F04-R04 | The default collected set MUST be the underwriting-relevant subset drawn from `vehicle_data` groups: charge_state, climate_state, drive_state, vehicle_config, vehicle_state, and gui_settings. | Must |
| F04-R05 | The collected set MUST include: odometer, speed, shift state (gear), power, brake and pedal state, lateral and longitudinal acceleration where available, charge state and charging session fields, TPMS pressures and warnings, climate setpoints, vehicle configuration (model, trim, wheel, exterior colour, RHD), seat belt state, and located-at-home/work. | Must |
| F04-R06 | `media_info` and `media_detail` MUST NOT be collected, and MUST be excluded by configuration rather than by code path. | Must |
| F04-R07 | The system MUST request location data explicitly for vehicles on firmware 2023.38+, on the basis of member consent. | Must |
| F04-R08 | The system MUST collect Powerwall data via the energy endpoints (`/api/1/products` and `/api/1/energy_sites/{id}/…`) for members with an energy site. | Must |
| F04-R09 | The system MUST NOT collect Vehicle Commands, Energy Product Commands, or Enterprise management data at MVP; those endpoint families remain disabled. | Must |
| F04-R10 | Each collection run MUST be recorded in a run log with: run id, cadence, start/end time, vehicles attempted, vehicles succeeded, vehicles failed, and per-vehicle error code. | Must |
| F04-R11 | A failure on one vehicle MUST NOT abort the run for other vehicles. | Must |
| F04-R12 | The system MUST respect Tesla rate limits and MUST NOT retry a rate-limited call more than the configured retry count. | Must |
| F04-R13 | The system SHOULD run the collector as a locally hosted scheduled job at MVP, with the scheduler configuration held in the repo. | Should |
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
**Effort:** Large (~6 days)

**User Story:** As an insurer evaluating a quote request, I receive a derived driver profile
(distance, usage pattern, FSD reliance, charging behaviour, safety indicators) rather than raw
telemetry, so I can price a premium.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F05-R01 | The system MUST derive a driver profile per vehicle per reporting period from normalised snapshots. | Must |
| F05-R02 | The profile MUST include annualised or period distance travelled, derived from odometer deltas across snapshots. | Must |
| F05-R03 | The profile MUST include **FSD usage as a percentage** of distance travelled. **Blocked at MVP:** no polling path returns this — see R-02. The requirement stands; the source is undecided. | Must |
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
| F06-R03 | Group aggregates MUST be segmented by at least postcode and vehicle model/variant/year (e.g. "Model 3 2024 Long Range, postcode 2335"). | Must |
| F06-R04 | The system MUST permit publication of a postcode cohort containing a single member; no minimum cohort size is required. | Must |
| F06-R05 | Aggregate metrics MUST include at least: vehicle count, model mix, average odometer, average period distance, average FSD usage percentage, and charging behaviour distribution. | Must |
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
AC2: A postcode containing exactly one member appears in the group output (no k-anonymity suppression).
AC3: The export is segmented to model/variant/year + postcode, matching the stated requirement example.
AC4: Re-running the same export against the same dataset produces identical figures.
AC5: The export log records query definition, recipient, and timestamp.
AC6: The dataset generation run is recorded and traceable.
```

---

### 4.7 FEATURE-07: Individual Quote Package & Consent-Based Data Release

**Priority:** P0  \
**Effort:** Large (~7 days)

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
**Effort:** Medium (~4 days)

**User Story:** As the operator, the platform stores the complete field registry and the collected
subset efficiently, without a 239-column wide fact row and without D1 bloat, and can replay raw data
if a normalisation bug is found.

**Functional Requirements:**

| ID | Requirement | Must/Should |
|----|------------|-------------|
| F08-R01 | The system MUST store vehicle telemetry as **narrow** fact rows (`vin`, `collected_at`, `field_key`, typed value columns) rather than one wide column per Fleet API field. | Must |
| F08-R02 | The narrow fact table MUST be keyed by vehicle and collection timestamp, and MUST be indexed to support per-vehicle time-range queries. | Must |
| F08-R03 | The system MUST store raw API payloads for each collection run in R2, referenced by key from D1, and MUST NOT store raw payloads inline in D1. | Must |
| F08-R04 | The system MUST store enum-valued fields as their enum name alongside the numeric value where Tesla returns both. | Must |
| F08-R05 | The system MUST retain the full 239-field catalog and the full endpoint catalog in D1 regardless of what is collected, per FEATURE-03. | Must |
| F08-R06 | The system MUST store a vehicle record per VIN linked to its member, carrying configuration fields needed for rating. | Must |
| F08-R07 | The system MUST store a distinct energy-site record and energy snapshot series for members with a Powerwall. | Must |
| F08-R08 | The system MUST store alert events observed on a vehicle, joined to the alert dictionary by `signal_name`, so alert severity and customer-facing text resolve without duplication. | Must |
| F08-R09 | The system MUST use a dedicated Tesla D1 database binding, separate from document-intelligence tables. | Must |
| F08-R10 | All Tesla D1 schema changes MUST land as numbered migrations applied by CI, never applied ad hoc from a local session. | Must |
| F08-R11 | The system SHOULD partition or age out high-volume telemetry tables on a defined retention boundary while retaining derived profiles. | Should |
| F08-R12 | The system SHOULD store data-access audit rows append-only. | Should |

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
AC5: A fact row referencing an unknown field_key is rejected.
AC6: The Tesla tables live in a binding distinct from the document-intelligence tables.
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
- **Fleet Telemetry streaming.** MVP polls `vehicle_data`; the `fleet-telemetry` server, mTLS on :443, Kafka/Redis dispatch, and streaming cost model are out of scope.
- **Real-time data.** Collection is weekly or monthly, not live.
- **`media_info` / `media_detail`.** Excluded from collection.
- **Pre-2018 Model S/X without infotainment upgrade.** Cannot be supported.
- **AFSL/AR authorisation.** AFIRMICO does not currently hold an AR under an AFSL; obtaining that authorisation is a separate workstream. The FRS assumes data gathering precedes it.
- **Insurer reporting requirements.** Deferred until insurers provide their specifications; only the MVP visualisation set is specified.
- **Non-TOCA tier pricing/product design.** The tier exists (same data access, membership incentive) but its commercial design is not specified here.
- **Telemetry hosting infrastructure.** Polling runs locally at MVP; production hosting, HA, and scaling are not specified.
- **Payment, billing, and premium collection.** Out of scope.
- **Multi-region.** AU only, via the NA region base URL.

---

## 6. Dependencies & Related Documents

| Artifact | Relation |
|----------|----------|
| `apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv` | Source of truth for the 239-field catalog (F03) |
| `apps/EdgeGDE - Document DB/Tesla APP DB/alert_dictionary.csv` | Source of truth for the 18,436-alert catalog (F03) |
| `apps/edge-runtime/wrangler.json` | D1 bindings; requires a dedicated Tesla binding (F08-R09) |
| `apps/edge-runtime/migrations/` | Numbered migration convention for all Tesla schema (F08-R10) |
| `apps/edge-runtime/public/.well-known/appspecific/com.tesla.3p.public-key.pem` | Tesla registration public key; currently untracked, produced by agent p9 — collision risk (F02-R01, R-08) |
| Bitwarden Secrets — Tesla client id / client secret | Credential source; the Tesla developer app does not yet exist |
| Cloudflare account `renleding`, worker `aged-cherry-8781` | Host for `auto.afirmi.co`; needs route separation for `/.well-known` |
| https://developer.tesla.com/docs/fleet-api/billing-and-limits | Billing limit behaviour; limit raised to $100, payment method added |
| https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints | Polling endpoint contract (`vehicle_data`, `list`, `fleet_status`) |
| https://www.teslaowners.org.au/membership | TOCA member funnel; entry point for onboarding (F01-R01) |
| FRS-007 / SDD-007 / IDD-007 (action ledger, budget guardrails) | Related governance pattern for audited releases and budget controls |
| FRS-006 (lender doc ingestion) | Related D1 + R2 + ingestion conventions |

---

## 7. Risks & Open Decisions

| ID | Risk / Decision | Impact | Status |
|----|----------------|--------|--------|
| R-01 | **Tesla developer app not yet created.** No partner registration, token, or vehicle call is possible until it exists and is approved. | Blocks all of F02 and everything downstream | OPEN — Warren |
| R-02 | **FSD usage is unreachable by polling — no workaround exists.** The requirement is FSD usage percentage (F05-R03), but `MilesSinceReset` / `SelfDrivingMilesSinceReset` are Fleet Telemetry-only, HW4-only, firmware 2025.44.25.5+. Tesla states verbatim: *"This is the only verifiable and authoritative source of Self-Driving usage data. Reliance on any other method is unsupported, speculative, and risks producing materially inaccurate conclusions."* Independently verified: the `vehicle_data` response exposes only six groups (`charge_state`, `climate_state`, `drive_state`, `vehicle_config`, `vehicle_state`, `media_info`, `gui_settings`) and **no autopilot/FSD group**; scanning the alert dictionary for FSD/autopilot terms returns 600 rows that are all **alerts** (feature unavailable / degraded / fault), never a distance-under-FSD measure. **Decision required** — see options below. | **Blocks the headline FSD metric.** FSD is also AU subscription-only at $149/month across 1M+ km already driven, so it is a live differentiator; a minimal FSD-first telemetry config is materially cheaper than full polling (see R-02b). | OPEN — decision required |
| R-02a | FSD option A — **MVP without FSD.** Ship polling; F05-R11 reports FSD usage as unavailable and flags reduced confidence. Lowest risk, no telemetry host, loses the differentiator at launch. | Launch scope | OPEN |
| R-02b | FSD option B — **Add minimal FSD-first Fleet Telemetry** for HW4 vehicles on 2025.44.25.5+ only. Configures only `MilesSinceReset` + `SelfDrivingMilesSinceReset` (they may only `include_fields` each other, so a minimal config is legitimate and cheap), plus odometer/battery level. Requires the vehicle-command HTTP proxy for signing and a public host that terminates mTLS on :443 for the OTLP/gRPC receiver. **Cost** (estimated by scaling Tesla's published figures — not a quoted price, verify before committing): Tesla publishes an 18-field basic config at ~$0.00636/hour of driving and a 70-signal fleet config at ~$0.00667/hour/vehicle; a 2–3 field config with odometer `minimum_delta` set high (≥1 mi, which `SelfDrivingMilesSinceReset` requires anyway) should land in the low single-digit AUD per vehicle per year at ~1 hour/day driving. Note this **revives the mTLS hosting constraint** previously closed by choosing polling, and Fleet Telemetry configs are **not restored** if a billing limit is breached. Coverage is partial: HW4-only excludes most of the 1,500-member fleet (older Model 3/Y are HW3), and the counters reset on software update / computer replacement / factory reset, so the figure is a *since-reset* ratio, not lifetime. | Partial fleet coverage | OPEN |
| R-02c | FSD option C — **Poll an approximate proxy now, promote to telemetry later.** Derive an FSD *engagement* indicator from polling signals already collectable (`LaneDepartureAvoidance`, `EmergencyLaneDepartureAvoidance`, `CruiseFollowDistance`, `ForwardCollisionWarning`, `SpeedLimitWarning`, `CruiseSetSpeed`, `AutomaticEmergencyBrakingOff`) plus the FSD/autopilot alert stream from `recent_alerts`. This is an *indicator*, not a distance percentage, and MUST be labelled as such — it must **not** be presented to an underwriter as "FSD usage %". | Definitional compromise | OPEN |
| R-03 | **Member authentication path from Member Jungle undecided** (Q11). SSO, signed magic link, or separate login — all unconfirmed. | Blocks F01-R01 implementation | OPEN — Warren |
| R-04 | **Tesla key-pairing UX undecided** (Q12) — same session as connect flow, or separate step. | Affects F01-R08 seamlessness target | OPEN — Warren |
| R-05 | **No AFSL/AR authorisation yet.** AFIRMICO is not an AR; the plan is to gather data first and seek AR approval. | May constrain or rework the offer/binding flow in F07 | OPEN — separate workstream |
| R-06 | **Consent and privacy wording not authored** (Q6, "TBA"). | Blocks F01-R02 and F01-R03 from being finalised | OPEN — Warren |
| R-07 | **Billing limit behaviour is destructive.** Exceeding the limit suspends API access AND removes Fleet Telemetry configurations, which are **not restored** when the limit is raised. Limit is now $100. | A single runaway run could silently break members' data collection | MITIGATED by polling (no telemetry configs), but cost guardrail still required (F04-N03) |
| R-08 | **Concurrent agent collision.** Untracked `.well-known` work exists from agent p9; the private key custody is undocumented. | Duplicate or conflicting key material could break registration | OPEN — coordinate with p9 |
| R-09 | **Postcode-to-lat/long mapping.** The group tier is postcode-segmented and the dashboard maps Australia at postcode level, but Tesla returns GPS coordinates — no mapping is defined. | Blocks F06-R03 and F09-R03 | OPEN — design decision |
| R-10 | **Tesla rate limits are per device, per account** and shared across multiple apps on one account, but the published numeric limits were not retrievable. | Run sizing and retry policy cannot be finalised | OPEN — verify before build |
| R-11 | **Backup and export linkage.** No backup/restore requirement is specified for the Tesla D1 database or R2 raw payloads. | Data-loss exposure | OPEN — likely a later FRS |
| R-12 | **No PII field-level classification** in the catalog beyond Location. | Deletion completeness (F10-N01) depends on knowing exactly which fields are PII | OPEN — design decision |

---

## 8. Suggested Phasing

| Phase | Scope |
|-------|-------|
| 0 | Resolve R-01 (create Tesla developer app), **R-02 FSD decision (a/b/c — gates F05-R03 and whether a telemetry host is needed at all)**, R-03/R-04 (auth + pairing UX), R-06 (consent wording), R-09 (postcode mapping) |
| 1 | FEATURE-02: public key route, partner registration, token lifecycle — the hard gate |
| 2 | FEATURE-03: full field, endpoint, and alert catalogs loaded and verified |
| 3 | FEATURE-08: D1 schema and migrations; R2 raw payload storage |
| 4 | FEATURE-04: scheduled polling collector, one vehicle, then the consented fleet |
| 5 | FEATURE-05: driver profile derivation incl. FSD usage |
| 6 | FEATURE-09: admin dashboard, Australia map, fleet and quality visualisation |
| 7 | FEATURE-06 + FEATURE-07: group-tier aggregates and individual quote packages with secure delivery |
| 8 | FEATURE-10: revocation, deletion, and retention lifecycle |
| 9 | Insurer requirements received → separate reporting FRS |

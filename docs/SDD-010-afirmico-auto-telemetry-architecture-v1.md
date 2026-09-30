# System Design Document (SDD): AFIRMICO Auto — Tesla Fleet Telemetry Platform

**Document ID:** SDD-010  \
**Version:** 1.0  \
**Status:** Draft  \
**Author:** Hermes (Director)  \
**Date:** 2026-09-29  \
**FRS Reference:** [FRS-010](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md)  \
**Source:** Requirements interview + architecture review (owner decisions 2026-09-29)

---

## 1. Scope

Internal architecture for FRS-010: how member consent, Tesla Fleet Telemetry ingestion, driver-profile
derivation, insurer data release, and the admin dashboard are built; where each component lives; and how
data flows between them.

**This SDD supersedes the polling transport.** FRS-010 §3.6 chose polling on the basis that it avoided a
mTLS telemetry host entirely. The owner has since selected Fleet Telemetry as the sole transport and a
minimal **kms + FSD-kms** field set with a 6-hour refresh. Section 1.1 records what that changes.

### 1.1 What the telemetry pivot changes

| Area | Polling design (superseded) | Telemetry design (this SDD) |
|------|------------------------------|------------------------------|
| Transport | Scheduled `GET vehicle_data` | Vehicles push to a self-hosted `fleet-telemetry` server |
| Host requirement | None — Worker-only | One long-lived process terminating client-cert mTLS on :443 (cannot be a Worker) |
| Pairing | Not strictly required for register | **Required** — virtual key must be paired per vehicle |
| Vehicle wake | Deliberate wake per poll | No wakes; vehicle pushes when awake |
| FSD usage | **Blocked** (R-02) | **Resolved** — `SelfDrivingMilesSinceReset` is telemetry-only |
| Fields | `vehicle_data` groups (~120) | Explicit field set — **6 fields** |
| Billing risk | Billing limit removes configs? No configs exist | **A breach removes configs and Tesla does not restore them** |
| Firmware floor | `vehicle_data` broadly available | 2023.20.6+; FSD fields need 2025.44.25.5+ **and HW4** |

**Cost consequence (measured, not estimated):** the field set below produces ~525 signals/vehicle/month
→ **$0.0035/vehicle/month → $5.25/month for a 1,500-vehicle fleet**, against a $10/month account credit.
Tesla API cost is fully absorbed by the credit; total system cost is the infrastructure line ($10.53/mo).

Rejected against this: the same platform collecting high-frequency behaviour fields (`LateralAcceleration`,
`LongitudinalAcceleration`, `BrakePedalPos`) at 60 s cost **$207/month** — 39× more, for data no MVP
consumer needs. Field interval selection, not transport selection, is the cost lever.

---

## 2. Component Boundaries

```text
┌─ TIER 1 · Cloudflare (stateless, scale-to-zero, zero always-on cost) ──────────┐
│                                                                               │
│  Worker  edgegde-calculator        (single worker, existing app)              │
│    /                                    SPA: splash + member portal           │
│    /.well-known/appspecific/            Tesla public key (text/plain)         │
│      com.tesla.3p.public-key.pem                                              │
│    /auth/callback                       Tesla OAuth code exchange            │
│    /admin/*                             operator dashboard (role-gated)       │
│    /api/telemetry/ingest                relay → D1/R2 (shared-secret auth)    │
│    /api/insurer/package/{id}            time-limited CSV download             │
│                                                                               │
│  D1  tesla_* tables        F08 schema (catalog + narrow fact + raw ref)       │
│  R2  raw payloads          one object per vehicle per ingest batch            │
│  Queues  derivation        profile derivation fan-out                         │
│  DO  RATE_LIMITER, AUDIT_LEDGER   (already deployed on this worker)           │
│  Cron  0 */6 * * *         derive profiles, refresh aggregates, signal count  │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ HTTPS POST (shared secret)
                                    │ batched JSONL, 5-minute flush
                                    │
┌─ TIER 2 · Telemetry relay (single small VPS, AU) ────────────────────────────┐
│                                                                               │
│  fleet-telemetry (Go, teslamotors reference impl)                             │
│    • terminates vehicle client-cert mTLS on :443                              │
│    • output: JSONL via the `logger` dispatcher                                │
│    • stateless: holds no database, does no derivation                         │
│                                                                               │
│  vehicle-command HTTP proxy                                                   │
│    • signs fleet_telemetry_config JWS with the private key                    │
│    • one outbound IP → Tesla partner allowlist                                │
│                                                                               │
│  Both share ONE private key. Both restartable from repo + secret.             │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ vehicle pushes when awake
                                    │
                        ┌───────────┴───────────┐
                        │  Member Tesla vehicle │
                        │  (virtual key paired) │
                        └───────────────────────┘
```

**Boundary rule.** The relay is a *span port*: it terminates mTLS, converts protobuf to JSON, and forwards.
It owns no business logic, no schema, and no persistence. Any enrichment, validation, or derivation happens
in Tier 1. This keeps the relay replaceable in minutes and keeps a single writer for the D1 schema.

**Boundary rule.** All Tesla API *calls* (config create, token exchange, fleet_status) originate in Tier 1
and go out through the proxy on Tier 2. The relay never initiates a Tesla call of its own.

---

## 3. Data Flow

### 3.1 FEATURE-02 — Registration and configuration (one-time, per vehicle)

```text
1.  Tier1 → proxy   POST /api/1/partner_accounts   (partner token, domain=auto.afirmi.co)
                    → requires public key already hosted at /.well-known (F02-R01)
2.  Member          https://tesla.com/_ak/auto.afirmi.co  → adds virtual key via Tesla app
                    → key-pairing is user-in-the-loop; cannot be automated
3.  Tier1 → proxy   POST /api/1/vehicles/fleet_telemetry_config  (JWS signed by private key)
                    → skipped_vehicles returns missing_key | unsupported_hardware |
                      unsupported_firmware | max_configs  → recorded per VIN
4.  Vehicle         adopts config on next backend connection
                    → GET .../fleet_telemetry_config until synced = true
```

`max_configs`: a vehicle accepts **3 fleet telemetry configurations** (docs elsewhere say five
third-party apps). Exceeding it returns `limit_reached = true`. This is a hard per-vehicle ceiling that
AFIRMICO shares with any other app the owner runs (e.g. TeslaFi, Home Assistant). It must be surfaced as a
distinct failure, not a generic error.

### 3.2 FEATURE-04 — Telemetry ingest

```text
Vehicle  ──mTLS──▶  fleet-telemetry (:443)
                       │  protobuf Payload {data[], created_at, vin, is_resend}
                       │  rate-limits per VIN, acks after dispatch
                       ▼
                     logger dispatcher → JSONL
                       │  buffered, flushed every 5 min OR 1 MB
                       ▼
Tier1    POST /api/telemetry/ingest   (shared secret)
          1. validate batch shape + VIN against enrolled set
          2. write raw JSONL blob → R2   key: raw/YYYY/MM/DD/{run_id}-{seq}.jsonl
          3. normalise → narrow fact rows (F08-R01) into D1
          4. increment tesla_signal_counter per VIN per day   (F04-N03 cost metric)
          5. upsert tesla_vehicle_connection state
```

**Idempotency.** Each batch carries a relay-generated `batch_id`; re-delivery is a no-op (F04-N05).
**Fault isolation.** A malformed record is quarantined to R2 and skipped, never failing the batch (F04-R11).
**`is_resend`.** Tesla sets this on payloads re-sent after a reconnect; rows are deduplicated on
`(vin, field_key, created_at)`.

### 3.3 FEATURE-05 — Profile derivation

```text
D1 narrow facts ──▶ derivation (deterministic, versioned)
                      │
                      │  distance      = Δodometer over window
                      │  fsd_kms       = ΔSelfDrivingMilesSinceReset over window
                      │  fsd_pct       = fsd_kms / ΔMilesSinceReset
                      │  charging      = ΔBatteryLevel, charging sessions
                      │  home_charging = LocatedAtHome co-occurrence
                      │  confidence    = f(snapshot count, coverage, completeness)
                      ▼
                    tesla_driver_profile (derivation_version, snapshot range)
```

**Critical semantics — the FSD counters reset.** `MilesSinceReset` and `SelfDrivingMilesSinceReset` reset on
software update, computer replacement, or factory reset. Consequences the derivation MUST handle:

- A **decrease** in either counter is a reset, not negative travel. The delta is discarded and the window
  restarts from the post-reset value.
- `fsd_pct` is a **since-reset ratio**, never lifetime. It MUST be labelled as such in every output
  (F05-R13) — an underwriter reading "42% FSD" without the reset caveat would misprice.
- `SelfDrivingMilesSinceReset` **requires `minimum_delta >= 1`** and is HW4 + firmware 2025.44.25.5+ only.
  Vehicles that cannot report it get `fsd_available = false`, not a zero (F05-R11).

### 3.4 FEATURE-07 — Insurer release

```text
Admin ──▶ quote request ──▶ consent check (live, unrevoked)
                              │
                              ├─ no consent → BLOCKED (F07-R02)
                              ▼
                            generate CSV → R2 (private, unguessable key)
                              │
                              ▼
                            signed download URL, time-limited, single-recipient
                              │
                              ▼
                            tesla_data_release audit row (consent version, fields, recipient, ts)
```

The release path is the only code path permitted to read member PII into an outbound artifact, and it
writes an audit row on every invocation.

### 3.5 FEATURE-10 — Revocation

```text
Member revokes
  ├─ policy held?  YES → stop collection (DELETE fleet_telemetry_config), retain until expiry, then delete
  └─                NO  → stop collection (DELETE fleet_telemetry_config), delete immediately
                             │
                             ▼
                    purge D1 rows + R2 raw objects + derived profiles
                    write deletion audit (survives the deletion)
                    group aggregates retained (no PII)
```

**Collection stops at the source.** For a telemetry platform, "stop collecting" means the vehicle must be
de-configured — `DELETE /api/1/vehicles/{vin}/fleet_telemetry_config`. Merely ignoring inbound data would
leave the vehicle streaming, which is both a privacy failure and a continuing Tesla API charge.

---

## 4. Data Structures

### 4.1 Telemetry configuration (the cost-critical artifact)

```json
{
  "vins": ["<vin>"],
  "config": {
    "hostname": "telemetry.afirmi.co",
    "port": 443,
    "ca": "<full LE certificate chain — contents, not a path>",
    "fields": {
      "Odometer":                   { "interval_seconds": 21600, "minimum_delta": 1 },
      "MilesSinceReset":            { "interval_seconds": 21600 },
      "SelfDrivingMilesSinceReset": { "interval_seconds": 21600, "minimum_delta": 1 },
      "BatteryLevel":               { "interval_seconds": 21600, "minimum_delta": 1 },
      "LocatedAtHome":              { "interval_seconds": 21600 },
      "LocatedAtWork":              { "interval_seconds": 21600 }
    }
  }
}
```

**Why this is cheap.** Signals bill on *change*, gated by `interval_seconds` per field, and only while the
vehicle is awake. With a 6-hour interval a field can emit at most 4 times a day, and emits nothing while the
vehicle sleeps. Measured: ~17.5 signals/vehicle/day → 525/month → $0.0035/vehicle/month.

**Delta gate.** `SelfDrivingMilesSinceReset` *requires* `minimum_delta >= 1`, so it only emits when at least
one FSD mile has accrued since its last send. It is already maximally throttled and cannot be throttled
further — this is a Tesla-imposed floor, and it also means the FSD field costs almost nothing.

**Open verification:** whether `interval_seconds` accepts a 6-hour value, or caps lower. The docs show the
1–60 s range and a 10-minute example and do not state a maximum. If 21600 is rejected, fall back to 3600
(1 h), which costs ~$6.60/mo fleet — still inside the credit. **Verify against a live vehicle before
committing the config** (see §7).

### 4.2 D1 tables (additions to the F08 schema)

```sql
-- F08 already defines: tesla_field_catalog, tesla_endpoint_catalog,
-- tesla_alert_dictionary, tesla_vehicle, tesla_energy_site,
-- narrow telemetry fact table, run log, data-access audit.

CREATE TABLE tesla_telemetry_config (
  vin                 TEXT PRIMARY KEY,
  config_hash         TEXT NOT NULL,       -- sha256 of the signed JWS
  fields_json         TEXT NOT NULL,       -- the exact field set + intervals applied
  synced              INTEGER NOT NULL DEFAULT 0,
  limit_reached       INTEGER NOT NULL DEFAULT 0,
  skipped_reason      TEXT,                -- missing_key|unsupported_hardware|
                                           -- unsupported_firmware|max_configs
  applied_at          TEXT,
  last_checked_at     TEXT
);

CREATE TABLE tesla_vehicle_connection (
  vin           TEXT NOT NULL,
  state         TEXT NOT NULL,             -- online|offline|unknown
  observed_at   TEXT NOT NULL,
  PRIMARY KEY (vin, observed_at)
);

CREATE TABLE tesla_signal_counter (
  vin       TEXT NOT NULL,
  day       TEXT NOT NULL,                 -- YYYY-MM-DD UTC
  signals   INTEGER NOT NULL DEFAULT 0,
  est_cost  REAL    NOT NULL DEFAULT 0,    -- signals * (1/150000)
  PRIMARY KEY (vin, day)
);

CREATE TABLE tesla_virtual_key (
  vin           TEXT PRIMARY KEY,
  paired_at     TEXT,
  removed_at    TEXT,                      -- from Locks-screen removal detection
  state         TEXT NOT NULL              -- paired|removed|unknown
);
```

`tesla_signal_counter` is what makes F04-N03 ("cost is a first-class run metric") achievable. Without it the
platform cannot see its own spend until Tesla's invoice arrives.

### 4.3 Narrow fact rows

Reuses the F08 shape; the collected subset is 6 fields:

```text
(vin, collected_at, field_key, value_real, value_int, value_text, value_bool, source_batch_id)
```

`field_key` references `tesla_field_catalog` — which carries **all 239 fields** with `collected = 0` for the
233 not in use, per F03-R07. Expanding the field set later is a config change, not a migration.

---

## 5. File Structure

```text
apps/edge-runtime/                          ← canonical home (existing app, bun, CI-wired)
  public/
    .well-known/appspecific/
      com.tesla.3p.public-key.pem            committed PUBLIC key (text/plain)
  migrations/
    00NN_create_tesla_catalog.sql            F03: 239 + 18,436 + endpoint catalog
    00NN_create_tesla_telemetry.sql          config, connection, signal counter, virtual key
    00NN_create_tesla_facts.sql              narrow fact + raw ref
    00NN_create_tesla_profiles.sql           derived profile + derivation version
    00NN_create_tesla_release.sql            release audit + download tokens
  src/
    tesla/
      auth.ts                                token lifecycle (client_credentials + PKCE)
      register.ts                            partner registration + public_key verify
      configure.ts                           fleet_telemetry_config create/delete/get
      ingest.ts                              /api/telemetry/ingest → R2 + D1
      derive.ts                              deterministic profile derivation
      release.ts                             packaged CSV + signed download URLs
      revoke.ts                              de-configure + purge
    admin/                                   dashboard + map
  wrangler.json                              + D1_TESLA binding, + R2_TESLA, + cron
```

```text
infra/telemetry-relay/                      ← NEW, separate deploy unit
  README.md                                 host, ports, mTLS, cert renewal
  server_config.json                        fleet-telemetry config (JSONL + connectivity)
  relay.ts | relay.py                       batch + POST to /api/telemetry/ingest
  check_server_cert.sh                      Tesla's validator (mTLS pre-flight)
  deploy.md                                 runbook: fresh host → streaming in prod
```

The relay is deliberately outside `apps/edge-runtime/` because it deploys to a different target and must be
replaceable without touching the Worker.

---

## 6. Invariants

1. **The private key never leaves the enterprise boundary.** Not in the repo, not in D1, not in logs, not
   in the relay's config file — environment variable or secrets store only. It signs both telemetry config
   and vehicle commands; its compromise is total.
2. **The public key is frozen.** Once registration succeeds, the key pair MUST NOT rotate. Tesla requires
   the registered public key to *remain* hosted; rotation invalidates the key on every paired vehicle.
   Rotation is a re-pairing migration, not a routine operation. (Tesla explicitly recommends the
   configuration-signing key be held offline and in an HSM.)
3. **One writer for the Tesla schema.** Only Tier 1 writes D1. The relay never writes a database.
4. **Derivation is deterministic and versioned.** Identical inputs → byte-identical output; every profile
   records its `derivation_version` and source snapshot range.
5. **No fabricated values.** An absent field yields `unavailable` and reduced confidence, never a
   substituted estimate (F05-R11).
6. **Collection stops at the source on revocation** — de-configure the vehicle, don't merely ignore traffic.
7. **Every outbound release carries a consent version and writes an audit row.**
8. **Raw payloads are replayable for the retention window** — a parsing bug is fixable without re-asking
   members to stream.

---

## 7. Failure Modes

| Failure | Detection | Handling |
|---------|-----------|----------|
| **Billing limit breached** | Tesla 80%/100% emails; `tesla_signal_counter` trend | ⚠️ **Configs are removed and NOT restored.** Requires: limit set well above projected spend, 80% alert wired, and a re-apply runbook (F02-N04). Highest-severity failure in the system. |
| `interval_seconds` rejected | config create returns an error | Fall back to 3600; record which interval is live per VIN |
| `missing_key` | `skipped_vehicles` on config create | Surface in portal as "pair your vehicle"; re-drive pairing |
| `max_configs` / `limit_reached` | config get | Distinct error — owner must free a slot in another app; cannot be resolved by AFIRMICO |
| `unsupported_firmware` | `skipped_vehicles` | Hold vehicle; re-attempt on next `fleet_status` firmware check |
| Relay host down | ingest heartbeat gap > 2 × flush interval | Alert operator. Vehicles reconnect automatically; **no data is lost from the vehicle's perspective** but unsent batches are. |
| Certificate expiry | `check_server_cert.sh`, cert-expiry monitor | Vehicle mTLS fails silently at expiry — automate renewal + alert (F02-N05) |
| Counter reset (FSD/mileage) | negative delta in derivation | Discard window, restart from post-reset value, flag discontinuity |
| Token refresh failure | auth error on scheduled run | Defer the run and alert; never block other vehicles (F02-R05) |
| Partial batch | malformed record | Quarantine to R2, skip, count; never fail the batch |

---

## 8. Verification Strategy

1. **Public key pre-flight** — `GET /.well-known/appspecific/com.tesla.3p.public-key.pem` returns
   `text/plain` with byte length matching the committed file, and **openssl parses it**. Today the domain
   returns SPA HTML on that path (R-01 blocker).
2. **mTLS pre-flight** — Tesla's `check_server_cert.sh` passes against the relay host before any config
   is pushed.
3. **Registration** — `POST /partner_accounts` succeeds; `GET /partner_accounts/public_key?domain=`
   returns the exact key.
4. **Field-set acceptance** — config create returns no `skipped_vehicles` for a supported test vehicle, and
   `synced = true` on poll. **This is where the 6-hour interval question is settled empirically.**
5. **Signal economy** — after 7 days on a test vehicle, `tesla_signal_counter` is within ±20% of the
   modelled 525/month/vehicle. A large overshoot means the interval is not being honoured.
6. **FSD derivation** — a profile over a known window matches hand-computed
   `ΔSelfDrivingMilesSinceReset / ΔMilesSinceReset`, and a forced reset marker produces a discarded window
   rather than a negative figure.
7. **Determinism** — two derivation runs over a fixed snapshot set produce byte-identical JSON.
8. **Revocation** — after revoke, `GET fleet_telemetry_config` confirms the config is gone and no further
   batches arrive; D1 rows and R2 objects for that VIN are absent.
9. **Release control** — an expired download URL is refused; the attempt is logged; no PII appears in the
   email body.

---

## 9. Open Items

| ID | Item | Owner |
|----|------|-------|
| O-1 | **Does `interval_seconds` accept 21600 (6 h)?** Verify on a live vehicle. Fallback 3600 modelled. | Build phase |
| O-2 | **Relay host choice** — owner to nominate the VPS; must offer a public :443 with an open inbound port and a static/public IP. | Warren |
| O-3 | **Tesla developer app creation** (R-01) — gates registration; nothing streams until it exists. | Warren |
| O-4 | **Tesla outbound-IP requirement** — confirm whether the partner allowlist requires a static IP, which would constrain the host choice. | Build phase |
| O-5 | **Consent wording** (R-06) — must disclose data leaves the vehicle to a US processor (Tesla) and to insurers (APP 8). | Warren |
| O-6 | **D1_TESLA binding decision** — extend `D1_AFIRMICO` vs provision a dedicated database per F08-R09. | Build phase |

---

## 10. Related Documents

| Artifact | Relation |
|----------|----------|
| [FRS-010](./FRS-010-afirmico-auto-tesla-fleet-data-v1.md) | Requirements this SDD implements (v1.4 supersedes the polling transport) |
| [SDD-007](./SDD-007-action-ledger-budget-guardrails-v1.md) | Architectural precedent and document convention |
| `docs/engineering/tesla-public-key-custody-coordination.md` | SUPERSEDED — retained for history |
| `apps/EdgeGDE - Document DB/Tesla APP DB/fleet_streaming_fields.csv` | 239-field catalog source (F03) |
| `apps/EdgeGDE - Document DB/Tesla APP DB/alert_dictionary.csv` | 18,436-alert dictionary source (F03) |
| https://developer.tesla.com/docs/fleet-api/fleet-telemetry | Transport, interval, and `include_fields` semantics |
| https://developer.tesla.com/docs/fleet-api/billing-and-limits | Pricing, billing-limit behaviour, rate limits |
| https://github.com/teslamotors/fleet-telemetry | Relay reference implementation |
| https://github.com/teslamotors/vehicle-command | Config-signing proxy |

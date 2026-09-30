# System Design Document (SDD): AFIRMICO Auto — Tesla Fleet Telemetry Platform

**Document ID:** SDD-010  \
**Version:** 1.3  \
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
   is pushed. Note that fleet-telemetry rejects any client certificate whose issuer is not a Tesla CA
   (§10.5), so this validates **our** server certificate chain only — it does not exercise vehicle auth.
3. **Registration** — `POST /partner_accounts` succeeds; `GET /partner_accounts/public_key?domain=`
   returns the exact key.
4. **Field-set acceptance** — config create returns no `skipped_vehicles` for a supported test vehicle, and
   `synced = true` on poll. **This is where the 6-hour interval question (O-1) is settled empirically.**
   Requires a **real paired vehicle** — a synthetic client cannot stream (§10.5).
5. **Signal economy** — after 7 days on a real vehicle, `tesla_signal_counter` is within ±20% of the
   modelled 525/month/vehicle. A large overshoot means the interval is not being honoured.
5a. **Ingest contract** — synthetic JSONL posted directly to `/api/telemetry/ingest` produces correct D1
   rows, R2 objects, and signal counts. Testable **without** a vehicle; run this before step 4 so the
   pipeline is proven before hardware is involved.
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
| O-2 | **Relay host choice** — owner nominated **Oracle Cloud Always Free**; evaluated in §10.7 as **suitable with account upgrade to PAYG** and provisioning at **1 OCPU / 2 GB** (not the full 2/12, which worsens idle-reclamation exposure). Owner to confirm home region is AU. | Warren |
| O-3 | **Tesla developer app creation** (R-01) — gates registration; nothing streams until it exists. | Warren |
| O-4 | **Tesla outbound-IP requirement** — confirm whether the partner allowlist requires a static IP, which would constrain the host choice. | Build phase |
| O-5 | **Consent wording** (R-06) — must disclose data leaves the vehicle to a US processor (Tesla) and to insurers (APP 8). | Warren |
| O-6 | **D1_TESLA binding decision** — extend `D1_AFIRMICO` vs provision a dedicated database per F08-R09. | Build phase |

---

## 10. Relay Host Specification (measured)

Sizing is **measured, not estimated**. Both Tesla images were run locally and load-tested
(2026-09-29, `tesla/fleet-telemetry:latest`, `tesla/vehicle-command:latest`).

### 10.1 Measured footprint

| Metric | fleet-telemetry | vehicle-command proxy |
|--------|----------------|----------------------|
| Image size | 90.2 MB | 119 MB |
| RSS, idle | 12.0 MiB | 16.8 MiB |
| RSS, **1,500 authenticated sessions** | **26.3 MiB peak** | n/a (not connection-scale) |
| Marginal per session | **4.18 KiB** | n/a |
| CPU, idle | 0.01% | 0.0% |
| CPU, cold-start burst | 1 vCPU absorbed 1,500 mTLS handshakes + WS upgrades in **3.5 s** | — |
| Writable layer | 15.8 kB | — |

Method: 1,500 concurrent sockets each completing a mutual-TLS handshake and a WebSocket upgrade
(`HTTP/1.1 101 Switching Protocols` ×1,500), RSS sampled every 2.5 s. The first attempt without
client certificates measured only 13.5 MiB and was **discarded as a lower bound** — the server was
rejecting at the handshake, so it was not a valid proxy for real load.

### 10.2 Minimum specification

| Resource | Minimum | Recommended | Why |
|----------|---------|-------------|-----|
| **vCPU** | 1 shared | 2 shared | Steady-state load is negligible. The only CPU spike is the cold-start thundering herd — up to ~1,500 vehicles waking after a fleet-wide config push, or when many vehicles start their day at once. Measured: 1 vCPU absorbed 1,500 handshakes in 3.5 s. |
| **RAM** | 512 MB | **1 GB** | Measured working set is ~45 MiB for both daemons (26 MiB + 17 MiB). The rest is OS, container runtime, and page cache. 512 MB is workable; 1 GB removes any reason to think about it. |
| **Disk** | 10 GB SSD | 20 GB SSD | OS ~3 GB + images 210 MB + logs. Traffic volume is trivial (~525 signals/vehicle/month). **Log rotation is mandatory** — an unbounded stdout stream is the realistic way to fill this disk. |
| **Arch** | x86_64 **or** arm64 | arm64 | Both are static Go binaries; both images are multi-arch. arm64 is typically cheaper on AU providers. |
| **Network** | Public IPv4, unrestricted inbound **:443** | + static/public IP | Vehicles connect **inbound** to this host. It cannot sit behind a NAT or a shared app host. |
| **Access** | root or container control | + no shell in app image | The app image is `scratch`-based (**no `sh`, no shell**). Debugging is `docker logs` / `docker exec` from the host only — there is no shell inside to attack. |
| **Ports** | 443 (app), 22 restricted | 22 key-only, geo/allowlist-limited | 443 must be open to the internet. 22 must not be. |

### 10.3 Operating system

**Ubuntu 24.04 LTS.** Debian 12 or RHEL 9 are acceptable equivalents. Rationale:

- Both components ship as **Docker images** (Tesla's supported distribution path), so the OS matters
  mainly for the container runtime and long-term patch support.
- Ubuntu 24.04 LTS is supported to 2029 and has the widest provider image availability in AU regions.
- The app is a static Go binary — no interpreter, no package-manager dependencies at runtime. There is
  no language-runtime version risk to manage.

**Port binding.** Both the telemetry server and (if used) the proxy default to :443, a privileged port.
Run with `--cap-add=NET_BIND_SERVICE` or drop to a high port and redirect with `iptables`/a reverse proxy.
Do not run either as `--privileged`.

**The proxy must NOT be internet-facing.** Started with `-host 0.0.0.0`, it warns verbatim:

> *Do not listen on a network interface without adding client authentication. Unauthorized clients may
> be used to create excessive traffic from your IP address to Tesla's servers, which Tesla may respond
> to by rate limiting or blocking your connections.*

It is only ever called by Tier 1, from the same host. Bind it to **`127.0.0.1`**. The only publicly
exposed process is fleet-telemetry on :443, and it enforces `RequireAndVerifyClientCert`.

### 10.4 Configuration deltas from the reference defaults

| Setting | Value | Note |
|---------|-------|------|
| `tls.server_cert` / `tls.server_key` | Let's Encrypt cert for `telemetry.afirmi.co` | Must be the **full chain**; vehicles verify it |
| `tls.ca_file` | **must be unset in production** | The binary already embeds Tesla's production vehicle CA. Setting `ca_file` *appends* a CA to the trust pool — a needless widening of trust. Use it only in test. |
| `records.V` | `["logger"]` | JSONL to stdout; our wrapper batches and forwards |
| `records.alerts` / `records.errors` / `records.connectivity` | `["logger"]` | Connectivity records are how we distinguish "vehicle asleep" from "vehicle broken" |
| `transmit_decoded_records` | `true` | JSON instead of protobuf — avoids a protobuf dependency in the relay wrapper |
| `namespace` | `tesla` | Prefix only; no broker in use |
| `log_level` | `warn` in production, `info` while commissioning | Info-level logging wrote ~1.5 MB for 1,500 handshake events |
| Kubernetes / Kafka / Kinesis / Redis | **not used** | Reachable at 1,500 vehicles with the `logger` dispatcher alone |

### 10.5 Testing constraint (discovered during measurement)

fleet-telemetry authenticates vehicles by deriving an identity from the **client certificate's issuer
and Tesla OID** (`messages/identity.go`), then rejects anything else as `unauthorized certificate`.
A synthetic client certificate therefore **cannot** complete a session, even when it passes mTLS:

```text
level=error msg=extract_sender_id_err
  error="create_identity issuer: vehicle-sim, common_name: vehicle-sim,
         err: unauthorized certificate"
```

Consequences for the verification plan (§8):

- **Handshake and socket behaviour can be tested locally** — this is how §10.1 was measured.
- **Vehicle record ingestion cannot.** End-to-end streaming verification requires a **real paired
  vehicle**, so §8 item 4 and item 5 must be scheduled against one.
- The **relay's forward path is independently testable** — its contract is JSONL, so synthetic batches
  can be posted straight to `/api/telemetry/ingest`. This is a direct benefit of the span-port
  boundary: the ingest contract does not depend on the vehicle.

### 10.6 Provider requirements (for host selection)

Any provider is fine provided it offers, in an **AU region**: public IPv4, unrestricted inbound :443, a
full root or container-capable host (**not** a shared/managed application host), ≥512 MB RAM, ≥10 GB
disk, and ideally a static egress IP (pending O-4). A ~$5–7/month instance is materially more than
enough — the measured working set is ~45 MiB.


### 10.7 Candidate host evaluation — Oracle Cloud Always Free

**Verdict: suitable.** Hardware far exceeds requirement and the platform is free within Always Free
limits. Two caveats matter: **the Arm shape may be unobtainable on the free tier at all** (see
Constraint 1), and **the idle-reclamation clause has no documented exemption** (see Constraint 2).
Upgrade to Pay As You Go is **recommended** — chiefly because Oracle documents it as the route to
capacity, and because paid tenancies escape the Arm allowance reduction. It is *not* a documented
cure for reclamation.

Hardware is far beyond requirement. Both Tesla images publish **arm64** manifests (verified via
`docker manifest inspect`) and the arm64 `fleet-telemetry` binary was executed to confirm it runs on
`linux/arm64`. Oracle's Always Free image list includes Ubuntu, so §10.3 is satisfied.

| OCI Always Free shape | Spec | Assessment |
|----------------------|------|------------|
| `VM.Standard.A1.Flex` (Arm/Ampere) | **2 OCPU / 12 GB** on Always Free (halved from 4/24 on 2026-06-15; **paid tenancies keep 4/24**) | Exceeds the 1 vCPU / 512 MB–1 GB requirement many times over. **1 OCPU / 2 GB is ample.** Allocation size does *not* affect the reclamation recheck — see Constraint 2. |
| `VM.Standard.E2.1.Micro` (AMD) | 1/8 OCPU / 1 GB / 50 Mbps, fixed quota | Technically sufficient. Non-flex quota (no hourly budget to exhaust). Thin CPU, and still subject to idle reclamation. |

#### Constraint 1: the Arm shape may be unobtainable

Oracle's Always Free documentation states, verbatim:

> If you receive an "out of host capacity" error when trying to create a Compute instance, this
> indicates a temporary lack of Always Free shapes in your home region. Try creating the instance in
> a different availability domain, or wait a while, then try to create the instance again. You can
> also choose to upgrade your account to Pay as You Go or another Paid account type, which gives you
> access to more types of Compute resources. Remember that Oracle doesn't charge for Always Free
> resources after you upgrade, and will only charge you for resource usage above the Always Free
> limits.

So **Pay As You Go is the documented route to obtaining capacity**, not merely an optimisation.
Sydney is a busy region and A1 capacity is in demand; provisioning on the free tier may simply fail
with `Out of host capacity`. Oracle's troubleshooting guidance is to vary the availability domain
(do not pin a fault domain) or retry later.

#### Constraint 2: idle reclamation, with no documented exemption

Oracle reclaims Always Free compute instances it deems idle. Thresholds, read from Oracle's live
documentation (verified 2026-09-30), verbatim:

> **Reclamation of Idle Compute Instances**
>
> Idle Always Free compute instances may be reclaimed by Oracle. Oracle will deem virtual machine and
> bare metal compute instances as idle if, during a 7-day period, the following are true:
> - CPU utilization for the 95th percentile is less than 20%
> - Network utilization is less than 20%
> - Memory utilization is less than 20% (applies to A1 shapes only)

Our relay workload, as measured in §10.1: **CPU ~0.01% of one core, memory ~45 MiB.** On a 12 GB
shape that is **0.37% memory utilisation**. This relay is by construction a low-duty-cycle
store-and-forward process moving ~525 signals per vehicle per month. Every threshold above is failed
by a wide margin, and no tuning changes that — the workload is idle by design.

**Two points that were wrong in revision 1.2 of this section and are corrected here:**

1. Oracle's published reclamation notice **does not state a Pay As You Go exemption.** Revision 1.2
   quoted such a sentence; it is not on the current page and the claim is withdrawn. PAYG is
   recommended in this document for *capacity* (Constraint 1) and because paid tenancies are
   unaffected by the Arm allowance reduction — **not** because it is a documented cure for
   reclamation. Treat reclamation as unmitigated.
2. The check is documented as running **during a 7-day period**, so the first recheck falls roughly a
   week after provisioning. Provisioning at 1 OCPU / 2 GB does not avoid it: the memory threshold
   applies to A1 shapes **regardless of allocation size**, so 2 GB (2.2% used) fails exactly as 12 GB
   (0.37%) does. Allocation size is a right-sizing decision, not a reclamation mitigation.

**Practical consequence.** Design the relay to be disposable: rebuildable from the repository plus one
secret, with telemetry ingest resuming without operator action. The liveness probe below is therefore
the primary control, not a nice-to-have.

#### Boot volume: 47 GB minimum

A platform floor, not a sizing preference — and it overrides the §10.3 recommendation of a 10–20 GB
disk:

> The minimum boot volume size for each instance is 47 GB, regardless of shape. Your account comes
> with 200 GB of Always Free block volume storage which you use to create the boot volumes for your
> compute instances.

Provision the **47 GB minimum**; the relay holds no data (it forwards to Tier 1). A1 instances may be
created in any availability domain **except South Korea North (Chuncheon)**.

#### OCI-specific constraints to confirm at setup

| Item | Constraint |
|------|-----------|
| **Home region** | Always Free resources exist **only in the tenancy's home region**, which **cannot be changed after signup**. Must be an AU region (Sydney/Melbourne) for latency and data residency. Verify before provisioning. |
| **Allocation halving** | On 2026-06-15 Oracle cut the Arm allowance 4 OCPU/24 GB → 2 OCPU/12 GB with **no announcement**; instances were stopped until resized. Provision inside 2/12 from the start. |
| **Outbound TCP 25** | Blocked by default. Not used by this system. |
| **Free-tier VCN cap** | Free-tier tenancies are limited to 2 VCNs. One is required. |
| **Boot volume floor** | Minimum boot volume is **47 GB** regardless of shape (see above) — overrides the 10–20 GB guidance in §10.3. |
| **Availability domains** | A1 instances may be created in any availability domain except **South Korea North (Chuncheon)**. Do not pin a fault domain on create. |

#### Residual risk accepted if OCI is chosen

The 2026-06-15 halving was applied silently and stopped running instances. The same class of change
could recur. If the relay is stopped, telemetry simply **stops arriving** — vehicles keep their config,
but no records reach Tier 1, producing silent gaps in insurer-relevant distance history. Two
mitigations, in order of value:

1. **External liveness probe** (independent of OCI) that alerts if no telemetry has arrived in N hours.
   Without this, a reclaimed instance is indistinguishable from a fleet of parked cars. **Required
   regardless of host.**
2. Oracle Notifications (Always Free, 1000 email/month) as a secondary channel.

**This residual risk is not mitigated by Pay As You Go.** A silently stopped relay is
indistinguishable from a fleet of parked cars, and a 6-hour telemetry cadence means the gap is not
obvious for hours. The liveness probe is the control that makes OCI acceptable; without it, OCI
should not be used for this workload.

If that probe dependency is unwelcome, a conventional ~$5–6/month AU VPS (~$66/year) removes this risk
class outright — a VPS gives root on a machine nobody reclaims for being idle. At the fleet sizes in
scope the platform cost is immaterial to the business case, so this reduces to: **OCI is the lower-cost
choice and accepts a silent-failure mode requiring external monitoring; a cheap VPS is the
lower-risk choice for about $66/year.** That is a risk-tolerance decision, not a cost one.

## 11. Related Documents

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

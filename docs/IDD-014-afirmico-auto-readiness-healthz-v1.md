# Interface Design Document (IDD): AFIRMICO Auto — Readiness Endpoint (`/healthz`)

**Document ID:** IDD-014  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-13  
**Spec:** FRS-010 v2.8 (F11-R03/R04, F02-R13, F01 AC5/AC6, F09-R13 pending)  
**Design:** SDD-010 v1.13

---

## 1. Purpose

`GET /healthz` is the single machine-readable statement of "is this deployment
healthy". Its consumers are the deploy pipeline's post-deploy gate (F11-R03),
the operator, and the scheduled GitHub-notification monitor. This IDD fixes the
response contract so a consumer can trust it without parsing prose.

## 2. Transport

```
GET /healthz            no authentication required
Cache-Control: no-store (F11-R04 — a readiness endpoint that can serve a stale
                         deployment is worse than none)
```

## 3. Response shape (live, 2026-10-13)

```json
{
  "status": "ok",
  "service": "afirmico-tesla",
  "version": "2026-10-03.2",
  "problems": [],
  "checks": {
    "d1": "ok",
    "fields": "272",
    "policies": "2",
    "consent_text": "ok",
    "collected_fields": "15",
    "consent_field_set": "ok",
    "billing_margin": "5878.80615x",
    "billing_projected_usd": "0.0170",
    "billing_consumed": "0.000",
    "active_configs": "1",
    "telemetry_facts": "910",
    "verified_configs": "1",
    "telemetry_flow": "ok",
    "telemetry_last_fact": "2026-10-13T01:01:48.494Z"
  }
}
```

## 4. Check semantics — what each check proves, and what it cannot

| Check | Proves | Does NOT prove |
|-------|--------|----------------|
| `version` | the authoritative consent policy version served by this deployment | that members consented under it |
| `d1` | schema reachable | migration currency beyond what `fields` reports |
| `fields` = 272 | catalog is the full Fleet API universe (F03-R07) | that any field is collected |
| `consent_text` | served text hash-matches the stored policy (F01 AC5) | — |
| `consent_field_set` = ok | catalog `collected = 1` set == `CONSENTED_FIELDS` by name (F01 AC6) | that every collected field has ever delivered data |
| `collected_fields` = 15 | current collection scope (§3.7) | — |
| `billing_margin` ≥ 10x | safety margin against an unrecoverable config-stripping breach (F02-R13) | that the limit is configured — **unset MUST report `unconfigured`, never healthy** (v1.23) |
| `billing_projected_usd` / `billing_consumed` | month-to-date + day-scaled projection | — |
| `active_configs` / `verified_configs` | vehicles Tesla reports configured / verified | per-field correctness of those configs |
| `telemetry_flow` = ok | a fact arrived inside the freshness window | which fields flowed — a single Odometer heartbeat satisfies it (identity fields may still be absent, F04-R17) |
| `telemetry_last_fact` | the newest fact's `observed_at` | attribute-clock freshness — this is the RECORD clock (F09-R14) |

## 5. `problems[]` semantics

- `[]` → `status: "ok"`.
- Non-empty → every entry names a specific misconfiguration
  (`Not configured: <name>`); the endpoint MUST degrade (non-ok status) rather
  than omit a problem. An unset billing limit is a problem, not a pass.
- **Invariant:** `status: "ok"` with a broken check MUST NOT be representable —
  each check's failure path appends to `problems[]`.

## 6. Known evolution (open)

- **F09-R13 (FRS v2.8):** `checks` will gain per-vehicle config states that
  distinguish *awaiting owner authorisation* (expected — F02-R17) from genuine
  failure. Until then an unauthorised vehicle's `failed` state is invisible
  here (only `active_configs` counts are exposed), which is why the readiness
  review misread it as a blocker.
- **F09-R15:** `telemetry_last_fact` is the reliable recency signal;
  `tesla_vehicle.last_seen_at` is enumeration-frozen and MUST NOT be consumed
  as readiness.

## 7. Out of scope

Auth-gated operational endpoints (`/admin/*`), relay-side health (monitored on
the relay host), alert delivery (F02-R13 alert stamping is D1-side).

---

## 8. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-13 | Initial: response shape from live production, per-check prove/can't-prove table, `problems[]` invariants, open F09-R13/R15 evolution. Created during the FRS/SDD/IDD consolidation round (FRS-010 v2.8). |
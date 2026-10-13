# Interface Design Document (IDD): AFIRMICO Auto — Data Export & Scheduled Reporting

**Document ID:** IDD-013  
**Version:** 1.0  
**Status:** Draft  
**Author:** Hermes (Director)  
**Date:** 2026-10-13  
**Spec:** FRS-010 v2.8 (FEATURE-13, F13-R01..R18)  
**Design:** SDD-010 v1.13 §"Export path as built"

---

## 1. Purpose

Contracts between four actors: the admin console (`/admin/exports`), the export
engine (`src/export.ts` + `src/export-worker.ts`), the cron tick
(`scheduled()` in `src/index.ts`), and the email transport (Cloudflare Email
Workers `send_email` binding). Requirements F13-R17 (scheduler must execute)
and F13-R18 (real transport only) are the load-bearing invariants.

## 2. Storage contracts (migration 0018)

### 2.1 `telemetry_export_schedule` — the target

| Column | Contract |
|--------|----------|
| `scope` | `all \| group \| vehicle` — `group_id`/`vin` must match the scope |
| `time_range` | `hour \| week \| month \| year \| all` |
| `format` | `csv \| xlsx \| pdf` |
| `recurrence` | `hourly \| daily \| weekly \| monthly \| yearly \| specific_date \| specific_weekdays` |
| `recurrence_config` | JSON: time-of-day, weekday set, specific date |
| `recipients` | JSON array of email addresses — MUST be non-empty when `enabled = 1` |
| `email_template` | JSON `{subject_template, body_template}` with placeholders |
| `enabled` | 0/1 toggle; disabled schedules MUST NOT fire |
| `next_run_at` | computed by the scheduler AFTER due-schedules are read (PR #236 ordering: `getDueSchedules` **before** `updateAllNextRunTimes` — reversing these double-fires or never-fires a run) |
| `last_run_at` / `last_run_status` | last attempt: `delivered \| failed \| partial` |

### 2.2 `telemetry_export_run` — one attempt

| Column | Contract |
|--------|----------|
| `run_id` | PK; referenced by audit rows |
| `delivery_status` | `pending → delivered \| failed \| partial` — `pending` MUST resolve; an enabled schedule past `next_run_at` MUST NOT present `never` (F13-R17) |
| `row_count`, `file_size`, `file_sha256` | recorded per run; sha-256 makes the artifact byte-reproducible (F13-R04/R13) |
| `error_detail` | populated only on `failed`/`partial` |

### 2.3 `telemetry_export_audit` — append-only history

`action ∈ generated \| email_sent \| email_failed \| retry \| catchup` with JSON
`detail` and `occurred_at`. Every state transition of §2.2 MUST leave one audit
row; `retry` rows carry attempt numbers, `catchup` rows mark missed-schedule
recovery (F13-R16).

## 3. Cron contract

```
*/5 * * * *  →  scheduled()  →  runExportSchedule(env)
```

- Due schedules are read first, then `next_run_at` advances (§2.1 ordering).
- Generation failure of one schedule MUST NOT abort the others in the tick.
- A schedule enabled and past-due after two consecutive ticks MUST appear as
  failed in `/admin/exports`, never as silently `never` (F13-R17).
- Large exports split per policy; a split that delivers 2 of 3 parts records
  `partial`, never `delivered` (F13-R08/R18).

## 4. Email transport contract

- Binding: `send_email` — a **Cloudflare Email Workers array binding**
  (wrangler config shape fixed in PRs #234/#238; a non-array binding fails
  deploy validation).
- `delivered` MUST be written only after the transport accepts the message
  (2xx). `sendEmail()` MUST NOT fabricate `message_id` or report `success`
  without a transport call — the placeholder implementation recorded at FRS
  v2.5 is the anti-contract this IDD forbids (F13-R18).
- Failure → `email_failed` audit row, `failed` status, retry with exponential
  backoff (`retry` audit rows); retries exhausted → terminal `failed` +
  operator-visible on `/admin/exports`.

## 5. Console surface (`/admin/exports`)

Reads §2 tables; `POST /admin/exports/run-now` MUST create a `pending` run row
and return its `run_id` synchronously — actual generation is the engine's job,
never inlined in the request path. Schedule CRUD writes `created_by` /
`updated_at` and recomputes `next_run_at`.

## 6. Out of scope

File-format internals (CSV escaping, XLSX/PDF rendering), placeholder
expansion grammar, recipient-list UX. Consent scope gating of WHAT may be
exported is F07/F10's concern, enforced upstream of this contract.

---

## 7. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-13 | Initial: storage, cron, transport and console contracts as built (1 schedule, 8 runs, 14 audits in production); F13-R17/R18 invariants stated as MUSTs. Created during the FRS/SDD/IDD consolidation round (FRS-010 v2.8). |
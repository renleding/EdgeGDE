# Implementation Plan: FEATURE-12 & FEATURE-13

## Phase 1: Database Migrations (FEATURE-12 core schema)

### 1.1 Migration: telemetry_config_scopes (0016)
- `telemetry_config_scope` — global/group/vehicle scope definitions
- `telemetry_config_entry` — sparse field entries per scope
- `tesla_vehicle_group` / `tesla_vehicle_group_member` — owner-curated groups
- `config_apply_run` — apply run tracking
- `config_apply_outcome` — per-vehicle outcomes

### 1.2 Migration: seed_global_scope (0017)
- Seed global scope from catalog with interval_seconds = 180

## Phase 2: Core Resolution Engine

### 2.1 `src/config-scope.ts`
- `resolveConfig()` — pure function: global > group > vehicle, sparse inheritance
- Returns `ResolvedConfig` with provenance per field
- Validates total base (all collected fields present in global)

### 2.2 `src/config-apply.ts`
- `applySweep()` — scheduled sweep with canary, eligibility, verification
- `sendVehicleConfig()` — single VIN config send via signer
- Three-condition verification: POST + has_config + synced + telemetry observation
- Bounded concurrency, idempotent re-runs

### 2.3 `src/config-groups.ts`
- Group CRUD (create, read, update, delete, list members)
- Owner-curated, NOT derived from segment keys

## Phase 3: Admin Console Extensions

### 3.1 `src/admin.ts` additions
- `/admin/telemetry/configurator` — read effective values + staging writes
- GET shows effective config + provenance + drift
- POST stages changes (writes to staging tables only)
- `/admin/telemetry/apply` — triggers sweep (canary only)

## Phase 4: FEATURE-13 Export & Scheduling

### 4.1 Migration: export_scheduling (0018)
- `telemetry_export_schedule` — recurring/adhoc schedules
- `telemetry_export_run` — run history with metadata
- `telemetry_export_audit` — audit trail

### 4.2 `src/export.ts`
- Export generation (CSV, Excel, PDF)
- Time range filtering (hour/week/month/year/all)
- Scope filtering (all/group/vehicle)
- PDF cover page with disclaimer

### 4.3 `src/scheduler.ts`
- Calendar-style recurrence (hourly/daily/weekly/monthly/yearly/specific date/weekdays)
- Cron trigger or Durable Object
- Exponential backoff retry (5min, 15min, 60min)
- Missed schedule catch-up

### 4.4 `src/email.ts`
- SMTP delivery with attachments
- Template rendering with placeholders
- Large file splitting (>25MB)

### 4.5 Admin console for exports
- `/admin/exports` — list/create/edit/delete schedules
- Ad-hoc export trigger
- Run history with status

## Phase 5: Verification & Tests

### 5.1 Unit tests
- Resolution engine: inheritance, shadowing, sparse, total-base
- Config apply: canary eligibility, three-condition verification, halt
- Export generation: formats, metadata, SHA-256

### 5.2 Integration tests
- Full sweep with mocked signer
- Scheduled export with mock email

### 5.3 Schema verification
- `verify-schema.sh` passes including D1 statement-size gate

---

## File Creation Order

1. `migrations/0016_config_scopes.sql`
2. `migrations/0017_seed_global_scope.sql`
3. `src/config-scope.ts`
4. `src/config-apply.ts`
5. `src/config-groups.ts`
6. `src/admin.ts` additions
7. `migrations/0018_export_scheduling.sql`
8. `src/export.ts`
9. `src/scheduler.ts`
10. `src/email.ts`
11. `src/admin.ts` export additions
12. Test files

---

Let's start implementing.
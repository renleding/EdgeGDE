# Implementation Plan Specification — Edge Document Intelligence Platform v1

**File:** `IPS-edge-document-intelligence-v1.md`  
**Status:** Approved  
**Based on:** FRS v1.0 (approved with 10 refinements)  
**Runtime:** Cloudflare Workers + Python M1 Poller

---

## 1. Repository Layout

```
apps/edge-runtime/
  src/
    api/
      doc-intel/                 ← New module
        index.ts                ← Router mount + tenant dispatch
        routes/
          ingest.ts             ← POST /api/v1/doc-intel/ingest
          jobs.ts               ← GET/POST job lifecycle
          documents.ts          ← GET document metadata
          search.ts             ← GET search endpoint
          retry.ts              ← POST retry/reset
          audit.ts              ← GET audit log
        lib/
          db.ts                 ← Doc-intel D1 accessor (tenant-aware)
          audit.ts              ← Audit log writer
          encryption.ts         ← AES-GCM crypto helpers
          key-registry.ts       ← Wrapped key chain management
          errors.ts             ← Error codes + classification
          types.ts              ← Shared types
          validation.ts         ← Input validation
    lib/
      env.ts                    ← ADD new bindings (see §2)
  migrations/
    0020_create_doc_intel_core.sql   ← D1 migration

poller/                           ← NEW directory at repo root
  main.py                        ← Entry point (launchd loop)
  jobs/
    claim.py
    download.py
    process.py
    upload.py
    complete.py
  ocr/
    paddle.py
    preprocess.py
  vision/
    ollama.py
  extraction/
    classify.py                  ← Document type classifier
    identity.py                  ← Passport/Licence/Medicare
    payslip.py
    bank_statement.py
  audit/
    logger.py
  templates/                     ← Client summary templates
    client_summary_v1.docx
    client_summary_v1.html
  requirements.txt

.hermes/logs/missions/           ← Mission evidence
```

---

## 2. Cloudflare Bindings (wrangler.json additions)

### D1 Databases

| Binding | Purpose |
|---|---|
| `D1_PERSONAL` | Personal vault schema |
| `D1_AFIRMICO` | AFIRMICO client schema |

### R2 Buckets

| Binding | Purpose |
|---|---|
| `R2_PERSONAL` | Personal vault documents |
| `R2_AFIRMICO` | AFIRMICO client documents |

### Workers Secrets

| Secret | Purpose |
|---|---|
| `MASTER_WRAP_KEY` | AES-256 key for key-wrapping chain (never rotates) |

### Env type additions (env.ts)

```typescript
export interface Env {
  // ...existing bindings...

  // Document Intelligence
  D1_PERSONAL?: D1Database
  D1_AFIRMICO?: D1Database
  R2_PERSONAL?: R2Bucket
  R2_AFIRMICO?: R2Bucket
  MASTER_WRAP_KEY?: string
}
```

---

## 3. Tenant Routing

The doc-intel routes are mounted under `/api/v1/doc-intel`. Tenant is determined by the `x-tenant` header:

| Header Value | D1 Binding | R2 Binding |
|---|---|---|
| `personal` | `D1_PERSONAL` | `R2_PERSONAL` |
| `afirmico` | `D1_AFIRMICO` | `R2_AFIRMICO` |

Returns `400` if tenant header is missing or invalid.

---

## 4. D1 Schema (Migration 0020 — shared by both databases)

### Table: `profiles`

```sql
CREATE TABLE IF NOT EXISTS profiles (
  profile_id     TEXT PRIMARY KEY,
  profile_type   TEXT NOT NULL,            -- 'personal' | 'client'
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  dob            TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  mobile         TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  encrypted_fields TEXT NOT NULL DEFAULT '[]',  -- JSON array of field names
  data_classification TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_profiles_name
  ON profiles(last_name, first_name);
```

### Table: `documents`

```sql
CREATE TABLE IF NOT EXISTS documents (
  document_id         TEXT PRIMARY KEY,
  profile_id          TEXT,
  document_type       TEXT NOT NULL,       -- 'passport', 'licence', 'medicare', 'payslip', 'bank_statement'
  filename_display    TEXT NOT NULL,       -- Human-readable name per FN-001
  original_r2_key     TEXT NOT NULL,       -- Original upload (kept forever)
  working_r2_key      TEXT,                -- Compressed version (if >20MB)
  original_size_bytes INTEGER NOT NULL DEFAULT 0,
  compressed_size_bytes INTEGER,
  ocr_status          TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | completed_with_warnings | failed
  confidence          REAL,
  document_version    INTEGER NOT NULL DEFAULT 1,
  document_group_id   TEXT,                -- Links versions of same document (e.g. passport v1/v2)
  active_version      INTEGER NOT NULL DEFAULT 1,
  data_classification TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_profile
  ON documents(profile_id, document_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents(ocr_status);
CREATE INDEX IF NOT EXISTS idx_documents_type
  ON documents(document_type);
```

### Table: `extracted_fields`

```sql
CREATE TABLE IF NOT EXISTS extracted_fields (
  field_id             TEXT PRIMARY KEY,
  document_id          TEXT NOT NULL,
  field_name           TEXT NOT NULL,      -- e.g. 'passport_number', 'date_of_birth'
  field_value_encrypted TEXT NOT NULL,     -- AES-GCM ciphertext
  confidence           REAL NOT NULL DEFAULT 0,
  key_version          INTEGER NOT NULL DEFAULT 1,
  data_classification  TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
  source_document      TEXT NOT NULL,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE INDEX IF NOT EXISTS idx_extracted_doc
  ON extracted_fields(document_id);
CREATE INDEX IF NOT EXISTS idx_extracted_field
  ON extracted_fields(field_name, confidence DESC);
```

### Table: `processing_jobs`

```sql
CREATE TABLE IF NOT EXISTS processing_jobs (
  job_id        TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
    -- pending | claimed | processing | retry_pending | completed | completed_with_warnings | failed
  attempt_count INTEGER NOT NULL DEFAULT 0,
  worker_id     TEXT,
  claimed_at    INTEGER,
  started_at    INTEGER,
  completed_at  INTEGER,
  heartbeat_at  INTEGER,
  last_error    TEXT,
  error_classification TEXT,  -- TRANSIENT | PERMANENT | VALIDATION | SECURITY
  workflow_id   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status
  ON processing_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_workflow
  ON processing_jobs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_jobs_stale
  ON processing_jobs(status, heartbeat_at)
  WHERE status = 'processing';
```

### Table: `key_registry`

```sql
CREATE TABLE IF NOT EXISTS key_registry (
  key_version  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant       TEXT NOT NULL,
  wrapped_key  TEXT NOT NULL,              -- AES-GCM wrapped under MASTER_WRAP_KEY
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  retired_at   INTEGER,
  UNIQUE(tenant, key_version)
);
```

### Table: `activities`

```sql
CREATE TABLE IF NOT EXISTS activities (
  activity_id   TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL,
  activity_type TEXT NOT NULL,  -- 'upload', 'ocr', 'extraction', 'validation', 'encryption',
                                -- 'form_population', 'doc_generation', 'crm_update', 'salestrekker_update'
  detail        TEXT NOT NULL DEFAULT '{}',
  workflow_id   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_profile
  ON activities(profile_id, created_at DESC);
```

### Table: `generated_documents`

```sql
CREATE TABLE IF NOT EXISTS generated_documents (
  generated_document_id TEXT PRIMARY KEY,
  profile_id            TEXT NOT NULL,
  document_type         TEXT NOT NULL,     -- 'client_summary', 'form'
  generated_type        TEXT NOT NULL,     -- 'docx', 'pdf', 'html'
  r2_key                TEXT NOT NULL,
  template_version      TEXT,
  workflow_id           TEXT,
  data_classification   TEXT NOT NULL DEFAULT 'INTERNAL',
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_generated_profile
  ON generated_documents(profile_id, created_at DESC);
```

### Table: `audit_log` (per-tenant)

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id       TEXT PRIMARY KEY,
  workflow_id    TEXT NOT NULL,
  document_id    TEXT,
  client_id      TEXT,
  profile_id     TEXT,
  skill_id       TEXT,              -- 'hermes-personal-vault' | 'hermes-afirmico-onboarding'
  tenant_id      TEXT NOT NULL,      -- 'personal' | 'afirmico'
  stage          TEXT NOT NULL,      -- 'upload', 'ocr', 'extraction', 'validation', 'encryption',
                                     -- 'form_population', 'doc_generation', 'crm_update', 'salestrekker_update'
  status         TEXT NOT NULL,      -- 'started', 'completed', 'failed', 'pending_approval'
  actor          TEXT NOT NULL DEFAULT 'system',
  duration_ms    INTEGER,
  before_state   TEXT,
  after_state    TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_workflow
  ON audit_log(workflow_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant
  ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_stage
  ON audit_log(tenant_id, stage, created_at DESC);
```

---

## 5. R2 Key Conventions

### Personal Bucket (R2_PERSONAL)

```
documents/<uuid>.pdf             -- Original upload (kept forever)
documents/<uuid>-compressed.pdf  -- Compressed version (if >10MB)
extracted/<uuid>-ocr.json        -- PaddleOCR output
extracted/<uuid>-fields.json     -- Extracted fields (plain PII-free metadata)
generated/<uuid>.docx            -- Generated DOCX
generated/<uuid>.html            -- Generated HTML
generated/<uuid>.pdf             -- Generated PDF
templates/<name>-v<ver>.docx     -- Template files
templates/<name>-v<ver>.html
audit/<workflow-id>.json         -- Audit artifact snapshots
```

### AFIRMICO Bucket (R2_PERSONAL)

Same structure, different bucket.

---

## 6. API Contracts

All routes are prefixed `/api/v1/doc-intel`.

### POST /api/v1/doc-intel/ingest

Upload a document for processing.

**Headers:** `x-tenant: personal | afirmico`  
**Body:** multipart/form-data with `file` field  
**Response (201):**

```json
{
  "document_id": "uuid",
  "job_id": "uuid",
  "workflow_id": "uuid",
  "status": "pending",
  "filename_display": "LEDINGHAM_WARREN_PASSPORT_20260711.pdf",
  "size_bytes": 123456
}
```

**Side effects:** D1 `documents` row inserted, `processing_jobs` row created, R2 original stored, audit log entry.

### GET /api/v1/doc-intel/jobs/pending

Returns pending jobs for M1 poller to claim.  
**Headers:** `x-tenant`  
**Response (200):**

```json
{
  "jobs": [
    {
      "job_id": "uuid",
      "document_id": "uuid",
      "status": "pending",
      "created_at": 1234567890
    }
  ]
}
```

### POST /api/v1/doc-intel/jobs/claim

Claim a job.  
**Headers:** `x-tenant`  
**Body:**

```json
{
  "worker_id": "M1-DOCINTEL-01"
}
```

**Response (200):**

```json
{
  "job_id": "uuid",
  "document_id": "uuid",
  "r2_original_key": "documents/uuid.pdf",
  "status": "claimed"
}
```

### POST /api/v1/doc-intel/jobs/result

Submit processing results.  
**Headers:** `x-tenant`  
**Body:**

```json
{
  "job_id": "uuid",
  "status": "completed",
  "document_type": "passport",
  "confidence": 0.992,
  "fields": [
    { "name": "passport_number", "value": "PA123456", "confidence": 0.99, "classification": "RESTRICTED" },
    { "name": "date_of_birth", "value": "1990-01-15", "confidence": 0.98, "classification": "CONFIDENTIAL" }
  ],
  "ocr_r2_key": "extracted/uuid-ocr.json",
  "fields_r2_key": "extracted/uuid-fields.json",
  "compressed_r2_key": "documents/uuid-compressed.pdf",
  "compressed_size_bytes": 3951822,
  "original_size_bytes": 18432943,
  "duration_ms": 8123
}
```

**Response (200):** `{ "accepted": true, "document_id": "..." }`

### POST /api/v1/doc-intel/jobs/heartbeat

Update job heartbeat (prevents stale-claim recovery).  
**Headers:** `x-tenant`  
**Body:** `{ "job_id": "uuid" }`  
**Response (200):** `{ "updated": true }`

### GET /api/v1/doc-intel/documents?profile_id=...&type=...

Search documents by profile, type, or date range.  
**Headers:** `x-tenant`  
**Response (200):**

```json
{
  "documents": [
    {
      "document_id": "uuid",
      "document_type": "passport",
      "filename_display": "LEDINGHAM_WARREN_PASSPORT_20260711.pdf",
      "status": "completed",
      "confidence": 0.992,
      "created_at": 1234567890
    }
  ]
}
```

### POST /api/v1/doc-intel/jobs/{job_id}/retry

Admin: retry a failed job.  
**Headers:** `x-tenant`  
**Response (200):** `{ "job_id": "...", "status": "retry_pending" }`

### POST /api/v1/doc-intel/jobs/{job_id}/reset

Admin: reset a stuck/abandoned job.  
**Headers:** `x-tenant`  
**Response (200):** `{ "job_id": "...", "status": "pending" }`

### GET /api/v1/doc-intel/audit?workflow_id=...&document_id=...&stage=...

Query audit log.  
**Headers:** `x-tenant`  
**Response (200):**

```json
{
  "events": [
    {
      "audit_id": "uuid",
      "workflow_id": "uuid",
      "stage": "upload",
      "status": "completed",
      "duration_ms": 45,
      "created_at": 1234567890
    }
  ]
}
```

---

## 7. Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `MISSING_TENANT` | 400 | `x-tenant` header required |
| `INVALID_TENANT` | 400 | Tenant must be `personal` or `afirmico` |
| `FILE_TOO_LARGE` | 413 | File exceeds R2 capacity or >100MB |
| `INVALID_FILE_TYPE` | 400 | Unsupported MIME type |
| `JOB_NOT_FOUND` | 404 | Job ID not found |
| `JOB_ALREADY_CLAIMED` | 409 | Job already claimed by another worker |
| `DOCUMENT_NOT_FOUND` | 404 | Document ID not found |
| `PROFILE_NOT_FOUND` | 404 | Profile ID not found |
| `ENCRYPTION_FAILED` | 500 | AES-GCM encryption error |
| `KEY_NOT_FOUND` | 500 | No key version found in registry |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## 8. Error Classification (Job Failures)

| Error | Classification | Action |
|---|---|---|
| R2 download timeout | TRANSIENT | Retry |
| Network timeout | TRANSIENT | Retry |
| Ollama unavailable | TRANSIENT | Retry |
| PaddleOCR crash | TRANSIENT | Retry |
| OOM | TRANSIENT | Retry |
| Corrupt PDF | PERMANENT | Fail immediately |
| Unsupported format | PERMANENT | Fail immediately |
| Unreadable document | PERMANENT | Fail immediately |
| Low confidence extraction | VALIDATION | Complete with warnings |
| Field mismatch | VALIDATION | Complete with warnings |
| Encryption failure | SECURITY | Fail immediately, no retry |
| Unauthorized access | SECURITY | Fail immediately, no retry |

---

## 9. Test Strategy

### Phase 1 Tests (Worker unit tests)

| Test | Description |
|---|---|
| `POST /doc-intel/ingest` — valid upload | 201 + D1 row + R2 object |
| `POST /doc-intel/ingest` — missing tenant | 400 MISSING_TENANT |
| `POST /doc-intel/ingest` — invalid tenant | 400 INVALID_TENANT |
| `POST /doc-intel/ingest` — no file | 400 |
| `GET /doc-intel/jobs/pending` — returns pending | 200 + array |
| `POST /doc-intel/jobs/claim` — happy path | 200 + job claimed |
| `POST /doc-intel/jobs/claim` — already claimed | 409 |
| `POST /doc-intel/jobs/result` — happy path | 200 + accepted |
| `POST /doc-intel/jobs/heartbeat` — updates timestamp | 200 |
| `POST /doc-intel/jobs/:id/retry` — resets job | 200 + retry_pending |
| `POST /doc-intel/jobs/:id/reset` — resets stuck job | 200 + pending |
| `GET /doc-intel/audit` — filters by workflow | 200 + matching events |
| Tenant isolation — personal vs afirmico | No cross-tenant data leak |

### Phase 2+ Tests (M1 poller integration)

- OCR on test passport image
- Ollama vision validation
- Extraction + field mapping
- Result submission to Worker
- Multi-page document handling
- Heartbeat during long processing

---

## 10. Acceptance Criteria Mapping (from FRS)

| FRS Req | IPS Coverage | Verification |
|---|---|---|
| DS-001 (data separation) | Separate D1 + R2 per tenant, tenant-routed API | Test: no cross-tenant leak |
| SEC-004 (AES-GCM) | encryption.ts with Web Crypto API | Unit test: encrypt/decrypt roundtrip |
| SEC-006 (secrets) | MASTER_WRAP_KEY in Workers Secrets | Integration: key not in source |
| AUTO-001 (no final submission) | Result endpoint only, no CRM trigger in Phase 1 | N/A — deferred to Phase 5 |
| AUD-001 (action logging) | audit_log table + audit endpoints | Test: every action creates row |
| FN-001 (naming) | filename_display stored, R2 keys are UUID | Visual: DB shows convention |
| JOB-001 (retry) | attempt_count + retry API | Test: retry resets status |
| JOB-003 (heartbeat) | heartbeat_at + stale recovery | Test: stale claim → pending |

---

## 11. Phase 1 Implementation Tasks

### Task 1.1 — D1 Migration

- [ ] Write migration 0020 with all tables (profiles, documents, extracted_fields, processing_jobs, key_registry, activities, generated_documents, audit_log)
- [ ] Run on both D1_PERSONAL and D1_AFIRMICO databases

### Task 1.2 — Worker API Scaffold

- [ ] Create `api/doc-intel/index.ts` — tenant dispatch router
- [ ] Create `api/doc-intel/lib/db.ts` — tenant-aware D1 accessor
- [ ] Create `api/doc-intel/lib/errors.ts` — error codes + responses
- [ ] Create `api/doc-intel/lib/audit.ts` — audit log writer
- [ ] Create `api/doc-intel/lib/types.ts` — shared types

### Task 1.3 — Ingest Endpoint

- [ ] `POST /api/v1/doc-intel/ingest` — accept multipart upload, store in R2, create D1 rows, return job_id

### Task 1.4 — Job Lifecycle Endpoints

- [ ] `GET /api/v1/doc-intel/jobs/pending` — list pending jobs
- [ ] `POST /api/v1/doc-intel/jobs/claim` — claim a job
- [ ] `POST /api/v1/doc-intel/jobs/result` — submit processing result
- [ ] `POST /api/v1/doc-intel/jobs/heartbeat` — update heartbeat

### Task 1.5 — Search + Admin Endpoints

- [ ] `GET /api/v1/doc-intel/documents` — search documents
- [ ] `POST /api/v1/doc-intel/jobs/:id/retry` — retry failed job
- [ ] `POST /api/v1/doc-intel/jobs/:id/reset` — reset stuck job
- [ ] `GET /api/v1/doc-intel/audit` — query audit log

### Task 1.6 — Registration in index.ts

- [ ] Mount docIntelRouter under `/api/v1/doc-intel`
- [ ] Add tenant bypass for `x-tenant` header route
- [ ] Update Env interface with new bindings

### Task 1.7 — Verification

- [ ] Upload test document → 201 + D1 row + R2 object
- [ ] Claim job → status changes to claimed
- [ ] Submit result → status changes to completed
- [ ] Query audit → stage entries exist
- [ ] Tenant isolation — personal DB not accessible from afirmico route

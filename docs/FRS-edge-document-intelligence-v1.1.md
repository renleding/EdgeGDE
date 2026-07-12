# Functional Requirements Specification

# Edge Document Intelligence & Provisioning Platform

## Version 1.1 (Post-Review)

---

# Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-07-11 | Warren Ledingham | Initial FRS |
| 1.1 | 2026-07-11 | Hermes (Director) | Post-review refinements — 10 architectural decisions incorporated |

---

# 1. Executive Summary

The Edge Document Intelligence Platform provides a secure, Cloudflare-native document ingestion, OCR, identity extraction, form automation, CRM provisioning, and document generation capability for Hermes.

The platform consists of:

## Skill 1 — hermes-personal-vault

Personal document intelligence system for Warren Ledingham. Functions: identity vault, OCR archive, form auto-population, document generation, personal document management.

## Skill 2 — hermes-afirmico-onboarding

Business onboarding and provisioning system. Functions: client onboarding, OCR extraction, SalesTrekker provisioning, Edge CRM population, client summary generation, workflow automation.

## Shared Platform — edge-document-intelligence

Cloudflare-native document processing engine shared by both skills while maintaining complete dataset separation.

---

# 2. System Architecture

## Topology

```
Document Upload → Worker API → R2 + D1 (status=pending)
                                    ↓
                    M1 Python Poller (launchd)
                     ├── PaddleOCR
                     ├── Ollama Vision
                     └── Extraction Engine
                                    ↓
                    Worker API → D1 + R2 (status=complete)
                                    ↓
                    Hermes summarizes → Human approves
                                    ↓
                    Edge CRM + SalesTrekker (Chrome, computer_use)
```

## Architectural Decision: Two-Tier

**Cloudflare Workers** — API gateway, routing, D1 writes, encryption, CRM integration, static storage.
**M1 Poller (Python)** — PaddleOCR, Ollama Vision, document classification, field extraction, document generation.

Interface: async two-phase API. `POST /api/jobs/start` returns `job_id`. M1 processes locally, `POST /api/jobs/result` posts artifacts.

---

# 3. Technology Stack

## Primary Platform — Cloudflare
- Workers, D1, R2, Durable Objects, KV, Workers Secrets, Web Crypto API

## OCR Engine — PaddleOCR (Python on M1)
- PDF OCR, image OCR, table OCR, multi-page extraction

## Vision Intelligence — Ollama Local Vision (on M1)
- Document understanding, semantic extraction, field classification, error correction
- Also used for **document classification** (passport vs payslip vs bank statement)

## Fallback — OpenRouter Vision (Hermes vision)

---

# 4. Data Separation Requirements

## DS-001
Personal and AFIRMICO data must never be commingled.

## Personal Environment
- `D1_PERSONAL` — database
- `R2_PERSONAL` — bucket
- `DO_PERSONAL` — (future)
- `KV_PERSONAL` — (future)

## AFIRMICO Environment
- `D1_AFIRMICO` — database
- `R2_AFIRMICO` — bucket
- `DO_AFIRMICO` — (future)
- `KV_AFIRMICO` — (future)

## Acceptance Criteria
✅ No shared tables, no shared buckets, no shared encryption keys, no shared workflows  
✅ Tenant routing via `x-tenant` header (single Worker, environment-aware bindings)

---

# 5. Supported Document Types

## Identity
- Passport, Driver Licence, Medicare

## Financial
- Bank Statements, Payslips

## Future Expansion
- Tax Returns, Notices of Assessment, BAS, Utility Bills, Trust Deeds, Company Documents, Rates Notices

---

# 6. OCR Requirements

## OCR-001
The platform shall automatically OCR all uploaded documents.

## OCR-002
PaddleOCR as the primary OCR engine (Python on M1).

## OCR-003
Multi-page PDFs must be fully processed (atomic — 1 document = 1 job).

## OCR-004
OCR confidence shall be stored per field.

## OCR-005
Vision models shall cross-check OCR output: `PaddleOCR result + Ollama Vision result = Validated result`

## OCR-006 (New)
**Document classification** shall occur before extraction. Ollama Vision classifies the document type (passport, payslip, etc.) → extraction template selected → PaddleOCR runs → cross-check.

## OCR-REPROC-001 (New)
Any document may be reprocessed using a newer OCR or vision model while preserving the original file.

---

# 7. Identity Resolution Requirements

## IDR-001
Compare identity fields across all uploaded documents (name, DOB, address).

## IDR-002
Auto-merge high-confidence matches.

## IDR-003
Flag identity conflicts (e.g. "John Smith" vs "Jon Smith").

## IDR-004
Conflict log must be created.

---

# 8. Personal Identity Vault

## PIV-001
Permanent identity profile with all PII AES-GCM encrypted.

## PIV-002
Future forms shall utilise vault data before requiring reprocessing.

## PIV-003
Document-derived updates must be traceable via audit log.

---

# 9. AFIRMICO Client Vault

## ACV-001
Client record persists indefinitely. Structure: Client → Documents, Profiles, Applications, Activities, Audit.

## ACV-002
Multiple engagements attach to one client record.

---

# 10. Database Schema

Full schema defined in migration `0020_create_doc_intel_core.sql`. Key tables:

- **profiles** — Identity profiles (personal vault or AFIRMICO clients)
- **documents** — Original and working R2 keys, version tracking, OCR status
- **extracted_fields** — Per-field AES-GCM encrypted values with confidence and key_version
- **processing_jobs** — Job queue with heartbeat, retry, error classification
- **key_registry** — Wrapped key chain for per-tenant encryption key rotation
- **activities** — Per-profile operational event log
- **generated_documents** — Generated DOCX/PDF/HTML summaries
- **audit_log** — Immutable audit trail with workflow_id correlation

---

# 11. R2 Architecture (Revised per R2-001 through R2-006)

## Principle
R2 stores blobs. D1 stores relationships. Business logic not encoded in path hierarchy.

## Key Convention
UUID-based object keys with typed prefixes:

```
documents/<uuid>.pdf              — Original upload (kept forever)
documents/<uuid>-compressed.pdf   — Compressed version (if >10MB)
extracted/<uuid>-ocr.json         — PaddleOCR output
extracted/<uuid>-fields.json      — Extracted fields
generated/<uuid>.docx             — Generated documents
templates/<name>-v<ver>.docx      — Template files
audit/<workflow-id>.json          — Audit artifact snapshots
```

## File Naming (FN-001)
Human-readable filenames stored in D1 `filename_display` field per convention `CLIENTSURNAME_CLIENTFIRST_DOCTYPE_DATE`. D1 is source of truth, not R2 paths.

## Original Document Retention (R2-005)
Original uploaded documents preserved indefinitely as authoritative source record. Derived artifacts stored as separate objects linked through D1.

---

# 12. Security Requirements

## SEC-001
TLS Full (Strict) via Cloudflare.

## SEC-002
At-rest encryption via Cloudflare-managed encryption.

## SEC-003
Field-level encryption mandatory for PII (AES-GCM via Web Crypto API).

## Protected Fields
Name, Address, DOB, Passport Number, Licence Number, Medicare Number, Bank Account, BSB, Email, Phone.

## SEC-004
AES-GCM via Web Crypto API with unique IV per encryption operation (12 bytes from `crypto.getRandomValues`).

## SEC-005
Master key stored only in Workers Secrets (`MASTER_WRAP_KEY`). Not in source code, database, or configuration files.

## Key Management Architecture — Wrapped Key Chain

```
MASTER_WRAP_KEY (Workers Secrets + Bitwarden backup)
    │ AES-GCM unwrap
    ▼
key_registry (D1):
  tenant  │ ver │ wrapped_key
  ────────┼─────┼─────────────
  personal│  1  │ <ciphertext>
  afirmico│  1  │ <ciphertext>

Each encrypted field stores key_version.
Rotation: new key_version created, new writes use new key.
Old records remain readable (their version's key still in registry).
Recovery: restore MASTER_WRAP_KEY from Bitwarden → all wrapped keys decryptable.
```

## KEY-001 / KEY-002
Data encryption keys must be rotatable. Key version stored against every encrypted field.

## Data Classification (New)
Every field classified: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED. Restricts which fields are encrypted and which are queryable in plaintext.

---

# 13. Audit Requirements

## AUD-001
Every action logged: Upload, OCR, Extraction, Validation, Encryption, Storage, Form Population, Document Generation, CRM Update, SalesTrekker Update.

## AUD-002
Audit records policy-enforced immutable (code never exposes UPDATE/DELETE endpoints for audit_log).

## AUD-003
Audit records never deleted.

## Correlation IDs (New — OBS-004 through OBS-006)
Full OTel distributed tracing deferred to V2. V1 uses per-component correlation IDs (`workflow_id`, `document_id`, `tenant_id`, `skill_id`) stored in every audit log entry and across all systems.

---

# 14. Automation Requirements

## AUTO-001
Hermes populates Edge CRM records (after human approval only).

## AUTO-002
Hermes populates SalesTrekker records (Chrome, computer_use, manual login).

## AUTO-003
Hermes creates draft applications only. ⛔ Final submission, lodgement, or external commit action forbidden without human approval.

## AUTO-004
Hermes uploads supporting documents to SalesTrekker.

## AUTO-005
Hermes verifies upload success via visual confirmation in browser.

## CRM-001 through CRM-006
- Human approval required before CRM create/update
- OCR-extracted data stays in pending_review until approved
- Duplicate detection mandatory (email → mobile → name+DOB → govID)
- Existing clients updated, not duplicated
- Document Intelligence remains authoritative document repository
- Edge CRM references documents via identifiers, not payloads

---

# 15. Client Summary Generation

## SUM-001
Hermes generates client summaries containing: Client Name, Identity Status, Income Summary, Banking Summary, Documents Received, Missing Documents, Provisioning Status.

## SUM-002
Exportable in DOCX, PDF, and HTML (generated on M1 via python-docx, Jinja2, pandoc).

## Template Registry (New)
Versioned templates stored in R2 (`templates/` prefix). Structure: `client_summary_v1`, `afirmico_summary_v1`.

---

# 16. Form Population Requirements

## FORM-001
Populate: Web Forms, CRM Forms, SalesTrekker Draft Forms.

## FORM-002
Field mapping configurable.

## FORM-003
Auto-completion confidence recorded.

---

# 17. Workflow Requirements

## Workflow 1 — Personal Onboarding
```
Upload → OCR → Identity Resolution → Encryption → Personal Vault Update → Generate Summary
```

## Workflow 2 — AFIRMICO Onboarding
```
Upload → OCR → Extraction → Identity Validation → Encryption → Create Client
→ Populate CRM → Populate SalesTrekker → Generate Client Summary → Await Human Approval
```

## Workflow Ownership (New)
Every workflow stores `workflow_owner` (personal | afirmico) for audit and future multi-tenant expansion.

## Document Versioning (DOCVER-001)
Documents may have multiple versions (e.g. passport v1/v2/v3). Earlier versions never overwritten. D1 tracks `document_group_id`, `document_version`, `active_version`.

---

# 18. Job Processing Lifecycle

## Job States
pending → claimed → processing → retry_pending → completed | completed_with_warnings | failed

## Retry Policy (JOB-001 through JOB-007)
- 3 maximum attempts, exponential backoff (immediate → +30s → +5min)
- Stage-aware: transient failures (network, OOM, timeouts) retry; permanent failures (corrupt PDF) fail immediately
- Security failures halt immediately, no retry, escalate
- Validation failures (low confidence) produce `completed_with_warnings` — workflow continues
- Heartbeat-based crash recovery (30s heartbeat, 10min stale = recovered)

## Error Classification
TRANSIENT | PERMANENT | VALIDATION | SECURITY

---

# 19. Observability Requirements

## OBS-001 through OBS-006 (Revised)
Correlation IDs as primary observability mechanism in V1. Every component emits structured logs with `workflow_id`, `document_id`, `tenant_id`, `skill_id`. Full OTel distributed tracing across Worker + M1 deferred to V2.

## OCR Confidence Metrics
Captured and stored per field. Thresholds: 95%+ auto-accept, 85-95% accept + warning, <85% human review required.

---

# 20. Poller Architecture (New — POLLER-001 through POLLER-006)

## Implementation
Python orchestration script, launched via launchd (LaunchAgent). Hermes not involved in polling loop.

## Polling Strategy
Exponential backoff: 1s → 2s → 5s → 10s → 30s → 60s max.

## Job Ownership
Every claimed job gets `worker_id` and `claimed_at` for tracking.

## Service Layout
```
poller/
  main.py                   — Entry point (launchd loop)
  jobs/{claim,download,process,upload}.py
  ocr/{vision_framework,preprocess}.py
  ocr/ocr_worker.py         — Fresh subprocess for Apple Vision OCR
  vision/{ollama}.py
  extraction/{classify,identity,payslip,bank_statement}.py
  audit/logger.py
  templates/                — Client summary templates
```

---

# 21. SalesTrekker Integration (STK-001 through STK-005)

## Approach
Browser automation via computer_use in Chrome. Not programmatic API.

## Requirements
- Human manually authenticates in Chrome before automation begins
- Agent verifies logged-in state (avatar/dashboard visible) before proceeding
- Agent may populate forms, upload documents, draft applications
- Agent must never submit or finalise
- Upload verification includes visual confirmation (document appears in attachment list)

---

# 22. Acceptance Criteria

## Personal Skill — Pass Criteria
✅ Passport extracted correctly  
✅ Medicare extracted correctly  
✅ Licence extracted correctly (C, R classes)  
✅ Payslip extracted correctly  
✅ Bank statement extracted correctly  
✅ Identity vault updated  
✅ Files renamed correctly  
✅ Audit trail recorded  
✅ Data encrypted (AES-GCM)  
✅ Client summary generated  

## AFIRMICO Skill — Pass Criteria
✅ Client created  
✅ Documents stored  
✅ OCR completed  
✅ CRM populated (after human approval)  
✅ SalesTrekker populated (draft only)  
✅ Draft application generated  
✅ Summary generated  
✅ Human approval pending  
✅ No final submission made  

## Security — Pass Criteria
✅ Data separated (personal vs afirmico DBs/buckets)  
✅ AES-GCM encryption working (unique IVs)  
✅ MASTER_WRAP_KEY in Workers Secrets only  
✅ Audit log immutable (policy-enforced)  
✅ No cross-database access  

---

# 23. Out of Scope (V1)

- True distributed tracing (OTel spans across Worker + M1)
- Page-level fan-out orchestration (deferred until >100 pages or >5min processing)
- Full-text search engine
- Automated SalesTrekker login (manual auth required)
- Web UI for document browsing
- CI/CD for M1 poller (manual deployment)
- M1 uptime alerting (poller retries forever, durable queue)

---

# 24. Decision Log

| # | Decision | Rationale |
|---|---|---|
| D01 | Two-tier architecture (Workers + M1 Python) | PaddleOCR/Ollama cannot run on Workers |
| D02 | Async two-phase API (claim/result) | Avoid 30s Worker timeout on multi-page docs |
| D03 | UUID-based R2 keys with typed prefixes | Business logic not in path hierarchy |
| D04 | Originals kept forever | Audit, compliance, future reprocessing |
| D05 | Wrapped key chain for encryption | Rotation support, Bitwarden recovery |
| D06 | Single Worker, tenant-routed | Shared engine code, separate data |
| D07 | Per-component correlation IDs, not full OTel | Pragmatic V1, leaves clean V2 path |
| D08 | Human approval gate before CRM/SalesTrekker | Protects against OCR noise in authoritative systems |
| D09 | Browser automation for SalesTrekker | No public API known; human auth gate |
| D10 | Python poller via launchd, no Hermes in loop | Poller is infrastructure, not agent work |
|| D11 | 3 retries, exponential backoff, heartbeat recovery | Handles real-world transient failures |\n|| D12 | Apple Vision framework replaces PaddleOCR | PaddlePaddle segfaults on Apple Silicon; Apple Vision is ANE-accelerated, zero-dependency, native macOS |\n|| D13 | No image preprocessing before Apple Vision OCR | Adaptive thresholding destroys contrast Apple Vision needs for text region detection |
| D12 | `completed_with_warnings` state | Low-confidence extractions shouldn't block workflow |
| D13 | File compression for >10MB → target <20MB | R2 free tier capacity management |

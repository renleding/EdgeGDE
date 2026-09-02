# FRS-0005: EdgeGDE PDF Form Filler

**Status:** DRAFT (post-PoC, pre-implementation)
**Author:** Hermes (Director)
**Date:** 2026-08-31
**Branch:** work/pdf-form-filler-frs
**PoC reference:** `work/pdf-autofill-poc` at `../EdgeGDE-worktrees/pdf-autofill/`

---

## 1. Purpose

EdgeGDE brokers and their clients routinely need to fill PDF forms (bank applications, ATO, government, lender disclosures). Today this is manual: download the PDF, open in Acrobat, type into each field, sign, save. We want to automate this end-to-end so a form-fill request takes a few seconds instead of ten minutes.

The system takes:
- A blank PDF (AcroForm or flattened, from any source — typically a web download)
- A `user_data` dict (client PII, already held in our systems)

And produces:
- A filled PDF
- An audit log of what was filled, by what, with what evidence
- An FRS-007-compatible state transition for the workflow

**Non-goals for v1:** web form filling (separate stack — agent automation), editable Word docs, fillable XFA-dynamic forms (handled as flattened), e-signature (separate concern), PDF generation from blank.

---

## 2. Scope (from interview 2026-08-31)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Use cases | (d) Generic "fill any PDF" — open-ended |
| 2 | State model | **Hybrid**: full FRS-007 ceremony for `risk_class ∈ {financial, government, legal}`, hash-only for `risk_class ∈ {subscription, marketing, low}` |
| 3 | Trust boundary | Sidecar runs on a different machine in the Tailscale mesh; CF Worker only proxies |
| 4 | PDF source | Anywhere — uploaded by user, downloaded from web, fetched from a URL, stored in our catalog |
| 5 | LLM | `qwen2.5:7b` via Ollama (free, private, fast JSON). ornith:9b as fallback for low-stakes forms only |
| 6 | Verification | All three: required-fields check + value validation (regex per field type) + round-trip re-read + final visual check (CUA snapshot) |
| 7 | Web forms | Different stack. Out of scope for FRS-0005 |
| 8 | Failure | Multi-pass: retry with different LLM strategy; if still failing, return partially-filled + `unmapped` list + escalate to human review queue |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CF Worker (Hermes-orchestrated)                             │
│  apps/edge-runtime/src/routes/pdf-autofill.ts                │
│  ────────────────────────────────────────────────────────  │
│  POST /api/pdf/autofill  (multipart: PDF + user_data JSON)  │
│    ↓                                                       │
│  1. Validate request, resolve risk_class                    │
│  2. Hash the input PDF (FRS-007 L1 input)                   │
│  3. Generate fill_id (UUID v7, time-sortable)               │
│  4. POST → http://sidecar.tailnet:8890/autofill              │
│  5. Receive: filled_pdf_hash, audit, document_hash           │
│  6. If risk_class ∈ {financial, government, legal}:            │
│       emit StateTransitionApplication_Filled                  │
│       (with document_hash as L3 evidence)                    │
│  7. Return filled PDF + audit + fill_id to caller            │
└─────────────────────────────────────────────────────────────┘
                              │ Tailscale
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Sidecar (dedicated machine, e.g. form-filler.tailnet)      │
│  apps/pdf-sidecar/main.py  (Python, FastMCP + FastAPI)      │
│  ────────────────────────────────────────────────────────  │
│  4 MCP tools + 2 HTTP endpoints                              │
│  Components:                                                 │
│    • PyPDFForm (AcroForm text fill)                          │
│    • pikepdf (checkbox write — bypasses PyPDFForm bug)       │
│    • Marker (in Podman, schema extraction for flattened)    │
│    • qwen3-vl:4b (visual coord detection for flattened)      │
│    • qwen2.5:7b (LLM field mapping)                          │
│    • PyMuPDF (stamp text on flattened PDFs)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Functional Requirements (RFC 2119: SHALL / MUST)

### 4.1 Input contract

**MUST** accept multipart/form-data POST with:
- `pdf`: the blank PDF (≤ 50 MB, validated mime = `application/pdf`)
- `user_data`: JSON string, ≤ 100 KB
- `risk_class`: enum `[financial, government, legal, subscription, marketing, low]`
- `tenant`: tenant ID (for multi-tenancy)
- `callback_url`: optional webhook for async results
- `idempotency_key`: optional UUID; same key = same fill, no duplicate

**MUST** reject with HTTP 400:
- Invalid PDF (not parseable by pikepdf)
- user_data missing required tenant fields
- risk_class not in enum

### 4.2 Form-type detection

**MUST** detect form type and route to correct path:
- **AcroForm path**: PDF has `/AcroForm/Fields` array with non-null entries after PyPDFForm buffer write
- **Flattened path**: no AcroForm, no extractable widgets → Marker + VLM + PyMuPDF
- **Hybrid path** (e.g. IRS W-4): no /AcroForm but widgets exist on page annotations → document and route to AcroForm with degraded confidence

### 4.3 AcroForm path

**SHALL** perform:
1. Enumerate fields via `pdfw.data.keys()` (not `schema` which is JSON Schema)
2. Classify each field by `schema['properties'][f]['type']`: `string` = text, `boolean` = checkbox, others = unknown
3. Text fill:
   - Pass 1: exact key match (free)
   - Pass 2: normalized match (`lower().replace(' ', '_')`)
   - Pass 3: batched LLM call (chunks of 10 fields per call; strip `[N]` suffix for LLM, map back)
4. Checkbox fill:
   - Group by base name (strip `[N]`) OR by Y-coordinate proximity (≤ 30pt)
   - For each group, LLM picks which option(s) to check
   - Write via pikepdf `field.V = Name.Yes/No`, `field.AS = Name.Yes/No` (bypasses PyPDFForm 5.5.5 checkbox persistence bug)
5. Combine: PyPDFForm fills text in memory → write to BytesIO → pikepdf opens buffer → modifies checkboxes → saves to disk

**MUST NOT** write to disk between PyPDFForm and pikepdf (PyPDFForm 5.5.5 corrupts `/Fields` on disk write).

### 4.4 Flattened path

**SHALL** perform:
1. Extract PDF to markdown via Marker (Podman container preferred, local fallback)
2. LLM maps user_data fields to schema fields (one batched call)
3. For each schema field, qwen3-vl:4b detects (x, y) bounding box (top-left origin, in PDF points)
4. PyMuPDF `page.insert_text(point, text, ...)` at each coordinate
5. **MUST** verify each coordinate is within page bounds; reject and escalate if not

### 4.5 Verification (from interview #6)

**MUST** perform ALL of:
1. **Required-fields check**: if PDF has a "required" indicator (AcroForm `/Ff` flag bit 2, or schema annotation), every required field must be filled. Fail with `unfilled_required: [...]` if not.
2. **Value validation** by detected type:
   - SSN/TFN/ABN: regex `^\d{9}$` or `^\d{2}-\d{7}$`
   - Date: `^\d{4}-\d{2}-\d{2}$` or `^\d{1,2}/\d{1,2}/\d{2,4}$`
   - Email: standard regex
   - Currency: parseable as float
   - Phone: AU `^(\+?61|0)4\d{8}$` if AU prefix hint
3. **Round-trip re-read**: open the saved PDF with PyPDFForm, compare `data` to expected. If discrepancies, fail.
4. **Visual check (CUA snapshot)**: render the first page, send to CUA-driver, ask "Are all fields visible and correctly filled?" Return `visual_ok: true/false`.

### 4.6 Multi-pass retry (from interview #8)

**MUST** retry on failure with these strategies in order:
1. Re-prompt LLM with explicit field descriptions
2. Try alternative LLM (ornith:9b if qwen2.5:7b failed)
3. If still failing, mark fields as `unmapped` and return partial fill
4. Escalate to human review queue (publish to a webhook or queue topic) with the partial fill + audit log

**MUST NOT** retry more than 3 times for any single fill.

### 4.7 Evidence & state (from interview #2)

**SHALL** compute for every fill:
- `input_pdf_sha256`: hash of the input PDF (L1 evidence per FRS-007)
- `filled_pdf_sha256`: hash of the output PDF (L3 evidence)
- `user_data_sha256`: hash of the user_data dict
- `llm_prompts_sha256[]`: hash of each LLM prompt sent
- `llm_responses_sha256[]`: hash of each LLM response received
- `audit`: array of `{field, value, source, confidence, path}`

**MUST**, if `risk_class ∈ {financial, government, legal}`, emit to the Transition Registry:
```yaml
state_transition:
  from: Application_Draft
  to: Application_Filled
  evidence:
    - L1: input_pdf_sha256
    - L2: llm_prompts_sha256[] + llm_responses_sha256[]
    - L3: filled_pdf_sha256
  tenant: <tenant>
  actor: pdf-form-filler-v1
  timestamp: <ISO-8601>
```

### 4.8 Caching (Q3: schema versioning)
**SHOULD** cache the schema extraction (Marker output) keyed by `sha256(input_pdf_bytes)`.
TTL = 7 days. On cache miss, extract (~3-5s via Marker) and cache.
**MUST NOT** cache user_data, audit, or filled PDFs (PII).
**SHOULD** invalidate the schema cache on any of:
- TTL expiry
- PDF bytes change (different content-hash)
- Explicit cache-flush via admin endpoint

### 4.9 Idempotency (Q1)
**MUST** dedupe by `idempotency_key` using an in-memory LRU with 1h TTL.
On hit: return the cached response without re-running the fill.
**MUST NOT** persist idempotency cache across restarts.
The `fill_id` (UUID v7) is the canonical identifier; callers store the response if needed.

### 4.10 R2 storage (Q5: failure analytics)
**SHALL** upload partial fills to R2 at `tenant://pdf-fills/{fill_id}/{pdf_filename}.pdf` with 7-day TTL.
**SHALL** upload the audit log alongside at `tenant://pdf-fills/{fill_id}/audit.json`.
**SHOULD** upload successful fills too (callers can re-fetch via signed URL).
**SHALL** emit Sentry breadcrumb on every LLM call, cache hit/miss, and validation failure.
**SHALL** POST to `callback_url` (if provided) on completion: `{fill_id, status, audit_url, filled_pdf_urls}`.

### 4.11 Multi-PDF bundles (Q2)
**SHALL** accept `pdf_set: Blob[]` (≤ 5 PDFs).
**SHALL** process the bundle atomically: any per-PDF failure marks the whole set `partial`.
**SHALL** share `fill_id` across the bundle; per-PDF `document_hash` is unique.
**SHALL** return results as a numbered set: `{fill_id, results: [{index, status, document_hash, audit, filled_pdf_url}]}`.

---

## 5. Non-functional Requirements

### 5.1 Performance
- AcroForm text-only fill: **MUST** complete in ≤ 5 seconds (LLM excluded)
- AcroForm with LLM mapping: **SHOULD** complete in ≤ 30 seconds for ≤ 50 fields
- Flattened path: **SHOULD** complete in ≤ 60 seconds (includes VLM)
- LLM cold start: **MUST** warm up `qwen2.5:7b` on sidecar boot

### 5.2 Availability
- Sidecar **MUST** run as a launchd service (auto-restart on crash)
- Health check: `GET /health` returns 200 if sidecar can accept requests
- CF Worker **MUST** circuit-break after 3 consecutive 5xx from sidecar

### 5.3 Security
- Sidecar **MUST** only accept connections from Tailscale mesh (no public IP)
- All user_data fields **MUST** be redacted from logs (replace with `***`)
- audit log **MUST** be persisted in tenant's R2 bucket with 90-day TTL
- PDFs containing tax file numbers (TFN), Medicare numbers, or full dates of birth **MUST** be encrypted at rest (CF R2 SSE-KMS)

### 5.4 Observability
- Sidecar **MUST** log structured JSON to stdout
- Each log line **MUST** include: `fill_id`, `tenant`, `risk_class`, `form_type`, `duration_ms`, `cost_usd`, `error` (if any)
- CF Worker **MUST** publish a metric `pdf_autofill.duration_seconds{result="success|failure"}` per fill
- **MUST** publish `pdf_autofill.fields_filled{form_type}` and `pdf_autofill.fields_unmapped{form_type}`

### 5.5 Cost
- Free LLM: qwen2.5:7b (local Ollama, $0)
- Free LLM fallback: ornith:9b (local Ollama, $0)
- **MUST NOT** use paid LLM unless explicit tenant opt-in

---

## 6. Data Model

### 6.1 Request
```typescript
interface AutofillRequest {
  // Single-PDF mode (backwards-compatible)
  pdf: Blob;                        // ≤ 50 MB

  // OR multi-PDF bundle (Q2: government forms often need 2-3 PDFs)
  pdf_set?: Blob[];                 // ≤ 5 PDFs, ≤ 50 MB each

  user_data: Record<string, string>; // ≤ 100 KB JSON
  risk_class: 'financial' | 'government' | 'legal' | 'subscription' | 'marketing' | 'low';
  tenant: string;                    // tenant ID
  callback_url?: string;             // webhook for async (Q5)
  idempotency_key?: string;          // UUID, dedupe-by-key for 1h (Q1)
}
```

### 6.2 Response
```typescript
interface AutofillResponse {
  fill_id: string;                   // UUID v7
  status: 'completed' | 'partial' | 'failed';
  filled_pdf_url?: string;           // R2 signed URL (or in body if small)
  filled_pdf_base64?: string;        // inline if no R2
  document_hash: string;             // SHA-256 of filled PDF
  input_pdf_hash: string;            // SHA-256 of input
  audit: Array<{
    field: string;
    value: string | null;
    source: 'hint' | 'key_match' | 'llm' | 'rule' | 'unmapped';
    confidence: number;               // 0.0-1.0
    path?: string;                    // PDF object path
  }>;
  unmapped?: string[];                // fields that couldn't be filled
  validation_errors?: string[];       // failed field validations
  visual_check?: 'ok' | 'flagged' | 'skipped';
  duration_ms: number;
  cost_usd: number;
}
```

---

## 7. State Transitions (FRS-007)

```
Application_Draft
   ↓ (autofill succeeded, risk_class ∈ {financial, government, legal})
Application_Filled
   ↓ (human review of visual_check=flagged OR unmapped.length > 0)
Application_ReviewRequired
   ↓ (human approved or corrected)
Application_Ready_To_Submit
```

For `risk_class ∈ {subscription, marketing, low}`: skip the ceremony, just log + return.

---

## 8. Test Plan

### 8.1 Unit
- Form-type detection: 10 PDFs (3 AcroForm, 3 flattened, 2 hybrid, 2 password-protected)
- Field enumeration: 5 known PDFs, check field counts
- LLM mapping: 20 (field, user_data) pairs, check determinism
- Checkbox group detection: 5 PDFs with known checkbox groups

### 8.2 Integration
- 5 real-world PDFs: ATO tax form, bank loan app, super fund, govt form, medical
- 100 fill requests with mixed risk_class
- Each verified: required fields filled, validation passed, round-trip OK, visual OK

### 8.3 Load
- 10 concurrent fills for 60 seconds
- p95 latency < 10s (AcroForm), < 90s (flattened)
- No memory leak after 1000 fills

### 8.4 Security
- PDFs with malicious embedded JS: reject
- user_data > 100 KB: reject
- Missing tenant: reject
- Sidecar reachable from non-Tailscale: reject

---

## 9. Implementation Plan

### Phase 1: Production hardening (1 week)
- [ ] Sidecar: launchd plist, auto-restart
- [ ] Sidecar: Tailscale-only listener (bind to tailnet IP)
- [ ] CF Worker: Hono route + circuit breaker
- [ ] R2: signed-URL upload for filled PDFs (don't inline > 1MB)
- [ ] Metrics: emit to existing EdgeGDE observability stack

### Phase 2: State machine (1 week)
- [ ] FRS-007 Transition Registry integration
- [ ] Risk-class routing (ceremony vs hash-only)
- [ ] Visual check via CUA-driver (re-use existing CUA infra)
- [ ] Webhook for human review queue

### Phase 3: Multi-pass retry (½ week)
- [ ] 3 retry strategies
- [ ] Escalation webhook
- [ ] User-visible partial-fill state in EdgeGDE UI

### Phase 4: Forms catalog (2 weeks)
- [ ] Pre-extracted schemas for top 50 AU forms
- [ ] Caching with proper invalidation
- [ ] Per-form confidence calibration

### Phase 5: Web form filling (separate FRS)
- [ ] New FRS-0006 for web forms
- [ ] Different stack (browser automation, not PDF parsing)

---

## 10. Open Questions — RESOLVED 2026-09-01

**Q1 Idempotency:** dedupe-by-key only. `idempotency_key` lookups in an in-memory LRU with 1h TTL — if hit, return the cached response. The caller is responsible for storing the response if needed; we don't persist completed fills longer than 1h.

**Q2 Multi-PDF forms:** yes, bundle. Request shape adds optional `pdf_set: [pdf_a, pdf_b, ...]`. Each PDF in the set shares the same `user_data`. Filled PDFs are returned as a numbered set with per-PDF `document_hash` and a shared `fill_id`. Bundle is atomic: any failure marks the whole set `partial` and escalates to human review.

**Q3 Schema versioning:** yes, auto-detect. Schema cache key = `sha256(input_pdf_bytes)`. On request: hash input; if hit, use cached schema; if miss, extract via Marker (≈3-5s) and cache for 7 days. Content-hash mismatch is the invalidation signal.

**Q4 Cost recovery:** always free. LLM is local Ollama (qwen2.5:7b for mapping, qwen3-vl:4b for visual). Track token usage in audit log for capacity planning, not billing. Future paid-model fallback requires tenant opt-in.

**Q5 Failure analytics:** both. Partial fills go to `tenant://pdf-fills/{fill_id}/{pdf_filename}.pdf` in R2 with 7-day TTL, audit log alongside. Sentry for stack traces and breadcrumbs (LLM calls, cache hits, validation failures). Webhook: if `callback_url` provided, POST `{fill_id, status, audit}` on completion (success or partial).

---

## 11. Cross-references

- FRS-0001 (least-cost LLM routing): this component uses qwen2.5:7b via Ollama
- FRS-0006 (State Engine): receives the StateTransitionApplication_Filled event
- FRS-0007 (Evidence Engine): verifies filled_pdf_sha256 against the L3 evidence
- FRS-0010 (Browser/CUA automation): provides visual_check capability (reused)
- `docs/research/pdf-autofill-architecture.md`: the original pivot from Docling to Marker
- `docs/FRS-canvas-editor-pwa-v2.md`: sister component (canvas editor)

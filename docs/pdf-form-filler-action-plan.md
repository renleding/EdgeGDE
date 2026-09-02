# EdgeGDE PDF Form Filler — Action Plan for Continuation

**Created:** 2026-09-01
**Branch context:** `work/pdf-form-filler-frs` (FRS committed), `work/pdf-autofill-poc` (sidecar code)
**Goal:** Get the PDF Form Filler from "PoC works for clean AcroForm" to "production-ready, fills real-world forms end-to-end"

---

## 1. Immediate (next session, ≤1 day each)

### 1.1 Sidecar hardening
- [ ] **Fix Form 80 AcroForm path** — Form 80 has 507 fields in PyPDFForm's data but only 21 in /AcroForm catalog. PyPDFForm 5.5.5 has 2 bugs: (a) /Fields corruption on disk write, (b) widget-level fill doesn't survive roundtrip. Workaround proven for clean AcroForm (in-memory buffer + pikepdf save), but Form 80's hybrid structure defeats it. **Next:** investigate the XFA-fallback in PyPDFForm, or use a different library (pikepdf-only fill for known-AcroForm, fallback to flattened path for hybrid)
- [ ] **Speed up the LLM batched mapping** — 385 fields took ~5min. Options: smaller chunks (5 fields/call), use qwen2.5:7b (3-5x faster than ornith:9b), or skip LLM entirely if the field names are semantic (like Form 80's "name fam" / "dob")
- [ ] **Visual verification** — Vision API has insufficient balance. Top up, or switch to a local VLM (qwen3-vl:4b works for text but timed out on coordinates). Need a reliable visual check that fits in the FRS

### 1.2 FRS-0005 open questions (5 questions, all in §10)
Warren needs to decide:
- [ ] **Q1 Idempotency** — keep results 24h (for retry lookups) vs dedupe by key only?
- [ ] **Q2 Multi-PDF forms** — bundle 2-3 PDFs from one user_data (govt forms often do this)?
- [ ] **Q3 Schema versioning** — auto-detect when bank updates their PDF, re-extract?
- [ ] **Q4 Cost recovery** — pass OpenRouter charges to tenant, or always-free (current)?
- [ ] **Q5 Failure analytics** — partial fills live in R2 with TTL? Sentry? Both?

**My recommendations** (per interview, awaiting Warren's call):
- Q1: dedupe-by-key only (no storage); idempotency is the caller's contract
- Q2: yes, bundle — add a `pdf_set: [pdf_a, pdf_b]` request shape
- Q3: yes, content-hash mismatch triggers re-extract; cache key = sha256 of input PDF
- Q4: always free; LLM is local Ollama, $0 to us
- Q5: R2 with 7-day TTL, Sentry for stack traces

### 1.3 Form 80 demo
- [ ] **Fill all 19 pages, not just 3** — proven pipeline works, just needs scale. The 3 unmapped fields (other passport, lost passport, national ID) need VLM coords for their checkboxes
- [ ] **Save the result to /Users/warren/Downloads/80-filled-mock.pdf** for inspection
- [ ] **Re-run with different mock data** to confirm repeatability

---

## 2. Short-term (this week)

### 2.1 Production hardening (FRS §9 Phase 1)
- [ ] **launchd plist** for the sidecar (auto-restart on crash)
- [ ] **Tailscale-only listener** — bind to tailnet IP, not 0.0.0.0
- [ ] **Hono route in `apps/edge-runtime/src/routes/pdf-autofill.ts`** — proxy POST to sidecar with circuit breaker (3 retries, 5s timeout, fail open)
- [ ] **R2 signed-URL upload** for filled PDFs (don't inline > 1MB)
- [ ] **Metrics** — emit `pdf_autofill.duration_seconds{result, form_type}` and `pdf_autofill.fields_filled{form_type}` to EdgeGDE observability stack

### 2.2 State machine (FRS §9 Phase 2)
- [ ] **FRS-007 Transition Registry integration** — `Application_Draft → Application_Filled` for risk_class ∈ {financial, government, legal}
- [ ] **Risk-class routing** — `risk_class` field on request drives ceremony vs hash-only
- [ ] **Visual check via CUA-driver** — re-use existing CUA infra (computer_use action='capture') to screenshot the filled PDF and ask "are all fields visible and correctly filled?"
- [ ] **Human review webhook** — when `unmapped.length > 0` or `visual_check=flagged`, POST partial fill + audit log to a review queue

### 2.3 Multi-pass retry (FRS §9 Phase 3)
- [ ] **3 retry strategies** — re-prompt with field descriptions, swap LLM, escalate
- [ ] **Escalation webhook** — same as 2.2 review webhook
- [ ] **User-visible partial state** in EdgeGDE UI — show the unmapped fields, let user fill manually

---

## 3. Medium-term (next 2 weeks)

### 3.1 Forms catalog (FRS §9 Phase 4)
- [ ] **Pre-extract schemas for top 50 AU forms** — ATO tax forms, bank loan applications, super fund forms, immigration forms
- [ ] **Caching with proper invalidation** — schema cache key = sha256(input PDF); invalidate on content-hash mismatch
- [ ] **Per-form confidence calibration** — track which forms the LLM maps correctly vs needs human review

### 3.2 Worker integration
- [ ] **Connect edge-runtime to Tailscale** — Hermes has the Tailscale infrastructure (per `~/.hermes/`), wire it up
- [ ] **Multi-tenant auth** — Hono route validates tenant token, routes to tenant-specific R2 bucket for filled PDFs
- [ ] **Webhook delivery** — `callback_url` on the request triggers async delivery (per FRS §4.1)

### 3.3 Tests (FRS §8)
- [ ] **Unit tests** — 10 form-type detection (AcroForm, flattened, hybrid), 5 field enumeration, 20 LLM mapping
- [ ] **Integration tests** — 5 real-world PDFs (ATO, bank, super, govt, medical), 100 mixed-risk fills
- [ ] **Load tests** — 10 concurrent fills for 60s, p95 < 10s (AcroForm) / < 90s (flattened)
- [ ] **Security tests** — PDF with embedded JS, oversize user_data, missing tenant, non-Tailscale source

---

## 4. Strategic (next month)

### 4.1 Web form filling (separate FRS — FRS-0006)
- [ ] **New FRS** for browser-based form filling (different stack: patchright/cua-driver)
- [ ] **Shared user_data layer** — same client data drives PDF + web fills
- [ ] **Cross-form state** — fill PDF, then continue into the same form on the web if user_data is incomplete

### 4.2 Cost + observability maturity
- [ ] **Per-tenant cost tracking** — log `cost_usd: 0` per fill (local Ollama is $0, but track LLM token usage for paid fallback)
- [ ] **SLO dashboards** — `pdf_autofill success_rate` (target 99%), `pdf_autofill p95_latency`, `pdf_autofill visual_check_pass_rate`
- [ ] **Failure taxonomy** — `field_type=unknown`, `lib_corruption`, `llm_mapping_failed`, `visual_check_flagged`, `human_escalated`

### 4.3 Open source prep
- [ ] **License the FRS** under Apache 2.0 (matching EdgeGDE)
- [ ] **Reference implementation** — `apps/pdf-sidecar/` becomes a standalone repo
- [ ] **Docs site** — autodoc from FRS, examples per form type

---

## 5. Blockers requiring Warren's input

1. **OpenSpec vs plain FRS** — should this component get a `.openspec/` change directory or just `FRS-*.md` like the others?
2. **Sidecar machine** — where does the Tailscale-mesh sidecar actually run? Dedicated mini-PC, a tailnet VM, or stays on Hermes's Mac for now?
3. **Tenant model** — is EdgeGDE multi-tenant today, or is this a single-org system? Affects how `risk_class` and `tenant` get validated
4. **Visual check fallback** — Vision API balance issue. Stay with local VLM (qwen3-vl:4b, slow but works)? Top up OpenRouter Vision? Use a different provider?
5. **Idempotency storage** — if Q1 answer is "store 24h", need R2 bucket + lifecycle rule; if "dedupe by key only", just need an in-memory LRU

---

## 6. Time estimates (calendar weeks, single contributor)

| Phase | Estimate | Risk |
|-------|----------|------|
| Immediate (§1) | 1 week | Low — proven pipeline |
| Short-term (§2) | 1 week | Medium — Tailscale + launchd + worker integration untested |
| Medium-term (§3) | 2 weeks | Medium — forms catalog is data work, not code |
| Strategic (§4) | 4+ weeks | High — depends on tenant model, web form FRS, business model |

Total: ~8 weeks to "production-ready + observability + first 50 forms pre-cached"

---

## 7. Definition of done (per FRS §4)

A form fill request is "done" when:
- All 21+ fields from user_data are either filled or in `unmapped[]` with a human-escalation entry
- All 3 verification paths passed (required-fields, value validation, round-trip re-read)
- `document_hash` computed and stored
- FRS-007 state transition emitted (if risk_class warrants)
- Filled PDF in R2, signed URL returned to caller (or inlined if small)
- Audit log persisted (90-day TTL)

The Form 80 demo already passes 4/7 of these. Missing: visual check (no Vision API), risk-class routing (no transition registry yet), R2 storage.

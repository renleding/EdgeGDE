# Functional Requirements Specification

# Lender Document Ingestion Pipeline

## Version 1.0

---

# Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-17 | Hermes (Director) | Initial FRS — batch ingestion of Salestrekker lender PDFs into D1 + Vectorize |

---

# 1. Executive Summary

The Lender Document Ingestion Pipeline bulk-extracts ~1,700 lender documents (PDF, DOCX, XLSX) from the organised Salestrekker download folders, classifies each document by lender and type, inserts them into the EdgeGDE D1 `lender_docs` table, and generates vector embeddings for semantic search. The result: Warren can ask "What docs do I need for Bluestone?" or "Show me the Auswide rate sheet" and get answers from both D1 keyword search and Vectorize semantic search via the broker chatbot.

---

# 2. Current Baseline

## 2.1 Existing Infrastructure

| Component | Purpose | Status |
|-----------|---------|--------|
| **Lender folders** | ~77 folders, ~1,700 PDF/DOCX/XLSX files under `Mortgage Lenders/{Banks_Mutuals,Non Banks_Specialists}/` | ✅ Populated |
| **D1 `lender_docs` table** | Holds lender name, doc_type, title, markdown_content | ✅ Created (migration 0023) |
| **D1 `lender_docs_fts`** | FTS5 virtual table on title + content | ✅ Created (external content, needs rebuild) |
| **Vectorize index** (`edgegde-kb-embeddings`) | 768-dim, cosine, semantic search | ✅ Created, 250 vectors |
| **`vectorize-backfill.py`** | Bulk embedding generation for docs missing vectors | ✅ Exists at `apps/edge-runtime/scripts/` |
| **`ingest-and-vectorize.py`** | Single-doc D1 insert + vectorize | ✅ Exists |
| **KB Query API** (`/api/v1/kb/search`) | FTS5 full-text search endpoint | ✅ Deployed |
| **KB Ingest API** (`/api/v1/kb/ingest`) | Admin-protected ingestion endpoint | ✅ Deployed |
| **Broker Chatbot Integration** | Auto-injects context via `chat-processor.ts` | ✅ Deployed |
| **pdftotext** | PDF text extraction (via poppler) | ✅ Available on macOS |

## 2.2 What Does NOT Exist Yet

| Gap | Impact |
|-----|--------|
| Batch walker over all lender folders | Currently no automated scan — each doc would need manual INSERT |
| Filename-to-title mapping | No standardised rule for deriving `title` and `doc_type` from filenames |
| Large PDF chunking | D1 rejects single INSERTS >~100KB — multi-page PDFs need splitting |
| DOCX/XLSX extraction pipeline | Only PDF handled currently |
| Bulk sequential D1 insert | 1,700 individual wrangler calls would be impractical |
| Chunk-level Vectorize indexing | Large docs need per-chunk embeddings for precise semantic retrieval |
| FTS5 index rebuild | `lender_docs_fts` is empty — no keyword search over ingested content |
| Folder-watch / incremental mode | New docs added to folders must be picked up automatically |

---

# 3. System Overview

## 3.1 Architecture

```
Lender Folders (PDF/DOCX/XLSX)
  ↓
┌─────────────────────────────┐
│   Batch Ingest Script       │  ← FRS-006
│   (apps/edge-runtime/scripts/│
│    ingest-lender-docs.py)    │
│                              │
│  1. Walk all lender folders  │
│  2. Extract text             │
│  3. Classify by path/name    │
│  4. Chunk large documents    │
│  5. Batch INSERT to D1       │
│  6. Rebuild FTS5             │
└─────────────────────────────┘
  ↓                    ↓
D1 lender_docs     Vectorize Index
(keyword/FTS5)     (semantic search)
  ↓                    ↓
└────────┬────────────┘
         ↓
 Broker Chatbot + Hermes KB Query
```

## 3.2 Data Flow

1. **Discovery** — Recursively walk `Mortgage Lenders/{Banks_Mutuals,Non Banks_Specialists}/` and collect all PDF, DOCX, and XLSX files
2. **Extraction** — Convert each file to plain text markdown:
   - PDF → `pdftotext -layout`
   - DOCX → `python-docx` or `pandoc`
   - XLSX → `openpyxl` (extract first sheet as markdown table)
3. **Classification** — Derive metadata from file path:
   - `lender_name` = parent folder name
   - `title` = filename (strip extension, clean up)
   - `doc_type` = heuristic from filename keywords (e.g., "Rate", "Fact Sheet", "Application Form", "Policy", "Guide")
4. **Chunking** — Documents >100KB split into numbered parts (part 1/3, 2/3, 3/3)
5. **Ingestion** — Batch insert chunks into D1 (avoiding >100KB per row)
6. **FTS5 rebuild** — Run `INSERT INTO lender_docs_fts(lender_docs_fts) VALUES('rebuild')`
7. **Vectorize** — Run `vectorize-backfill.py` to generate embeddings for all new docs

---

# 4. Functional Requirements

## FR-1: Batch Folder Walker

**FR-1.1** — The batch script SHALL recursively walk all subdirectories under `Mortgage Lenders/Banks_Mutuals/` and `Mortgage Lenders/Non Banks_Specialists/`.

**FR-1.2** — The script SHALL collect files with extensions `.pdf`, `.docx`, `.doc`, `.xlsx`, `.xls`, `.xlsm`.

**FR-1.3** — The script SHALL track which files have already been ingested using either:
   - A D1 query (`SELECT file_path FROM lender_docs WHERE source_path = ?`) for incremental runs, OR
   - A local JSON checkpoint file at `apps/edge-runtime/data/ingestion-checkpoint.json`

**FR-1.4** — The script SHALL accept a `--limit N` flag to process only N files (for testing), defaulting to 0 = all.

**FR-1.5** — The script SHALL accept a `--dry-run` flag that prints what would be ingested without writing to D1.

**FR-1.6** — The script SHALL report progress: `[45/1700] Auswide — Rate Card.pdf → lender_docs + vectorize`

### Acceptance Criteria

- [ ] Running without flags processes all ~1,700 files
- [ ] `--dry-run` prints file count and first 5 titles without mutation
- [ ] `--limit 10` processes only 10 files and exits
- [ ] Re-running after completion shows "0 new files" or processes only un-ingested files

---

## FR-2: Document Text Extraction

**FR-2.1** — For `.pdf` files, extraction SHALL use `pdftotext -layout <file> -` preserving table structure and column alignment.

**FR-2.2** — For `.docx` and `.doc` files, extraction SHALL use `python-docx` to read all paragraph text.

**FR-2.3** — For `.xlsx`, `.xls`, and `.xlsm` files, extraction SHALL use `openpyxl` to convert the first sheet to a markdown table.

**FR-2.4** — If extraction produces fewer than 20 characters of plain text, the script SHALL log a warning and include the filename in a `--retry` output list.

**FR-2.5** — The script SHALL handle password-protected PDFs gracefully (log and skip, do not crash).

### Acceptance Criteria

- [ ] PDF with tables extracts clean markdown with preserved column alignment
- [ ] DOCX extracts readable paragraph text
- [ ] XLSX extracts as markdown table with header row
- [ ] Empty/near-empty extraction logs warning without crashing

---

## FR-3: Document Classification

**FR-3.1** — `lender_name` SHALL be derived from the immediate parent folder name.

**FR-3.2** — `title` SHALL be the filename with extension stripped, spaces normalised, and `_dl` suffix (if present) removed.

**FR-3.3** — `doc_type` SHALL be determined by a keyword matcher applied to the filename (case-insensitive):

| Keyword in filename | doc_type |
|---------------------|----------|
| `application form`, `application`, `accreditation` | form |
| `rate`, `interest`, `pricing`, `fees`, `charges` | pricing |
| `fact sheet`, `product spec`, `product specification` | product |
| `policy`, `procedure`, `guide`, `manual`, `handbook`, `faq` | policy |
| `tmd`, `target market` | tmd |
| `calculator`, `worksheet`, `tool` | calculator |
| `broker guide`, `broker pack`, `submission checklist` | broker-guide |
| `declaration`, `privacy`, `consent`, `disclosure`, `authority` | compliance |
| `discharge`, `release`, `variation`, `change of` | form |
| `lmi`, `lenders mortgage insurance`, `mortgage insurance` | lmi |
| (default, none matched) | other |

**FR-3.4** — The keyword matcher SHALL be configurable via a YAML/JSON file for easy updates without code changes.

**FR-3.5** — `source_path` SHALL store the relative path from the Mortgage Lenders root for dedup reference.

### Acceptance Criteria

- [ ] `Rate Card and Fees.pdf` in Auswide folder → `{lender: "Auswide", title: "Rate Card and Fees", doc_type: "pricing"}`
- [ ] `Broker Accreditation Form.pdf` in ANZ folder → `{lender: "ANZ", title: "Broker Accreditation Form", doc_type: "form"}`
- [ ] Unrecognised filename → `doc_type: "other"` (no crash)

---

## FR-4: Large Document Chunking

**FR-4.1** — Any extracted text exceeding 90KB SHALL be split into numbered parts with a maximum of 90KB per part.

**FR-4.2** — Each chunk SHALL insert as a separate D1 row with `title` appended with `(part X/N)`.

**FR-4.3** — Chunk boundaries SHALL be at paragraph breaks (double newlines), not mid-sentence, to preserve semantic units.

**FR-4.4** — Each chunk SHALL have its own Vectorize embedding for precise semantic search.

### Acceptance Criteria

- [ ] 250KB extracted document → 3 chunks of ≤90KB each
- [ ] Chunks break at paragraph boundaries, not mid-line
- [ ] D1 rows show `"Rate Card and Fees (part 1/3)"`, `"Rate Card and Fees (part 2/3)"`, etc.

---

## FR-5: D1 Bulk Ingestion

**FR-5.1** — Ingestion SHALL use the D1 REST API (via wrangler or Cloudflare API) for batch inserts, NOT per-document wrangler calls.

**FR-5.2** — Batches SHALL be limited to 50 rows per INSERT statement to stay within D1's request size limits.

**FR-5.3** — After all documents are inserted, the script SHALL rebuild the FTS5 index:
```sql
INSERT INTO lender_docs_fts(lender_docs_fts) VALUES('rebuild');
```

**FR-5.4** — On failure of a single batch, the script SHALL log which files failed and continue (no full rollback), outputting a retry list at the end.

**FR-5.5** — The script SHALL generate a stable UUID (v4) for each document row.

### Acceptance Criteria

- [ ] 1,700 documents processed in ≤35 D1 INSERT calls (50 rows each)
- [ ] FTS5 rebuild runs after all inserts
- [ ] Failed batch outputs file list for retry without crashing
- [ ] Each row has a unique UUID

---

## FR-6: Vectorize Embedding Generation

**FR-6.1** — After D1 insertion, the script SHALL run the existing `vectorize-backfill.py` to generate embeddings for all new/changed documents.

**FR-6.2** — The script SHALL pass the `--limit` flag to vectorize-backfill so test runs stay small.

**FR-6.3** — First 5,000 characters only of each document SHALL be embedded (matching the 512-token model limit).

**FR-6.4** — The script SHALL log per-document embedding status (success/skip/error).

### Acceptance Criteria

- [ ] After ingestion, Vectorize index shows ~1,700+ vectors (one per chunk)
- [ ] Semantic query "Bluestone accreditation documents" returns relevant chunks

---

## FR-7: Incremental / Watch Mode

**FR-7.1** — The script SHALL support an `--incremental` flag that queries D1 for existing `source_path` values and skips already-ingested files.

**FR-7.2** — The script SHALL accept a `--folder "/Mortgage Lenders/Non Banks_Specialists/NewLender"` flag to process a single folder without full scan.

**FR-7.3** — A future cron job MAY schedule `--incremental` daily to pick up new downloads automatically.

### Acceptance Criteria

- [ ] First run: all 1,700 files ingested
- [ ] Second run with `--incremental`: 0 new files
- [ ] New file added to folder → third run with `--incremental`: 1 new file ingested

---

# 5. Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Python 3.11 (script on macOS) |
| PDF extraction | `pdftotext` (poppler) |
| DOCX extraction | `python-docx` |
| XLSX extraction | `openpyxl` |
| Batch orchestration | Python (no framework needed) |
| D1 API | `wrangler d1 execute --file` or Cloudflare API `POST /accounts/{id}/d1/database/{id}/query` |
| Vectorize API | `vectorize-backfill.py` via Workers AI |
| Search | D1 FTS5 + Vectorize cosine similarity |
| Observability | CLI logging to stdout |

---

# 6. Constraints & Non-Goals

## Constraints

- **Max 100KB per D1 row** — enforced by chunking (FR-4)
- **Max 50 rows per INSERT** — D1 batch size limit
- **No D1 migration changes** — uses existing `lender_docs` schema (migration 0023)
- **Workers AI free tier rate limits** — ~5 calls/batch, ~1s each. Expect ~6 minutes for 1,700 embeddings

## Non-Goals (Out of Scope for v1)

- PDF image/scan OCR (expects selectable-text PDFs; scanned PDFs logged and skipped)
- PDF form field extraction (only text content)
- DOCX image/embedded chart extraction
- XLSX multiple-sheet extraction (first sheet only)
- Web UI for ingestion management (CLI-only)
- Real-time folder watching (poll-based incremental only)
- Deduplication by content hash (filename-based only)

---

# 7. Error Handling & Recovery

| Error | Handling |
|-------|----------|
| PDF extraction fails (password, corrupt) | Log warning, skip file, continue |
| D1 batch insert fails | Log batch file list, continue, output retry list |
| Vectorize fails for N docs | Log per-doc status, continue, re-runnable via `--incremental` |
| Network timeout to Workers AI | Retry up to 3 times with 2s backoff |
| Filename collision (same title, different lender) | Handled by `lender_name` distinction in D1 |
| Script killed mid-run | Re-runnable via `--incremental` (skips already-inserted `source_path` values) |

---

# 8. Rollout Plan

| Phase | What | Effort |
|-------|------|--------|
| **1. Core script** | Batch walker + extraction + classification + D1 insert | 1 session |
| **2. Chunking** | Large doc splitting + multi-row insertion | 0.5 session |
| **3. Vectorize integration** | Auto-trigger `vectorize-backfill.py` after insert | 0.5 session |
| **4. Full run** | Process all ~1,700 docs, verify search results | Background (~30 min) |
| **5. Incremental cron** | Schedule daily `--incremental` run | 0.5 session |

Total estimated effort: **4-5 sessions** (building + debugging + full run)

---

# 9. Verification Tests

## 9.1 Dry Run Smoke Test
```bash
cd apps/edge-runtime
python3 scripts/ingest-lender-docs.py --dry-run --limit 5
```
Expected: prints classification for 5 files, no D1 mutations.

## 9.2 Single-Folder Test
```bash
python3 scripts/ingest-lender-docs.py \
  --folder "/Mortgage Lenders/Non Banks_Specialists/Allium Money" \
  --limit 3
```
Expected: 3 docs ingested for Allium Money only.

## 9.3 Full Ingestion
```bash
python3 scripts/ingest-lender-docs.py
```
Expected: ~1,700 documents in D1, 1,700+ vectors in Vectorize, FTS5 index rebuilt.

## 9.4 Search Verification
```bash
curl -s "https://edgegde-calculator.renleding.workers.dev/api/v1/kb/search?q=Auswide+rate+sheet" | jq '.results | length'
```
Expected: ≥1 result from Auswide rate documents.

## 9.5 Incremental Verification
```bash
python3 scripts/ingest-lender-docs.py --incremental
```
Expected: "0 new files ingested."

---

# 10. OTel Observability

| Span | Attribute | Status |
|------|-----------|--------|
| `ingest.walk` | `files_found`, `files_skipped`, `files_errored` | OK / FAIL |
| `ingest.extract` | `file_ext`, `char_count`, `chunk_count` | OK / SKIP / FAIL |
| `ingest.classify` | `lender`, `doc_type`, `title` | OK / FALLBACK |
| `ingest.d1_insert` | `batch_size`, `rows_inserted`, `rows_failed` | OK / PARTIAL / FAIL |
| `ingest.fts5_rebuild` | `duration_ms` | OK / FAIL |
| `ingest.vectorize` | `docs_sent`, `docs_succeeded`, `docs_failed` | OK / PARTIAL / FAIL |

---

# 11. Cross-Lender Analysis Capabilities

Once all ~1,700 lender documents are ingested into D1 and Vectorize, the broker chatbot and Hermes gain a powerful cross-lender analysis layer that was previously impossible (data was siloed in files).

## 11.1 Analysis by Doc Type (D1 Keyword Queries)

These queries run across ALL lenders simultaneously via the FTS5 index or `LIKE` on `lender_docs`:

| Question | SQL / Query Pattern |
|----------|---------------------|
| "Which lenders have rate cards?" | `SELECT DISTINCT lender_name FROM lender_docs WHERE doc_type = 'pricing'` |
| "Which lenders are missing their TMD?" | `SELECT lender_name FROM lenders LEFT JOIN lender_docs ON lender_name = ... AND doc_type = 'tmd' WHERE doc_type IS NULL` |
| "Show every lender's accreditation form" | `SELECT lender_name, title FROM lender_docs WHERE doc_type = 'form' ORDER BY lender_name` |
| "What types of docs does each lender provide?" | `SELECT lender_name, doc_type, COUNT(*) FROM lender_docs GROUP BY 1, 2 ORDER BY 1, 2` |
| "Which lenders have a broker guide?" | `SELECT lender_name, title FROM lender_docs WHERE doc_type = 'broker-guide'` |
| "Find lenders with LMI info" | `SELECT lender_name, title FROM lender_docs WHERE doc_type = 'lmi'` |

## 11.2 Semantic Cross-Lender Search (Vectorize)

These queries search the meaning of all documents, not just keywords:

| Question | How |
|----------|-----|
| "Which lenders mention construction loans?" | Vectorize query `construction loan policy` → ranked by relevance, grouped by lender |
| "Compare reverse mortgage offerings across lenders" | Vectorize `reverse mortgage` → docs from Heartland, Household Capital, etc. |
| "Which lenders support self-employed / alt-doc?" | Vectorize `self-employed low doc alternative` → docs mentioning this topic |
| "Find lenders that offer NDIS or SMSF loans" | Semantic search for niche product mentions |
| "Which lenders have the most competitive investment property rates?" | Vectorize `investment property interest rates` across pricing docs |

## 11.3 Gap Analysis

Ingestion enables systematic gap identification:

```sql
-- Lenders with no pricing docs
SELECT lender_name FROM lender_docs
GROUP BY lender_name
HAVING SUM(CASE WHEN doc_type = 'pricing' THEN 1 ELSE 0 END) = 0;

-- Lenders with no TMD (regulatory gap)
SELECT lender_name FROM lender_docs
GROUP BY lender_name
HAVING SUM(CASE WHEN doc_type = 'tmd' THEN 1 ELSE 0 END) = 0;

-- Lenders with fewer than 10 docs total (thin coverage)
SELECT lender_name, COUNT(*) AS doc_count
FROM lender_docs
GROUP BY lender_name
HAVING doc_count < 10;
```

## 11.4 Chatbot Integration Pattern

The broker chatbot (`chat-processor.ts`) auto-injects lender context before answering:

```
User: "What docs do I need for Bluestone accreditation?"
  → Vectorize query: "Bluestone accreditation"
  → Returns: Bluestone Accreditation Form, Bluestone Broker Guide
  → D1 query: SELECT content FROM lender_docs WHERE lender_name='Bluestone' AND doc_type IN ('form','broker-guide')
  → Chatbot: "Here are the docs I found..."
```

```
User: "Which lenders offer construction loans and what are their requirements?"
  → Vectorize query: "construction loan requirements"
  → Returns docs ranked by relevance across ALL lenders
  → D1 query: SELECT lender_name, title FROM lender_docs WHERE ... (top 5 lenders)
  → Chatbot: "The following lenders mention construction loans: [list]"
```

## 11.5 FR-8: Analysis Query Endpoint

**FR-8.1** — A new API endpoint `GET /api/v1/kb/analysis` SHALL accept parameters:
- `group_by` — `lender_name`, `doc_type`, or both
- `filter` — optional `doc_type` or `lender_name` filter
- `min_count` — minimum document count filter

**FR-8.2** — The endpoint SHALL return aggregate statistics:
```json
{
  "total_docs": 1700,
  "total_lenders": 77,
  "by_type": {
    "form": 320,
    "pricing": 145,
    "policy": 280,
    "product": 200,
    "tmd": 77,
    ...
  },
  "by_lender": {
    "ANZ": 91,
    "Westpac": 65,
    "CBA": 73,
    ...
  }
}
```

**FR-8.3** — The endpoint SHALL support a `gap_analysis` flag that returns lenders missing specific doc types.

### Acceptance Criteria

- [ ] `GET /api/v1/kb/analysis?group_by=doc_type` returns doc counts by type
- [ ] `GET /api/v1/kb/analysis?group_by=lender_name` returns doc counts by lender
- [ ] `GET /api/v1/kb/analysis?gap_analysis=true` returns lenders missing pricing, TMD, or forms
- [ ] Response time under 3 seconds (D1 aggregate queries are fast)

---

Stored at `apps/edge-runtime/data/doc-type-rules.yaml`:

```yaml
rules:
  - keywords: ["application form", "broker accreditation", "accreditation form"]
    doc_type: form
  - keywords: ["rate card", "interest rate", "pricing", "fee schedule", "fees & charges"]
    doc_type: pricing
  - keywords: ["fact sheet", "product specification", "product summary"]
    doc_type: product
  - keywords: ["credit policy", "lending policy", "procedure", "broker guide", "faq", "handbook"]
    doc_type: policy
  - keywords: ["target market determination", "tmd"]
    doc_type: tmd
  - keywords: ["calculator", "serviceability", "worksheet"]
    doc_type: calculator
  - keywords: ["submission checklist", "broker pack", "supporting document"]
    doc_type: broker-guide
  - keywords: ["declaration", "privacy consent", "authority to disclose", "disclosure"]
    doc_type: compliance
  - keywords: ["lmi", "mortgage insurance", "lenders mortgage insurance"]
    doc_type: lmi
  - default: other
```

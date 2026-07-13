# Functional Requirements Specification

# LMS Video Knowledge Pipeline

## Version 1.0

---

# Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-13 | Hermes (Director) | Initial FRS — based on Purple CFS LMS extraction implementation |

---

# 1. Executive Summary

The LMS Video Knowledge Pipeline extracts training video content from authenticated corporate LMS environments (starting with Purple Circle Financial Services), processes it through a dual-OCR chain (qwen3-vl + Apple Vision), produces a structured Watch Report, merges it with the full transcript into a single knowledge document, and ingests it into a shared D1 knowledge base for querying by the Afirmico broker chatbot and Hermes agents.

The pipeline transforms raw training video into structured, searchable knowledge — combining visual slide content (via Apple Vision exact OCR), interpretive analysis (via qwen3-vl vision model), and verbatim transcript (via faster-whisper).

---

# 2. Current Baseline

## 2.1 Existing Infrastructure

| Component | Purpose | Status |
|-----------|---------|--------|
| **EdgeGDE Worker** (`edgegde-calculator`) | Hono routes, D1, KV, R2, Vectorize | ✅ Production |
| **D1 Database** (`edgegde-prod` / `ebroker_leads`) | FTS5 search over transcripts | ✅ Migration 0023 |
| **Vectorize Index** (`edgegde-kb-embeddings`) | Semantic search (768d, cosine) | ✅ Created |
| **KB Query API** (`/api/v1/kb/search`) | FTS5 full-text search endpoint | ✅ Deployed |
| **KB Ingest API** (`/api/v1/kb/ingest`) | Admin-protected ingestion endpoint | ✅ Deployed |
| **Broker Chatbot Integration** | Auto-injects transcript context via `chat-processor.ts` | ✅ Deployed |
| **faster-whisper** | Local audio transcription (base model) | ✅ Installed |
| **yt-dlp** | Video download from Vimeo (Referer auth) | ✅ Installed |
| **Apple Vision OCR** | macOS native ANE-accelerated OCR (`poller/ocr/vision_framework.py`) | ✅ Existing doc-intel pipeline |
| **Ollama qwen3-vl:4b** | Vision model for interpretive text extraction | ✅ Running locally |
| **Doc-Intel Poller** | M1-based document processing daemon (`poller/`) | ✅ Existing |

## 2.2 What Does NOT Exist Yet

| Gap | Impact |
|-----|--------|
| Unified frame-OCR pipeline for video slides | Currently manual / ad-hoc per video |
| Automated slide text extraction into knowledge doc | Relies on vision_analyze one-off calls |
| Batch processing for multiple lessons | Each lesson extracted individually |
| Lender docs ingestion pipeline | `lender_docs` table exists but no ingestion flow |

---

# 3. Requirements

## R1: Frame Extraction from Video

The pipeline must extract representative frames from a video file for OCR processing.

**Acceptance criteria:**
- Extract frames at **full 1920x1080 resolution** (no scaling) for Apple Vision OCR — 512px scaled frames return 0 observations regardless of text contrast
- Scale frames to 512px width for qwen3-vl analysis and display only (separate parallel extraction)
- Cap at 100 frames per video (20s minimum spacing on 41-min video)
- Extract 0–10s hook frames at 2fps for opening analysis
- Frames stored temporarily in `frames/` subdirectory, **deleted after `.knowledge.md` finalised**

## R2: Dual-OCR Slide Text Extraction

Each frame must be processed through two OCR passes:

**Pass 1 — qwen3-vl (interpretive):**
- Prompt: "Extract all visible text from this slide/frame. Return only the text content exactly as shown, preserving layout where possible. Include headings, bullet points, labels, and any numbers."
- Freeform output — no structured field parsing (unlike the driver's license extraction path)
- Temperature: 0.1 (deterministic)

**Pass 2 — Apple Vision (exact):**
- Via `poller/ocr/ocr_worker.py` → `vision_framework.py`
- `VNRecognizeTextRequest` with Accurate level, en-AU/en-US
- Returns per-line text with confidence scores
- ANE-accelerated on M1 (~0.5-2s per frame)

**Output:**
- qwen3-vl output: interpretive reading (captures formatting, context, partial text)
- Apple Vision output: exact OCR text with confidence (ground truth)
- Both stored per-frame for cross-reference

## R3: Watch Report Generation

Generate a structured markdown report combining frame analysis and transcript.

**Required sections:**
- **TL;DR** — one-paragraph summary
- **Key Moments** — timestamped table of every major section
- **Hook Breakdown** — visual analysis of opening 10 seconds
- **Process Map** — any workflow/procedure covered (if applicable)
- **Escalation / Procedures** — specific actionable procedures from the video
- **Entities & Concepts** — extracted people, tools, lenders, products
- **Commission / Milestones** — any numerical thresholds mentioned
- **Support Channels** — contact methods, SLAs
- **Key Quotes** — notable quotable moments with speaker attribution
- **Editorial Profile** — duration, cuts, speaker changes, format

## R4: Merged Knowledge Document

Merge the Watch Report and full verbatim transcript into a single `.knowledge.md` file.

**Structure:**
```
# Knowledge Document: <title>

## Metadata (source, duration, speakers, format, LMS URL, Vimeo ID)

## TL;DR
## Key Moments (timestamped)
## Process Map (if applicable)
## Entities & Concepts
## Key Quotes
## Full Transcript (complete verbatim text, no truncation)
```

**Rules:**
- Watch Report sections go FIRST (structured overview)
- Full transcript goes AFTER (ground truth)
- Raw transcript is authoritative — Watch Report is interpretive
- D1 FTS5 indexes only the raw transcript text (not the interpretive sections)

## R5: D1 Knowledge Base Ingestion

The pipeline must ingest video metadata and transcript into the EdgeGDE D1 knowledge base.

**Storage:**
| Table | Content | Search? |
|-------|---------|---------|
| `videos` | Source URL, Vimeo URL, title, duration, transcript FK | Metadata queries |
| `transcripts` | Full raw transcript text | FTS5 full-text search |
| `transcripts_fts` | FTS5 virtual table (auto-synced via triggers) | Keyword search |

**Required fields per insert:**
- `videos`: id, source_url, vimeo_url, title, duration_seconds, transcript_id
- `transcripts`: id, video_id, title, source_url, markdown_content, word_count

**Target databases:** Both `edgegde-prod` (production) and `ebroker_leads_staging` (staging)

## R6: Broker Chatbot Context Integration

The knowledge base must feed into the Afirmico broker chatbot's LLM context.

**Mechanism:**
- `chat-processor.ts` calls `searchTranscripts(db, userText)` for every chat message
- Top 3 transcript snippets injected as `[Video Lesson: <title>]` blocks
- Labeled so LLM attributes source correctly
- Graceful failure: if D1 unavailable or query fails, transcript context silently omitted

## R7: Output Artifact Storage

| Artifact | Format | Location | Retention |
|----------|--------|----------|-----------|
| Video file | `.mp4` | `.../PCFS - LMS Data/videos/<module>/` | Permanent |
| Raw transcript | `.md` | Same directory | Permanent |
| Watch Report | `.watch-report.md` | Same directory | Permanent |
| Merged Knowledge Doc | `.knowledge.md` | Same directory | Primary reference |
| Frames | `.jpg` | `frames/` subdirectory | Transient — delete after `.knowledge.md` finalised. Re-extractable via ffmpeg seek (~0.1s/frame). Enforced by pipeline. |
| Audio | `.wav` | Same directory | Transient — delete after processing |

---

# 4. Architecture

## 4.1 Pipeline Flow

```
SEED URL (LMS lesson page)
    │
    ▼
1. DISCOVERY
   ├── curl/grep for player.vimeo.com/video/<id>?h=<hash>
   └── Extract Vimeo URL + use LMS page as Referer
    │
    ▼
2. DOWNLOAD (yt-dlp)
   ├── --referer <lms-url>
   ├── --restrict-filenames
   ├── No --cookies needed (Vimeo privacy hash suffices)
   └── Output: <module>/<title>.mp4
    │
    ▼
3. TRANSCRIPTION
   ├── Check for yt-dlp subtitles → .vtt
   ├── If none → faster-whisper (base model, CPU)
   │   └── ffmpeg extract audio → whisper → markdown
   └── Output: <title>.md (raw transcript)
    │
    ▼
4. FRAME EXTRACTION
   ├── ffmpeg select=not(mod(n\,900)),scale=512:-1 → ~68 frames/41min
   ├── 0-10s hook: fps=2, scale=512:-1 → 20 frames
   └── Output: frames/ directory
    │
    ▼
5. DUAL OCR
   ├── qwen3-vl:4b via Ollama (interpretive slide text)
   │   └── Prompt: "Extract all visible text from this slide/frame..."
   └── Apple Vision via poller/ocr/ocr_worker.py (exact OCR text)
       └── VNRecognizeTextRequest, en-AU, Accurate level
    │
    ▼
6. WATCH REPORT
   ├── Synthesize: frame analysis + transcript + OCR text
   └── Output: <title>.watch-report.md
    │
    ▼
7. MERGED KNOWLEDGE DOC
   ├── Watch Report sections + full transcript
   └── Output: <title>.knowledge.md
    │
    ▼
8. D1 INGESTION
   ├── wrangler d1 execute --file → edgegde-prod + staging
   └── Searchable via /api/v1/kb/search
```

## 4.2 Module Map

```
EdgeGDE/
├── apps/edge-runtime/
│   ├── src/
│   │   ├── api/knowledge-base.ts          # KB query router (search, videos, video detail)
│   │   ├── api/kb-ingest.ts               # KB ingest router (POST /ingest, /ingest/batch)
│   │   ├── lib/knowledge-base.ts           # searchTranscripts() for chatbot context
│   │   └── lib/chat-processor.ts           # Wired to call searchTranscripts per message
│   ├── migrations/0023_create_knowledge_base.sql
│   └── wrangler.json                        # Vectorize + D1 bindings
│
├── poller/
│   ├── ocr/ocr_worker.py                   # Apple Vision subprocess runner
│   ├── ocr/vision_framework.py             # VNRecognizeTextRequest wrapper
│   └── vision/ollama.py                    # qwen3-vl Ollama client
│
└── scripts/
    ├── extract-lms-videos.py               # Full pipeline orchestrator (Python)
    └── extract-cookies.py                  # Chrome cookie extraction (disused — Referer auth sufficess)
```

## 4.3 Data Flow (Dual OCR Detail)

```
Frame.jpg
    │
    ├──→ Ollama qwen3-vl:4b
    │     POST /v1/chat/completions
    │     { prompt: "Extract all visible text..." }
    │     → qwen_text (interpretive, may miss fine print)
    │
    └──→ poller/ocr/ocr_worker.py
          → python3 subprocess
          → vision_framework.py
          → VNRecognizeTextRequest (Apple Vision)
          → AV_text + confidence + bboxes
    │
    ▼
Combine: qwen_text + AV_text
  → qwen captures slide context, headings, structure
  → AV provides exact OCR, catches fine print
  → Cross-reference to identify discrepancies
```

---

# 5. D1 Schema (Migration 0023 — Complete)

```
videos
  id TEXT PK                    -- UUID
  source_url TEXT NOT NULL      -- LMS page URL
  vimeo_url TEXT NOT NULL       -- player.vimeo.com/video/...?h=...
  title TEXT NOT NULL DEFAULT ''
  duration_seconds INTEGER NOT NULL DEFAULT 0
  r2_key TEXT                   -- R2 object key (optional, future)
  transcript_id TEXT            -- FK → transcripts.id
  extracted_at TEXT

transcripts
  id TEXT PK                    -- UUID
  video_id TEXT NOT NULL REFERENCES videos(id)
  title TEXT NOT NULL DEFAULT ''
  source_url TEXT NOT NULL
  markdown_content TEXT NOT NULL
  word_count INTEGER NOT NULL DEFAULT 0
  chunk_count INTEGER NOT NULL DEFAULT 0
  extracted_at TEXT

transcripts_fts                -- FTS5 virtual table
  (title, markdown_content, content='transcripts')

lender_docs                    -- Future: lender policies, forms
  id TEXT PK
  lender_name TEXT NOT NULL
  doc_type TEXT CHECK(policy|form|guide|faq|other)
  title TEXT NOT NULL
  markdown_content TEXT NOT NULL
  word_count INTEGER NOT NULL DEFAULT 0
  ingested_at TEXT

lender_docs_fts                -- FTS5 virtual table
  (title, markdown_content, content='lender_docs')
```

---

# 6. API Contracts

## GET /api/v1/kb/search

Full-text FTS5 search across transcripts and lender docs.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | FTS5 query (hyphens auto-sanitized) |
| `type` | string | `all` | `all`, `transcript`, `lender` |
| `limit` | int | 10 | Max results (1-50) |

**Response:**
```json
{
  "results": [{
    "id": "uuid",
    "source": "transcript|lender",
    "title": "...",
    "snippet": "... excerpt around match ...",
    "rank": -0.0000037,
    "url": "LMS lesson URL",
    "extracted_at": "2026-07-13T..."
  }],
  "total": 1,
  "query": "cooling-off period"
}
```

## GET /api/v1/kb/videos

List all extracted videos with transcript availability.

## GET /api/v1/kb/video/:id

Single video detail with full linked transcript content.

## POST /api/v1/kb/ingest

Admin-auth (Bearer token). Insert video + transcript into D1. Triggers FTS5 auto-sync.

## POST /api/v1/kb/ingest/batch

Bulk insert up to 50 items. Reports per-item success/failure.

---

# 7. Error Handling

| Condition | Behaviour |
|-----------|-----------|
| Vimeo iframe not found on page | Check for dynamic rendering (Playwright timeout), then return "No Media Found" |
| Missing `?h=` privacy hash | Log warning, proceed with extraction attempt |
| yt-dlp returns no subtitles | Skip VTT, proceed to faster-whisper fallback |
| faster-whisper fails | Log error, skip transcription, preserve video file |
| Apple Vision returns empty OCR | Fall back to qwen3-vl text only, mark frame as "low confidence" |
| Ollama qwen3-vl unavailable | Skip qwen pass, proceed with Apple Vision only |
| D1 insert fails | Log error, save artifacts locally, retry on next pipeline run |
| Cookie expiry / LMS redirects to login | Halt pipeline, request refreshed session |
| Frame extraction too slow (>60s) | Fall back to uniform sampling (1 frame/30s) |

---

# 8. Verification

| Check | Criteria |
|-------|----------|
| Single video end-to-end | Video downloaded, transcript generated, frames extracted, dual OCR run, watch report created, knowledge doc merged, D1 ingested |
| FTS5 search returns content | `curl /api/v1/kb/search?q=<term>` returns result with correct snippet |
| Video list shows entry | `curl /api/v1/kb/videos` includes the video |
| Video detail returns transcript | `curl /api/v1/kb/video/<id>` returns video + transcript |
| Broker chatbot injects context | Chat message produces `[Video Lesson: ...]` in LLM context |
| Apple Vision produces exact text | OCR text matches on-screen slide content |
| Hyphen in FTS5 query handled | `cooling-off` returns results (hyphen sanitised to space) |
| No subtitle fallback | Video without captions still produces transcript (faster-whisper) |

---

# 9. Deferred for Future Iteration

| Feature | Rationale |
|---------|-----------|
| **Automated batch extraction** | Currently one URL at a time; follow-Next-Lesson links could be Phase 2 |
| **Lender docs ingestion** | `lender_docs` table exists, no ingestion pipeline yet — needs PDF/HTML → markdown converter |
| **Vector embedding pipeline** | Vectorize index exists but no automatic chunk → embed → insert flow. Requires Workers AI + embedding cron |
| **Graph entity extraction** | MemPalace/Ladybug for entity-relationship graph from transcripts. Requires NLP pipeline |
| **Video upload to R2** | Currently stored locally on M1. Could be uploaded to `edgegde-vault` R2 bucket |
| **Watch Video Hermes skill** | Currently a manual script. Could be formalised as `/watch` Hermes slash command |
| **Automated re-extraction on LMS update** | Would need change detection (polling or webhook from Purple CFS LMS) |
| **Multi-language transcription** | faster-whisper supports many languages; currently locked to English |

---

# 10. Dependencies

| Dependency | Purpose | Install |
|-----------|---------|---------|
| `yt-dlp` | Video download | `brew install yt-dlp` |
| `ffmpeg` | Audio extraction, frame extraction | `brew install ffmpeg` |
| `faster-whisper` | Audio transcription | `pip install faster-whisper` |
| `pyobjc-framework-Vision` | Apple Vision OCR bindings | Already installed in poller venv |
| `ollama` + `qwen3-vl:4b` | Vision model OCR pass | Already running |
| `cryptography` | Chrome cookie AES decryption | `pip install cryptography` (rarely needed) |

---

# 11. Open Questions

1. **Lender docs ingestion** — what format are lender policies in? PDF, HTML, or scanned images? Determines the ingestion path.
2. **Batch lesson extraction** — should the pipeline follow "Next Lesson" links automatically, or is one-at-a-time the preferred workflow?
3. **Vector embedding schedule** — should transcript embeddings be generated on-ingest (synchronous, slower) or via cron (asynchronous, need job queue)?
4. **Knowledge doc retention** — `.knowledge.md` files stored alongside videos; should they also be ingested into D1 as a separate `knowledge_docs` table?

---

*End of FRS. Version 1.0 — 13 July 2026.*

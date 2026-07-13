# IPS: Purple CFS LMS Knowledge Base

**Version:** 1.0  
**Status:** Approved  
**Target:** EdgeGDE Worker + D1 + Vectorize + Local M1 extraction  
**FRS Source:** Autonomous LMS Video Discovery & Extraction (Purple CFS → Knowledge Base)

---

## 1. Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  Local M1 (Hermes)  │     │  EdgeGDE Worker      │     │  Broker Chatbot  │
│                     │     │                      │     │                  │
│  Playwright ──→ LMS  │     │  GET /api/kb/search  │◄────│  FTS5 queries    │
│  (cookies.txt auth) │     │  │                   │     │                  │
│       │              │     │  ├── FTS5 (keyword)  │     │                  │
│       ▼              │     │  └── Vectorize       │     │                  │
│  yt-dlp ──→ .mp4     │     │       (semantic)    │     │                  │
│       │              │     │                      │     │                  │
│       ▼              │     │  D1: ebroker_leads   │     │  Hermes (Agent)  │
│  VTT → markdown      │────►│  └── transcripts     │◄────│  FTS5 + Ladybug  │
│       │              │     │      └── FTS5 index  │     │                  │
│       ▼              │     │                      │     │                  │
│  R2 (video files)    │────►│  R2: edgegde-vault   │     │  MemPalace       │
│  (manual upload)   │     │                      │     │  Ladybug (graph) │
└─────────────────────┘     └──────────────────────┘     └──────────────────┘
```

## 2. Repository Layout

```
apps/edge-runtime/
  migrations/
    0022_create_knowledge_base.sql       ← New: transcripts + FTS5
  src/
    api/
      knowledge-base.ts                  ← New: KB query router
    lib/
      env.ts                             ← Edit: add VECTORIZE_INDEX binding
  wrangler.jsonc                         ← Edit: add Vectorize binding
  wrangler.local.toml                    ← Edit: add Vectorize stub

<ROOT>/
  skills/  (→ ~/.hermes/skills/)
    lms-extract/
      SKILL.md                           ← New: Hermes skill for extraction
      references/
        extraction-guide.md              ← New: Step-by-step extraction workflow
```

## 3. Cloudflare Bindings

| Binding | Type | Purpose | Currently Exists? |
|---|---|---|---|
| `DB` | D1 | Transcript storage + FTS5 | ✅ Yes |
| `VAULT_BUCKET` | R2 | Video files (manual upload) | ✅ Yes |
| `VECTORIZE_INDEX` | Vectorize | Semantic search over transcripts | ❌ New — create via CLI |
| `AI` | Workers AI | Embedding generation | ✅ Built-in |

## 4. D1 Schema (Migration 0022)

```sql
-- 0022_create_knowledge_base.sql

-- Source videos — metadata only. Actual video stored on M1 + optionally R2.
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,                              -- UUID
  source_url TEXT NOT NULL,                          -- LMS page where found
  vimeo_url TEXT NOT NULL,                           -- player.vimeo.com/video/...?h=...
  title TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,                                       -- R2 object key if uploaded
  transcript_id TEXT,                                -- FK to transcripts.id (nullable)
  extracted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_extracted ON videos(extracted_at DESC);

-- Transcripts — the core knowledge payload
CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,                               -- UUID
  video_id TEXT NOT NULL REFERENCES videos(id),
  title TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  markdown_content TEXT NOT NULL,                    -- Full clean transcript as markdown
  word_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  extracted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_video ON transcripts(video_id);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  title,
  markdown_content,
  content='transcripts',
  content_rowid='rowid'
);
-- Note: rowid is implicitly available on the virtual table.
-- After each INSERT into transcripts, sync:
--   INSERT INTO transcripts_fts(rowid, title, markdown_content)
--   VALUES (new.rowid, new.title, new.markdown_content);

-- Lender policies (future: can be ingested the same way as transcripts)
CREATE TABLE IF NOT EXISTS lender_docs (
  id TEXT PRIMARY KEY,
  lender_name TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('policy','form','guide','faq','other')),
  title TEXT NOT NULL,
  markdown_content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_lender_docs_lender ON lender_docs(lender_name);
CREATE INDEX IF NOT EXISTS idx_lender_docs_type ON lender_docs(doc_type);

CREATE VIRTUAL TABLE lender_docs_fts USING fts5(
  title,
  markdown_content,
  content='lender_docs',
  content_rowid='rowid'
);
```

## 5. API Contracts

### GET /api/kb/search

Full-text search across transcripts and lender docs.

**Request:**
```
GET /api/kb/search?q=cooling-off+period&type=all&limit=10
```

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | required | FTS5 query string |
| `type` | string | `all` | `all`, `transcript`, `lender` |
| `limit` | int | 10 | Max results (1–50) |

**Response:**
```json
{
  "results": [
    {
      "id": "uuid",
      "source": "transcript",
      "title": "Understanding Cooling-Off Periods",
      "snippet": "...cooling-off period allows the borrower to...",
      "rank": 0.85,
      "url": "https://purplecfs.com.au/lessons/module-3",
      "extracted_at": "2026-07-13T..."
    }
  ],
  "total": 1,
  "query": "cooling-off period"
}
```

**Edge cases:**
- Empty `q` → 400: query required
- No matches → 200 with empty results array
- FTS5 syntax error → 400 with "invalid query syntax" message
- `type` not recognized → defaults to `all`

### GET /api/kb/videos

List all extracted videos.

**Response:**
```json
{
  "videos": [
    {
      "id": "uuid",
      "title": "Module 3: Compliance Essentials",
      "duration_seconds": 1845,
      "has_transcript": true,
      "extracted_at": "2026-07-13T..."
    }
  ]
}
```

## 6. Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `KB_QUERY_REQUIRED` | 400 | `q` search parameter is required |
| `KB_INVALID_QUERY` | 400 | FTS5 syntax error in query |
| `KB_NOT_FOUND` | 404 | Video or transcript ID not found |
| `KB_DB_ERROR` | 500 | Internal D1 query failure |

## 7. Phased Task List

### Phase 1: Foundation (NOW — this gogo)

The working extraction pipeline + D1 storage + basic query API.

**Tasks:**
1. Migration 0022 — Create knowledge base schema with FTS5
2. wrangler config — Add Vectorize binding (stub for now)
3. Env types — Add VECTORIZE_INDEX binding type
4. Hermes skill — `lms-extract` skill with extraction workflow
5. KB query router — `/api/kb/search` and `/api/kb/videos`
6. R2 upload helper — Lambda/minimal function for video upload
7. Extract one video end-to-end and verify

### Phase 2: Semantic Search (deferred)

Vector embeddings + hybrid search.

**Tasks:**
1. Create Vectorize index via wrangler CLI
2. Workers AI embedding pipeline (chunk → embed → insert)
3. Hybrid search endpoint (FTS5 rank × Vectorize cosine)
4. Automatic embedding on transcript insert

### Phase 3: Lender Docs Ingestion (deferred)

PDF/HTML policy forms → markdown → same FTS5 + Vectorize pipeline.

### Phase 4: Graph Layer (deferred)

MemPalace/Ladybug entity extraction from transcripts — relationship mapping for Hermes.

---

## 8. Acceptance Criteria Mapping

| FRS Requirement | IPS Section | Phase | Verification |
|---|---|---|---|
| Navigate LMS / extract iframes (WATCH video skill integration) | §7 Phase 1 task 4 | 1 | Manual: Hermes extracts one video |
| yt-dlp download with cookies + referer | §7 Phase 1 task 4 | 1 | Video file exists on M1 |
| VTT → clean markdown | §7 Phase 1 task 4 | 1 | Transcript readable in D1 |
| Store in knowledge base | §4, §7 Phase 1 | 1 | D1 has rows |
| Queryable by chatbot + agents | §5 | 1 | `curl /api/kb/search?q=test` returns results |
| Broker context for Afirmico | §1 architecture | 1-4 | Chatbot queries return video knowledge |
| Hermes strategy questions | §1 architecture | 1-4 | Hermes queries KB via Worker API |
| Lender knowledge | §4 lender_docs table | 3 | Lender docs ingested and searchable |
| Semantic search | §7 Phase 2 | 2 | Vector results from Vectorize |
| Graph relationships | §7 Phase 4 | 4 | Ladybug nodes from transcripts |

---

## 9. Phase 1 Implementation

**Deliverables:**
- `apps/edge-runtime/migrations/0022_create_knowledge_base.sql`
- `apps/edge-runtime/src/api/knowledge-base.ts`
- Edit `apps/edge-runtime/src/lib/env.ts`
- Edit `apps/edge-runtime/wrangler.jsonc`
- Edit `apps/edge-runtime/wrangler.local.toml`
- New Hermes skill: `~/.hermes/skills/lms-extract/SKILL.md`

**Verification after Phase 1:**
- [ ] Migration runs cleanly on local D1
- [ ] Hermes can extract one video and insert into D1
- [ ] `GET /api/kb/search?q=test` returns results
- [ ] Environment type-checks pass
- [ ] Migration applies to staging

---

*End of IPS. Phase 1 implementation begins below.*

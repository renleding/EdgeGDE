# FRS: Meetily + cal.com/Cal Video Integration

**Document ID:** FRS-meetily-cal-integration-v1  
**Status:** Draft  
**Date:** 2026-07-23  
**Author:** Hermes (Director)  
**Project:** EdgeGDE  
**Parent Task:** DOC-FRS-0001  

---

## 1. Executive Summary

Integrate Meetily (open-source, local-first AI meeting note-taker) with cal.com (scheduling + Cal Video) to produce a fully private, self-hosted meeting intelligence pipeline. Post-meeting only — real-time triggers deferred to future phase.

The system captures meeting audio via Meetily (invisible, no bot), transcribes locally with Whisper/Parakeet, summarises via Ollama, and exposes structured data through a SQLite watcher. A Hermes-managed integration layer reads new transcript data and triggers cal.com API actions (follow-up booking, CRM update, email through Gmail).

---

## 2. System Context

```
                    ┌─────────────────────┐
                    │     cal.com         │
                    │  (free plan)        │
                    │                     │
                    │  Booking page ──────┤──── Cal Video call
                    │  Webhooks           │
                    │  API v2             │
                    └────────┬────────────┘
                             │ booking created/cancelled
                             ▼
┌─────────────────────────────────────────────────────┐
│                    User's Mac                         │
│                                                        │
│  ┌────────────┐    ┌──────────────────────────────┐   │
│  │  Meetily   │───▶│  SQLite DB                    │   │
│  │  (captures │    │  ├─ meetings                  │   │
│  │   system   │    │  ├─ transcripts               │   │
│  │   audio)   │    │  ├─ transcript_chunks          │   │
│  └────────────┘    │  └─ summary_processes          │   │
│                     └──────────┬───────────────────┘   │
│                                │                        │
│                     ┌──────────▼───────────────────┐   │
│                     │  Hermes SQLite Watcher        │   │
│                     │  (FSEvents/inotify + trigger) │   │
│                     └──────────┬───────────────────┘   │
│                                │                        │
│                     ┌──────────▼───────────────────┐   │
│                     │  Hermes Action Engine         │   │
│                     │  ├─ Cal.com API ───▶ booking  │   │
│                     │  ├─ Gmail ────────▶ email     │   │
│                     │  └─ CRM ─────────▶ task       │   │
│                     └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Meetily (Data Source)

**Purpose:** Capture, transcribe, and summarise meetings locally.

**Configuration:**
- Audio capture: System audio (invisible to participants)
- Transcription engine: Parakeet or Whisper (local)
- Summarisation LLM: Ollama (model: TBD — Gemma3, LLaMA, or Mistral)
- Platform: macOS (primary) — also Windows, Linux via Docker

**DB path confirmed:** `/Users/warren/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite`  
**Schema verified:** 6 tables match FRS spec (meetings, transcripts, transcript_chunks, summary_processes, settings, transcript_settings)  
**WAL mode:** Active (`.sqlite-wal` + `.sqlite-shm` present) — our `sqlite3.connect()` handles this automatically

**DB is standard SQLite, unencrypted, no WAL mode (default).**

---

### 3.2 SQLite Database Schema

Confirmed from Meetily v0.4.0 source code (`backend/app/db.py`):

#### Table: `meetings`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `title` | TEXT NOT NULL | Meeting title |
| `created_at` | TEXT NOT NULL | ISO-8601 |
| `updated_at` | TEXT NOT NULL | ISO-8601 |
| `folder_path` | TEXT | Optional path to exported artifacts |

#### Table: `transcripts`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `meeting_id` | TEXT NOT NULL FK | References `meetings(id)` |
| `transcript` | TEXT NOT NULL | Raw transcript text |
| `timestamp` | TEXT NOT NULL | ISO-8601 |
| `summary` | TEXT | AI-generated summary |
| `action_items` | TEXT | Extracted action items |
| `key_points` | TEXT | Key discussion points |
| `audio_start_time` | REAL | Seconds from recording start |
| `audio_end_time` | REAL | Seconds from recording start |
| `duration` | REAL | Segment duration in seconds |

#### Table: `transcript_chunks`

| Column | Type | Description |
|---|---|---|
| `meeting_id` | TEXT PK FK | References `meetings(id)` |
| `meeting_name` | TEXT | Denormalised title |
| `transcript_text` | TEXT NOT NULL | Full meeting transcript |
| `model` | TEXT NOT NULL | STT model used |
| `model_name` | TEXT NOT NULL | Model variant |
| `chunk_size` | INTEGER | Chunk config |
| `overlap` | INTEGER | Overlap config |
| `created_at` | TEXT NOT NULL | ISO-8601 |

#### Table: `summary_processes`

| Column | Type | Description |
|---|---|---|
| `meeting_id` | TEXT PK FK | References `meetings(id)` |
| `status` | TEXT NOT NULL | PENDING, COMPLETED, FAILED |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `error` | TEXT | Error message if failed |
| `result` | TEXT | JSON blob of summarisation output |
| `start_time` | TEXT | |
| `end_time` | TEXT | |
| `chunk_count` | INTEGER DEFAULT 0 | |
| `processing_time` | REAL DEFAULT 0.0 | |
| `metadata` | TEXT | JSON metadata |

#### Useful Queries for the Watcher

```sql
-- Latest completed meeting with summary
SELECT m.id, m.title, m.created_at, tc.transcript_text, sp.result, sp.status
FROM meetings m
JOIN transcript_chunks tc ON m.id = tc.meeting_id
JOIN summary_processes sp ON m.id = sp.meeting_id
WHERE sp.status = 'COMPLETED'
ORDER BY m.created_at DESC
LIMIT 1;

-- New meetings since last check
SELECT id, title, created_at
FROM meetings
WHERE created_at > ?
ORDER BY created_at ASC;
```

---

### 3.3 SQLite File Watcher

**Implementation language:** Python (Hermes-compatible)

**Trigger mechanism:** Use macOS `FSEvents` via `pyfsevent` or `watchdog` library. Poll every 2 seconds as fallback.

**Detection flow:**
1. Watch `meeting_minutes.db` for file modification events
2. On change, query `summary_processes` for status transitions: `PENDING → COMPLETED`
3. Extract meeting_id, transcript, and AI summary/action_items
4. Pass structured data to Hermes Action Engine

**Polling interval:** 2 seconds (the DB write completes in < 50ms — polling overhead is negligible)

**Race condition protection:** SQLite is ACID; open connection as READ_ONLY after write commit is guaranteed complete.

---

### 3.4 Hermes Action Engine

**Purpose:** Process extracted meeting data and execute configured actions.

**Available actions (configurable per trigger phrase):**

| Trigger Phrase (from transcript) | Action | Integration |
|---|---|---|
| "email [documents/details] to [name]" | Send email with documents | Gmail API (via Hermes gmail skill) |
| "create task for [description]" | Create CRM task | Salestrekker API |
| "book follow-up [date/time]" | Create cal.com booking | cal.com API v2 |
| "complete task [id/description]" | Mark CRM task done | Salestrekker API |
| "save [note] to knowledge base" | Write to MemPalace/Ladybug | MemPalace API |
| *(no trigger)* | Default: archive transcript + summary | Local storage + MemPalace |

**Trigger matching:** LLM-as-matcher — pass transcript snippet + action_items to local Ollama model with structured prompt to extract trigger phrases and their parameters, then map to actions.

---

### 3.5 cal.com Integration

**Scope:** cal.com free plan features only.

**API Authentication**
- API v2: OAuth2 client credentials
- Account email: `connect@afirmico.com`
- Endpoint: `https://api.cal.com/v2/`
- Rate limits: Free plan allows standard usage

#### Webhook Subscriptions
- Subscribe to `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED` events
- Receive real-time notification when a cal.com meeting is booked
- Used to correlate Meetily transcripts with cal.com booking records (via meeting title/timestamp matching)

#### Action: Create Follow-up Booking

```http
POST https://api.cal.com/v2/bookings
Authorization: Bearer <token>
Content-Type: application/json

{
  "eventTypeId": <event_type_id>,
  "start": "2026-07-30T10:00:00Z",
  "attendees": [
    {"name": "<participant_name>", "email": "<participant_email>", "timeZone": "Australia/Sydney"}
  ],
  "title": "Follow-up: <original_meeting_title>",
  "description": "Auto-scheduled follow-up from meeting transcript action item",
  "calVideoSettings": {
    "enableAutomaticRecordingForOrganizer": false,
    "enableAutomaticTranscription": true
  }
}
```

#### Action: Get Event Types

```http
GET https://api.cal.com/v2/event-types
Authorization: Bearer <token>
```

Response includes `eventTypeId` values for your meeting types — used to route follow-ups to the correct meeting type.

#### Cal Video Integration Notes
- Cal Video is the default meeting communication for all bookings
- Cal Video supports automatic transcription (set via `calVideoSettings`)
- Transcripts from Cal Video can supplement Meetily transcripts for cross-reference
- Future: cal.com Notes feature (currently waitlist) may provide an alternative cloud-based summary pipeline alongside Meetily

**Calendar:** cal.com manages event creation. Events sync to connected calendars as configured in cal.com settings (Apple Calendar via CalDAV).

---

### 3.6 Gmail Integration

**Purpose:** Send emails triggered by transcript action items.

**Integration:** Hermes existing `gmail` skill (OAuth2 via `warren.ledingham@gmail.com`).

**Authentication:** Two accounts with separate auth:
- **Gmail** `warren.ledingham@gmail.com` — personal broker emails (OAuth client `947866220350-kn5lkltgq2ir2m6psmirgvt8ut3no69k`)
- **Zoho** `connect@afirmico.com` — business/cal.com-related emails (Zoho Mail API via OAuth or app password)

**Action flow:**
1. Extract recipient, subject, body from transcript via Ollama
2. Determine sending context (cal.com action → Zoho; personal → Gmail)
3. Hermes calls appropriate email API
4. Log to meeting record

---

### 3.7 CRM (Salestrekker) Integration

**Purpose:** Create/complete tasks in Salestrekker based on action items.

**Integration:** Salestrekker REST API (existing Hermes authentication).

**Scope:**
- Create task: `POST /api/v1/tasks` with description, due date, assignee
- Complete task: `PATCH /api/v1/tasks/{id}` with status `completed`
- Update contact record with meeting notes: `PATCH /api/v1/contacts/{id}`

---

### 3.8 MemPalace / Knowledge Base Integration

**Purpose:** Store meeting summaries and extracted knowledge for future retrieval.

**Integration:** MemPalace read-write API + LadybugDB read-only projection.

**Action:** Each processed meeting creates a MemPalace entity with predicates:
- `type → meeting`
- `title → <meeting_title>`
- `transcript → <full_text>`
- `summary → <ai_summary>`
- `action_items → <extracted_items>`
- `participants → <speakers>`
- `date → <meeting_date>`
- `cal_booking_id → <if applicable>`

---

## 4. Data Flow

### 4.1 Post-Meeting Processing

```
1. cal.com: Booking created → Webhook fires (BOOKING_CREATED)
   └─ Store booking_id, meeting title, scheduled time

2. User attends Cal Video meeting (no Meetily bot involvement)

3. Meetily: Captures system audio during call
   └─ Writes transcript + summary to SQLite DB

4. Hermes Watcher: Detects DB change (FSEvents)
   └─ Queries: SELECT from summary_processes WHERE status='COMPLETED'
   └─ Extracts: meeting_id, transcript_text, summary, action_items
   └─ Matches meeting title with cal.com booking (if correlation exists)

5. Hermes Action Engine: Processes extracted data
   └─ Runs Ollama prompt to extract trigger phrases from action_items
   └─ Maps triggers → configured actions
   └─ Executes actions:
       ├─ If "book follow-up" → cal.com API → POST /v2/bookings
       ├─ If "email X to Y" → Gmail API → send email
       ├─ If "create task" → Salestrekker API → create task
       └─ Always → MemPalace → save meeting record

6. Logging: Write processing summary to Hermes mission log
```

### 4.2 Meetily <-> Cal.com Meeting Correlation

Since Meetily captures any system audio (no integration with cal.com during the call), we correlate post-hoc:

| Correlation Method | Reliability | Complexity |
|---|---|---|
| Meeting title fuzzy match between Meetily DB and cal.com webhook | Medium | Low |
| Time-range overlap (Meetily capture time ≈ Cal Video booking slot) | High | Low |
| Manual tagging via Meetily UI by user | High (manual) | Zero |

**Recommendation:** Use time-range matching as primary, title match as secondary. Both fields are in the Meetily `meetings` table and cal.com webhook payload.

---

## 5. Ollama Model Configuration

**Recommendation:** Gemma3 27B (via Ollama) for summarisation and trigger extraction across English + multilingual.

| Model | Strengths | Weaknesses |
|---|---|---|
| Gemma3 27B | Best multilingual support, large context (128k), fast on Apple Silicon | High RAM (~20GB) |
| LLaMA 3.1 8B | Fast, low RAM (~8GB) | English only, smaller context |
| Mistral 7B | Fast, decent multilingual | Lower quality summaries |
| Phi-4 14B | Good reasoning, strong for trigger extraction | Heavier than 8B options |

**Suggested config:** Gemma3 27B for summarisation (quality), Phi-4 14B for trigger extraction (speed + precision).

---

## 6. Acceptance Criteria

| ID | Criterion | Verification |
|---|---|---|
| AC-1 | Meetily captures Cal Video meeting audio without bot joining | Visual: No bot appears in meeting roster. Audio: Transcript produced. |
| AC-2 | Meetily transcribes meeting locally using Whisper/Parakeet | SQLite `transcript_chunks` table populated with text |
| AC-3 | Meetily generates summary via Ollama | `summary_processes.result` populated with JSON summary |
| AC-4 | Hermes SQLite watcher detects new completed meeting within 5 seconds | Log shows watcher event timestamp ≤ 5s after DB write |
| AC-5 | Hermes extracts action_items from transcript | `action_items` field populated in trigger prompt |
| AC-6 | Trigger "book follow-up" creates cal.com booking | `POST /v2/bookings` returns 201. Booking appears in cal.com dashboard. |
| AC-7 | Trigger "email documents to [name]" sends Gmail | Email received by test recipient |
| AC-8 | Trigger "create task for [desc]" creates Salestrekker task | Task visible in Salestrekker dashboard |
| AC-9 | Every meeting summary saved to MemPalace | MemPalace query returns meeting entity |
| AC-10 | Real-time triggers explicitly disabled (post-meeting only) | No watcher action fires during active meeting |

---

## 7. Non-Goals (Deferred to Future)

- Real-time/in-meeting trigger execution
- Live coaching or suggestions to host during meeting
- Sentiment tracking, talk-time analysis, meeting scoring
- Multilingual AI voice agent
- Shareable audio clips
- Screenpipe integration (eval separately if Meetily path fails)
- cal.com Notes feature (waitlist — evaluate when GA)
- Apple Calendar integration (deferred — configure via cal.com settings if needed)

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Meetily DB schema changes in v0.5+ | Medium | Medium | Pin Meetily version. Add schema migration test in watcher. |
| Meetily captures non-meeting audio | High | Low | Watcher deduplicates by meeting_id. No false actions fired. |
| Ollama model quality insufficient for trigger extraction | Low | Medium | Fallback to DeepSeek/Claude via API for trigger matching. |
| cal.com API rate limits on free plan | Low | Medium | Queue follow-up booking requests. One per meeting. No burst. |
| SQLite WAL mode causes read-after-write lag | Low | Low | Open with `SQLITE_OPEN_READONLY` — auto-includes WAL pages. |
| cal.com Notes feature obsoletes this pipeline | Low (2026) | Medium | Monitor. If GA, re-evaluate architecture. |

---

## 9. Implementation Phases

### Phase 1 (Current — DOC-FRS-0001)
- Complete this FRS ✅
- Confirm Meetily installation and DB location on Warren's Mac
- Test SQLite read access and schema discovery

### Phase 2 — Watcher Prototype
- Implement Python SQLite watcher using `watchdog`
- Query new completed meetings
- Extract transcript + summary + action_items
- Verify locally

### Phase 3 — cal.com API Binding
- Implement cal.com auth (OAuth2 via Bitwarden-managed key)
- Implement `POST /v2/bookings` for follow-up booking
- Implement webhook subscription for `BOOKING_CREATED`
- Test end-to-end: trigger → booking created in cal.com

### Phase 4 — Action Engine
- Implement Ollama trigger extraction pipeline
- Implement Gmail action
- Implement Salestrekker task action
- Implement MemPalace save action
- Test with real meeting data

### Phase 5 — Deployment
- Create launchd agent for watcher (auto-start on login)
- Create Hermes cron job for periodic health check
- Document operation procedures

---

## 10. Appendix A: cal.com API Reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/v2/event-types` | GET | List available event types (get IDs for booking) |
| `/v2/bookings` | POST | Create booking |
| `/v2/webhooks` | POST | Subscribe to booking events |
| `/v2/oauth` | POST | OAuth2 token exchange |

**Auth:** OAuth2 client_credentials → Bearer token. Store in Bitwarden AI Vault via Hermes credential-management skill.

---

## 11. Appendix B: Meetily DB Discovery

Commands to locate Meetily database on macOS:

```bash
# If Meetily is running, find open DB files
lsof -p $(pgrep -f meetily) 2>/dev/null | grep .db

# Common locations
find ~/Library/Application\ Support -name "meeting_minutes.db" 2>/dev/null
find ~/.meetily -name "*.db" 2>/dev/null
find /tmp -name "meeting_minutes.db" 2>/dev/null

# Or check the DATABASE_PATH env var if set
# Meetily defaults to 'meeting_minutes.db' in its working directory
```

---

## 12. Appendix C: Watcher Python Skeleton

```python
"""meetily_watcher.py — Hermes-managed SQLite watcher for Meetily"""

import time
import sqlite3
import json
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

MEETILY_DB = "/path/to/meeting_minutes.db"
KNOWN_MEETINGS = set()

class MeetilyDBHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path == MEETILY_DB:
            self.process_new_meeting()

    def process_new_meeting(self):
        conn = sqlite3.connect(MEETILY_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT m.id, m.title, m.created_at,
                   tc.transcript_text, sp.result, sp.action_items
            FROM meetings m
            JOIN transcript_chunks tc ON m.id = tc.meeting_id
            JOIN summary_processes sp ON m.id = sp.meeting_id
            WHERE sp.status = 'COMPLETED'
              AND m.id NOT IN ({})
        """.format(",".join("?" * len(KNOWN_MEETINGS))),
            list(KNOWN_MEETINGS))
        for row in cur.fetchall():
            meeting_id = row["id"]
            KNOWN_MEETINGS.add(meeting_id)
            process_meeting(dict(row))
        conn.close()

def process_meeting(data: dict):
    """Route meeting data to Hermes Action Engine"""
    print(f"New meeting: {data['title']} ({data['id']})")
    # Call Hermes action pipeline
    # - Extract triggers via Ollama
    # - Execute actions (cal.com, Gmail, CRM, MemPalace)

if __name__ == "__main__":
    observer = Observer()
    observer.schedule(MeetilyDBHandler(), path=MEETILY_DB, recursive=False)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
```

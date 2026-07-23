# Meetily + cal.com Integration — Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement task-by-task.

**Goal:** Build a local Python toolset that watches Meetily's SQLite database for new completed meeting transcripts, extracts action items via Ollama, and triggers actions on cal.com (follow-up booking), Gmail (send email), Salestrekker (CRM task), and MemPalace (knowledge storage).

**Architecture:** macOS FSEvents watcher on Meetily's SQLite DB → Hermes-managed Python engine → Ollama trigger extraction → parallel action dispatch via cal.com API v2, Gmail/Zoho API, Salestrekker API, MemPalace API.

**Tech Stack:** Python 3.11+, watchdog (FSEvents), aiosqlite, httpx (async HTTP), Ollama /api/chat, cal.com API v2, Gmail OAuth2, Salestrekker REST API, MemPalace REST API.

**FRS Reference:** `docs/FRS-meetily-cal-integration-v1.md`

**Parent Task:** DOC-FRS-0001

---

## Phase 1 — Discovery & Setup (0.5h)

### Task 1.1: Locate Meetily DB on Warren's Mac

**Objective:** Find the exact path to Meetily's SQLite database on this machine.

**Files:**
- Run: discovery commands only

**Step 1: Check running Meetily process**
```bash
pgrep -fl meetily
```

**Step 2: Find open DB files**
```bash
lsof -p $(pgrep -f meetily) 2>/dev/null | grep .db
```

**Step 3: Search common locations**
```bash
find ~/Library/Application\ Support -name "meeting_minutes.db" 2>/dev/null
find ~ -maxdepth 4 -name "meeting_minutes.db" 2>/dev/null
find /tmp -name "meeting_minutes.db" 2>/dev/null
```

**Step 4: If found, inspect schema**
```bash
sqlite3 <db_path> ".tables"
sqlite3 <db_path> ".schema meetings"
sqlite3 <db_path> ".schema transcripts"
sqlite3 <db_path> ".schema transcript_chunks"
sqlite3 <db_path> ".schema summary_processes"
sqlite3 <db_path> "SELECT COUNT(*) FROM meetings;"
sqlite3 <db_path> "SELECT id, title, created_at, status FROM summary_processes sp JOIN meetings m ON sp.meeting_id = m.id ORDER BY created_at DESC LIMIT 5;"
```

**Verification:** DB path known, schema matches FRS spec, at least one completed meeting visible.

---

### Task 1.2: Verify cal.com API Access

**Objective:** Confirm cal.com API v2 authentication works and event types exist.

**Files:**
- `.env.meetily` — store API keys (add to .gitignore)

**Step 1: Get API credentials**
- Generate API key from cal.com dashboard: Settings → Developers → API Keys
- Store in `.env.meetily`: `CAL_COM_API_KEY=cal_live_...` (managed via Bitwarden)

**Step 2: Test API connectivity**
```bash
curl -s -H "Authorization: Bearer $CAL_COM_API_KEY" \
  -H "cal-api-version: 2024-06-01" \
  https://api.cal.com/v2/event-types | python3 -m json.tool | head -30
```

**Expected:** 200 + list of event types with `id` and `title`

**Step 3: Verify Cal Video default**
```bash
curl -s -H "Authorization: Bearer $CAL_COM_API_KEY" \
  -H "cal-api-version: 2024-06-01" \
  "https://api.cal.com/v2/event-types?limit=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
et=d.get('data',d.get('eventTypes',[]))[0]
print('Default location:', et.get('locations',[{}])[0].get('type','unknown'))
print('Has Cal Video:', any(l.get('type')=='integrations:cal.com:cal_video' for l in et.get('locations',[])))
"
```

**Verification:** API responds, event types visible, Cal Video is the default location type.

---

### Task 1.3: Set Up Python Project Structure

**Objective:** Create the meetily-integration Python package with dependencies.

**Files:**
- Create: `scripts/meetily-integration/pyproject.toml`
- Create: `scripts/meetily-integration/src/__init__.py`
- Create: `scripts/meetily-integration/src/watcher.py` (stub)
- Create: `scripts/meetily-integration/src/engine.py` (stub)
- Create: `scripts/meetily-integration/src/actions/__init__.py`
- Create: `scripts/meetily-integration/.env.example`
- Create: `scripts/meetily-integration/requirements.txt`

**Step 1: Create directory structure**
```bash
mkdir -p scripts/meetily-integration/src/actions
```

**Step 2: Write pyproject.toml**
```toml
[project]
name = "meetily-integration"
version = "0.1.0"
description = "Hermes-managed SQLite watcher + action engine for Meetily + cal.com"
requires-python = ">=3.11"
dependencies = [
    "watchdog>=4.0.0",
    "aiosqlite>=0.19.0",
    "httpx>=0.27.0",
    "python-dotenv>=1.0.0",
]
```

**Step 3: Write requirements.txt**
```
watchdog>=4.0.0
aiosqlite>=0.19.0
httpx>=0.27.0
python-dotenv>=1.0.0
```

**Step 4: Write .env.example**
```
MEETILY_DB_PATH=/path/to/meeting_minutes.db
CAL_COM_API_KEY=cal_live_xxx
CAL_COM_EVENT_TYPE_ID=123
GMAIL_CREDENTIALS_PATH=~/.hermes/credentials/gmail-oauth.json
ZOHO_EMAIL=connect@afirmico.com
ZOHO_APP_PASSWORD=xxx
SALESTREKKER_API_KEY=xxx
SALESTREKKER_BASE_URL=https://api.salestrekker.com
MEMPALACE_API_URL=http://localhost:8910
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_TRIGGER_MODEL=ornith:9b
OLLAMA_SUMMARY_MODEL=qwen3-vl:4b
```

**Step 5: Write fresh venv + install**
```bash
cd scripts/meetily-integration
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

**Verification:** `uv pip list | grep -E "watchdog|aiosqlite|httpx|python-dotenv"` shows all four installed.

---

### Task 1.4: Create Stub Entry Point

**Objective:** Create `main.py` as the CLI entry point with subcommands.

**Files:**
- Create: `scripts/meetily-integration/src/main.py`

**Step 1: Write main.py**
```python
"""meetily-integration: Hermes-managed SQLite watcher + action engine.

Usage:
  python -m src.main watch        # Start DB watcher daemon
  python -m src.main process <id>  # Process a single meeting by ID
  python -m src.main list          # List recent meetings
"""
import argparse
import asyncio
import sys

def main():
    parser = argparse.ArgumentParser(description="Meetily Integration Engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("watch", help="Start SQLite watcher daemon")
    proc = sub.add_parser("process", help="Process a single meeting")
    proc.add_argument("meeting_id", help="Meeting UUID to process")
    sub.add_parser("list", help="List recent completed meetings")

    args = parser.parse_args()

    if args.command == "watch":
        from .watcher import run_watcher
        asyncio.run(run_watcher())
    elif args.command == "process":
        from .engine import process_meeting
        asyncio.run(process_meeting(args.meeting_id))
    elif args.command == "list":
        from .engine import list_meetings
        asyncio.run(list_meetings())

if __name__ == "__main__":
    main()
```

**Step 2: Test**
```bash
cd scripts/meetily-integration
python -m src.main --help
python -m src.main list
```

**Verification:** `--help` shows 3 subcommands. `list` runs without error (returns empty or "no meetings found").

---

## Phase 2 — SQLite Watcher (1h)

### Task 2.1: Implement DB Reader

**Objective:** Read-only SQLite queries for the Meetily schema.

**Files:**
- Create: `scripts/meetily-integration/src/db.py`

**Step 1: Write db.py**
```python
"""Read-only SQLite interface for Meetily database."""
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

class MeetilyDB:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"Meetily DB not found: {db_path}")

    def get_new_meetings(self, since_id: Optional[str] = None) -> list[dict]:
        """Return completed meetings not yet processed."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        if since_id:
            cur.execute("""
                SELECT m.id, m.title, m.created_at,
                       tc.transcript_text,
                       sp.result, sp.status,
                       sp.action_items
                FROM meetings m
                JOIN summary_processes sp ON m.id = sp.meeting_id
                JOIN transcript_chunks tc ON m.id = tc.meeting_id
                WHERE sp.status = 'COMPLETED'
                  AND m.created_at > COALESCE(
                      (SELECT created_at FROM meetings WHERE id = ?), '1970-01-01')
                ORDER BY m.created_at ASC
            """, (since_id,))
        else:
            cur.execute("""
                SELECT m.id, m.title, m.created_at,
                       tc.transcript_text,
                       sp.result, sp.status,
                       sp.action_items
                FROM meetings m
                JOIN summary_processes sp ON m.id = sp.meeting_id
                JOIN transcript_chunks tc ON m.id = tc.meeting_id
                WHERE sp.status = 'COMPLETED'
                ORDER BY m.created_at ASC
            """)

        rows = cur.fetchall()
        conn.close()

        results = []
        for row in rows:
            d = dict(row)
            if d.get("result"):
                try:
                    d["result"] = json.loads(d["result"])
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append(d)
        return results

    def get_all_meetings(self, limit: int = 10) -> list[dict]:
        """Return recent meetings with status."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT m.id, m.title, m.created_at, sp.status
            FROM meetings m
            LEFT JOIN summary_processes sp ON m.id = sp.meeting_id
            ORDER BY m.created_at DESC
            LIMIT ?
        """, (limit,))
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows
```

**Step 2: Test**
```python
# python -c "
# from src.db import MeetilyDB
# db = MeetilyDB('/tmp/meeting_minutes.db')  # path TBD
# print(db.get_all_meetings(5))
# "
```

(Full test once DB path is confirmed from Task 1.1.)

---

### Task 2.2: Implement File Watcher

**Objective:** Watch the Meetily SQLite file for modifications and trigger processing.

**Files:**
- Modify: `scripts/meetily-integration/src/watcher.py`

**Step 1: Write watcher.py**
```python
"""FSEvents-based watcher for Meetily SQLite database."""
import asyncio
import logging
import os
import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from .db import MeetilyDB

logger = logging.getLogger(__name__)

class MeetilyDBHandler(FileSystemEventHandler):
    def __init__(self, db_path: str, poll_interval: float = 2.0):
        self.db_path = db_path
        self.poll_interval = poll_interval
        self._last_modified = os.path.getmtime(db_path)
        self._known_ids = set()

    def on_modified(self, event):
        if event.src_path != self.db_path:
            return
        now = os.path.getmtime(self.db_path)
        if now - self._last_modified < self.poll_interval:
            return  # Debounce rapid writes
        self._last_modified = now
        asyncio.run_coroutine_threadsafe(self._check_for_new(), _loop)

    async def _check_for_new(self):
        """Query for unprocessed completed meetings."""
        try:
            db = MeetilyDB(self.db_path)
            meetings = db.get_new_meetings()
            for m in meetings:
                if m["id"] not in self._known_ids:
                    self._known_ids.add(m["id"])
                    logger.info(f"New meeting detected: {m['title']} ({m['id']})")
                    from .engine import process_meeting
                    await process_meeting(m)
        except Exception as e:
            logger.error(f"Watcher check failed: {e}")

    def seed_known_ids(self, db: MeetilyDB):
        """Pre-populate known IDs from existing meetings on startup."""
        for m in db.get_all_meetings(limit=100):
            self._known_ids.add(m["id"])

_loop = None  # Set by run_watcher

def run_watcher():
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)

    db_path = os.environ.get("MEETILY_DB_PATH", "meeting_minutes.db")
    if not Path(db_path).exists():
        logger.error(f"Database not found: {db_path}")
        return

    # Seed known IDs
    db = MeetilyDB(db_path)
    handler = MeetilyDBHandler(db_path)
    handler.seed_known_ids(db)

    observer = Observer()
    observer.schedule(handler, path=str(Path(db_path).parent), recursive=False)
    observer.start()
    logger.info(f"Watching {db_path} for changes...")

    try:
        _loop.run_forever()
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
```

---

### Task 2.3: Write Unit Tests for DB Reader

**Objective:** Ensure DB queries work correctly with a test SQLite database.

**Files:**
- Create: `scripts/meetily-integration/tests/test_db.py`
- Create: `scripts/meetily-integration/tests/fixtures/meeting_minutes.db` (via script)

**Step 1: Create test fixtures script**
```python
# tests/create_fixture_db.py
import sqlite3
import json
from datetime import datetime

db = sqlite3.connect("tests/fixtures/meeting_minutes.db")
db.executescript("""
    CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transcript_chunks (
        meeting_id TEXT PRIMARY KEY, meeting_name TEXT,
        transcript_text TEXT NOT NULL, model TEXT NOT NULL,
        model_name TEXT NOT NULL, chunk_size INTEGER, overlap INTEGER,
        created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS summary_processes (
        meeting_id TEXT PRIMARY KEY, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        error TEXT, result TEXT);
""")

now = datetime.utcnow().isoformat()
db.execute("INSERT INTO meetings VALUES ('m1','Test Meeting',?,?)", (now, now))
db.execute("INSERT INTO transcript_chunks VALUES ('m1','Test Meeting','Hello world transcript','whisper','large-v3',0,0,?)", (now,))
summary = json.dumps({"overview": "Test", "action_items": ["email docs to Joe"]})
db.execute("INSERT INTO summary_processes VALUES ('m1','COMPLETED',?,?,NULL,?)", (now, now, summary))
db.execute("INSERT INTO meetings VALUES ('m2','Pending Meeting',?,?)", (now, now))
db.execute("INSERT INTO summary_processes VALUES ('m2','PENDING',?,?,NULL,NULL)", (now, now))
db.commit()
db.close()
print("Fixture DB created with 2 meetings (1 completed, 1 pending)")
```

**Step 2: Write test_db.py**
```python
import pytest
from src.db import MeetilyDB

FIXTURE_DB = "tests/fixtures/meeting_minutes.db"

def test_get_new_meetings_returns_only_completed():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_new_meetings()
    assert len(meetings) == 1
    assert meetings[0]["id"] == "m1"
    assert meetings[0]["status"] == "COMPLETED"

def test_get_new_meetings_with_since_id():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_new_meetings(since_id="m1")
    assert len(meetings) == 0  # No meetings after m1

def test_get_all_meetings():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_all_meetings()
    assert len(meetings) >= 2

def test_get_all_meetings_limit():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_all_meetings(limit=1)
    assert len(meetings) == 1

def test_db_not_found():
    with pytest.raises(FileNotFoundError):
        MeetilyDB("/nonexistent/db.sqlite")
```

**Step 3: Run tests**
```bash
cd scripts/meetily-integration
python tests/create_fixture_db.py
uv pip install pytest
pytest tests/test_db.py -v
```

**Expected:** 5 passed.

---

## Phase 3 — Ollama Trigger Extraction (1h)

### Task 3.1: Implement Ollama Client

**Objective:** Call Ollama models for summarisation and trigger extraction.

**Files:**
- Create: `scripts/meetily-integration/src/llm.py`

**Step 1: Write llm.py**
```python
"""Ollama client for transcript analysis and trigger extraction."""
import json
import logging
import httpx

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "http://localhost:11434"
DEFAULT_MODEL = "ornith:9b"

class OllamaClient:
    def __init__(self, endpoint: str = None, model: str = None):
        self.endpoint = (endpoint or DEFAULT_ENDPOINT).rstrip("/")
        self.model = model or DEFAULT_MODEL

    async def chat(self, messages: list[dict], format: str = None, **kwargs) -> str:
        """Send a chat completion request to Ollama."""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            **kwargs,
        }
        if format:
            payload["format"] = format

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{self.endpoint}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]

    async def extract_triggers(self, transcript: str, action_items: list[str]) -> list[dict]:
        """Extract structured triggers from transcript action items.

        Returns list of {type, params} dicts.
        """
        prompt = f"""Extract action triggers from this meeting transcript and action items.

TRANSCRIPT (excerpt):
{transcript[:3000]}

ACTION ITEMS:
{json.dumps(action_items, indent=2)}

Return ONLY a JSON array of trigger objects. Each object has:
  "type": one of "email", "booking", "task", "save_note"
  "params": object with trigger-specific fields

For "email": {{"recipient": str, "subject": str, "body": str}}
For "booking": {{"title": str, "date": str or null, "participant": str or null}}
For "task": {{"description": str, "assignee": str or null}}
For "save_note": {{"content": str, "topic": str}}

Return [] if no triggers found.
"""
        response = await self.chat([
            {"role": "system", "content": "You extract structured action triggers from meeting transcripts. Return only valid JSON."},
            {"role": "user", "content": prompt},
        ])

        # Parse JSON from response
        try:
            # Find JSON array in response (handle markdown code fences)
            text = response.strip()
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            return json.loads(text)
        except (json.JSONDecodeError, IndexError) as e:
            logger.warning(f"Failed to parse trigger JSON: {e}")
            logger.debug(f"Raw response: {response}")
            return []

    async def summarize(self, transcript: str, summary_model: str = "qwen3-vl:4b") -> dict:
        """Generate structured summary from full transcript."""
        prompt = f"""Summarise this meeting transcript into:

Overview (2-3 sentences)
Bullet Points (key discussion points)
Action Items (concrete tasks mentioned)
Custom Notes (anything notable)

TRANSCRIPT:
{transcript[:8000]}

Return as JSON with keys: overview, bullet_points, action_items, custom_notes
"""
        orig_model = self.model
        self.model = summary_model
        try:
            response = await self.chat([
                {"role": "system", "content": "You summarise meeting transcripts into structured JSON."},
                {"role": "user", "content": prompt},
            ], format="json")
            return json.loads(response)
        except json.JSONDecodeError:
            logger.error(f"Summary JSON parse failed: {response[:200]}")
            return {"overview": "", "bullet_points": [], "action_items": [], "custom_notes": ""}
        finally:
            self.model = orig_model
```

**Step 2: Test Ollama connectivity**
```bash
curl -s http://localhost:11434/api/tags | python3 -c "import json,sys; d=json.load(sys.stdin); print([m['name'] for m in d.get('models',[])])"
```

**Expected:** Models list includes `phi4:14b` and `gemma3:27b`. Pull if missing.

---

### Task 3.2: Write Test for Trigger Extraction

**Files:**
- Create: `scripts/meetily-integration/tests/test_llm.py`

**Step 1: Write test_llm.py**
```python
import pytest
from src.llm import OllamaClient

@pytest.mark.skip(reason="Requires running Ollama with ornith:9b")
@pytest.mark.asyncio
async def test_extract_triggers_email():
    client = OllamaClient()
    triggers = await client.extract_triggers(
        "I'll email the documents to Joe",
        ["email documents to Joe"]
    )
    assert len(triggers) > 0
    assert any(t["type"] == "email" for t in triggers)

@pytest.mark.skip(reason="Requires running Ollama with ornith:9b")
@pytest.mark.asyncio
async def test_extract_triggers_booking():
    client = OllamaClient()
    triggers = await client.extract_triggers(
        "Let's book a follow-up for next Thursday",
        ["book follow-up next Thursday"]
    )
    assert len(triggers) > 0
    assert any(t["type"] == "booking" for t in triggers)

@pytest.mark.skip(reason="Requires running Ollama with ornith:9b")
@pytest.mark.asyncio
async def test_extract_triggers_empty():
    client = OllamaClient()
    triggers = await client.extract_triggers(
        "The weather is nice today",
        []
    )
    assert triggers == []
```

---

## Phase 4 — Action Engine (1.5h)

### Task 4.1: Implement cal.com Action

**Objective:** Create and cancel bookings via cal.com API v2.

**Files:**
- Create: `scripts/meetily-integration/src/actions/cal_com.py`

**Step 1: Write cal_com.py**
```python
"""cal.com API v2 actions."""
import logging
import httpx

logger = logging.getLogger(__name__)

CAL_API_BASE = "https://api.cal.com/v2"

class CalComClient:
    def __init__(self, api_key: str, event_type_id: int):
        self.api_key = api_key
        self.event_type_id = event_type_id
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "cal-api-version": "2024-06-01",
            "Content-Type": "application/json",
        }

    async def create_booking(self, title: str, start: str,
                             attendee_name: str, attendee_email: str,
                             description: str = "") -> dict:
        """Create a Cal Video booking."""
        payload = {
            "eventTypeId": self.event_type_id,
            "start": start,
            "attendees": [{
                "name": attendee_name,
                "email": attendee_email,
                "timeZone": "Australia/Sydney",
            }],
            "title": title,
            "description": description,
            "calVideoSettings": {
                "enableAutomaticRecordingForOrganizer": False,
                "enableAutomaticTranscription": True,
            },
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{CAL_API_BASE}/bookings",
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"Cal.com booking created: {data.get('uid', 'unknown')}")
            return data

    async def get_event_types(self) -> list[dict]:
        """List available event types."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{CAL_API_BASE}/event-types",
                headers=self._headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", data.get("eventTypes", []))
```

---

### Task 4.2: Implement Email Action (Gmail + Zoho)

**Objective:** Send emails via Gmail OAuth or Zoho SMTP based on context.

**Files:**
- Create: `scripts/meetily-integration/src/actions/email.py`

**Step 1: Write email.py**
```python
"""Email sending via Gmail API or Zoho SMTP."""
import logging
import smtplib
import json
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)

class EmailClient:
    def __init__(self, zoho_email: str, zoho_password: str):
        self.zoho_email = zoho_email
        self.zoho_password = zoho_password

    def send_via_zoho(self, to: str, subject: str, body: str) -> bool:
        """Send email via Zoho SMTP."""
        msg = MIMEText(body, "plain")
        msg["Subject"] = subject
        msg["From"] = self.zoho_email
        msg["To"] = to

        try:
            with smtplib.SMTP_SSL("smtp.zoho.com.au", 465) as server:
                server.login(self.zoho_email, self.zoho_password)
                server.sendmail(self.zoho_email, [to], msg.as_string())
            logger.info(f"Email sent via Zoho to {to}: {subject}")
            return True
        except Exception as e:
            logger.error(f"Zoho email failed: {e}")
            return False

    def send_via_gmail(self, to: str, subject: str, body: str,
                       credentials_path: str) -> bool:
        """Send email via Gmail API with OAuth2."""
        # Uses Hermes gmail skill — invoke via Hermes CLI
        import subprocess
        import tempfile
        payload = json.dumps({"to": to, "subject": subject, "body": body})
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(payload)
            f.flush()
            result = subprocess.run(
                ["hermes", "tool", "gmail", "send", f.name],
                capture_output=True, text=True, timeout=30,
            )
        if result.returncode == 0:
            logger.info(f"Email sent via Gmail to {to}: {subject}")
            return True
        else:
            logger.error(f"Gmail send failed: {result.stderr}")
            return False
```

---

### Task 4.3: Implement Salestrekker CRM Action

**Objective:** Create/complete tasks in Salestrekker.

**Files:**
- Create: `scripts/meetily-integration/src/actions/salestrekker.py`

**Step 1: Write salestrekker.py**
```python
"""Salestrekker CRM actions."""
import logging
import httpx

logger = logging.getLogger(__name__)

class SalestrekkerClient:
    def __init__(self, api_key: str, base_url: str = "https://api.salestrekker.com"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def create_task(self, description: str, due_date: str = None,
                          assignee: str = None) -> dict:
        """Create a new task in Salestrekker."""
        payload = {
            "description": description,
        }
        if due_date:
            payload["due_date"] = due_date
        if assignee:
            payload["assignee"] = assignee

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/tasks",
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"Salestrekker task created: {data.get('id')}")
            return data

    async def complete_task(self, task_id: str) -> dict:
        """Mark task as completed."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(
                f"{self.base_url}/api/v1/tasks/{task_id}",
                headers=self._headers,
                json={"status": "completed"},
            )
            resp.raise_for_status()
            logger.info(f"Salestrekker task {task_id} completed")
            return resp.json()
```

---

### Task 4.4: Implement MemPalace Action

**Objective:** Save meeting summaries to MemPalace for persistent knowledge.

**Files:**
- Create: `scripts/meetily-integration/src/actions/mempalace.py`

**Step 1: Write mempalace.py**
```python
"""MemPalace knowledge base actions."""
import logging
import httpx
import json

logger = logging.getLogger(__name__)

class MemPalaceClient:
    def __init__(self, api_url: str = "http://localhost:8910"):
        self.api_url = api_url.rstrip("/")

    async def save_meeting(self, meeting_id: str, title: str,
                           transcript: str, summary: dict,
                           triggers: list[dict]) -> bool:
        """Persist meeting record to MemPalace."""
        payload = {
            "entity_id": f"meeting:{meeting_id}",
            "predicates": {
                "type": "meeting",
                "title": title,
                "transcript": transcript[:50000],  # Truncate for storage
                "summary": json.dumps(summary),
                "triggers": json.dumps(triggers),
                "source": "meetily",
            }
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.api_url}/api/entities",
                    json=payload,
                )
                resp.raise_for_status()
                logger.info(f"Meeting saved to MemPalace: {meeting_id}")
                return True
        except Exception as e:
            logger.error(f"MemPalace save failed: {e}")
            return False

    async def search_meetings(self, query: str, limit: int = 5) -> list[dict]:
        """Search past meeting records."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.api_url}/api/search",
                params={"q": query, "limit": limit, "type": "meeting"},
            )
            resp.raise_for_status()
            return resp.json().get("results", [])
```

---

### Task 4.5: Implement Main Action Engine

**Objective:** Orchestrate the processing pipeline: DB → LLM → actions.

**Files:**
- Modify: `scripts/meetily-integration/src/engine.py`

**Step 1: Write engine.py**
```python
"""Main action engine — orchestrates DB read → LLM trigger extraction → action dispatch."""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from .db import MeetilyDB
from .llm import OllamaClient
from .actions.cal_com import CalComClient
from .actions.email import EmailClient
from .actions.salestrekker import SalestrekkerClient
from .actions.mempalace import MemPalaceClient

logger = logging.getLogger(__name__)

def _load_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise ValueError(f"Missing env var: {key}")
    return val

async def process_meeting(meeting: dict):
    """Process a single meeting: extract triggers, dispatch actions."""
    logger.info(f"Processing meeting: {meeting.get('title', 'unknown')}")

    # 1. Parse existing summary from Meetily
    summary = meeting.get("result", {})
    if isinstance(summary, str):
        try:
            summary = json.loads(summary)
        except json.JSONDecodeError:
            summary = {"raw": summary}

    action_items = summary.get("action_items", [])
    if isinstance(action_items, str):
        action_items = [action_items]

    transcript = meeting.get("transcript_text", "")

    # 2. Extract triggers via Ollama
    llm = OllamaClient(
        endpoint=os.environ.get("OLLAMA_ENDPOINT"),
        model=os.environ.get("OLLAMA_TRIGGER_MODEL", "ornith:9b"),
    )
    triggers = await llm.extract_triggers(transcript, action_items)
    logger.info(f"Extracted {len(triggers)} triggers: {[t['type'] for t in triggers]}")

    # 3. Save to MemPalace (always)
    mempalace = MemPalaceClient(
        api_url=os.environ.get("MEMPALACE_API_URL", "http://localhost:8910"),
    )
    await mempalace.save_meeting(
        meeting_id=meeting["id"],
        title=meeting.get("title", "Untitled Meeting"),
        transcript=transcript,
        summary=summary,
        triggers=triggers,
    )

    # 4. Dispatch actions based on trigger types
    for trigger in triggers:
        ttype = trigger.get("type")
        params = trigger.get("params", {})

        if ttype == "email":
            await _dispatch_email(params)
        elif ttype == "booking":
            await _dispatch_booking(params, meeting)
        elif ttype == "task":
            await _dispatch_task(params)
        elif ttype == "save_note":
            logger.info(f"Note saved via MemPalace: {params.get('topic', 'general')}")
        else:
            logger.warning(f"Unknown trigger type: {ttype}")

    logger.info(f"Meeting {meeting['id']} processed successfully")

async def _dispatch_email(params: dict):
    """Send email via Zoho (business) or Gmail (personal)."""
    to = params.get("recipient", "")
    subject = params.get("subject", "Meeting follow-up")
    body = params.get("body", "")

    if not to:
        logger.warning("Email trigger missing recipient")
        return

    # Business emails go through Zoho
    zoho_email = os.environ.get("ZOHO_EMAIL")
    zoho_pass = os.environ.get("ZOHO_APP_PASSWORD")
    email = EmailClient(zoho_email, zoho_pass)
    email.send_via_zoho(to, subject, body)

async def _dispatch_booking(params: dict, meeting: dict):
    """Create cal.com follow-up booking."""
    title = params.get("title", f"Follow-up: {meeting.get('title', 'Meeting')}")
    participant = params.get("participant", "")
    date_str = params.get("date")

    if not date_str:
        # Default: book 7 days from now at 10am
        future = datetime.now(timezone.utc) + timedelta(days=7)
        date_str = future.replace(hour=10, minute=0, second=0).isoformat()

    cal = CalComClient(
        api_key=_load_env("CAL_COM_API_KEY"),
        event_type_id=int(_load_env("CAL_COM_EVENT_TYPE_ID")),
    )
    await cal.create_booking(
        title=title,
        start=date_str,
        attendee_name=participant or "Client",
        attendee_email=params.get("email", ""),
        description=f"Auto-scheduled follow-up from meeting: {meeting.get('title', '')}",
    )

async def _dispatch_task(params: dict):
    """Create Salestrekker task."""
    description = params.get("description", "")
    if not description:
        logger.warning("Task trigger missing description")
        return

    salestrekker = SalestrekkerClient(
        api_key=_load_env("SALESTREKKER_API_KEY"),
        base_url=os.environ.get("SALESTREKKER_BASE_URL", "https://api.salestrekker.com"),
    )
    await salestrekker.create_task(
        description=description,
        assignee=params.get("assignee"),
    )

async def list_meetings():
    """List recent meetings from the DB."""
    db_path = os.environ.get("MEETILY_DB_PATH", "meeting_minutes.db")
    db = MeetilyDB(db_path)
    meetings = db.get_all_meetings(limit=20)
    print(f"{'ID':<36} {'Title':<40} {'Date':<25} {'Status':<12}")
    print("-" * 113)
    for m in meetings:
        print(f"{m['id']:<36} {m['title'][:38]:<40} {m['created_at'][:22]:<25} {m['status']:<12}")
```

---

### Task 4.6: Integration Test (End-to-End)

**Objective:** Run the full pipeline against the fixture DB and verify dispatch.

**Files:**
- Create: `scripts/meetily-integration/tests/test_integration.py`

**Step 1: Write test_integration.py**
```python
"""End-to-end integration test with fixture data."""
import pytest
import os
from src.engine import process_meeting

FIXTURE_DB = "tests/fixtures/meeting_minutes.db"

@pytest.mark.skip(reason="Requires Ollama + API keys in .env")
@pytest.mark.asyncio
async def test_engine_processes_completed_meeting():
    # Set env vars from .env.test
    os.environ.setdefault("OLLAMA_ENDPOINT", "http://localhost:11434")

    meeting = {
        "id": "m1",
        "title": "Test Meeting",
        "transcript_text": "Please email the contract to Joe",
        "result": '{"overview":"Test","action_items":["email contract to Joe"]}',
    }
    # This should dispatch email action
    await process_meeting(meeting)
    # Verify no exceptions raised
    assert True
```

---

## Phase 5 — Deployment (0.5h)

### Task 5.1: Create Launchd Agent

**Objective:** Auto-start the watcher on login via launchd.

**Files:**
- Create: `scripts/meetily-integration/com.meetily.watcher.plist`
- Create: `scripts/meetily-integration/start_watcher.sh`

**Step 1: Write start_watcher.sh**
```bash
#!/bin/bash
# Meetily SQLite watcher — starts on login via launchd
cd "$(dirname "$0")/.."
export PYTHONPATH="src:$PYTHONPATH"
source .venv/bin/activate
exec python -m src.main watch
```

**Step 2: Write launchd plist**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.meetily.watcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/warren/Documents/_HQ_AI/EdgeGDE/scripts/meetily-integration/start_watcher.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/warren/Documents/_HQ_AI/EdgeGDE/scripts/meetily-integration</string>
    <key>StandardOutPath</key>
    <string>/Users/warren/.hermes/logs/meetily-watcher.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/warren/.hermes/logs/meetily-watcher.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MEETILY_DB_PATH</key>
        <string>/path/to/meeting_minutes.db</string>
    </dict>
</dict>
</plist>
```

**Step 3: Install and test**
```bash
cp scripts/meetily-integration/com.meetily.watcher.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.meetily.watcher.plist
sleep 3
launchctl list | grep meetily
tail -5 ~/.hermes/logs/meetily-watcher.log
```

**Verification:** `launchctl list` shows `com.meetily.watcher` with a PID.

---

### Task 5.2: Verify Full Pipeline with a Real Meeting

**Objective:** Join a real Cal Video meeting, let Meetily capture it, confirm the pipeline fires.

**Procedure:**
1. Schedule a test meeting via cal.com with Cal Video
2. Join the call, speak for 1-2 minutes (include a trigger phrase like "please email the contract to Joe")
3. End the call
4. Wait for Meetily to finish transcription + summarisation
5. Check watcher log: `tail -20 ~/.hermes/logs/meetily-watcher.log`
6. Check cal.com dashboard for any auto-created follow-up booking
7. Verify MemPalace has the meeting record

**Verification:** Pipeline fires automatically within 5 seconds of summary completion.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Meetily DB path unknown on this Mac | Task 1.1 — find via `lsof` + common locations |
| cal.com API key not yet generated | Task 1.2 — generate from dashboard |
| Ollama models not pulled | `ollama pull ornith:9b && ollama pull qwen3-vl:4b` |
| Zoho SMTP requires app password | Generate from Zoho Mail → Security → App Passwords |
| Salestrekker API endpoint differs | Task 4.3 — verify with existing Hermes credentials |
| MemPalace API shape differs | Task 4.4 — adjust after reading MemPalace API docs |

---

## Summary

- **10 tasks** across 5 phases (~4.5h total)
- **15 files** created (code + config + tests + fixtures)
- **Core loop:** Meetily writes DB → watchdog fires → engine reads + extracts triggers → actions dispatch
- **Trigger types:** email (Zoho/Gmail), booking (cal.com API v2), task (Salestrekker), save_note (MemPalace)
- **Deployment:** launchd agent auto-starts on login

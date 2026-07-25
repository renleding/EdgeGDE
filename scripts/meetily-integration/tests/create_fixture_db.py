"""Create test SQLite database fixture matching Meetily schema."""
import sqlite3
import json
from datetime import datetime, timezone

DB_PATH = "tests/fixtures/meeting_minutes.sqlite"

conn = sqlite3.connect(DB_PATH)
conn.executescript("""
    CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_chunks (
        meeting_id TEXT PRIMARY KEY,
        meeting_name TEXT,
        transcript_text TEXT NOT NULL,
        model TEXT NOT NULL,
        model_name TEXT NOT NULL,
        chunk_size INTEGER,
        overlap INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS summary_processes (
        meeting_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT,
        result TEXT,
        start_time TEXT,
        end_time TEXT,
        chunk_count INTEGER DEFAULT 0,
        processing_time REAL DEFAULT 0.0,
        metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        transcript TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        summary TEXT,
        action_items TEXT,
        key_points TEXT,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        whisperModel TEXT NOT NULL
    );
""")

now = datetime.now(timezone.utc).isoformat()

# Meeting 1: completed with summary
conn.execute(
    "INSERT INTO meetings VALUES (?,?,?,?)",
    ("m1", "Test Call with Client", now, now)
)
conn.execute(
    "INSERT INTO transcript_chunks VALUES (?,?,?,?,?,?,?,?)",
    ("m1", "Test Call with Client",
     "Hello, thanks for calling. I need to discuss the loan application. Please email the documents to Joe.",
     "whisper", "large-v3", 0, 0, now)
)
summary = json.dumps({
    "overview": "Client discussed loan application",
    "action_items": ["email documents to Joe", "book follow-up next week"],
    "bullet_points": ["Loan application in progress", "Need to review credit score"]
})
conn.execute(
    "INSERT INTO summary_processes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ("m1", "COMPLETED", now, now, None, summary, now, now, 3, 12.5, None)
)
conn.execute(
    "INSERT INTO transcripts VALUES (?,?,?,?,?,?,?)",
    ("t1", "m1", "Hello, thanks for calling...", now, summary, "email documents to Joe", "Loan discussion")
)

# Meeting 2: still pending
conn.execute(
    "INSERT INTO meetings VALUES (?,?,?,?)",
    ("m2", "Ongoing Meeting", now, now)
)
conn.execute(
    "INSERT INTO summary_processes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ("m2", "PENDING", now, now, None, None, now, None, 0, 0.0, None)
)

# Meeting 3: failed
conn.execute(
    "INSERT INTO meetings VALUES (?,?,?,?)",
    ("m3", "Failed Meeting", now, now)
)
conn.execute(
    "INSERT INTO summary_processes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ("m3", "FAILED", now, now, "Whisper model not available", None, now, now, 0, 0.0, None)
)

conn.commit()
conn.close()
print(f"Fixture DB created: {DB_PATH} with 3 meetings (1 completed, 1 pending, 1 failed)")

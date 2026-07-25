"""Read-only SQLite interface for Meetily database."""
import json
import sqlite3
from pathlib import Path
from typing import Optional


# WAL mode detection: sqlite3.connect() auto-reads WAL pages,
# no special handling needed beyond providing the main .sqlite path.

class MeetilyDB:
    """Read-only access to Meetily's SQLite meeting data."""

    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(
                f"Meetily DB not found: {db_path}\n"
                "Expected location: ~/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite"
            )

    def _connect(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON;")  # Safety: read-only enforcement
        return conn

    def get_new_meetings(self, since_id: Optional[str] = None) -> list[dict]:
        """Return completed meetings not yet processed, ordered by creation time."""
        conn = self._connect()
        cur = conn.cursor()

        if since_id:
            cur.execute("""
                SELECT m.id, m.title, m.created_at,
                       tc.transcript_text,
                       sp.result, sp.status
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
                       sp.result, sp.status
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
        """Return recent meetings with processing status."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("""
            SELECT m.id, m.title, m.created_at,
                   COALESCE(sp.status, 'NO_PROCESS') AS status
            FROM meetings m
            LEFT JOIN summary_processes sp ON m.id = sp.meeting_id
            ORDER BY m.created_at DESC
            LIMIT ?
        """, (limit,))
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows

    def get_meeting_by_id(self, meeting_id: str) -> Optional[dict]:
        """Get a single meeting with transcript and summary."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("""
            SELECT m.id, m.title, m.created_at,
                   tc.transcript_text,
                   sp.result, sp.status
            FROM meetings m
            JOIN summary_processes sp ON m.id = sp.meeting_id
            JOIN transcript_chunks tc ON m.id = tc.meeting_id
            WHERE m.id = ?
        """, (meeting_id,))
        row = cur.fetchone()
        conn.close()
        if row:
            d = dict(row)
            if d.get("result"):
                try:
                    d["result"] = json.loads(d["result"])
                except (json.JSONDecodeError, TypeError):
                    pass
            return d
        return None

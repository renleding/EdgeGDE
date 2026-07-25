"""FSEvents-based watcher for Meetily SQLite database.

Monitors the Meetily SQLite file for modifications, detects new completed
meetings, and triggers the action engine for processing.
"""
import asyncio
import logging
import os
import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from .db import MeetilyDB

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.path.expanduser(
    "~/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite"
)

_loop: asyncio.AbstractEventLoop | None = None


class MeetilyDBHandler(FileSystemEventHandler):
    """Watch for SQLite file modifications and process new completed meetings."""

    def __init__(self, db_path: str, debounce_seconds: float = 2.0):
        self.db_path = db_path
        self.debounce = debounce_seconds
        self._last_modified = os.path.getmtime(db_path) if os.path.exists(db_path) else 0
        self._known_ids: set[str] = set()

    def on_modified(self, event):
        if event.src_path != self.db_path:
            return
        now = os.path.getmtime(self.db_path)
        if now - self._last_modified < self.debounce:
            return  # Debounce rapid writes (Meetily updates WAL/SHM files frequently)
        self._last_modified = now
        if _loop and _loop.is_running():
            asyncio.run_coroutine_threadsafe(self._check_for_new(), _loop)

    async def _check_for_new(self):
        """Query for completed meetings that haven't been processed yet."""
        try:
            db = MeetilyDB(self.db_path)
            meetings = db.get_new_meetings()
            new_found = 0
            for m in meetings:
                if m["id"] not in self._known_ids:
                    self._known_ids.add(m["id"])
                    new_found += 1
                    logger.info(
                        "New completed meeting: %s (%s)", m["title"], m["id"]
                    )
                    from .engine import process_meeting
                    await process_meeting(m)

            if new_found:
                logger.info("Processed %d new meeting(s)", new_found)
        except Exception as e:
            logger.error("Watcher check failed: %s", e)

    def seed_known_ids(self):
        """Pre-populate known IDs from existing meetings on startup.
        
        This prevents re-processing old meetings when the watcher starts.
        """
        try:
            db = MeetilyDB(self.db_path)
            for m in db.get_all_meetings(limit=200):
                self._known_ids.add(m["id"])
            logger.info("Seeded %d existing meeting IDs", len(self._known_ids))
        except Exception as e:
            logger.warning("Could not seed known IDs: %s", e)


def run_watcher():
    """Start the watcher daemon. Runs until interrupted."""
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)

    db_path = os.environ.get("MEETILY_DB_PATH") or DEFAULT_DB_PATH
    if not Path(db_path).exists():
        logger.error("Database not found: %s", db_path)
        print(f"ERROR: Database not found at: {db_path}")
        print("Set MEETILY_DB_PATH env var or verify Meetily has run at least once.")
        return

    handler = MeetilyDBHandler(db_path)
    handler.seed_known_ids()

    observer = Observer()
    observer.schedule(handler, path=str(Path(db_path).parent), recursive=False)
    observer.start()
    logger.info("Watching %s for changes...", db_path)
    print(f"Watching {db_path} for changes...")

    try:
        _loop.run_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        observer.stop()
    observer.join()
    _loop.close()

"""Action Journal — JSON-Lines telemetry."""
import json, logging, os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger('state-engine.journal')

JOURNAL_PATH = os.path.expanduser("~/.hermes/logs/state-engine/actions.jsonl")

class ActionJournal:
    def __init__(self, path: str = JOURNAL_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = None
        logger.info("Action journal opened: %s", self.path)

    def log(self, entry: dict):
        entry['_timestamp'] = datetime.now(timezone.utc).isoformat()
        try:
            with open(self.path, 'a') as f:
                f.write(json.dumps(entry, default=str) + '\n')
        except Exception as e:
            logger.error("Journal write failed: %s", e)

    def close(self):
        pass

    def get_recent(self, limit: int = 10) -> list:
        try:
            with open(self.path) as f:
                lines = f.readlines()
            return [json.loads(l) for l in lines[-limit:]]
        except (FileNotFoundError, json.JSONDecodeError):
            return []

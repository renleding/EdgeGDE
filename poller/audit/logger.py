"""
Edge Document Intelligence — Audit Logger

Structured JSON logging for the M1 poller.
Every log entry includes correlation IDs for cross-system tracing.
"""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Optional


class DocIntelLogger:
    """Structured JSON logger for doc-intel poller operations."""

    def __init__(self, name: str = "doc-intel-poller", level: int = logging.INFO):
        self._log = logging.getLogger(name)
        self._log.setLevel(level)
        if not self._log.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(logging.Formatter(
                "%(message)s"  # We format as JSON ourselves
            ))
            self._log.addHandler(handler)

    def _log_event(self, level: int, event: str, **kwargs):
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **kwargs,
        }
        self._log.log(level, json.dumps(record))

    def info(self, event: str, **kwargs):
        self._log_event(logging.INFO, event, **kwargs)

    def warn(self, event: str, **kwargs):
        self._log_event(logging.WARN, event, **kwargs)

    def error(self, event: str, **kwargs):
        self._log_event(logging.ERROR, event, **kwargs)

    def debug(self, event: str, **kwargs):
        self._log_event(logging.DEBUG, event, **kwargs)


# Global singleton
logger = DocIntelLogger()

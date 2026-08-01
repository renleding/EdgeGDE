"""Action Journal — JSON-Lines telemetry with tamper-evident hash chaining.

FRS-007 FEATURE-01: every entry carries
  - agent_id           injected from the authenticated runner context (never caller-supplied)
  - owner_attestation  reference to the governance/approval record authorizing the action
  - prev_hash          SHA-256 of the canonical serialization of the previous entry
  - entry_hash         SHA-256 of the canonical serialization of this entry (minus entry_hash)

The ledger is append-only. Rotation chains across files. Integrity is verified
by ledger_verify.py / verify_report.py (F01-R07, F01-R12).
"""
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger('state-engine.journal')

JOURNAL_PATH = os.path.expanduser("~/.hermes/logs/state-engine/actions.jsonl")

# Fields the caller may never supply — injected only by this module (F01-R10).
RESERVED_FIELDS = frozenset({"agent_id", "owner_attestation", "prev_hash", "entry_hash"})


def canonical_serialize(obj: dict) -> str:
    """Deterministic serialization: sorted keys, compact separators, UTF-8.

    Stable across runs and Python versions so hashes are reproducible (F01-N03).
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ActionJournal:
    def __init__(self, path: str = JOURNAL_PATH,
                 agent_id: Optional[str] = None,
                 owner_attestation: Optional[str] = None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = None
        self._agent_id = agent_id or os.environ.get("STATE_ENGINE_AGENT_ID", "state-engine")
        self._owner_attestation = owner_attestation
        self._chain_head: Optional[str] = None  # entry_hash of last appended entry
        self._journal_degraded = False
        self._rebuild_chain_head()
        logger.info("Action journal opened: %s (chain head: %s)",
                    self.path, self._chain_head or "none")

    def set_context(self, agent_id: str, owner_attestation: Optional[str] = None) -> None:
        """Inject the authenticated runner context for subsequent entries.

        Called by the execution wrapper; never from mission-supplied content (F01-R10).
        """
        self._agent_id = agent_id
        if owner_attestation is not None:
            self._owner_attestation = owner_attestation

    def _rebuild_chain_head(self) -> None:
        """Re-read the tail of the current file to rebuild the chain head after restart."""
        try:
            with open(self.path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(entry, dict) and entry.get("entry_hash"):
                        self._chain_head = entry["entry_hash"]
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.error("Chain head rebuild failed: %s", e)

    def log(self, entry: dict) -> Optional[str]:
        """Append a ledger entry. Returns the entry_hash, or None on write failure.

        Rejects caller-supplied reserved fields (F01-R10) with ValueError.
        Never blocks the caller on write failure — degrades and logs instead (F01-N02).
        """
        if not isinstance(entry, dict):
            logger.error("Journal entry must be a dict, got %s", type(entry).__name__)
            return None
        supplied = RESERVED_FIELDS & set(entry.keys())
        if supplied:
            raise ValueError(f"reserved journal fields not allowed from caller: {sorted(supplied)}")

        full = dict(entry)
        full["_timestamp"] = datetime.now(timezone.utc).isoformat()
        full["agent_id"] = self._agent_id
        full["owner_attestation"] = self._owner_attestation
        full["prev_hash"] = self._chain_head
        full["entry_hash"] = sha256_hex(canonical_serialize(
            {k: v for k, v in full.items() if k != "entry_hash"}))
        line = json.dumps(full, default=str) + "\n"
        try:
            with open(self.path, "a") as f:
                f.write(line)
            self._chain_head = full["entry_hash"]
            return full["entry_hash"]
        except Exception as e:
            self._journal_degraded = True
            logger.error("Journal write failed: %s", e)
            return None

    @property
    def degraded(self) -> bool:
        return self._journal_degraded

    def rotate(self) -> None:
        """Start a new ledger file; the chain continues across the boundary (F01-R06).

        The old file's last entry_hash becomes the new file's first prev_hash.
        """
        if self.path.exists() and self.path.stat().st_size > 0:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            rotated = self.path.with_name(f"{self.path.name}.{stamp}")
            os.replace(str(self.path), str(rotated))
            logger.info("Journal rotated to %s (chain head: %s)", rotated, self._chain_head)
        # chain head intentionally preserved across rotation

    def close(self):
        pass

    def get_recent(self, limit: int = 10) -> list:
        try:
            with open(self.path) as f:
                lines = f.readlines()
            return [json.loads(l) for l in lines[-limit:]]
        except (FileNotFoundError, json.JSONDecodeError):
            return []

"""
observer.py — FRS-007 Phase 4: Observer Daemon (Pillar I — Perception).

READ-ONLY capture of what actually happens on the browser surface —
DOM input values, clicks, network calls — into evidence.db. The Observer
NEVER mutates anything; it records, so that Task Mining (below) can
distill happy-path state transitions from real telemetry instead of
theory (FRS-006: Evidence Precedes Theory).

Pipeline:
    CDP / injected hooks ──► ObserverDaemon.record(...) ──► evidence.db
        observer_events   (raw, immutable event log)
        observer_runs     (run-level summaries for the promotion pipeline)

TaskMiner groups raw events into task candidates by temporal + target
clustering, producing the 10-run baseline inputs the FRS-007 promotion
bar (>=10 observed runs, >=95% success) consumes.
"""

import json
import logging
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger('state-engine.observer')

SCHEMA = """
CREATE TABLE IF NOT EXISTS observer_events (
    event_id     TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL,
    ts_ms        INTEGER NOT NULL,
    source       TEXT NOT NULL,   -- dom | network | keyboard | mouse | api
    event_type   TEXT NOT NULL,   -- input | click | mutation | fetch | keydown ...
    target       TEXT NOT NULL,   -- element label / selector / url
    detail_json  TEXT NOT NULL DEFAULT '{}',
    value_hash   TEXT              -- sha256 of the input value (no raw PII)
);
CREATE INDEX IF NOT EXISTS idx_observer_events_run ON observer_events (run_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_observer_events_source ON observer_events (source, event_type);

CREATE TABLE IF NOT EXISTS observer_runs (
    run_id          TEXT PRIMARY KEY,
    mission_id      TEXT NOT NULL,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    steps_observed  INTEGER NOT NULL DEFAULT 0,
    success         INTEGER NOT NULL DEFAULT 0,
    transitions_json TEXT NOT NULL DEFAULT '[]',  -- mined transitions
    task_candidates TEXT NOT NULL DEFAULT '[]'    -- mined task candidates
);
CREATE INDEX IF NOT EXISTS idx_observer_runs_mission ON observer_runs (mission_id, started_at);
"""


def _utc_ms() -> int:
    return int(time.time() * 1000)


def _hash_value(v: Any) -> str:
    import hashlib
    return hashlib.sha256(str(v).encode()).hexdigest()[:16]


@dataclass
class ObserverEvent:
    run_id: str
    source: str
    event_type: str
    target: str
    ts_ms: int = field(default_factory=_utc_ms)
    detail: dict = field(default_factory=dict)
    value: Any = None
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    @property
    def value_hash(self) -> Optional[str]:
        return _hash_value(self.value) if self.value is not None else None

    def to_row(self) -> dict:
        return {
            'event_id': self.event_id,
            'run_id': self.run_id,
            'ts_ms': self.ts_ms,
            'source': self.source,
            'event_type': self.event_type,
            'target': self.target,
            'detail_json': json.dumps(self.detail),
            'value_hash': self.value_hash,
        }

    @property
    def detail_json(self) -> str:
        return json.dumps(self.detail)


class ObserverDaemon:
    """Read-only capture daemon writing observer events to evidence.db."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._open = False
        self._lock = threading.Lock()
        self._run_id = str(uuid.uuid4())

    def open(self):
        if self._open:
            return
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._open = True

    @property
    def conn(self) -> sqlite3.Connection:
        if not self._open or self._conn is None:
            raise RuntimeError('ObserverDaemon not open')
        return self._conn

    def close(self):
        if self._open and self._conn is not None:
            self._conn.close()
            self._open = False

    # ── recording ─────────────────────────────────────────────────────
    def record(self, source: str, event_type: str, target: str,
               detail: Optional[dict] = None, value: Any = None,
               run_id: Optional[str] = None) -> str:
        """Record one observed event. Returns the event id."""
        ev = ObserverEvent(
            run_id=run_id or self._run_id,
            source=source, event_type=event_type, target=target,
            detail=detail or {}, value=value,
        )
        with self._lock:
            self.conn.execute(
                """INSERT INTO observer_events
                   (event_id, run_id, ts_ms, source, event_type, target,
                    detail_json, value_hash)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (ev.event_id, ev.run_id, ev.ts_ms, ev.source, ev.event_type,
                 ev.target, ev.detail_json, ev.value_hash))
            self.conn.commit()
        return ev.event_id

    # ── capture helpers (called from the browser session, read-only) ──
    def capture_inputs(self, inputs: dict[str, Any], run_id: Optional[str] = None):
        """inputs: {label: value} from a DOM scan of visible inputs."""
        for label, value in inputs.items():
            self.record('dom', 'input', label, value=value, run_id=run_id)

    def capture_network(self, calls: list[dict], run_id: Optional[str] = None):
        """calls: [{'url':..., 'status':..., 'method':...}] from CDP Network."""
        for call in calls:
            self.record('network', 'fetch', call.get('url', ''),
                        detail={'status': call.get('status'),
                                'method': call.get('method')},
                        run_id=run_id)

    def capture_clicks(self, clicks: list[tuple[str, int, int]],
                       run_id: Optional[str] = None):
        for label, x, y in clicks:
            self.record('mouse', 'click', label,
                        detail={'x': x, 'y': y}, run_id=run_id)

    # ── run lifecycle ─────────────────────────────────────────────────
    def begin_run(self, mission_id: str) -> str:
        self._run_id = str(uuid.uuid4())
        self.conn.execute(
            """INSERT INTO observer_runs (run_id, mission_id, started_at)
               VALUES (?,?,?)""",
            (self._run_id, mission_id, _utc_ms()))
        self.conn.commit()
        return self._run_id

    def end_run(self, success: bool, run_id: Optional[str] = None,
                transitions: Optional[list] = None,
                candidates: Optional[list] = None):
        rid = run_id or self._run_id
        steps = self.conn.execute(
            'SELECT COUNT(*) AS n FROM observer_events WHERE run_id = ?',
            (rid,)).fetchone()['n']
        self.conn.execute(
            """UPDATE observer_runs
                  SET ended_at = ?, steps_observed = ?, success = ?,
                      transitions_json = ?, task_candidates = ?
                WHERE run_id = ?""",
            (_utc_ms(), steps, 1 if success else 0,
             json.dumps(transitions or []), json.dumps(candidates or []), rid))
        self.conn.commit()

    # ── read-back ─────────────────────────────────────────────────────
    def events(self, run_id: str) -> list[dict]:
        rows = self.conn.execute(
            'SELECT * FROM observer_events WHERE run_id = ? ORDER BY ts_ms',
            (run_id,)).fetchall()
        return [dict(r) for r in rows]

    def runs(self, mission_id: str, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            'SELECT * FROM observer_runs WHERE mission_id = ? ORDER BY started_at DESC LIMIT ?',
            (mission_id, limit)).fetchall()
        return [dict(r) for r in rows]


class TaskMiner:
    """Groups raw observer events into task candidates + transitions.

    Heuristics (deterministic — no LLM):
      - events touching the same target within a 2s window form a cluster
      - a cluster of >=3 input events on one section = a fill task
      - a save/complete click after a cluster = the transition trigger
      - transitions = (cluster target) -> 'PERSISTED' when a save follows
    """

    CLUSTER_WINDOW_MS = 2000
    MIN_CLUSTER_EVENTS = 3
    SAVE_TRIGGERS = ('save', 'submit', 'complete', 'apply', 'calculate')

    def mine(self, events: list[dict]) -> dict:
        clusters = []
        cur: list[dict] = []
        for ev in sorted(events, key=lambda e: e['ts_ms']):
            if cur and ev['ts_ms'] - cur[-1]['ts_ms'] > self.CLUSTER_WINDOW_MS:
                clusters.append(cur)
                cur = []
            cur.append(ev)
        if cur:
            clusters.append(cur)

        candidates = []
        transitions = []
        for cluster in clusters:
            targets = {e['target'] for e in cluster}
            section = max(targets, key=lambda t: sum(1 for e in cluster if e['target'] == t))
            n_input = sum(1 for e in cluster if e['event_type'] in ('input', 'keydown'))
            has_save = any(
                e['event_type'] == 'click' and
                any(s in e['target'].lower() for s in self.SAVE_TRIGGERS)
                for e in cluster)
            if n_input >= self.MIN_CLUSTER_EVENTS:
                candidates.append({
                    'task': f'fill_{section}',
                    'section': section,
                    'input_events': n_input,
                    'confidence': round(min(1.0, 0.5 + n_input * 0.08), 2),
                })
                transitions.append({
                    'source': f'{section}_DRAFT',
                    'target': 'PERSISTED' if has_save else f'{section}_ENTERED',
                    'observed_inputs': n_input,
                    'save_seen': has_save,
                })
        return {'candidates': candidates, 'transitions': transitions,
                'clusters': len(clusters)}


def promote_baseline(runs: list[dict], min_runs: int = 10,
                     min_success_rate: float = 0.95) -> dict:
    """FRS-007 promotion bar: >= min_runs observed, >= 95% success."""
    if len(runs) < min_runs:
        return {'eligible': False, 'runs': len(runs),
                'needed': min_runs - len(runs), 'success_rate': None}
    successes = sum(1 for r in runs if r['success'])
    rate = successes / len(runs)
    return {'eligible': rate >= min_success_rate, 'runs': len(runs),
            'success_rate': round(rate, 3), 'successes': successes}

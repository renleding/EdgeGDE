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
bar consumes.

PROMOTION BAR (FRS-007 closure, LOCKED — all three MUST hold):
    total_observed_runs       >= 10
    historical_success_rate   >= 0.95
    consecutive_shadow_passes >= 3
A shadow pass = Candidate Selected → Pre-Read → Execution → Post-Read →
L1 Confirmed (the full dual-gate). 3 passes across INDEPENDENT
executions are preferred over replaying the same transaction.
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
    shadow_pass     INTEGER NOT NULL DEFAULT 0,  -- full dual-gate (L1 confirmed)
    transition_id   TEXT,                        -- candidate signature / family id
    observation_diversity_hash TEXT,             -- SHA256(object_type + transition_name + context_type)
    created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    transitions_json TEXT NOT NULL DEFAULT '[]',  -- mined transitions
    task_candidates TEXT NOT NULL DEFAULT '[]'    -- mined task candidates
);
CREATE INDEX IF NOT EXISTS idx_observer_runs_mission ON observer_runs (mission_id, started_at);
"""

# NOTE: idx_observer_runs_transition is created in _migrate() AFTER the
# transition_id/created_at columns exist (pre-closure DBs lack them).

_SHADOW_PASS_MIGRATION = (
    "ALTER TABLE observer_runs "
    "ADD COLUMN shadow_pass INTEGER NOT NULL DEFAULT 0"
)
_OBSERVATION_COLUMNS = {
    'shadow_pass': (
        "ALTER TABLE observer_runs "
        "ADD COLUMN shadow_pass INTEGER NOT NULL DEFAULT 0"),
    'transition_id': (
        "ALTER TABLE observer_runs ADD COLUMN transition_id TEXT"),
    'observation_diversity_hash': (
        "ALTER TABLE observer_runs "
        "ADD COLUMN observation_diversity_hash TEXT"),
    'created_at': (
        "ALTER TABLE observer_runs "
        "ADD COLUMN created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)"),
}


def _utc_ms() -> int:
    return int(time.time() * 1000)


def _hash_value(v: Any) -> str:
    import hashlib
    return hashlib.sha256(str(v).encode()).hexdigest()[:16]


def _sha256_hex(s: str) -> str:
    """Full SHA-256 hex digest — used for the observation diversity hash
    (B1: SHA256(object_type + transition_name + context_type))."""
    import hashlib
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


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
        self._open = True          # set BEFORE migrate (conn property gate)
        self._migrate()

    def _migrate(self):
        """In-place migration for pre-closure databases: observer_runs
        predates the shadow_pass / transition_id / diversity columns —
        add whatever is missing, then build the transition index."""
        cols = {r['name'] for r in self.conn.execute(
            'PRAGMA table_info(observer_runs)').fetchall()}
        for col, stmt in _OBSERVATION_COLUMNS.items():
            if col not in cols:
                self.conn.execute(stmt)
        self.conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_observer_runs_transition '
            'ON observer_runs (transition_id, created_at DESC)')
        self.conn.commit()

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
            """INSERT INTO observer_runs
                 (run_id, mission_id, started_at, created_at)
               VALUES (?,?,?,?)""",
            (self._run_id, mission_id, _utc_ms(), _utc_ms()))
        self.conn.commit()
        return self._run_id

    def end_run(self, success: bool, run_id: Optional[str] = None,
                transitions: Optional[list] = None,
                candidates: Optional[list] = None,
                shadow_pass: bool = False,
                transition_id: Optional[str] = None,
                object_type: Optional[str] = None,
                transition_name: Optional[str] = None,
                context_type: Optional[str] = None):
        """Close a run. shadow_pass=True records that this run satisfied
        the FULL dual-gate (Pre-Read → Execution → Post-Read → L1
        Confirmed) — the promotion pipeline counts consecutive passes.

        B1 — observation_diversity_hash = SHA256(object_type +
        transition_name + context_type): contextual diversity measures
        GENERALIZATION (Income / Asset / Liability count as independent
        even inside the SAME deal), not entity count. transition_id links
        the run to the registry candidate/family for the promotion guard.
        """
        rid = run_id or self._run_id
        steps = self.conn.execute(
            'SELECT COUNT(*) AS n FROM observer_events WHERE run_id = ?',
            (rid,)).fetchone()['n']
        div_hash = None
        if object_type and transition_name and context_type:
            div_hash = _sha256_hex(
                f'{object_type}{transition_name}{context_type}')
        self.conn.execute(
            """UPDATE observer_runs
                  SET ended_at = ?, steps_observed = ?, success = ?,
                      shadow_pass = ?, transition_id = ?,
                      observation_diversity_hash = ?,
                      transitions_json = ?, task_candidates = ?
                WHERE run_id = ?""",
            (_utc_ms(), steps, 1 if success else 0, 1 if shadow_pass else 0,
             transition_id, div_hash,
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


def verify_promotion_guard(candidate_id: str, db_conn) -> bool:
    """B2 — independent-execution guard (verbatim from the closure spec).

    The last 3 CONSECUTIVE shadow passes must span >= 3 DISTINCT
    observation_diversity_hash values — proving generalization across
    independent contexts (Income / Asset / Liability count as independent
    even inside the SAME deal), not replay of one transaction.

    Full bar (unchanged): >=10 runs AND >=0.95 success AND >=3 consecutive
    shadow passes AND this guard.
    """
    rows = db_conn.execute("""
        SELECT shadow_pass, observation_diversity_hash
        FROM observer_runs WHERE transition_id = ?
        ORDER BY created_at DESC LIMIT 10
    """, (candidate_id,)).fetchall()
    consecutive = []
    for row in rows:
        if row["shadow_pass"] == 1:
            consecutive.append(row["observation_diversity_hash"])
            if len(consecutive) == 3:
                break
        else:
            break  # consecutive chain broken
    if len(consecutive) < 3:
        return False
    return len(set(consecutive)) >= 3  # generalization across 3 distinct contexts


def promote_baseline(runs: list[dict], min_runs: int = 10,
                     min_success_rate: float = 0.95,
                     min_consecutive_shadow_passes: int = 3,
                     guard_result: Optional[bool] = None) -> dict:
    """FRS-007 promotion bar — ALL THREE constraints MUST hold:

      1. total_observed_runs       >= min_runs           (default 10)
      2. historical_success_rate   >= min_success_rate   (default 0.95)
      3. consecutive_shadow_passes >= min_consecutive_shadow_passes (3)

    A shadow pass = full dual-gate (Pre-Read → Execution → Post-Read →
    L1 Confirmed): run['shadow_pass'] is truthy AND run['success'].
    Consecutive passes are counted from the most recent run backwards —
    scattered passes do NOT qualify.

    4. independent-execution guard (B2): when guard_result is provided
       (from verify_promotion_guard), eligibility additionally requires
       it to be True — >= 3 distinct contexts across the consecutive
       shadow passes.
    """
    if len(runs) < min_runs:
        return {'eligible': False, 'runs': len(runs),
                'needed': min_runs - len(runs), 'success_rate': None,
                'consecutive_shadow_passes': 0,
                'shadow_passes_needed': min_consecutive_shadow_passes,
                'guard_result': guard_result}
    successes = sum(1 for r in runs if r.get('success'))
    rate = successes / len(runs)
    consecutive = 0
    for r in reversed(runs):
        if r.get('shadow_pass') and r.get('success'):
            consecutive += 1
        else:
            break
    eligible = (rate >= min_success_rate
                and consecutive >= min_consecutive_shadow_passes)
    if guard_result is not None:
        eligible = eligible and bool(guard_result)
    return {'eligible': eligible, 'runs': len(runs),
            'success_rate': round(rate, 3), 'successes': successes,
            'consecutive_shadow_passes': consecutive,
            'shadow_passes_needed': max(0, min_consecutive_shadow_passes
                                        - consecutive),
            'guard_result': guard_result}

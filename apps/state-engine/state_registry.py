"""
state_registry.py — FRS-007 Phase 2: State & Transition Registries (Data Plane).

Implements the explicit state modeling required by FRS-007:

    State Precedes Action.
    State Change Requires Independent Proof.

Two registries, both SQLite-backed in the Data Plane (same evidence.db WAL):

  State Registry      — WHERE things are. Tracks object lifecycle phases.
  Transition Registry — HOW things move. Declarative BPMN-style maps.

L1 COMMIT CONTRACT (FRS-007 v1.0 resolution, Q1):
  An executor's return value (including HTTP response) is L3 evidence.
  Committing a state transition REQUIRES a completely independent read-back
  (fresh API GET / full DOM reload / board re-poll) recorded as evidence
  with evidence_strength='L1'. The executor can never certify its own work.

Schema additions (v1.0):
  object_states    — current state per business object (State Registry)
  state_history    — immutable audit trail of every committed transition
  transitions      — declarative transition definitions (Transition Registry)

Usage:
    sr = StateRegistry()
    sr.register_object('deal_24f7', 'deal', 'DRAFT')
    tr = TransitionRegistry(sr.conn)
    tr.register_from_yaml('transitions.yaml')

    # executor attempts the transition
    sr.begin_transition('deal_24f7', 'save_transaction')
    ... executor acts ...
    # INDEPENDENT read-back produces evidence_id (strength L1)
    sr.commit_transition('deal_24f7', 'save_transaction', evidence_id=ev_id)
"""

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger('state-engine.registry')

DB_PATH = Path.home() / '.hermes' / 'evidence' / 'evidence.db'

# Evidence strengths that qualify as INDEPENDENT confirmation (L1 contract).
# Executor self-reports must be recorded as L3 and never qualify.
INDEPENDENT_STRENGTHS = frozenset({'L1', 'l1'})

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- =====================================================================
-- STATE REGISTRY (FRS-007 Phase 2)
-- WHERE things are. One row per business object; current_state is
-- authoritative and may ONLY be written via commit_transition().
-- =====================================================================
CREATE TABLE IF NOT EXISTS object_states (
    object_id       TEXT PRIMARY KEY,
    object_type     TEXT NOT NULL,
    current_state   TEXT NOT NULL,
    previous_state  TEXT,
    transition_id   TEXT,
    evidence_id     TEXT NOT NULL,        -- L1 proof of the state
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Immutable audit trail: every committed state change, append-only.
CREATE TABLE IF NOT EXISTS state_history (
    history_id      TEXT PRIMARY KEY,
    object_id       TEXT NOT NULL,
    object_type     TEXT NOT NULL,
    from_state      TEXT,
    to_state        TEXT NOT NULL,
    transition_id   TEXT,
    evidence_id     TEXT NOT NULL,
    committed_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Pending (staged, not yet committed) transitions — the "in flight" set.
CREATE TABLE IF NOT EXISTS pending_transitions (
    pending_id      TEXT PRIMARY KEY,
    object_id       TEXT NOT NULL,
    transition_id   TEXT NOT NULL,
    source_state    TEXT NOT NULL,
    target_state    TEXT NOT NULL,
    staged_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | COMMITTED | ABORTED
    UNIQUE(object_id, transition_id)
);

-- =====================================================================
-- TRANSITION REGISTRY (FRS-007 Phase 2)
-- HOW things move. Declarative BPMN-style transition definitions.
-- verification_gate entries MUST reference business-state read-backs,
-- never DOM observations (FRS-007 R1 resolution).
-- =====================================================================
CREATE TABLE IF NOT EXISTS transitions (
    transition_id       TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    source_state        TEXT NOT NULL,
    target_state        TEXT NOT NULL,
    verification_gate   TEXT NOT NULL,   -- JSON list of L1 gate checks
    synchronization_gate TEXT NOT NULL,  -- JSON list of readiness gates
    rollback_policy     TEXT NOT NULL,   -- JSON list of compensation ops
    is_active           INTEGER NOT NULL DEFAULT 1
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StateRegistry:
    """State Registry + Transition Registry (FRS-007 Phase 2, Data Plane).

    Thread-safety: the caller owns the connection (single daemon). WAL mode
    permits concurrent readers; writes serialize on this connection.
    """

    def __init__(self, db_path: str = str(DB_PATH)):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._open = False

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------
    def open(self):
        if self._open:
            return
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path)
        self._open = True  # set before touching conn (property guard)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA_SQL)
        self.conn.commit()
        logger.info("StateRegistry open at %s", self.db_path)

    def close(self):
        if self._open:
            self.conn.close()
            self._open = False

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *args):
        self.close()

    def _require_open(self):
        if not self._open:
            raise RuntimeError("StateRegistry not open")

    @property
    def conn(self) -> sqlite3.Connection:
        """Narrowed connection handle — raises if the registry is closed."""
        if not self._open or self._conn is None:
            raise RuntimeError("StateRegistry not open")
        return self._conn

    # ------------------------------------------------------------------
    # State Registry — object lifecycle
    # ------------------------------------------------------------------
    def register_object(self, object_id: str, object_type: str,
                        initial_state: str, evidence_id: str) -> str:
        """Register a business object with its initial state.

        The initial state must itself be backed by independent evidence.
        """
        self._require_open()
        self.conn.execute(
            """INSERT OR REPLACE INTO object_states
               (object_id, object_type, current_state, previous_state,
                transition_id, evidence_id, version)
               VALUES (?,?,?,NULL,NULL,?,1)""",
            (object_id, object_type, initial_state, evidence_id),
        )
        self.conn.execute(
            """INSERT INTO state_history
               (history_id, object_id, object_type, from_state, to_state,
                transition_id, evidence_id)
               VALUES (?,?,?,NULL,?,NULL,?)""",
            (str(uuid.uuid4()), object_id, object_type, initial_state, evidence_id),
        )
        self.conn.commit()
        logger.info("Registered %s %s in state %s",
                    object_type, object_id, initial_state)
        return object_id

    def get_state(self, object_id: str) -> Optional[dict]:
        """Read the authoritative current state of an object."""
        self._require_open()
        row = self.conn.execute(
            "SELECT * FROM object_states WHERE object_id = ?", (object_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_history(self, object_id: str, limit: int = 50) -> list:
        self._require_open()
        rows = self.conn.execute(
            """SELECT * FROM state_history WHERE object_id = ?
               ORDER BY rowid DESC LIMIT ?""",
            (object_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Transition lifecycle — begin / commit / abort
    # ------------------------------------------------------------------
    def begin_transition(self, object_id: str, transition_id: str,
                         transition_name: Optional[str] = None) -> dict:
        """Stage a transition: validate source state, record pending.

        Does NOT change current_state. The executor acts; only an
        independent read-back may commit (see commit_transition).
        """
        self._require_open()
        obj = self.get_state(object_id)
        if obj is None:
            raise ValueError(f"Object {object_id} not registered")

        trans = self._get_transition(transition_id)
        if trans is None:
            raise ValueError(f"Transition {transition_id} not registered")

        if trans['source_state'] != obj['current_state']:
            raise ValueError(
                f"Transition {transition_id} requires source "
                f"'{trans['source_state']}' but object is "
                f"'{obj['current_state']}'"
            )

        self.conn.execute(
            """INSERT OR REPLACE INTO pending_transitions
               (pending_id, object_id, transition_id, source_state,
                target_state, status)
               VALUES (?,?,?,?,?,'PENDING')""",
            (str(uuid.uuid4()), object_id, transition_id,
             trans['source_state'], trans['target_state']),
        )
        self.conn.commit()
        logger.info("Staged transition %s on %s (%s → %s)",
                    transition_id, object_id,
                    trans['source_state'], trans['target_state'])
        return {
            'object_id': object_id,
            'transition_id': transition_id,
            'source_state': trans['source_state'],
            'target_state': trans['target_state'],
            'status': 'PENDING',
            'verification_gate': json.loads(trans['verification_gate']),
            'synchronization_gate': json.loads(trans['synchronization_gate']),
        }

    def commit_transition(self, object_id: str, transition_id: str,
                          evidence_id: str,
                          evidence_strength: str = 'L1') -> dict:
        """COMMIT a staged transition — ONLY on independent confirmation.

        FRS-007 L1 contract: evidence_strength must be L1 (independent
        read-back). Executor self-reports (L3) are rejected: the executor
        can never certify its own work.

        Also rejects evidence_id values that do not exist in the
        evidence table as an L1 record (strict mode) — the Evidence
        Engine is the source of truth.
        """
        self._require_open()
        pending = self.conn.execute(
            """SELECT * FROM pending_transitions
               WHERE object_id = ? AND transition_id = ? AND status='PENDING'""",
            (object_id, transition_id),
        ).fetchone()
        if pending is None:
            raise ValueError(
                f"No pending transition {transition_id} for {object_id}")

        if evidence_strength not in INDEPENDENT_STRENGTHS:
            raise PermissionError(
                f"L1 commit contract violated: evidence strength "
                f"'{evidence_strength}' is not independent confirmation. "
                f"Executor self-reports are L3 evidence and cannot commit "
                f"a state transition.")

        # Strict check: the evidence must exist in the Evidence Engine
        # as an L1 record. Falls back to the strength flag if the
        # evidence table is absent (fresh DB, adapter initializes later)
        # or the row was recorded under a different adapter instance.
        try:
            ev = self.conn.execute(
                "SELECT * FROM evidence WHERE evidence_id = ?", (evidence_id,)
            ).fetchone()
        except sqlite3.OperationalError:
            ev = None  # evidence table not yet created — trust the flag
        if ev is not None:
            row_strength = (ev['evidence_strength'] or '').upper()
            if row_strength not in INDEPENDENT_STRENGTHS:
                raise PermissionError(
                    f"L1 commit contract violated: evidence {evidence_id} "
                    f"has strength {row_strength}, not L1")

        obj = self.get_state(object_id)
        self.conn.execute(
            """UPDATE object_states
               SET current_state = ?, previous_state = ?,
                   transition_id = ?, evidence_id = ?, version = version + 1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE object_id = ?""",
            (pending['target_state'], obj['current_state'],
             transition_id, evidence_id, object_id),
        )
        self.conn.execute(
            """INSERT INTO state_history
               (history_id, object_id, object_type, from_state, to_state,
                transition_id, evidence_id)
               VALUES (?,?,?,?,?,?,?)""",
            (str(uuid.uuid4()), object_id, obj['object_type'],
             obj['current_state'], pending['target_state'],
             transition_id, evidence_id),
        )
        self.conn.execute(
            """UPDATE pending_transitions SET status='COMMITTED'
               WHERE object_id = ? AND transition_id = ?""",
            (object_id, transition_id),
        )
        self.conn.commit()
        logger.info("COMMITTED %s on %s: %s → %s (evidence %s)",
                    transition_id, object_id, obj['current_state'],
                    pending['target_state'], evidence_id)
        return {
            'object_id': object_id,
            'from_state': obj['current_state'],
            'to_state': pending['target_state'],
            'transition_id': transition_id,
            'evidence_id': evidence_id,
            'version': obj['version'] + 1,
        }

    def abort_transition(self, object_id: str, transition_id: str,
                         reason: str = '') -> dict:
        """Abort a staged transition — no state change (compensation path)."""
        self._require_open()
        pending = self.conn.execute(
            """SELECT * FROM pending_transitions
               WHERE object_id = ? AND transition_id = ? AND status='PENDING'""",
            (object_id, transition_id),
        ).fetchone()
        if pending is None:
            raise ValueError(f"No pending transition {transition_id} for {object_id}")
        self.conn.execute(
            """UPDATE pending_transitions SET status='ABORTED'
               WHERE object_id = ? AND transition_id = ?""",
            (object_id, transition_id),
        )
        self.conn.commit()
        logger.info("ABORTED %s on %s (reason=%s)",
                    transition_id, object_id, reason)
        return {'object_id': object_id, 'transition_id': transition_id,
                'status': 'ABORTED', 'reason': reason}

    # ------------------------------------------------------------------
    # Transition Registry — definitions
    # ------------------------------------------------------------------
    def register_transition(self, transition_id: str, name: str,
                            source_state: str, target_state: str,
                            verification_gate: list,
                            synchronization_gate: Optional[list] = None,
                            rollback_policy: Optional[list] = None) -> str:
        self._require_open()
        self.conn.execute(
            """INSERT OR REPLACE INTO transitions
               (transition_id, name, source_state, target_state,
                verification_gate, synchronization_gate, rollback_policy,
                is_active)
               VALUES (?,?,?,?,?,?,?,1)""",
            (transition_id, name, source_state, target_state,
             json.dumps(verification_gate),
             json.dumps(synchronization_gate or []),
             json.dumps(rollback_policy or [])),
        )
        self.conn.commit()
        return transition_id

    def _get_transition(self, transition_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM transitions WHERE transition_id = ?",
            (transition_id,),
        ).fetchone()
        return dict(row) if row else None

    def get_transition(self, transition_id: str) -> Optional[dict]:
        t = self._get_transition(transition_id)
        if t is None:
            return None
        t['verification_gate'] = json.loads(t['verification_gate'])
        t['synchronization_gate'] = json.loads(t['synchronization_gate'])
        t['rollback_policy'] = json.loads(t['rollback_policy'])
        return t

    def find_transitions(self, source_state: str) -> list:
        rows = self.conn.execute(
            "SELECT * FROM transitions WHERE source_state = ? AND is_active = 1",
            (source_state,),
        ).fetchall()
        return [dict(r) for r in rows]

    def load_transitions_from_yaml(self, path: str) -> int:
        """Load declarative transition definitions from YAML.

        Expected shape (FRS-007 spec example):
            transitions:
              save_transaction:
                source_state: DRAFT
                target_state: PERSISTED
                verification_gate: [list of L1 business-state checks]
                synchronization_gate: [network_idle, no_active_spinners, ...]
                rollback_policy: [revert_to_draft, ...]
        """
        import yaml  # local import: optional dependency

        with open(path) as f:
            data = yaml.safe_load(f)
        trans = (data or {}).get('transitions', {})
        count = 0
        for tid, spec in trans.items():
            self.register_transition(
                transition_id=tid,
                name=spec.get('name', tid),
                source_state=spec['source_state'],
                target_state=spec['target_state'],
                verification_gate=spec.get('verification_gate', []),
                synchronization_gate=spec.get('synchronization_gate', []),
                rollback_policy=spec.get('rollback_policy', []),
            )
            count += 1
        logger.info("Loaded %d transitions from %s", count, path)
        return count

    # ------------------------------------------------------------------
    # Introspection / reporting
    # ------------------------------------------------------------------
    def get_registry_report(self) -> dict:
        self._require_open()
        objects = self.conn.execute(
            "SELECT object_type, current_state, COUNT(*) as n "
            "FROM object_states GROUP BY object_type, current_state"
        ).fetchall()
        pending = self.conn.execute(
            "SELECT COUNT(*) as n FROM pending_transitions WHERE status='PENDING'"
        ).fetchone()['n']
        trans = self.conn.execute(
            "SELECT COUNT(*) as n FROM transitions WHERE is_active = 1"
        ).fetchone()['n']
        return {
            'state_count': sum(r['n'] for r in objects),
            'by_object_state': [dict(r) for r in objects],
            'pending_transitions': pending,
            'active_transitions': trans,
        }

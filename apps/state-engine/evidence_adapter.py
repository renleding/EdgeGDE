"""
evidence_adapter.py — FRS-006 Evidence Engine for State Engine MCP.

SQLite-backed epistemology framework. Provides the Fact Registry,
Evidence Engine, and Verification Hierarchy as an in-process Python
adapter. All Tier A metadata commits synchronously to the WAL;
Tier B heavy artifacts dispatch to async workers.

Schema: FRS-006 v6.0 Final
Location: ~/.hermes/evidence/evidence.db
"""

import sqlite3
import json
import os
import uuid
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger('state-engine.evidence')

EVIDENCE_DIR = Path.home() / '.hermes' / 'evidence'
DB_PATH = EVIDENCE_DIR / 'evidence.db'
ARTIFACTS_DIR = EVIDENCE_DIR / 'artifacts'
SCREENSHOTS_DIR = EVIDENCE_DIR / 'screenshots'
TRACES_DIR = EVIDENCE_DIR / 'traces'
HAR_DIR = EVIDENCE_DIR / 'har'

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- Mission aggregation
CREATE TABLE IF NOT EXISTS missions (
    mission_id TEXT PRIMARY KEY,
    objective TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    status TEXT NOT NULL
);

-- Individual execution run
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    mission_id TEXT,
    parent_run_id TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    application TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY(mission_id) REFERENCES missions(mission_id)
);

-- Governance gatekeeper
CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    action TEXT NOT NULL,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    approver TEXT,
    status TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES runs(run_id)
);

-- Raw sensory input
CREATE TABLE IF NOT EXISTS observations (
    observation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    category TEXT NOT NULL,
    observation TEXT NOT NULL,
    confidence TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES runs(run_id)
);

-- Reasoning trail (Invariant 3 enforced at application layer)
CREATE TABLE IF NOT EXISTS hypotheses (
    hypothesis_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    source TEXT NOT NULL,
    statement TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    evidence_id TEXT,
    FOREIGN KEY(run_id) REFERENCES runs(run_id),
    FOREIGN KEY(observation_id) REFERENCES observations(observation_id),
    FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
);

-- Captured telemetry metadata
CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    storage_mode TEXT NOT NULL,
    evidence_strength TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT,
    file_path TEXT,
    checksum_sha256 TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES runs(run_id)
);

-- Async evidence processing queue
CREATE TABLE IF NOT EXISTS evidence_jobs (
    job_id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    source_buffer_ref TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    status TEXT NOT NULL,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_log TEXT,
    FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
);

-- Worker health snapshot
CREATE VIEW IF NOT EXISTS worker_metrics AS
SELECT 
    COUNT(*) FILTER (WHERE status = 'QUEUED') AS queue_depth,
    MAX(CAST((julianday('now') - julianday(created_at)) * 24 * 60 AS INTEGER))
        FILTER (WHERE status = 'QUEUED') AS oldest_job_age_minutes,
    COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_jobs,
    AVG(CAST((julianday(completed_at) - julianday(created_at)) * 24 * 60 * 60 AS INTEGER))
        FILTER (WHERE status = 'COMPLETED') AS avg_processing_time_seconds
FROM evidence_jobs;

-- Verification hierarchy results
CREATE TABLE IF NOT EXISTS verifications (
    verification_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    level TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    FOREIGN KEY(run_id) REFERENCES runs(run_id)
);

-- Quantitative fact registry
CREATE TABLE IF NOT EXISTS facts (
    fact_id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    confidence TEXT NOT NULL,
    evidence_count INTEGER DEFAULT 1,
    validated_date DATETIME NOT NULL,
    expiry_date DATETIME NOT NULL
);

-- Fact challenge protocol
CREATE TABLE IF NOT EXISTS fact_challenges (
    challenge_id TEXT PRIMARY KEY,
    fact_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    supporting_run_count INTEGER DEFAULT 0,
    opposing_run_count INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolution TEXT,
    FOREIGN KEY(fact_id) REFERENCES facts(fact_id)
);

-- Immutable fact history
CREATE TABLE IF NOT EXISTS fact_history (
    history_id TEXT PRIMARY KEY,
    fact_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(fact_id) REFERENCES facts(fact_id),
    FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
);

-- Anti-regression memory
CREATE TABLE IF NOT EXISTS contradictions (
    id TEXT PRIMARY KEY,
    hypothesis TEXT NOT NULL,
    disproved_by TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
);

-- Action explainability & audit trail
CREATE TABLE IF NOT EXISTS decisions (
    decision_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT,
    evidence_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES runs(run_id),
    FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
);
"""


class EvidenceAdapter:
    """In-process Evidence Engine adapter for FRS-006.

    All Tier A operations (metadata) commit synchronously through the WAL.
    Tier B operations (heavy file artifacts) queue via evidence_jobs for
    async dispatch. The contradiction cache is maintained in-memory for
    fast-path rejection during execution.
    """

    def __init__(self, db_path: str = str(DB_PATH)):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._contradiction_cache: set = set()  # Fast in-memory cache
        self._fact_cache: dict = {}  # key -> {value, confidence, supersedes}
        self._open = False

    # ── Lifecycle ──

    def open(self):
        """Initialize database and load caches."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._open = True
        self._conn.executescript(SCHEMA_SQL)
        self._load_caches()
        logger.info("EvidenceAdapter opened at %s", self.db_path)

    def close(self):
        if self._conn:
            self._conn.close()
        self._open = False

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *args):
        self.close()

    def _require_open(self):
        if not self._open or not self._conn:
            raise RuntimeError(
                "EvidenceAdapter not opened. Call .open() before use."
            )
        return self._conn

    def _load_caches(self):
        """Hydrate in-memory caches from DB on startup."""
        # Contradictions cache
        cur = self._require_open().execute("SELECT hypothesis FROM contradictions")
        self._contradiction_cache = {row['hypothesis'] for row in cur.fetchall()}

        # Facts cache
        cur = self._require_open().execute(
            "SELECT key, value, confidence, evidence_count FROM facts"
        )
        self._fact_cache = {}
        for row in cur.fetchall():
            self._fact_cache[row['key']] = {
                'value': row['value'],
                'confidence': row['confidence'],
                'evidence_count': row['evidence_count'],
            }
        logger.info(
            "Loaded %d contradictions, %d facts",
            len(self._contradiction_cache),
            len(self._fact_cache),
        )

    # ── Evidential API ──

    def begin_mission(self, mission_id: str, objective: str) -> str:
        """Start a new mission. Returns mission_id."""
        if not mission_id:
            mission_id = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT OR IGNORE INTO missions (mission_id, objective, status) VALUES (?, ?, ?)",
            (mission_id, objective, 'IN_PROGRESS'),
        )
        self._require_open().commit()
        return mission_id

    def complete_mission(self, mission_id: str, status: str):
        if status not in ('COMPLETED', 'FAILED', 'ABORTED'):
            raise ValueError(f"Invalid mission status: {status}")
        self._require_open().execute(
            "UPDATE missions SET completed_at = ?, status = ? WHERE mission_id = ?",
            (datetime.now(timezone.utc).isoformat(), status, mission_id),
        )
        self._require_open().commit()

    def begin_run(self, run_id: str, mission_id: str, application: str,
                  action: str) -> str:
        """Start a new execution run within a mission."""
        if not run_id:
            run_id = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO runs (run_id, mission_id, application, action, status) "
            "VALUES (?, ?, ?, ?, 'RUNNING')",
            (run_id, mission_id, application, action),
        )
        self._require_open().commit()
        return run_id

    def finish_run(self, run_id: str, status: str):
        if status not in ('SUCCESS', 'FAILED', 'WAITING_FOR_AUTHORIZATION'):
            raise ValueError(f"Invalid run status: {status}")
        self._require_open().execute(
            "UPDATE runs SET finished_at = ?, status = ? WHERE run_id = ?",
            (datetime.now(timezone.utc).isoformat(), status, run_id),
        )
        # Update mission counters
        mission_id = self._require_open().execute(
            "SELECT mission_id FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if mission_id and mission_id['mission_id']:
            col = 'success_count' if status == 'SUCCESS' else 'failure_count'
            self._require_open().execute(
                f"UPDATE missions SET {col} = {col} + 1 WHERE mission_id = ?",
                (mission_id['mission_id'],),
            )
        self._require_open().commit()

    def log_observation(self, run_id: str, category: str, observation: str,
                        confidence: str = 'MEDIUM') -> str:
        oid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO observations (observation_id, run_id, category, "
            "observation, confidence) VALUES (?, ?, ?, ?, ?)",
            (oid, run_id, category, observation, confidence),
        )
        self._require_open().commit()
        return oid

    def log_hypothesis(self, run_id: str, observation_id: str, source: str,
                       statement: str) -> str:
        hid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO hypotheses (hypothesis_id, run_id, observation_id, "
            "source, statement, status) VALUES (?, ?, ?, ?, ?, 'OPEN')",
            (hid, run_id, observation_id, source, statement),
        )
        self._require_open().commit()
        return hid

    def add_evidence(self, run_id: str, evidence_type: str,
                     storage_mode: str, evidence_strength: str,
                     payload_json: Optional[str] = None,
                     file_path: Optional[str] = None,
                     checksum: Optional[str] = None) -> str:
        eid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO evidence (evidence_id, run_id, type, storage_mode, "
            "evidence_strength, status, payload_json, file_path, checksum_sha256) "
            "VALUES (?, ?, ?, ?, ?, 'COMPLETE', ?, ?, ?)",
            (eid, run_id, evidence_type, storage_mode, evidence_strength,
             payload_json, file_path, checksum),
        )
        self._require_open().commit()
        return eid

    def queue_artifact_job(self, evidence_id: str, artifact_type: str,
                           source_buffer_ref: str, destination_path: str) -> str:
        jid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO evidence_jobs (job_id, evidence_id, artifact_type, "
            "source_buffer_ref, destination_path, status) "
            "VALUES (?, ?, ?, ?, ?, 'QUEUED')",
            (jid, evidence_id, artifact_type, source_buffer_ref, destination_path),
        )
        self._require_open().commit()
        return jid

    def add_verification(self, run_id: str, level: str, status: str,
                         reason: Optional[str] = None) -> str:
        vid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO verifications (verification_id, run_id, level, "
            "status, reason) VALUES (?, ?, ?, ?, ?)",
            (vid, run_id, level, status, reason),
        )
        self._require_open().commit()
        return vid

    def log_decision(self, run_id: str, decision: str, rationale: Optional[str] = None,
                     evidence_id: Optional[str] = None) -> str:
        did = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO decisions (decision_id, run_id, decision, rationale, "
            "evidence_id) VALUES (?, ?, ?, ?, ?)",
            (did, run_id, decision, rationale, evidence_id),
        )
        self._require_open().commit()
        return did

    def await_approval(self, run_id: str, action: str, ttl_hours: int = 24) -> str:
        """Record an approval gate. Returns approval_id."""
        aid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO approvals (approval_id, run_id, action, status) "
            "VALUES (?, ?, ?, 'PENDING')",
            (aid, run_id, action),
        )
        self._require_open().commit()
        return aid

    # ── Fact Registry ──

    def calculate_confidence(self, evidence_count: int) -> str:
        """Deterministic confidence scaling per FRS-006 v6.0."""
        if evidence_count < 1:
            return "speculative"
        elif 1 <= evidence_count <= 2:
            return "probable"
        elif 3 <= evidence_count <= 24:
            return "confirmed"
        else:
            return "strongly_confirmed"

    def upsert_fact(self, key: str, value: str, evidence_count: int,
                    validated_date: Optional[str] = None,
                    expiry_days: int = 90) -> dict:
        """Insert or update a fact. Returns previous state for history."""
        now = validated_date or datetime.now(timezone.utc).isoformat()
        expiry = (datetime.now(timezone.utc) + timedelta(days=expiry_days)).isoformat()
        confidence = self.calculate_confidence(evidence_count)

        existing = self._require_open().execute(
            "SELECT * FROM facts WHERE key = ?", (key,)
        ).fetchone()
        old_value = existing['value'] if existing else None

        if existing:
            # Check expiry — auto-degrade if expired
            current_confidence = existing['confidence']
            if datetime.now(timezone.utc).isoformat() > existing['expiry_date']:
                current_confidence = self.calculate_confidence(
                    max(1, existing['evidence_count'] - 1)
                )

            self._require_open().execute(
                "UPDATE facts SET value = ?, confidence = ?, evidence_count = ?, "
                "validated_date = ?, expiry_date = ? WHERE key = ?",
                (value, confidence, evidence_count, now, expiry, key),
            )
        else:
            self._require_open().execute(
                "INSERT INTO facts (fact_id, key, value, confidence, "
                "evidence_count, validated_date, expiry_date) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), key, value, confidence,
                 evidence_count, now, expiry),
            )

        self._require_open().commit()

        # Refresh in-memory cache
        self._fact_cache[key] = {
            'value': value,
            'confidence': confidence,
            'evidence_count': evidence_count,
        }

        return {'old_value': old_value, 'new_value': value,
                'old_confidence': existing['confidence'] if existing else None,
                'new_confidence': confidence}

    def get_fact(self, key: str) -> Optional[dict]:
        """Retrieve a fact by key. Returns None if not found."""
        row = self._require_open().execute(
            "SELECT * FROM facts WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return None
        return {
            'fact_id': row['fact_id'],
            'key': row['key'],
            'value': row['value'],
            'confidence': row['confidence'],
            'evidence_count': row['evidence_count'],
            'validated_date': row['validated_date'],
            'expiry_date': row['expiry_date'],
        }

    def record_fact_history(self, fact_id: str, old_value: Optional[str],
                            new_value: str, evidence_id: str):
        self._require_open().execute(
            "INSERT INTO fact_history (history_id, fact_id, old_value, "
            "new_value, evidence_id) VALUES (?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), fact_id, old_value, new_value, evidence_id),
        )
        self._require_open().commit()

    # ── Contradiction Engine ──

    def is_path_blocked(self, hypothesis: str) -> bool:
        """Check if a hypothesis or strategy is disproven. O(1) cache hit."""
        return hypothesis in self._contradiction_cache

    def add_contradiction(self, hypothesis: str, disproved_by: str,
                          evidence_id: str):
        """Record a disproven hypothesis and update the cache."""
        cid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO contradictions (id, hypothesis, disproved_by, evidence_id) "
            "VALUES (?, ?, ?, ?)",
            (cid, hypothesis, disproved_by, evidence_id),
        )
        self._require_open().commit()
        self._contradiction_cache.add(hypothesis)

    def get_blocked_paths(self) -> list:
        """Return all currently blocked hypotheses."""
        return sorted(self._contradiction_cache)

    # ── Fact Challenge Protocol ──

    def open_fact_challenge(self, fact_id: str, severity: str = 'MEDIUM') -> str:
        cid = str(uuid.uuid4())
        self._require_open().execute(
            "INSERT INTO fact_challenges (challenge_id, fact_id, severity, status) "
            "VALUES (?, ?, ?, 'OPEN')",
            (cid, fact_id, severity),
        )
        self._require_open().commit()
        return cid

    def resolve_fact_challenge(self, challenge_id: str, resolution: str):
        if resolution not in ('RETAINED', 'DOWNGRADED', 'RETIRED'):
            raise ValueError(f"Invalid resolution: {resolution}")
        self._require_open().execute(
            "UPDATE fact_challenges SET resolved_at = ?, status = 'ACCEPTED', "
            "resolution = ? WHERE challenge_id = ?",
            (datetime.now(timezone.utc).isoformat(), resolution, challenge_id),
        )
        self._require_open().commit()

    # ── Observation ──

    def get_recent_observations(self, run_id: str, limit: int = 10) -> list:
        cur = self._require_open().execute(
            "SELECT * FROM observations WHERE run_id = ? ORDER BY timestamp DESC LIMIT ?",
            (run_id, limit),
        )
        return [dict(row) for row in cur.fetchall()]

    def get_run_verifications(self, run_id: str) -> list:
        cur = self._require_open().execute(
            "SELECT * FROM verifications WHERE run_id = ? ORDER BY level", (run_id,)
        )
        return [dict(row) for row in cur.fetchall()]

    def get_evidence_for_run(self, run_id: str) -> list:
        cur = self._require_open().execute(
            "SELECT * FROM evidence WHERE run_id = ? ORDER BY timestamp", (run_id,)
        )
        return [dict(row) for row in cur.fetchall()]

    # ── Audit ──

    def get_mission_report(self, mission_id: str) -> dict:
        mission = self._require_open().execute(
            "SELECT * FROM missions WHERE mission_id = ?", (mission_id,)
        ).fetchone()
        if not mission:
            return {}
        runs = self._require_open().execute(
            "SELECT * FROM runs WHERE mission_id = ? ORDER BY started_at",
            (mission_id,),
        ).fetchall()
        return {
            'mission': dict(mission),
            'runs': [dict(r) for r in runs],
        }

    def get_worker_health(self) -> dict:
        cur = self._require_open().execute("SELECT * FROM worker_metrics")
        return dict(cur.fetchone() or {})

    # ── Tier B Artifact Dispatching ──

    def get_pending_jobs(self) -> list:
        cur = self._require_open().execute(
            "SELECT * FROM evidence_jobs WHERE status = 'QUEUED' "
            "ORDER BY created_at LIMIT 50"
        )
        return [dict(row) for row in cur.fetchall()]

    def complete_job(self, job_id: str, success: bool, error_log: Optional[str] = None):
        if success:
            self._require_open().execute(
                "UPDATE evidence_jobs SET status = 'COMPLETED', "
                "completed_at = ? WHERE job_id = ?",
                (datetime.now(timezone.utc).isoformat(), job_id),
            )
        else:
            self._require_open().execute(
                "UPDATE evidence_jobs SET status = 'FAILED', "
                "error_log = ?, retry_count = retry_count + 1 WHERE job_id = ?",
                (error_log, job_id),
            )
        self._require_open().commit()

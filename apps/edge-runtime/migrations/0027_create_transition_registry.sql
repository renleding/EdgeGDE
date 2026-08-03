-- FRS-007 Observer→D1 Integration — Item A2: Transition Registry
--
-- The registry stores mined transition VERSIONS. Zero raw values / PII:
-- only structural metadata crosses the boundary (element selectors,
-- dual-gate spec, verification class, telemetry).
--
-- Lineage model:
--   transition_family_id groups versions of one transition
--     e.g. 'Deal_totalBusinessIncome'
--   candidate_signature is the immutable VERSION hash — selector drift OR
--     verification drift => NEW signature = new version, never overwrite.
--
-- Lifecycle (D1 shadow dispatch — D1 has no browser):
--   PENDING_APPROVAL → APPROVED_FOR_VALIDATION → ACTIVE | REJECTED
--   - promote()        → PENDING_APPROVAL (+ Telegram prompt to human)
--   - approve()        → APPROVED_FOR_VALIDATION + enqueue 3 SHADOW
--                        missions for the signature
--   - shadow-result()  → 3 consecutive shadow successes → ACTIVE;
--                        any failure → REJECTED

CREATE TABLE IF NOT EXISTS transition_registry (
    transition_family_id   TEXT NOT NULL,          -- e.g. 'Deal_totalBusinessIncome'
    candidate_signature    TEXT PRIMARY KEY,       -- specific VERSION hash
    object_type            TEXT NOT NULL,
    source_state           TEXT NOT NULL,
    target_state           TEXT NOT NULL,
    element_selectors_json TEXT NOT NULL,
    dual_gate_spec_json    TEXT NOT NULL,
    verification_class     TEXT CHECK(verification_class IN ('L1', 'L2')),
    status                 TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    -- PENDING_APPROVAL → APPROVED_FOR_VALIDATION → ACTIVE | REJECTED
    telemetry_json         TEXT NOT NULL DEFAULT '{}',
    promoted_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at             INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_transition_registry_family
    ON transition_registry (transition_family_id, promoted_at DESC);

CREATE INDEX IF NOT EXISTS idx_transition_registry_status
    ON transition_registry (status);

-- Shadow validation runs: 3 consecutive successes (run_seq 1..3) for a
-- signature flip the registry row to ACTIVE; any failure → REJECTED.
CREATE TABLE IF NOT EXISTS transition_shadow_runs (
    signature   TEXT NOT NULL,
    run_seq     INTEGER NOT NULL,
    success     INTEGER NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (signature, run_seq)
);

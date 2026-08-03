"""
tests/test_state_registry.py — FRS-007 Phase 2 verification.

Covers:
 1. State Registry CRUD (register/get/history)
 2. Transition Registry declarative definitions (YAML load)
 3. begin → commit lifecycle with L1 independent-proof enforcement
 4. L1 CONTRACT: L3 (executor self-report) evidence is REJECTED
 5. Source-state validation (wrong source → ValueError)
 6. Abort path (compensation) leaves state unchanged
 7. Registry report introspection

Run: python3 -m pytest tests/test_state_registry.py -v
"""

import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from state_registry import StateRegistry  # noqa: E402


@pytest.fixture()
def registry():
    tmp = tempfile.mktemp(suffix='.db')
    sr = StateRegistry(db_path=tmp)
    sr.open()
    yield sr
    sr.close()
    if os.path.exists(tmp):
        os.remove(tmp)


@pytest.fixture()
def seeded(registry):
    """Object + transitions pre-loaded, mirroring the test-deal lifecycle."""
    registry.register_transition(
        transition_id='save_transaction',
        name='Save deal transaction',
        source_state='DRAFT',
        target_state='PERSISTED',
        verification_gate=[
            'independent_readback: deal_visible_on_board',
            'state_readback: deal_status == PERSISTED',
        ],
        synchronization_gate=['network_idle', 'no_active_spinners'],
        rollback_policy=['revert_to_draft'],
    )
    registry.register_transition(
        transition_id='attach_applicant',
        name='Attach applicant to deal',
        source_state='PERSISTED',
        target_state='APPLICANT_ATTACHED',
        verification_gate=['readback: applicant_visible_on_deal'],
        synchronization_gate=['dom_attached'],
        rollback_policy=['remove_applicant'],
    )
    registry.register_object('deal_test', 'deal', 'DRAFT',
                             evidence_id='ev_initial_seed')
    return registry


def _seed_l1_evidence(registry, ev_id: str):
    """Insert an L1 evidence row into the shared evidence table."""
    # Minimal evidence table for the isolated temp DB (production DB is
    # created by EvidenceAdapter; the registry reuses the same file).
    registry.conn.execute(
        """CREATE TABLE IF NOT EXISTS evidence (
           evidence_id TEXT PRIMARY KEY,
           run_id TEXT NOT NULL,
           type TEXT NOT NULL,
           storage_mode TEXT NOT NULL,
           evidence_strength TEXT NOT NULL,
           status TEXT NOT NULL,
           payload_json TEXT,
           file_path TEXT,
           checksum_sha256 TEXT,
           timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    registry.conn.execute(
        """INSERT OR IGNORE INTO evidence
           (evidence_id, run_id, type, storage_mode, evidence_strength,
            status, payload_json, timestamp)
           VALUES (?, 'run_x', 'l1_readback', 'inline', 'L1', 'confirmed',
                   '{}', CURRENT_TIMESTAMP)""",
        (ev_id,),
    )
    registry.conn.commit()


# ----------------------------------------------------------------------
# 1. State Registry CRUD
# ----------------------------------------------------------------------
def test_register_and_read_state(seeded):
    state = seeded.get_state('deal_test')
    assert state['current_state'] == 'DRAFT'
    assert state['object_type'] == 'deal'
    assert state['version'] == 1


def test_history_has_initial_record(seeded):
    hist = seeded.get_history('deal_test')
    assert len(hist) == 1
    assert hist[0]['to_state'] == 'DRAFT'


def test_unknown_object_returns_none(seeded):
    assert seeded.get_state('does_not_exist') is None


# ----------------------------------------------------------------------
# 2. Transition Registry
# ----------------------------------------------------------------------
def test_transition_definitions_loaded(seeded):
    t = seeded.get_transition('save_transaction')
    assert t['source_state'] == 'DRAFT'
    assert t['target_state'] == 'PERSISTED'
    assert 'independent_readback' in t['verification_gate'][0]
    assert 'network_idle' in t['synchronization_gate']


def test_find_transitions_from_source(seeded):
    trans = seeded.find_transitions('DRAFT')
    assert len(trans) == 1
    assert trans[0]['transition_id'] == 'save_transaction'


def test_load_transitions_from_yaml(registry):
    yaml_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'references', 'test-deal-transitions.yaml')
    n = registry.load_transitions_from_yaml(yaml_path)
    assert n >= 2
    assert registry.get_transition('save_transaction') is not None
    assert registry.get_transition('attach_applicant') is not None


# ----------------------------------------------------------------------
# 3. begin → commit lifecycle (L1 contract)
# ----------------------------------------------------------------------
def test_full_commit_lifecycle(seeded):
    _seed_l1_evidence(seeded, 'ev_l1_saved')
    staged = seeded.begin_transition('deal_test', 'save_transaction')
    assert staged['status'] == 'PENDING'
    assert staged['target_state'] == 'PERSISTED'

    # State unchanged while pending
    assert seeded.get_state('deal_test')['current_state'] == 'DRAFT'

    # Independent read-back confirms → commit
    result = seeded.commit_transition('deal_test', 'save_transaction',
                                      evidence_id='ev_l1_saved',
                                      evidence_strength='L1')
    assert result['to_state'] == 'PERSISTED'
    assert result['version'] == 2

    # Now in target state, history has both records
    assert seeded.get_state('deal_test')['current_state'] == 'PERSISTED'
    hist = seeded.get_history('deal_test')
    assert len(hist) == 2
    assert hist[0]['from_state'] == 'DRAFT'
    assert hist[0]['to_state'] == 'PERSISTED'


# ----------------------------------------------------------------------
# 4. L1 CONTRACT: executor self-report (L3) cannot commit
# ----------------------------------------------------------------------
def test_l3_self_report_rejected(seeded):
    staged = seeded.begin_transition('deal_test', 'save_transaction')
    assert staged['status'] == 'PENDING'
    with pytest.raises(PermissionError):
        seeded.commit_transition('deal_test', 'save_transaction',
                                 evidence_id='ev_executor_claim',
                                 evidence_strength='L3')
    # State must NOT have moved
    assert seeded.get_state('deal_test')['current_state'] == 'DRAFT'


def test_l1_evidence_row_must_exist_as_l1(seeded):
    """Even a caller claiming 'L1' cannot commit against an L3 evidence row."""
    registry = seeded
    _seed_l1_evidence(registry, 'ev_dummy')  # ensure evidence table exists
    registry.conn.execute(
        """INSERT OR IGNORE INTO evidence
           (evidence_id, run_id, type, storage_mode, evidence_strength,
            status, payload_json, timestamp)
           VALUES ('ev_l3_row', 'run_x', 'executor_return', 'inline',
                   'L3', 'confirmed', '{}', CURRENT_TIMESTAMP)""")
    registry.conn.commit()
    seeded.begin_transition('deal_test', 'save_transaction')
    with pytest.raises(PermissionError):
        seeded.commit_transition('deal_test', 'save_transaction',
                                 evidence_id='ev_l3_row',
                                 evidence_strength='L1')


def test_commit_without_pending_rejected(seeded):
    with pytest.raises(ValueError):
        seeded.commit_transition('deal_test', 'save_transaction',
                                 evidence_id='ev_l1_saved')


# ----------------------------------------------------------------------
# 5. Source-state validation
# ----------------------------------------------------------------------
def test_wrong_source_state_rejected(seeded):
    # deal is DRAFT; attach_applicant requires PERSISTED
    with pytest.raises(ValueError, match='requires source'):
        seeded.begin_transition('deal_test', 'attach_applicant')


def test_unknown_transition_rejected(seeded):
    with pytest.raises(ValueError, match='not registered'):
        seeded.begin_transition('deal_test', 'nonexistent_transition')


# ----------------------------------------------------------------------
# 6. Abort path (compensation)
# ----------------------------------------------------------------------
def test_abort_leaves_state_unchanged(seeded):
    seeded.begin_transition('deal_test', 'save_transaction')
    seeded.abort_transition('deal_test', 'save_transaction',
                            reason='gate failed')
    assert seeded.get_state('deal_test')['current_state'] == 'DRAFT'
    pending = seeded.conn.execute(
        """SELECT status FROM pending_transitions
           WHERE object_id='deal_test' AND transition_id='save_transaction'"""
    ).fetchone()
    assert pending['status'] == 'ABORTED'


# ----------------------------------------------------------------------
# 7. Registry report
# ----------------------------------------------------------------------
def test_registry_report(seeded):
    _seed_l1_evidence(seeded, 'ev_l1_rpt')
    seeded.begin_transition('deal_test', 'save_transaction')
    seeded.commit_transition('deal_test', 'save_transaction',
                             evidence_id='ev_l1_rpt')
    report = seeded.get_registry_report()
    assert report['state_count'] == 1
    assert report['pending_transitions'] == 0
    assert report['active_transitions'] == 2

"""
tests/test_observer.py — FRS-007 Phase 4: Observer Daemon verification.

Covers:
 1. schema creation + event recording (read-only daemon)
 2. capture helpers (inputs / network / clicks)
 3. run lifecycle (begin/end + steps_observed)
 4. TaskMiner — clusters raw events into fill tasks + transitions
 5. promotion baseline (10-run / 95% bar)
 6. value hashing — no raw PII in the event log
"""

import os
import sys
import json

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from observer import ObserverDaemon, TaskMiner, promote_baseline  # noqa: E402


@pytest.fixture()
def obs(tmp_path):
    d = ObserverDaemon(str(tmp_path / 'evidence.db'))
    d.open()
    yield d
    d.close()


# ── 1. recording ─────────────────────────────────────────────────────
def test_record_event_and_readback(obs):
    eid = obs.record('dom', 'input', 'grossSales', value=80000,
                     detail={'section': 'income'})
    events = obs.events(obs._run_id)
    assert len(events) == 1
    ev = events[0]
    assert ev['event_id'] == eid
    assert ev['source'] == 'dom'
    assert ev['event_type'] == 'input'
    assert ev['target'] == 'grossSales'
    assert json.loads(ev['detail_json'])['section'] == 'income'


def test_value_hashed_no_pii(obs):
    """PII never stored raw — only a value hash."""
    obs.record('dom', 'input', 'phone', value='0412 123 123')
    events = obs.events(obs._run_id)
    ev = events[0]
    assert ev['value_hash'] is not None
    assert ev['value_hash'] != '0412 123 123'          # not the raw value
    assert '0412 123 123' not in json.dumps(ev)        # no PII anywhere
    assert len(ev['value_hash']) == 16


def test_capture_helpers(obs):
    obs.capture_inputs({'gross': 80000, 'profit': 70000})
    obs.capture_network([{'url': 'https://api/deals', 'status': 200,
                          'method': 'GET'}])
    obs.capture_clicks([('Save and calculate', 941, 756)])
    events = obs.events(obs._run_id)
    sources = {e['source'] for e in events}
    assert sources == {'dom', 'network', 'mouse'}
    assert sum(1 for e in events if e['source'] == 'dom') == 2


# ── 3. run lifecycle ─────────────────────────────────────────────────
def test_run_lifecycle(obs):
    rid = obs.begin_run('test-deal-data-entry')
    obs.record('dom', 'input', 'a', value=1, run_id=rid)
    obs.record('dom', 'input', 'b', value=2, run_id=rid)
    obs.record('mouse', 'click', 'Save and calculate', run_id=rid)
    obs.end_run(True, run_id=rid, transitions=[{'source': 'DRAFT',
                                                'target': 'PERSISTED'}])
    runs = obs.runs('test-deal-data-entry')
    assert len(runs) == 1
    assert runs[0]['steps_observed'] == 3
    assert runs[0]['success'] == 1
    assert json.loads(runs[0]['transitions_json'])[0]['target'] == 'PERSISTED'


def test_multiple_runs_recorded(obs):
    for i in range(3):
        rid = obs.begin_run('mission-x')
        obs.record('dom', 'input', 'f', value=i, run_id=rid)
        obs.end_run(True, run_id=rid)
    assert len(obs.runs('mission-x')) == 3


# ── 4. TaskMiner ─────────────────────────────────────────────────────
def _mk_events(pairs):
    """pairs: [(ts, source, etype, target)]"""
    return [{'ts_ms': ts, 'source': s, 'event_type': t, 'target': g}
            for ts, s, t, g in pairs]


def test_miner_detects_fill_task_and_transition(obs):
    now = 1_000_000
    events = _mk_events([
        (now, 'dom', 'input', 'Groceries'),
        (now + 100, 'dom', 'input', 'Clothing'),
        (now + 200, 'dom', 'input', 'Phone'),
        (now + 300, 'mouse', 'click', 'Save and calculate'),
    ])
    result = TaskMiner().mine(events)
    assert len(result['candidates']) == 1
    c = result['candidates'][0]
    assert c['task'].startswith('fill_')
    assert c['input_events'] == 3
    assert c['confidence'] >= 0.5
    # save seen → transition to PERSISTED
    assert result['transitions'][0]['target'] == 'PERSISTED'
    assert result['transitions'][0]['save_seen'] is True


def test_miner_separates_clusters_by_window(obs):
    now = 1_000_000
    events = _mk_events([
        (now, 'dom', 'input', 'gross'),
        (now + 100, 'dom', 'input', 'profit'),
        (now + 200, 'dom', 'input', 'commission'),
        (now + 10_000, 'dom', 'input', 'Groceries'),
        (now + 10_100, 'dom', 'input', 'Clothing'),
        (now + 10_200, 'dom', 'input', 'Phone'),
    ])
    result = TaskMiner().mine(events)
    assert result['clusters'] == 2
    assert len(result['candidates']) == 2


def test_miner_requires_min_cluster_size(obs):
    now = 1_000_000
    events = _mk_events([
        (now, 'dom', 'input', 'a'),
        (now + 100, 'dom', 'input', 'b'),
    ])
    result = TaskMiner().mine(events)
    assert result['candidates'] == []


# ── 5. promotion baseline ────────────────────────────────────────────
def test_promotion_bar_below_min_runs(obs):
    runs = [{'success': 1} for _ in range(5)]
    verdict = promote_baseline(runs, min_runs=10, min_success_rate=0.95)
    assert verdict['eligible'] is False
    assert verdict['needed'] == 5


def test_promotion_bar_meets_bar(obs):
    runs = [{'success': 1} for _ in range(10)]
    verdict = promote_baseline(runs, min_runs=10, min_success_rate=0.95)
    assert verdict['eligible'] is True
    assert verdict['success_rate'] == 1.0


def test_promotion_bar_fails_on_low_success(obs):
    runs = [{'success': 1} for _ in range(9)] + [{'success': 0}]
    verdict = promote_baseline(runs, min_runs=10, min_success_rate=0.95)
    assert verdict['eligible'] is False
    assert verdict['success_rate'] == 0.9

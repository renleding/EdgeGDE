"""
tests/test_mission_queue_client.py — FRS-007 Phase 3 Data Plane client.

Verifies the Dispatcher / Performer client against a fake in-memory queue
implementing the lease semantics (claim TTL, heartbeat, auto-release,
dead-letter) without needing the live Control Plane.

Run: python3 -m pytest tests/test_mission_queue_client.py -v
"""

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mission_queue_client import MissionQueueClient, Performer  # noqa: E402


class FakeQueue:
    """In-memory Control Plane queue with the SAME lease contract."""

    def __init__(self, lease_seconds=60):
        self.items = {}
        self.seq = 0
        self.lease_seconds = lease_seconds

    def enqueue(self, mission_id, payload, priority=0, max_attempts=3,
                target_state='', state_object_id=''):
        self.seq += 1
        item_id = f"item_{self.seq}"
        self.items[item_id] = {
            'item_id': item_id, 'mission_id': mission_id,
            'payload_json': payload, 'status': 'QUEUED',
            'priority': priority, 'max_attempts': max_attempts,
            'attempts': 0, 'lease_holder': None, 'lease_expires_at': None,
            'heartbeat_count': 0, 'result_json': None, 'error_log': '',
            'target_state': target_state, 'state_object_id': state_object_id,
        }
        return {'success': True, 'itemId': item_id, 'status': 'QUEUED'}

    def claim(self, performer_id):
        now = time.time() * 1000
        # reap expired
        for it in self.items.values():
            if (it['status'] == 'IN_PROGRESS'
                    and it['lease_expires_at']
                    and it['lease_expires_at'] < now):
                it['attempts'] += 1
                if it['attempts'] >= it['max_attempts']:
                    it['status'] = 'DEAD'
                else:
                    it['status'] = 'QUEUED'
                    it['lease_holder'] = None
                    it['lease_expires_at'] = None
        # pick highest priority QUEUED
        q = [it for it in self.items.values() if it['status'] == 'QUEUED']
        if not q:
            return {'success': True, 'item': None, 'message': 'queue_empty'}
        it = max(q, key=lambda x: (x['priority'], -int(x['item_id'][5:])))
        it['status'] = 'IN_PROGRESS'
        it['lease_holder'] = performer_id
        it['lease_expires_at'] = now + self.lease_seconds * 1000
        it['heartbeat_count'] = 0
        return {'success': True, 'item': {
            'itemId': it['item_id'], 'missionId': it['mission_id'],
            'payload': it['payload_json'], 'status': it['status'],
            'attempts': it['attempts'],
            'leaseExpiresAt': it['lease_expires_at'],
            'leaseDurationSeconds': self.lease_seconds,
            'targetState': it['target_state'],
            'stateObjectId': it['state_object_id'],
        }}

    def __getitem__(self, item_id):
        return self.items[item_id]

    def heartbeat(self, item_id, performer_id):
        it = self.items.get(item_id)
        if (not it or it['status'] != 'IN_PROGRESS'
                or it['lease_holder'] != performer_id):
            return {'success': False, 'error': 'lease_not_held'}
        it['lease_expires_at'] = time.time() * 1000 + self.lease_seconds * 1000
        it['heartbeat_count'] += 1
        return {'success': True, 'itemId': item_id,
                'leaseExpiresAt': it['lease_expires_at'],
                'heartbeatCount': it['heartbeat_count']}

    def complete(self, item_id, performer_id, status, result=None, error=''):
        it = self.items.get(item_id)
        if (not it or it['status'] != 'IN_PROGRESS'
                or it['lease_holder'] != performer_id):
            return {'success': False, 'error': 'lease_not_held'}
        it['status'] = status
        it['result_json'] = result
        it['error_log'] = error
        it['lease_holder'] = None
        it['lease_expires_at'] = None
        return {'success': True, 'itemId': item_id, 'status': status}

    def status(self):
        from collections import Counter
        return {'success': True,
                'byStatus': [{'status': s, 'n': n} for s, n in
                             Counter(i['status'] for i in self.items.values()).items()]}


class FakeClient(MissionQueueClient):
    def __init__(self, queue):
        super().__init__('http://fake')
        self.queue = queue

    def _post(self, path, body):
        if path == '/enqueue':
            return self.queue.enqueue(body['missionId'], body.get('payload', {}),
                                      body.get('priority', 0),
                                      body.get('maxAttempts', 3),
                                      body.get('targetState', ''),
                                      body.get('stateObjectId', ''))
        if path == '/claim':
            return self.queue.claim(body['performerId'])
        if path == '/heartbeat':
            return self.queue.heartbeat(body['itemId'], body['performerId'])
        if path == '/complete':
            return self.queue.complete(body['itemId'], body['performerId'],
                                       body['status'], body.get('result'),
                                       body.get('error', ''))
        raise AssertionError(path)

    def _get(self, path):
        return self.queue.status()


@pytest.fixture()
def queue():
    return FakeQueue(lease_seconds=60)


# ----------------------------------------------------------------------
def test_dispatcher_enqueues(queue):
    client = FakeClient(queue)
    r = client.enqueue('m1', {'deal': 'A'}, priority=5)
    assert r['success'] is True
    assert queue.items[r['itemId']]['status'] == 'QUEUED'
    assert queue.items[r['itemId']]['priority'] == 5


def test_performer_processes_queue(queue):
    client = FakeClient(queue)
    for i in range(3):
        client.enqueue(f'm{i}', {'n': i})

    def handler(item):
        return {'verified': True, 'n': item['payload']['n']}

    stats = Performer(client, 'node-1', lease_duration_seconds=60,
                      heartbeat_interval_seconds=1).work(handler)
    assert stats['claimed'] == 3
    assert stats['completed'] == 3
    assert stats['failed'] == 0
    assert all(it['status'] == 'COMPLETED' for it in queue.items.values())


def test_performer_reports_failure(queue):
    client = FakeClient(queue)
    client.enqueue('m1', {})

    def bad_handler(item):
        raise RuntimeError('BRE: invalid data')

    stats = Performer(client, 'node-1').work(bad_handler)
    assert stats['failed'] == 1
    assert any(it['status'] == 'FAILED' for it in queue.items.values())


def test_lease_expiry_releases_item(queue):
    client = FakeClient(queue)
    client.enqueue('m1', {})
    # claim manually, then force expiry, then another performer reclaims
    r = client.claim('node-1')
    item_id = r['item']['itemId']
    queue.items[item_id]['lease_expires_at'] = time.time() * 1000 - 1
    r2 = client.claim('node-2')
    assert r2['item']['itemId'] == item_id
    assert r2['item']['attempts'] == 1


def test_heartbeat_extends_lease(queue):
    client = FakeClient(queue)
    client.enqueue('m1', {})
    r = client.claim('node-1')
    item_id = r['item']['itemId']
    before = queue.items[item_id]['lease_expires_at']
    time.sleep(0.02)
    hb = client.heartbeat(item_id, 'node-1')
    assert hb['success'] is True
    assert queue.items[item_id]['lease_expires_at'] > before
    assert queue.items[item_id]['heartbeat_count'] == 1


def test_foreign_heartbeat_rejected(queue):
    client = FakeClient(queue)
    client.enqueue('m1', {})
    r = client.claim('node-1')
    item_id = r['item']['itemId']
    hb = client.heartbeat(item_id, 'node-2')
    assert hb['success'] is False


def test_max_attempts_dead_letter(queue):
    queue = FakeQueue(lease_seconds=60)
    client = FakeClient(queue)
    client.enqueue('m1', {}, max_attempts=2)
    r = client.claim('node-1')
    item_id = r['item']['itemId']
    # expire twice
    queue.items[item_id]['lease_expires_at'] = time.time() * 1000 - 1
    client.claim('node-2')
    queue.items[item_id]['lease_expires_at'] = time.time() * 1000 - 1
    client.claim('node-3')
    assert queue.items[item_id]['status'] == 'DEAD'


def test_queue_status_report(queue):
    client = FakeClient(queue)
    client.enqueue('m1', {})
    report = client.status()
    assert report['success'] is True
    statuses = [s['status'] for s in report['byStatus']]
    assert 'QUEUED' in statuses


# ═══════════════════════════════════════════════════════════════════════
# PHASE 3 CLOSURE — P1 trust boundaries, P2 lease safety, P3 resumption
# handshake, P4 heartbeat resilience, P6 distributed recovery
# ═══════════════════════════════════════════════════════════════════════

def test_p1_malformed_claim_response_rejected(queue):
    """P1: malformed boundary payloads fail validation, never business logic."""
    client = FakeClient(queue)
    client.enqueue('m1', {})

    def broken_claim(path, body):
        return {'success': True, 'item': {'itemId': 'i1', 'missionId': 'm1',
                                          'status': 'IN_PROGRESS',
                                          'payload': 'not-a-dict'}}

    client._post = broken_claim
    with pytest.raises(ValueError, match='payload not an object'):
        client.claim('node-1')

    def missing_item_id(path, body):
        return {'success': True, 'item': {'missionId': 'x', 'status': 'X'}}

    client._post = missing_item_id
    with pytest.raises(ValueError, match='itemId'):
        client.claim('node-1')


def test_p2_late_commit_rejected_after_reclaim(queue):
    """P2: A's lease expires → B reclaims → A's complete() MUST be rejected."""
    client = FakeClient(queue)
    client.enqueue('m1', {})
    claim_a = client.claim('node-A')
    item_id = claim_a['item']['itemId']
    # A "crashes" (lease expires, no heartbeat)
    queue[item_id]['lease_expires_at'] = time.time() * 1000 - 1
    # B reclaims
    claim_b = client.claim('node-B')
    assert claim_b['item']['itemId'] == item_id
    assert queue[item_id]['lease_holder'] == 'node-B'
    # A attempts late commit — MUST fail (lease no longer held by A)
    late = client.complete(item_id, 'node-A', 'COMPLETED', result={})
    assert late['success'] is False
    assert queue[item_id]['status'] == 'IN_PROGRESS'  # B still owns it
    # B commits fine
    ok = client.complete(item_id, 'node-B', 'COMPLETED', result={'done': True})
    assert ok['success'] is True
    assert queue[item_id]['status'] == 'COMPLETED'


def test_p3_resumption_handshake_idempotent_skip(queue):
    """P3: target state already reached → skip execution, mark COMPLETED."""
    client = FakeClient(queue)
    client.enqueue('m1', {'deal': 'A'}, target_state='PERSISTED',
                   state_object_id='deal_1')
    executed = []

    def handler(item):
        executed.append(item['itemId'])
        return {'verified': True}

    def resume_check(item):
        # AUTHORITATIVE read-back: business system shows target reached
        return item['targetState'] == 'PERSISTED'

    stats = Performer(client, 'node-1').work(handler, resume_check=resume_check)
    assert stats['completed_idempotent'] == 1
    assert stats['completed'] == 1
    assert executed == []  # handler NEVER ran — no duplicate business action
    assert queue['item_1']['status'] == 'COMPLETED'
    assert queue['item_1']['result_json']['idempotent'] is True


def test_p3_resumption_handshake_executes_when_not_reached(queue):
    """P3: target state NOT reached → execute the transition normally."""
    client = FakeClient(queue)
    client.enqueue('m1', {'deal': 'A'}, target_state='PERSISTED')
    executed = []

    def handler(item):
        executed.append(item['itemId'])
        return {'verified': True}

    def resume_check(item):
        return False  # business system shows the deal is still DRAFT

    stats = Performer(client, 'node-1').work(handler, resume_check=resume_check)
    assert stats['completed'] == 1
    assert stats['completed_idempotent'] == 0
    assert executed == ['item_1']


def test_p4_heartbeat_independent_of_long_operation(queue):
    """P4: heartbeat continues during a long-running handler (no stall)."""
    client = FakeClient(queue)
    client.enqueue('m1', {})
    # Long transaction: 6s handler vs 1s heartbeat interval
    def handler(item):
        time.sleep(6)
        return {'verified': True, 'long_run': True}

    stats = Performer(client, 'node-1', lease_duration_seconds=60,
                      heartbeat_interval_seconds=1).work(handler)
    assert stats['completed'] == 1
    assert queue['item_1']['heartbeat_count'] >= 3  # lease kept alive
    assert queue['item_1']['status'] == 'COMPLETED'


def test_p6_distributed_failure_recovery(queue):
    """P6 (definitive): A claims → A fails → lease expires → B reclaims →
    read-back → NO duplicate action → mission completes."""
    client = FakeClient(queue)
    client.enqueue('m1', {'deal': 'A'}, target_state='PERSISTED')
    executed = []

    def handler(item):
        executed.append(item['itemId'])
        return {'verified': True}

    # Node A claims then "crashes" (no heartbeat; lease expires)
    claim_a = client.claim('node-A')
    item_id = claim_a['item']['itemId']
    assert queue[item_id]['lease_holder'] == 'node-A'
    queue[item_id]['lease_expires_at'] = time.time() * 1000 - 1

    # Node B reclaims; its read-back shows the target state NOT reached
    # (A never completed the business action), so B executes exactly once
    def resume_check(item):
        return False  # deal still DRAFT — A never persisted

    stats = Performer(client, 'node-B', lease_duration_seconds=60,
                      heartbeat_interval_seconds=1).work(
        handler, resume_check=resume_check)
    assert stats['completed'] == 1
    assert executed == [item_id]  # exactly ONE business action
    assert queue[item_id]['status'] == 'COMPLETED'
    # and the read-back prevented a duplicate: A's crash produced no side effect


def test_p6_no_duplicate_after_partial_success(queue):
    """P6 variant: A's action actually succeeded before the crash → B's
    authoritative read-back detects it → B skips → no duplicate."""
    client = FakeClient(queue)
    client.enqueue('m1', {'deal': 'A'}, target_state='PERSISTED')
    executed = []

    def handler(item):
        executed.append(item['itemId'])
        return {'verified': True}

    # A claims, executes, but dies BEFORE completing (lease expires)
    claim_a = client.claim('node-A')
    item_id = claim_a['item']['itemId']
    queue[item_id]['lease_expires_at'] = time.time() * 1000 - 1
    # Simulate: A's side effect DID land (deal shows PERSISTED on read-back)
    def resume_check(item):
        return True  # authoritative re-query shows target reached

    stats = Performer(client, 'node-B').work(handler, resume_check=resume_check)
    assert stats['completed_idempotent'] == 1
    assert executed == []  # NO duplicate business action
    assert queue[item_id]['status'] == 'COMPLETED'

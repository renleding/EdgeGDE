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

    def enqueue(self, mission_id, payload, priority=0, max_attempts=3):
        self.seq += 1
        item_id = f"item_{self.seq}"
        self.items[item_id] = {
            'item_id': item_id, 'mission_id': mission_id,
            'payload_json': payload, 'status': 'QUEUED',
            'priority': priority, 'max_attempts': max_attempts,
            'attempts': 0, 'lease_holder': None, 'lease_expires_at': None,
            'heartbeat_count': 0, 'result_json': None, 'error_log': '',
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
        }}

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
                                      body.get('maxAttempts', 3))
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

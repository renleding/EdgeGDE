"""
tests/test_distributed_recovery.py — FRS-007 closure Item 3.

HARD side-effect assertions (distributed recovery). Scenario verbatim
from the closure plan:

    Performer_A claims task, begins adding applicant to Deal 2bc60884 →
    SIGKILL mid-execution → wait lease TTL → Performer_B claims,
    Pre-Read, finishes, Post-Read, completes.

MANDATORY domain assertion (queue status alone is insufficient):

    applicants = external_api.get_applicants(deal_id="2bc60884")
    assert len(applicants) == 1  # NO duplicate side-effect
    assert mission_queue.get(mission_id).status == "COMPLETED"

Setup is a real local HTTP server exposing BOTH the mission queue API and
a fake external business API (applicants), so Performer_A runs as a real
separate OS process (multiprocessing) and is killed with a real SIGKILL.

Run: python3 -m pytest tests/test_distributed_recovery.py -v
"""

import json
import os
import signal
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import multiprocessing
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mission_queue_client import MissionQueueClient, Performer  # noqa: E402

DEAL_ID = "2bc60884"
MISSION_ID = "frs007-distributed-recovery"
APPLICANT = {"deal_id": DEAL_ID, "name": "Sam Smith"}


# ── fake external business API + mission queue, one HTTP server ──────
class _Handler(BaseHTTPRequestHandler):
    srv = None

    def log_message(self, *args):  # keep test output clean
        pass

    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n).decode()) if n else {}

    def _send(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith('/api/v1/mission-queue'):
            return self._send(self.srv.status())
        if self.path.startswith('/api/v1/external/applicants'):
            return self._send(self.srv.get_applicants(DEAL_ID))
        return self._send({'success': False, 'error': 'not_found'}, 404)

    def do_POST(self):
        body = self._body()
        p = self.path
        if p == '/api/v1/mission-queue/enqueue':
            return self._send(self.srv.enqueue(
                body['missionId'], body.get('payload', {}),
                body.get('priority', 0), body.get('maxAttempts', 3),
                body.get('targetState', ''), body.get('stateObjectId', '')))
        if p == '/api/v1/mission-queue/claim':
            return self._send(self.srv.claim(body['performerId']))
        if p == '/api/v1/mission-queue/heartbeat':
            return self._send(self.srv.heartbeat(body['itemId'],
                                                 body['performerId']))
        if p == '/api/v1/mission-queue/complete':
            return self._send(self.srv.complete(
                body['itemId'], body['performerId'], body['status'],
                body.get('result'), body.get('error', '')))
        if p == '/api/v1/external/add-applicant':
            return self._send(self.srv.add_applicant(body))
        return self._send({'success': False, 'error': 'not_found'}, 404)


class RecoveryServer:
    """Thread-safe in-memory mission queue + applicants store over HTTP.

    Queue lease contract mirrors the Control Plane (apps/edge-runtime):
      - claim reaps expired leases first (attempts + 1, DEAD at max)
      - complete is rejected unless the item is IN_PROGRESS, held by the
        caller, AND the lease is still valid (atomic — mirrors the
        production UPDATE ... WHERE lease_expires_at > now).
    """

    def __init__(self):
        self.items = {}
        self.seq = 0
        self.applicants = []
        self.lock = threading.Lock()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), _Handler)
        _Handler.srv = self
        self.url = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever,
                         daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ── mission queue API ────────────────────────────────────────────
    def enqueue(self, mission_id, payload, priority=0, max_attempts=3,
                target_state='', state_object_id=''):
        with self.lock:
            self.seq += 1
            item_id = f'item_{self.seq}'
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
        with self.lock:
            now = time.time() * 1000
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
            q = [it for it in self.items.values() if it['status'] == 'QUEUED']
            if not q:
                return {'success': True, 'item': None, 'message': 'queue_empty'}
            it = max(q, key=lambda x: (x['priority'], -int(x['item_id'][5:])))
            it['status'] = 'IN_PROGRESS'
            it['lease_holder'] = performer_id
            it['lease_expires_at'] = now + 3000  # short TTL for the test
            it['heartbeat_count'] = 0
            return {'success': True, 'item': {
                'itemId': it['item_id'], 'missionId': it['mission_id'],
                'payload': it['payload_json'], 'status': it['status'],
                'attempts': it['attempts'],
                'leaseExpiresAt': it['lease_expires_at'],
                'leaseDurationSeconds': 3,
                'targetState': it['target_state'],
                'stateObjectId': it['state_object_id'],
            }}

    def heartbeat(self, item_id, performer_id):
        with self.lock:
            it = self.items.get(item_id)
            if (not it or it['status'] != 'IN_PROGRESS'
                    or it['lease_holder'] != performer_id):
                return {'success': False, 'error': 'lease_not_held'}
            it['lease_expires_at'] = time.time() * 1000 + 3000
            it['heartbeat_count'] += 1
            return {'success': True, 'itemId': item_id,
                    'leaseExpiresAt': it['lease_expires_at'],
                    'heartbeatCount': it['heartbeat_count']}

    def complete(self, item_id, performer_id, status, result=None, error=''):
        with self.lock:
            it = self.items.get(item_id)
            now = time.time() * 1000
            if (not it or it['status'] != 'IN_PROGRESS'
                    or it['lease_holder'] != performer_id
                    or it['lease_expires_at'] is None
                    or it['lease_expires_at'] <= now):
                return {'success': False, 'error': 'lease_not_held_or_expired'}
            it['status'] = status
            it['result_json'] = result
            it['error_log'] = error
            it['lease_holder'] = None
            it['lease_expires_at'] = None
            return {'success': True, 'itemId': item_id, 'status': status}

    def status(self):
        from collections import Counter
        with self.lock:
            by = Counter(i['status'] for i in self.items.values())
            return {'success': True,
                    'metrics': {s: by.get(s, 0) for s in
                                ('QUEUED', 'IN_PROGRESS', 'COMPLETED',
                                 'FAILED', 'DEAD')}}

    def get_mission(self, mission_id):
        with self.lock:
            for it in self.items.values():
                if it['mission_id'] == mission_id:
                    return dict(it)
            return None

    # ── external business API (applicants on the deal) ───────────────
    def add_applicant(self, applicant):
        with self.lock:
            if applicant not in self.applicants:  # idempotent add
                self.applicants.append(applicant)
            return {'success': True, 'applicants': list(self.applicants)}

    def get_applicants(self, deal_id):
        with self.lock:
            return [a for a in self.applicants if a['deal_id'] == deal_id]


def _get(url, deal_id=DEAL_ID):
    with urllib.request.urlopen(
            f'{url}/api/v1/external/applicants?deal_id={deal_id}',
            timeout=5) as resp:
        return json.loads(resp.read().decode())


def _post(url, path, body):
    req = urllib.request.Request(
        f'{url}{path}', data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode())


# ── Performer_A: real OS process, killed with SIGKILL mid-execution ──
def _performer_a_main(url: str, deal_id: str, sleep_before_add: float):
    client = MissionQueueClient(url)

    def handler(item):
        # "begins adding applicant to Deal 2bc60884"
        if sleep_before_add > 0:
            time.sleep(sleep_before_add)
        _post(url, '/api/v1/external/add-applicant',
              {'deal_id': deal_id, 'name': 'Sam Smith'})
        time.sleep(30)  # mid-execution — never completes before the kill
        return {'verified': True}

    Performer(client, 'node-A', lease_duration_seconds=3,
              heartbeat_interval_seconds=60).work(handler, max_items=1)


def _kill(proc):
    os.kill(proc.pid, signal.SIGKILL)
    proc.join(timeout=5)
    assert not proc.is_alive(), 'Performer_A survived SIGKILL'


def _start_a(srv, sleep_before_add=0.0):
    proc = multiprocessing.Process(
        target=_performer_a_main, args=(srv.url, DEAL_ID, sleep_before_add))
    proc.start()
    return proc


def _wait_applicant(srv, count=1, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(srv.get_applicants(DEAL_ID)) >= count:
            return
        time.sleep(0.05)
    raise AssertionError(f'applicants never reached {count}')


# ═════════════════════════════════════════════════════════════════════
def test_sigkill_after_side_effect_no_duplicate():
    """A adds the applicant, is SIGKILLed mid-execution → B pre-reads,
    detects the reached state, skips idempotently → exactly ONE applicant,
    queue COMPLETED. MANDATORY domain assertion holds."""
    with RecoveryServer() as srv:
        srv.enqueue(MISSION_ID, {'deal_id': DEAL_ID, 'action': 'add_applicant'},
                    target_state='PERSISTED', state_object_id=f'deal_{DEAL_ID}')
        proc = _start_a(srv)
        try:
            _wait_applicant(srv, count=1)  # side effect landed
            _kill(proc)                    # SIGKILL mid-execution
            time.sleep(3.5)                # wait lease TTL (3s) + margin

            client = MissionQueueClient(srv.url)
            executed = []

            def handler_b(item):
                executed.append(item['itemId'])
                return {'verified': True}

            def resume_check(item):
                # Gate 1 — LIVE re-query of the business application
                return len(srv.get_applicants(DEAL_ID)) >= 1

            def verify_check(item, result):
                # Gate 2 — LIVE re-query after (any) execution
                return len(srv.get_applicants(DEAL_ID)) == 1

            stats = Performer(client, 'node-B', lease_duration_seconds=30,
                              heartbeat_interval_seconds=1).work(
                handler_b, resume_check=resume_check,
                verify_check=verify_check, max_items=1)
            assert stats['completed'] == 1
            assert stats['completed_idempotent'] == 1  # B skipped — no re-run

            # ── MANDATORY DOMAIN ASSERTION (spec verbatim) ────────────
            applicants = _get(srv.url)
            assert len(applicants) == 1   # NO duplicate side-effect
            mission = srv.get_mission(MISSION_ID)
            assert mission['status'] == 'COMPLETED'
            assert executed == []          # actuator never re-ran
        finally:
            if proc.is_alive():
                _kill(proc)


def test_sigkill_before_side_effect_b_finishes():
    """A is SIGKILLed BEFORE the side effect lands → B's pre-read shows
    not reached → B executes exactly once → post-read confirms → exactly
    ONE applicant, queue COMPLETED."""
    with RecoveryServer() as srv:
        srv.enqueue(MISSION_ID, {'deal_id': DEAL_ID, 'action': 'add_applicant'},
                    target_state='PERSISTED', state_object_id=f'deal_{DEAL_ID}')
        proc = _start_a(srv, sleep_before_add=30.0)
        try:
            time.sleep(1.0)      # A is mid-execution, nothing added yet
            assert len(srv.get_applicants(DEAL_ID)) == 0
            _kill(proc)          # SIGKILL before any side effect
            time.sleep(3.5)      # wait lease TTL

            client = MissionQueueClient(srv.url)
            executed = []

            def handler_b(item):
                _post(srv.url, '/api/v1/external/add-applicant',
                      {'deal_id': DEAL_ID, 'name': 'Sam Smith'})
                executed.append(item['itemId'])
                return {'verified': True}

            def resume_check(item):
                return len(srv.get_applicants(DEAL_ID)) >= 1

            def verify_check(item, result):
                return len(srv.get_applicants(DEAL_ID)) == 1

            stats = Performer(client, 'node-B', lease_duration_seconds=30,
                              heartbeat_interval_seconds=1).work(
                handler_b, resume_check=resume_check,
                verify_check=verify_check, max_items=1)
            assert stats['completed'] == 1
            assert stats['verify_failed'] == 0
            assert executed == [srv.get_mission(MISSION_ID)['item_id']]

            # ── MANDATORY DOMAIN ASSERTION (spec verbatim) ────────────
            applicants = _get(srv.url)
            assert len(applicants) == 1   # NO duplicate side-effect
            mission = srv.get_mission(MISSION_ID)
            assert mission['status'] == 'COMPLETED'
        finally:
            if proc.is_alive():
                _kill(proc)

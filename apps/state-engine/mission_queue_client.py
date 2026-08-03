"""
mission_queue_client.py — FRS-007 Phase 3: Dispatcher / Performer client.

Data Plane counterpart of the Control Plane D1 Mission Queue
(see apps/edge-runtime/src/api/mission-queue.ts).

Dispatcher  — loads discrete transactions into the queue (enqueue).
Performer   — claims ONE item, processes it with a heartbeat thread
              keeping the lease alive, then reports the verified outcome.

Lease contract (FRS-007 Q2 resolution, LOCKED):
  - claim() atomically takes an item and sets lease_expires_at = now + TTL
  - the performer MUST heartbeat every heartbeat_interval_seconds
  - if the process hangs or the node drops off the mesh, the lease
    expires and the item is auto-released back to the queue
  - after max_attempts releases the item goes DEAD

L1 verification is the caller's contract: the handler must return an
outcome backed by independent read-back before it is reported COMPLETED.
"""

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

logger = logging.getLogger('state-engine.mission-queue')

DEFAULT_LEASE_SECONDS = 60
DEFAULT_HEARTBEAT_SECONDS = 20


class MissionQueueClient:
    """HTTP client for the Control Plane mission queue."""

    def __init__(self, base_url: str, api_token: str = "",
                 timeout: float = 15.0):
        self.base_url = base_url.rstrip('/')
        self.api_token = api_token
        self.timeout = timeout

    def _post(self, path: str, body: dict) -> dict:
        req = urllib.request.Request(
            f"{self.base_url}/api/v1/mission-queue{path}",
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        if self.api_token:
            req.add_header('Authorization', f'Bearer {self.api_token}')
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode())
            except Exception:
                return {'success': False, 'error': f'HTTP {e.code}'}
        except urllib.error.URLError as e:
            return {'success': False, 'error': str(e.reason)}

    def _get(self, path: str) -> dict:
        req = urllib.request.Request(
            f"{self.base_url}/api/v1/mission-queue{path}",
            headers={'Content-Type': 'application/json'},
            method='GET',
        )
        if self.api_token:
            req.add_header('Authorization', f'Bearer {self.api_token}')
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode())
            except Exception:
                return {'success': False, 'error': f'HTTP {e.code}'}
        except urllib.error.URLError as e:
            return {'success': False, 'error': str(e.reason)}

    # ── Dispatcher ────────────────────────────────────────────────────
    def enqueue(self, mission_id: str, payload: Optional[dict] = None,
                priority: int = 0, max_attempts: int = 3) -> dict:
        """Load a discrete transaction into the queue."""
        return self._post('/enqueue', {
            'missionId': mission_id,
            'payload': payload or {},
            'priority': priority,
            'maxAttempts': max_attempts,
        })

    # ── Performer ─────────────────────────────────────────────────────
    def claim(self, performer_id: str,
              lease_duration_seconds: int = DEFAULT_LEASE_SECONDS) -> dict:
        """Atomically claim the next available item (or None if empty)."""
        return self._post('/claim', {
            'performerId': performer_id,
            'leaseDurationSeconds': lease_duration_seconds,
        })

    def heartbeat(self, item_id: str, performer_id: str) -> dict:
        """Extend the lease on the held item."""
        return self._post('/heartbeat', {
            'itemId': item_id,
            'performerId': performer_id,
        })

    def complete(self, item_id: str, performer_id: str, status: str,
                 result: Optional[dict] = None,
                 error: str = '') -> dict:
        """Report the verified outcome (COMPLETED or FAILED)."""
        return self._post('/complete', {
            'itemId': item_id,
            'performerId': performer_id,
            'status': status,
            'result': result or {},
            'error': error,
        })

    def status(self) -> dict:
        """Control Room view: status distribution + in-flight items."""
        return self._get('/')


class Performer:
    """Single-node performer loop with lease heartbeat.

    Usage:
        def handler(item: dict) -> dict:
            ... execute with independent L1 verification ...
            return {'verified': True}   # or raise on BRE/SE

        Performer(client, 'node-1').work(handler, max_items=10)
    """

    def __init__(self, client: MissionQueueClient, performer_id: str,
                 lease_duration_seconds: int = DEFAULT_LEASE_SECONDS,
                 heartbeat_interval_seconds: int = DEFAULT_HEARTBEAT_SECONDS):
        self.client = client
        self.performer_id = performer_id
        self.lease_duration = lease_duration_seconds
        self.heartbeat_interval = heartbeat_interval_seconds
        self._stop = threading.Event()
        self._hb_thread: Optional[threading.Thread] = None

    # ── heartbeat thread (keeps the lease alive while working) ────────
    def _heartbeat_loop(self, item_id: str):
        while not self._stop.is_set():
            time.sleep(self.heartbeat_interval)
            if self._stop.is_set():
                break
            resp = self.client.heartbeat(item_id, self.performer_id)
            if not resp.get('success'):
                logger.warning("Heartbeat lost for %s: %s",
                               item_id, resp.get('error'))
                self._stop.set()  # lease lost — abort work
                return

    def _start_heartbeat(self, item_id: str):
        self._stop.clear()
        self._hb_thread = threading.Thread(
            target=self._heartbeat_loop, args=(item_id,), daemon=True)
        self._hb_thread.start()

    def _stop_heartbeat(self):
        self._stop.set()
        if self._hb_thread:
            self._hb_thread.join(timeout=self.heartbeat_interval + 2)

    # ── main loop ─────────────────────────────────────────────────────
    def work(self, handler: Callable[[dict], dict], max_items: int = -1,
             on_error: Optional[Callable[[dict, Exception], str]] = None) -> dict:
        """Claim → process → verify → report, until the queue is empty.

        handler(item) -> result dict (must be L1-verified by the caller)
        on_error(item, exc) -> error string (defaults to str(exc))
        """
        stats = {'claimed': 0, 'completed': 0, 'failed': 0,
                 'queue_empty': 0, 'leased_lost': 0}
        while max_items < 0 or stats['claimed'] < max_items:
            resp = self.client.claim(
                self.performer_id, self.lease_duration)
            if not resp.get('success'):
                logger.error("Claim failed: %s", resp.get('error'))
                break
            item = resp.get('item')
            if item is None:
                stats['queue_empty'] += 1
                break  # queue drained

            item_id = item['itemId']
            stats['claimed'] += 1
            self._start_heartbeat(item_id)
            try:
                result = handler(item)
                if self._stop.is_set():
                    # lease lost mid-work — do NOT report; item will
                    # auto-release and be retried by another performer
                    stats['leased_lost'] += 1
                    continue
                done = self.client.complete(
                    item_id, self.performer_id, 'COMPLETED', result=result)
                if done.get('success'):
                    stats['completed'] += 1
                    logger.info("Item %s COMPLETED", item_id)
                else:
                    stats['failed'] += 1
                    logger.warning("Complete rejected: %s", done.get('error'))
            except Exception as exc:  # noqa: BLE001 — report any failure
                msg = on_error(item, exc) if on_error else str(exc)
                self.client.complete(
                    item_id, self.performer_id, 'FAILED', error=msg)
                stats['failed'] += 1
                logger.warning("Item %s FAILED: %s", item_id, msg)
            finally:
                self._stop_heartbeat()
        return stats

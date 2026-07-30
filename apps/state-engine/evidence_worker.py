"""
evidence_worker.py — Async Tier B artifact flush worker.

Processes the evidence_jobs queue: reads pending jobs, writes binary
payloads (screenshots, HAR, traces) to ~/.hermes/evidence/artifacts/,
computes SHA-256 checksums, and updates the evidence/evidence_jobs
tables with the results.

Runs as an asyncio background task inside the State Engine daemon.
Use evidence_adapter.get_worker_health() to monitor.
"""

import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger('state-engine.evidence-worker')

ARTIFACTS_BASE = Path.home() / '.hermes' / 'evidence'
ARTIFACT_SUBDIRS = {
    'screenshot': ARTIFACTS_BASE / 'screenshots',
    'har': ARTIFACTS_BASE / 'har',
    'trace': ARTIFACTS_BASE / 'traces',
    'other': ARTIFACTS_BASE / 'artifacts',
}
for d in ARTIFACT_SUBDIRS.values():
    d.mkdir(parents=True, exist_ok=True)

POLL_INTERVAL_SECONDS = 2.0
MAX_CONCURRENT_JOBS = 3


class EvidenceWorker:
    """Async background worker for Tier B artifact flushing.

    Usage inside State Engine daemon:
        worker = EvidenceWorker(adapter)
        asyncio.create_task(worker.run())
    """

    def __init__(self, adapter, poll_interval: float = POLL_INTERVAL_SECONDS):
        self.adapter = adapter
        self.poll_interval = poll_interval
        self._running = False
        self._concurrent = 0
        self._total_processed = 0
        self._total_failed = 0

    async def run(self):
        """Main loop — polls evidence_jobs queue and processes pending work."""
        self._running = True
        logger.info("EvidenceWorker started (poll=%ss, max_concurrent=%d)",
                     self.poll_interval, MAX_CONCURRENT_JOBS)

        while self._running:
            try:
                pending = self.adapter.get_pending_jobs()
                if pending:
                    logger.debug("EvidenceWorker: %d pending jobs", len(pending))
                    for job in pending[:MAX_CONCURRENT_JOBS]:
                        asyncio.create_task(self._process_job(job))
                        await asyncio.sleep(0.05)
                await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("EvidenceWorker poll error: %s", e)
                await asyncio.sleep(self.poll_interval * 5)

        logger.info("EvidenceWorker stopped. Processed=%d Failed=%d",
                     self._total_processed, self._total_failed)

    def stop(self):
        self._running = False

    async def _process_job(self, job: dict):
        """Process a single evidence job: write file + compute checksum."""
        job_id = job['job_id']
        evidence_id = job['evidence_id']
        artifact_type = job['artifact_type']
        source_ref = job['source_buffer_ref']
        dest_path = job['destination_path']
        retry_count = job.get('retry_count', 0)

        if retry_count >= 5:
            logger.warning("EvidenceWorker: job %s exceeded max retries, marking failed", job_id)
            self.adapter.complete_job(job_id, success=False, error_log="Max retries exceeded")
            return

        self._concurrent += 1
        try:
            # Build the destination path with timestamp hierarchy
            dest = self._resolve_path(artifact_type, dest_path, evidence_id)

            # Decode source buffer (base64 for binary, plain text for JSON)
            if artifact_type in ('screenshot', 'har', 'trace'):
                import base64
                try:
                    raw = base64.b64decode(source_ref)
                except Exception:
                    raw = source_ref.encode('utf-8')
            else:
                raw = source_ref.encode('utf-8')

            # Write to disk
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, 'wb') as f:
                f.write(raw)

            # Compute SHA-256
            sha256 = hashlib.sha256(raw).hexdigest()

            # Verify write
            actual_size = os.path.getsize(dest)
            expected_size = len(raw)
            if actual_size != expected_size:
                raise IOError(f"Write size mismatch: wrote {actual_size} vs expected {expected_size}")

            # Mark job complete
            self.adapter.complete_job(job_id, success=True)
            logger.debug("EvidenceWorker: wrote %s (%d bytes, sha256=%s)", dest, actual_size, sha256[:16])

            self._total_processed += 1

        except Exception as e:
            logger.error("EvidenceWorker: job %s failed: %s", job_id, e)
            self.adapter.complete_job(job_id, success=False, error_log=str(e))
            self._total_failed += 1
        finally:
            self._concurrent -= 1

    def _resolve_path(self, artifact_type: str, dest_path: str, evidence_id: str) -> str:
        """Resolve the destination path with timestamp hierarchy.

        Format: ~/.hermes/evidence/{subdir}/YYYY/MM/DD/{evidence_id}_{type}.{ext}
        If dest_path is already an absolute path, use it as-is.
        """
        if dest_path and dest_path.startswith('/'):
            return dest_path

        subdir = ARTIFACT_SUBDIRS.get(artifact_type, ARTIFACT_SUBDIRS['other'])
        now = datetime.now(timezone.utc)
        date_path = f"{now.year:04d}/{now.month:02d}/{now.day:02d}"

        ext_map = {'screenshot': 'png', 'har': 'har', 'trace': 'json', 'other': 'bin'}
        ext = ext_map.get(artifact_type, 'bin')

        return str(subdir / date_path / f"{evidence_id[:12]}_{artifact_type}.{ext}")

    @property
    def stats(self) -> dict:
        return {
            'running': self._running,
            'concurrent': self._concurrent,
            'total_processed': self._total_processed,
            'total_failed': self._total_failed,
        }

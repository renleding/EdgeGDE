"""
Edge Document Intelligence — M1 Poller Main Entry Point

launchd-managed daemon that polls the Worker API for pending OCR jobs.

Usage:
  python3 main.py              # Daemon mode (infinite loop)
  python3 main.py --once       # Single run (for testing)
  python3 main.py --jobs=5     # Process up to 5 jobs then exit
"""

import os
import sys
import time
import signal

# Force language environment at the OS level before any imports
# Apple Vision's text detection is sensitive to locale settings
os.environ.setdefault('LANG', 'en_AU.UTF-8')
os.environ.setdefault('LC_ALL', 'en_AU.UTF-8')

from audit.logger import logger

# Initialize AppKit at startup to ensure Vision framework
# has full runtime context for ANE-accelerated recognition
try:
    import AppKit
    AppKit.NSApplication.sharedApplication()
except Exception:
    pass

import argparse
# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jobs.claim import claim_job
from jobs.process import process_job
from audit.logger import logger

# ── Configuration ──────────────────────────────────────────────────────────

BASE_URL = os.environ.get("WORKER_BASE_URL", "http://localhost:8787")
TENANT = os.environ.get("TENANT", "personal")
WORKER_ID = os.environ.get("WORKER_ID", "M1-DOCINTEL-01")

# Polling backoff (seconds)
BACKOFF_MIN = 1
BACKOFF_MAX = 60

# Heartbeat interval (seconds)
HEARTBEAT_INTERVAL = 30

# ── Main Loop ──────────────────────────────────────────────────────────────


def run_once() -> bool:
    """Claim and process one job. Returns True if a job was processed."""
    job = claim_job(BASE_URL, TENANT, WORKER_ID)
    if not job:
        return False

    logger.info("job_claimed", job_id=job["job_id"],
                document_id=job["document_id"])
    return process_job(BASE_URL, TENANT, WORKER_ID, job)


def run_loop(max_jobs: int = None):
    """
    Main polling loop.

    Polls for jobs, processes them, backs off when idle.
    """
    backoff = BACKOFF_MIN
    jobs_processed = 0

    logger.info("poller_started",
                base_url=BASE_URL,
                tenant=TENANT,
                worker_id=WORKER_ID,
                max_jobs=max_jobs)

    while True:
        try:
            had_job = run_once()
        except Exception as e:
            logger.error("poller_loop_error", error=str(e))
            had_job = False

        if had_job:
            jobs_processed += 1
            backoff = BACKOFF_MIN  # Reset backoff on success

            if max_jobs and jobs_processed >= max_jobs:
                logger.info("poller_reached_max",
                            jobs_processed=jobs_processed)
                break
        else:
            # Exponential backoff when idle
            logger.debug("poller_idle", backoff_seconds=backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)

    logger.info("poller_stopped", jobs_processed=jobs_processed)


# ── Entry Point ────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Edge Document Intelligence M1 Poller"
    )
    parser.add_argument("--once", action="store_true",
                        help="Process one job and exit")
    parser.add_argument("--jobs", type=int, default=None,
                        help="Process N jobs and exit")
    args = parser.parse_args()

    if args.once:
        logger.info("mode_once")
        run_once()
    elif args.jobs:
        logger.info("mode_batch", count=args.jobs)
        run_loop(max_jobs=args.jobs)
    else:
        logger.info("mode_daemon")
        run_loop()


if __name__ == "__main__":
    main()

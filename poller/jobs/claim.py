"""
Edge Document Intelligence — Job Claim Module

Claims the next pending job from the Worker API.
Uses atomic claim (Worker-side update with status check).
"""

from typing import Optional
from audit.logger import logger


def claim_job(base_url: str, tenant: str, worker_id: str) -> Optional[dict]:
    """
    Claim the next pending job from the Worker API.

    Returns the job dict if one was claimed, or None if no jobs are pending.

    The Worker handles atomicity — if another poller claims the same job,
    this returns empty (no jobs available for us).
    """
    import requests

    url = f"{base_url}/api/v1/doc-intel/jobs/claim"
    headers = {
        "Content-Type": "application/json",
        "x-tenant": tenant,
    }
    payload = {"worker_id": worker_id}

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if "job_id" in data:
                logger.info("job_claimed",
                            job_id=data["job_id"],
                            document_id=data["document_id"],
                            r2_key=data.get("r2_original_key"))
                return data
            logger.debug("no_jobs_available")
            return None
        elif resp.status_code == 409:
            # Job was already claimed by another worker — fine, try again
            logger.debug("job_already_claimed")
            return None
        else:
            logger.warn("claim_unexpected_status",
                        status=resp.status_code,
                        body=resp.text[:500])
            return None
    except requests.exceptions.Timeout:
        logger.warn("claim_timeout")
        return None
    except requests.exceptions.ConnectionError:
        logger.warn("claim_connection_error")
        return None
    except Exception as e:
        logger.error("claim_error", error=str(e))
        return None

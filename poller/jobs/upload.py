"""
Edge Document Intelligence — Artifact Upload Module

Uploads processed artifacts (OCR JSON, extracted fields, compressed PDF) to R2
via the Worker API.
"""

from typing import Optional
from audit.logger import logger


def upload_artifact(base_url: str, tenant: str, r2_key: str,
                    file_path: str, content_type: str = "application/json") -> bool:
    """
    Upload a local file to R2 via the Worker API.

    The Worker stores the file at the specified r2_key in the tenant's bucket.
    Returns True on success.
    """
    import requests

    url = f"{base_url}/api/v1/doc-intel/documents/upload"
    headers = {"x-tenant": tenant}

    try:
        with open(file_path, 'rb') as f:
            files = {'file': (r2_key.split('/')[-1], f, content_type)}
            params = {'r2_key': r2_key}
            resp = requests.post(url, headers=headers, files=files,
                                 params=params, timeout=120)

        if resp.status_code in (200, 201):
            logger.info("artifact_uploaded", r2_key=r2_key)
            return True
        else:
            logger.warn("upload_failed",
                        r2_key=r2_key,
                        status=resp.status_code,
                        body=resp.text[:500])
            return False
    except Exception as e:
        logger.error("upload_error", r2_key=r2_key, error=str(e))
        return False


def submit_result(base_url: str, tenant: str, payload: dict) -> bool:
    """
    Submit processing results back to the Worker.
    This marks the job as complete and stores extracted fields.
    """
    import requests

    url = f"{base_url}/api/v1/doc-intel/jobs/result"
    headers = {
        "Content-Type": "application/json",
        "x-tenant": tenant,
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            logger.info("result_submitted",
                        job_id=payload.get("job_id"),
                        status=data.get("status"))
            return True
        else:
            logger.warn("result_submit_failed",
                        status=resp.status_code,
                        body=resp.text[:500])
            return False
    except Exception as e:
        logger.error("result_submit_error", error=str(e))
        return False


def send_heartbeat(base_url: str, tenant: str, job_id: str) -> bool:
    """Update the job heartbeat to prevent stale-claim recovery."""
    import requests

    url = f"{base_url}/api/v1/doc-intel/jobs/heartbeat"
    headers = {
        "Content-Type": "application/json",
        "x-tenant": tenant,
    }

    try:
        resp = requests.post(url, headers=headers,
                             json={"job_id": job_id}, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False

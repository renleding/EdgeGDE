"""
Edge Document Intelligence — Document Download Module

Downloads the original document from R2 via the Worker's download URL.
Supports compressed download when available.
"""

import os
import tempfile
from typing import Optional
from audit.logger import logger


def download_document(base_url: str, tenant: str, r2_key: str) -> Optional[str]:
    """
    Download a document from R2 via the Worker proxy.

    Returns the local file path, or None on failure.
    The file is written to a temp directory and should be cleaned up by the caller.
    """
    import requests

    # The Worker doesn't have a direct download endpoint for doc-intel yet,
    # so we construct the R2 URL from the key.
    # In production, this would use the Worker's signed URL or direct R2 access.
    url = f"{base_url}/api/v1/doc-intel/documents/download"
    headers = {"x-tenant": tenant}
    params = {"r2_key": r2_key}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=120)
        if resp.status_code == 200:
            # Write to temp file
            ext = os.path.splitext(r2_key)[1] or ".pdf"
            fd, tmp_path = tempfile.mkstemp(suffix=ext, prefix="docintel_")
            with os.fdopen(fd, 'wb') as f:
                f.write(resp.content)
            logger.info("document_downloaded",
                        r2_key=r2_key,
                        size_bytes=len(resp.content),
                        tmp_path=tmp_path)
            return tmp_path
        else:
            logger.warn("download_failed",
                        r2_key=r2_key,
                        status=resp.status_code,
                        body=resp.text[:500])
            return None
    except requests.exceptions.Timeout:
        logger.warn("download_timeout", r2_key=r2_key)
        return None
    except Exception as e:
        logger.error("download_error", r2_key=r2_key, error=str(e))
        return None


def cleanup_document(path: str):
    """Remove a downloaded temp file."""
    try:
        if path and os.path.exists(path):
            os.unlink(path)
            logger.debug("cleanup_ok", path=path)
    except Exception as e:
        logger.warn("cleanup_failed", path=path, error=str(e))

"""
Edge Document Intelligence — Full Job Processing Pipeline

Orchestrates the complete document processing workflow:
  Classify → Preprocess → OCR → Vision Validate → Extract → Upload

Called by main.py for each claimed job.
"""

import json
import os
import sys
import time
from typing import Optional
from jobs.claim import claim_job
from jobs.download import download_document, cleanup_document
from jobs.upload import upload_artifact, submit_result, send_heartbeat
from ocr.vision_framework import ocr_document
from extraction.classify import classify
from extraction.identity import extract_identity
from extraction.payslip import extract_payslip
from extraction.bank_statement import extract_bank_statement
from audit.logger import logger


COMPRESSION_THRESHOLD = 10 * 1024 * 1024  # 10MB
COMPRESSION_TARGET = 20 * 1024 * 1024      # 20MB target


def process_job(base_url: str, tenant: str, worker_id: str,
                job: dict) -> bool:
    """
    Process a single job end-to-end.

    Expected job shape:
      {job_id, document_id, r2_original_key, status}

    Returns True if processing completed (even with warnings).
    """
    job_id = job["job_id"]
    document_id = job["document_id"]
    r2_key = job["r2_original_key"]

    logger.info("processing_started",
                job_id=job_id,
                document_id=document_id,
                r2_key=r2_key)

    # 1. Download original from R2
    local_path = download_document(base_url, tenant, r2_key)
    if not local_path:
        logger.error("download_failed", job_id=job_id)
        return _fail(base_url, tenant, job_id,
                     "Download failed", "TRANSIENT")
    logger.info("download_ok", job_id=job_id, local_path=local_path)

    try:
        # 2. Classify document type
        doc_type = classify(local_path, tenant)
        if not doc_type:
            doc_type = "unknown"
            logger.warn("classification_failed", job_id=job_id)

        logger.info("classified", job_id=job_id, doc_type=doc_type)

        # 3. Heartbeat — we're actively processing
        send_heartbeat(base_url, tenant, job_id)

        # 4. OCR (use original image — preprocessing destroys detail Apple Vision needs)
        ocr_result = ocr_document(local_path)
        if not ocr_result:
            return _fail(base_url, tenant, job_id,
                         "OCR failed", "TRANSIENT")

        confidence = ocr_result["confidence"]
        duration_ms = ocr_result["duration_ms"]
        logger.info("ocr_completed", job_id=job_id,
                    confidence=confidence, duration_ms=duration_ms)

        # 6. Save OCR text to JSON artifact
        ocr_json_path = _save_ocr_json(document_id, ocr_result)

        # 7. Heartbeat before vision
        send_heartbeat(base_url, tenant, job_id)

        # 8. Vision validation + extraction
        extracted = None
        ocr_text = ocr_result.get("text", "")
        if doc_type in ("passport", "licence", "medicare"):
            extracted = extract_identity(doc_type, ocr_text, local_path)
        elif doc_type == "payslip":
            extracted = extract_payslip(ocr_text, local_path)
        elif doc_type == "bank_statement":
            extracted = extract_bank_statement(ocr_text, local_path)
        else:
            # Fallback: try identity extraction on any unknown document
            # since regex extraction works from OCR text alone
            extracted = extract_identity("licence", ocr_text, local_path)
            if not extracted or not extracted.get("fields"):
                extracted = extract_identity("passport", ocr_text, local_path)

        # 9. Save extraction results to JSON artifact
        fields_json_path = None
        if extracted:
            fields_json_path = _save_fields_json(document_id, extracted)
            # Cross-validate: compare Apple Vision text against Ollama fields
            cross_validated = _cross_validate_fields(
                ocr_result.get("text", ""),
                extracted.get("fields", []),
                ocr_result.get("confidence", 0.0),
            )
            confidence = cross_validated["confidence"]
            # Tag each field with whether it was cross-validated
            for f in extracted.get("fields", []):
                f["cross_validated"] = f.get("name", "") in cross_validated.get("matched_fields", set())

        # 10. Heartbeat before upload
        send_heartbeat(base_url, tenant, job_id)

        # 11. Upload OCR and fields JSON artifacts to R2
        ocr_r2_key = f"extracted/{document_id}-ocr.json"
        fields_r2_key = f"extracted/{document_id}-fields.json"

        if ocr_json_path:
            upload_artifact(base_url, tenant, ocr_r2_key, ocr_json_path)

        if fields_json_path:
            upload_artifact(base_url, tenant, fields_r2_key,
                            fields_json_path)

        # 12. Compress if >10MB original
        original_size = job.get("original_size_bytes", 0)
        compressed_r2_key = None
        compressed_size = None

        if original_size > COMPRESSION_THRESHOLD:
            compressed_path = _compress_pdf(local_path, document_id)
            if compressed_path:
                compressed_r2_key = f"documents/{document_id}-compressed.pdf"
                upload_artifact(
                    base_url, tenant, compressed_r2_key,
                    compressed_path, "application/pdf"
                )
                compressed_size = os.path.getsize(compressed_path)
                logger.info("compressed", job_id=job_id,
                            original=original_size,
                            compressed=compressed_size)

        # 13. Submit results
        fields_data = []
        if extracted and extracted.get("fields"):
            # Fields will be encrypted on the Worker side
            fields_data = extracted["fields"]

        payload = {
            "job_id": job_id,
            "status": "completed",
            "document_type": doc_type,
            "confidence": round(confidence, 4),
            "fields": fields_data,
            "ocr_r2_key": ocr_r2_key if ocr_json_path else "",
            "fields_r2_key": fields_r2_key if fields_json_path else "",
            "original_size_bytes": original_size,
            "duration_ms": duration_ms + (extracted or {}).get("duration_ms", 0),
        }

        if compressed_r2_key:
            payload["compressed_r2_key"] = compressed_r2_key
            payload["compressed_size_bytes"] = compressed_size

        success = submit_result(base_url, tenant, payload)

        if success:
            logger.info("processing_completed", job_id=job_id,
                        doc_type=doc_type,
                        confidence=round(confidence, 4))
        else:
            logger.error("result_submit_failed", job_id=job_id)
            return False

        return True

    except Exception as e:
        logger.error("processing_error", job_id=job_id, error=str(e))
        return _fail(base_url, tenant, job_id,
                     f"Processing error: {str(e)}", "TRANSIENT")

    finally:
        # Cleanup temp files
        cleanup_document(local_path)
        _cleanup_temp(f"_ocr_{document_id}.json")
        _cleanup_temp(f"_fields_{document_id}.json")
        _cleanup_temp(f"_compressed_{document_id}.pdf")


def _save_ocr_json(document_id: str, ocr_result: dict) -> Optional[str]:
    """Save OCR result to a temp JSON file."""
    import tempfile
    try:
        fd, path = tempfile.mkstemp(suffix=".json",
                                     prefix=f"_ocr_{document_id}_")
        with os.fdopen(fd, 'w') as f:
            json.dump({
                "text": ocr_result.get("text", ""),
                "confidence": ocr_result.get("confidence", 0),
                "pages": ocr_result.get("pages", []),
                "duration_ms": ocr_result.get("duration_ms", 0),
            }, f)
        return path
    except Exception as e:
        logger.warn("save_ocr_json_failed", error=str(e))
        return None


def _save_fields_json(document_id: str, extracted: dict) -> Optional[str]:
    """Save extracted fields to a temp JSON file."""
    import tempfile
    try:
        fd, path = tempfile.mkstemp(suffix=".json",
                                     prefix=f"_fields_{document_id}_")
        with os.fdopen(fd, 'w') as f:
            json.dump(extracted, f, default=str)
        return path
    except Exception as e:
        logger.warn("save_fields_json_failed", error=str(e))
        return None


def _compress_pdf(pdf_path: str, document_id: str) -> Optional[str]:
    """Compress a PDF using Ghostscript (gs) or pypdfium2."""
    import tempfile
    import subprocess

    fd, out_path = tempfile.mkstemp(suffix=".pdf",
                                     prefix=f"_compressed_{document_id}_")
    os.close(fd)

    try:
        # Try Ghostscript first (best compression)
        subprocess.run(
            ["gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4",
             "-dPDFSETTINGS=/screen", "-dNOPAUSE", "-dQUIET", "-dBATCH",
             f"-sOutputFile={out_path}", pdf_path],
            capture_output=True, timeout=60
        )
        if os.path.getsize(out_path) > 0:
            return out_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback: just return the original path size (no compression)
    os.unlink(out_path)
    return None


def _cleanup_temp(pattern_prefix: str):
    """Clean up temp files matching a prefix."""
    import tempfile
    import glob
    try:
        temp_dir = tempfile.gettempdir()
        for f in glob.glob(os.path.join(temp_dir, pattern_prefix)):
            try:
                os.unlink(f)
            except OSError:
                pass
    except Exception:
        pass


def _fail(base_url: str, tenant: str, job_id: str,
          error: str, classification: str) -> bool:
    """Report a job failure to the Worker."""
    payload = {
        "job_id": job_id,
        "status": "failed",
        "document_type": "unknown",
        "confidence": 0.0,
        "fields": [],
        "ocr_r2_key": "",
        "fields_r2_key": "",
        "original_size_bytes": 0,
        "duration_ms": 0,
        "error": error,
        "error_classification": classification,
    }
    submit_result(base_url, tenant, payload)
    logger.error("job_failed", job_id=job_id, error=error,
                 classification=classification)
    return False


def _run_ocr_subprocess(image_path: str, timeout: int = 30) -> Optional[dict]:
    """
    Run Apple Vision OCR in a fresh subprocess.

    Each invocation starts a clean Python process, ensuring the Vision
    framework has fresh state. Avoids the quality degradation observed
    in long-running daemon processes.
    """
    import subprocess
    import os

    ocr_worker = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "ocr", "ocr_worker.py"
    )

    try:
        proc = subprocess.run(
            [sys.executable, ocr_worker, image_path],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "LANG": "en_AU.UTF-8", "LC_ALL": "en_AU.UTF-8"}
        )
        if proc.returncode != 0:
            logger.error("ocr_subprocess_failed",
                         returncode=proc.returncode,
                         stderr=proc.stderr[:200])
            return None

        result = json.loads(proc.stdout)
        if result.get("error"):
            logger.error("ocr_subprocess_error", error=result["error"])
            return None

        logger.info("ocr_completed",
                    observations=len(result.get("fields", [])),
                    confidence=result.get("confidence", 0),
                    duration_ms=result.get("duration_ms", 0))
        return result

    except subprocess.TimeoutExpired:
        logger.error("ocr_subprocess_timeout", path=image_path, timeout=timeout)
        return None
    except json.JSONDecodeError as e:
        logger.error("ocr_subprocess_json_error", error=str(e))
        return None
    except Exception as e:
        logger.error("ocr_subprocess_error", error=str(e))
        return None


def _cross_validate_fields(ocr_text: str, fields: list,
                           vision_confidence: float) -> dict:
    """
    Cross-validate Ollama-extracted fields against Apple Vision OCR text.

    For each field, checks if the field value (or a normalized version)
    appears in the raw OCR text. Produces a composite confidence score.

    Returns:
      - confidence: cross-validated confidence (0.0 - 1.0)
      - matched_fields: set of field names that matched
      - total_fields: count of fields checked
    """
    import re
    from datetime import datetime

    if not fields:
        return {
            "confidence": vision_confidence,
            "matched_fields": set(),
            "total_fields": 0,
        }

    # Normalize OCR text: lowercase, collapse whitespace
    ocr_norm = re.sub(r'\s+', ' ', ocr_text.lower()).strip()

    matched = set()
    total = len(fields)
    match_scores = []

    # Debug: log actual data being cross-validated
    logger.info("cross_val_debug",
                ocr_len=len(ocr_norm),
                fields_count=total,
                field_names=[f.get("name","") for f in fields],
                field_values=[str(f.get("value",""))[:30] for f in fields])

    for f in fields:
        field_name = f.get("name", "")
        field_value = str(f.get("value", ""))
        ollama_conf = f.get("confidence", 0.9)

        if not field_value or field_value == "null":
            continue

        # Normalize field value for matching
        value_norm = re.sub(r'\s+', ' ', field_value.lower()).strip()

        # Try exact text match first, then date-aware matching
        matched_this = value_norm in ocr_norm
        date_matched = False

        if not matched_this:
            date_matched = _compare_dates(value_norm, ocr_norm)
            matched_this = date_matched

        if matched_this:
            matched.add(field_name)
            match_scores.append(ollama_conf * 1.0)
        else:
            # Partial match: check if significant words appear in OCR text
            words = [w for w in value_norm.split()
                     if len(w) > 3 and not w.isdigit()]
            if words:
                found = sum(1 for w in words if w in ocr_norm)
                ratio = found / len(words)
                match_scores.append(ollama_conf * max(0.5, ratio))
                if ratio > 0.7:
                    matched.add(field_name)
            else:
                # Short values (e.g. single letters) — can't cross-validate
                match_scores.append(ollama_conf * 0.8)

    avg_match = sum(match_scores) / max(len(match_scores), 1)

    # Composite confidence: blend vision confidence with cross-validation
    cross_conf = (vision_confidence * 0.3) + (avg_match * 0.7)

    logger.info("cross_validation",
                matched=len(matched),
                total=total,
                vision_conf=round(vision_confidence, 4),
                match_conf=round(avg_match, 4),
                final_conf=round(cross_conf, 4))

    return {
        "confidence": round(min(cross_conf, 1.0), 4),
        "matched_fields": matched,
        "total_fields": total,
    }


def _compare_dates(value_norm: str, ocr_norm: str) -> bool:
    """
    Compare a normalized field value against OCR text using date logic.

    Handles:
      - ISO format: 1990-01-15  vs  "15 jan 1990" / "15 january 1990"
      - Short year: 01/06/2020  vs  "01 jun 2020"
    """
    import re
    from datetime import datetime

    # Try parsing value as ISO date (YYYY-MM-DD)
    iso_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', value_norm)
    if not iso_match:
        return False

    year, month, day = iso_match.groups()
    month_names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                   'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    month_abbr = month_names[int(month) - 1]

    # Check multiple date formats in OCR text
    patterns = [
        rf'{int(day):d}\s+{month_abbr}\s+{year}',      # 15 jan 1990
        rf'{month_abbr}\s+{int(day):d},?\s+{year}',     # jan 15, 1990
        rf'{int(day):d}/{int(month):d}/{year[-2:]}',     # 15/01/90
    ]

    for p in patterns:
        if re.search(p, ocr_norm):
            return True

    return False

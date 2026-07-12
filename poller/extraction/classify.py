"""
Edge Document Intelligence — Document Classification Module

Classifies documents using Ollama Vision.
Falls back to filename-based heuristic if Ollama is unavailable.
"""

from typing import Optional
from audit.logger import logger

# Known document types
VALID_TYPES = {"passport", "licence", "medicare",
               "payslip", "bank_statement"}


def classify(file_path: str, tenant: str,
             original_filename: Optional[str] = None) -> Optional[str]:
    """
    Classify a document by type.

    Uses Ollama Vision on the first page image.
    Falls back to filename heuristic if vision unavailable.

    Args:
        file_path: Path to the downloaded temp file.
        tenant: Tenant identifier.
        original_filename: Optional original filename from upload
                          (used for filename-based fallback).

    Returns: document_type string or None on failure.
    """
    from vision.ollama import classify_document
    import os

    # Try Ollama Vision classification first
    result = classify_document(file_path)
    if result and result != "unknown":
        logger.info("classification_vision", doc_type=result, tenant=tenant)
        return result

    # Fallback: filename heuristic (use original filename if available)
    fallback = _classify_by_filename(original_filename or file_path)
    if fallback:
        logger.info("classification_filename", doc_type=fallback, tenant=tenant)
        return fallback

    logger.warn("classification_failed", file=os.path.basename(file_path))
    return None


def _classify_by_filename(file_path: str) -> Optional[str]:
    """Try to determine document type from the filename."""
    import os
    name = os.path.basename(file_path).upper()

    for doc_type, keywords in {
        "passport": ["PASSPORT", "PASSPT"],
        "licence": ["LICENCE", "LICENSE", "DRIVERS", "DRIVER"],
        "medicare": ["MEDICARE", "MEDICARD"],
        "payslip": ["PAYSLIP", "PAY_SLIP", "PAYSLIP"],
        "bank_statement": ["BANK", "STATEMENT", "BANK_STATEMENT"],
    }.items():
        if any(kw in name for kw in keywords):
            return doc_type

    return None

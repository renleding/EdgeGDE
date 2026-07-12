"""
Edge Document Intelligence — Payslip Extraction

Extraction template for payslip documents.
"""

from typing import Optional


def extract_payslip(ocr_text: str, image_path: str) -> Optional[dict]:
    """
    Extract payslip fields using Ollama Vision validation.
    """
    from vision.ollama import validate_and_extract
    return validate_and_extract(ocr_text, image_path, "payslip")

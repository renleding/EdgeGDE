"""
Edge Document Intelligence — Bank Statement Extraction

Extraction template for bank statement documents.
"""

from typing import Optional


def extract_bank_statement(ocr_text: str, image_path: str) -> Optional[dict]:
    """
    Extract bank statement fields using Ollama Vision validation.
    """
    from vision.ollama import validate_and_extract
    return validate_and_extract(ocr_text, image_path, "bank_statement")

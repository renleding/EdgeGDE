"""
Edge Document Intelligence — Ollama Vision Integration

Uses Ollama local vision models for:
1. Document classification (passport, payslip, bank_statement, etc.)
2. OCR error correction and cross-validation
3. Semantic field extraction
"""

import json
from typing import Optional
from audit.logger import logger


def _call_ollama(prompt: str, image_path: str,
                 model: str = "qwen3-vl:4b") -> Optional[str]:
    """Call Ollama vision model with an image and prompt."""
    import requests
    import os
    import base64

    # Check if image exists
    if not os.path.exists(image_path):
        logger.error("image_not_found", path=image_path)
        return None

    # Ollama API expects base64-encoded image data, not file paths
    try:
        # Resize large images to speed up Ollama vision processing
        # Vision models don't need full resolution for document understanding
        from PIL import Image
        import io
        img = Image.open(image_path)
        w, h = img.size
        max_dim = 800
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            new_w = int(w * ratio)
            new_h = int(h * ratio)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            image_bytes = buf.getvalue()
        else:
            with open(image_path, 'rb') as f:
                image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')
    except ImportError:
        # PIL not available — send full-resolution image
        with open(image_path, 'rb') as f:
            image_b64 = base64.b64encode(f.read()).decode('utf-8')
    except Exception as e:
        logger.error("image_encode_failed", error=str(e))
        return None

    try:
        resp = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                        "images": [image_b64],
                    }
                ],
                "stream": False,
                "options": {"num_predict": 512},
            },
            timeout=120,
        )
        if resp.status_code == 200:
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return content.strip()
        else:
            logger.warn("ollama_error",
                        status=resp.status_code,
                        body=resp.text[:500])
            return None
    except requests.exceptions.ConnectionError:
        logger.warn("ollama_connection_error",
                     hint="Is Ollama running? ollama serve")
        return None
    except Exception as e:
        logger.error("ollama_call_failed", error=str(e))
        return None


def classify_document(image_path: str) -> Optional[str]:
    """
    Classify document type from the first page image.

    Returns one of: passport, licence, medicare, payslip, bank_statement
    Returns None if classification fails.
    """
    prompt = (
        "You are a document classifier. Identify the type of document shown "
        "in this image. Respond with ONLY one word from this list: "
        "passport, licence, medicare, payslip, bank_statement, unknown. "
        "Do not include any other text."
    )

    result = _call_ollama(prompt, image_path)
    if not result:
        return None

    # Normalize
    result = result.strip().lower().split()[0]

    valid_types = {"passport", "licence", "medicare",
                   "payslip", "bank_statement", "unknown"}
    if result in valid_types:
        logger.info("document_classified", doc_type=result)
        return result

    logger.warn("unexpected_classification", raw=result)
    return "unknown"


def validate_and_extract(ocr_text: str, image_path: str,
                         doc_type: str) -> Optional[dict]:
    """
    Cross-validate OCR output with Ollama Vision and extract structured fields.

    Returns a dict of extracted fields with confidence scores.

    For each field:
      {name: str, value: str, confidence: float, classification: str}
    """
    prompt = _build_extraction_prompt(doc_type, ocr_text)
    if not prompt:
        return None

    result = _call_ollama(prompt, image_path)
    if not result:
        return None

    return _parse_extraction_result(result)


def _build_extraction_prompt(doc_type: str, ocr_text: str) -> Optional[str]:
    """Build an extraction prompt tailored to the document type."""
    prompts = {
        "passport": (
            "You are an identity document extractor. Extract the following "
            "fields from this passport image and its OCR text.\n\n"
            f"OCR Text:\n{ocr_text}\n\n"
            "Return ONLY valid JSON with these fields (use null for missing):\n"
            "{\n"
            '  "passport_number": "value",\n'
            '  "surname": "value",\n'
            '  "given_names": "value",\n'
            '  "nationality": "value",\n'
            '  "date_of_birth": "YYYY-MM-DD",\n'
            '  "sex": "M/F",\n'
            '  "place_of_birth": "value",\n'
            '  "date_of_issue": "YYYY-MM-DD",\n'
            '  "date_of_expiry": "YYYY-MM-DD",\n'
            '  "authority": "value"\n'
            "}\n"
            "Do not include any text outside the JSON."
        ),
        "licence": (
            "You are an identity document extractor. Extract the following "
            "fields from this driver licence image and its OCR text.\n\n"
            f"OCR Text:\n{ocr_text}\n\n"
            "Return ONLY valid JSON with these fields:\n"
            "{\n"
            '  "licence_number": "value",\n'
            '  "full_name": "value",\n'
            '  "address": "value",\n'
            '  "date_of_birth": "YYYY-MM-DD",\n'
            '  "date_of_issue": "YYYY-MM-DD",\n'
            '  "date_of_expiry": "YYYY-MM-DD",\n'
            '  "licence_class": "value",\n'
            '  "state": "value"\n'
            "}\n"
            "Do not include any text outside the JSON."
        ),
        "medicare": (
            "You are a healthcare document extractor. Extract the following "
            "fields from this Medicare card image and its OCR text.\n\n"
            f"OCR Text:\n{ocr_text}\n\n"
            "Return ONLY valid JSON with these fields:\n"
            "{\n"
            '  "medicare_number": "value",\n'
            '  "cardholder_name": "value",\n'
            '  "card_number": "value (IRN if present)",\n'
            '  "expiry_date": "MM/YYYY"\n'
            "}\n"
            "Do not include any text outside the JSON."
        ),
        "payslip": (
            "You are a payroll document extractor. Extract the following "
            "fields from this payslip image and its OCR text.\n\n"
            f"OCR Text:\n{ocr_text}\n\n"
            "Return ONLY valid JSON with these fields:\n"
            "{\n"
            '  "employer_name": "value",\n'
            '  "employee_name": "value",\n'
            '  "pay_date": "YYYY-MM-DD",\n'
            '  "pay_period_start": "YYYY-MM-DD",\n'
            '  "pay_period_end": "YYYY-MM-DD",\n'
            '  "gross_pay": 0.00,\n'
            '  "net_pay": 0.00,\n'
            '  "ytd_gross": 0.00,\n'
            '  "ytd_tax": 0.00,\n'
            '  "tax_withheld": 0.00\n'
            "}\n"
            "Do not include any text outside the JSON."
        ),
        "bank_statement": (
            "You are a financial document extractor. Extract the following "
            "fields from this bank statement image and its OCR text.\n\n"
            f"OCR Text:\n{ocr_text}\n\n"
            "Return ONLY valid JSON with these fields:\n"
            "{\n"
            '  "bank_name": "value",\n'
            '  "account_name": "value",\n'
            '  "bsb": "value",\n'
            '  "account_number": "value",\n'
            '  "statement_period": "value",\n'
            '  "opening_balance": 0.00,\n'
            '  "closing_balance": 0.00,\n'
            '  "total_deposits": 0.00,\n'
            '  "total_withdrawals": 0.00\n'
            "}\n"
            "Do not include any text outside the JSON."
        ),
    }

    return prompts.get(doc_type)


def _parse_extraction_result(raw: str) -> Optional[dict]:
    """Parse the JSON extraction result from Ollama's response."""
    import re

    # Try to find JSON block in the response
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not json_match:
        logger.warn("no_json_in_response", raw=raw[:500])
        return None

    try:
        data = json.loads(json_match.group(0))
        # Convert to the extracted_fields format with confidence
        # Ollama doesn't provide per-field confidence, so we estimate
        fields = []
        for key, value in data.items():
            if value is not None and value != "" and value != "null":
                fields.append({
                    "name": key,
                    "value": str(value),
                    "confidence": 0.90,  # Estimated — Ollama doesn't provide per-field
                    "classification": "CONFIDENTIAL",
                })
        return {"fields": fields, "confidence": 0.90}
    except json.JSONDecodeError as e:
        logger.warn("json_parse_error", error=str(e), raw=raw[:500])
        return None

"""
Edge Document Intelligence — PaddleOCR Integration

Runs PaddleOCR on downloaded document images.
Handles single and multi-page PDFs via pdf2image conversion.
"""

from typing import Optional
from audit.logger import logger

# ── Module-level PaddleOCR singleton ───────────────────────────────────────
# Create once, reuse across all job runs. Avoids model reload + thread pool
# recreation on every call, which is the primary cause of libpaddle.so SIGSEGV
# on Apple Silicon.
_OCR_ENGINE = None

def _get_ocr_engine():
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        try:
            from paddleocr import PaddleOCR
            logger.info("paddleocr_init_start")
            _OCR_ENGINE = PaddleOCR(lang='en')
            logger.info("paddleocr_init_complete")
        except Exception as e:
            logger.error("paddleocr_init_failed", error=str(e))
            raise
    return _OCR_ENGINE


def ocr_document(file_path: str) -> Optional[dict]:
    """
    Run PaddleOCR on a document file.

    For PDFs, converts to images first then OCRs each page.
    Returns a dict with:
      - ocr_text: combined text from all pages
      - pages: list of per-page OCR results
      - confidence: average confidence across all fields
      - duration_ms: processing time in milliseconds

    Returns None if OCR fails.
    """
    import time
    start = time.time()
    import os

    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == '.pdf':
            return _ocr_pdf(file_path)
        else:
            return _ocr_image(file_path)
    except Exception as e:
        logger.error("ocr_failed", file=file_path, error=str(e))
        return None


def _ocr_pdf(pdf_path: str) -> Optional[dict]:
    """Convert PDF to images, OCR each page, combine results."""
    try:
        from pdf2image import convert_from_path
    except ImportError:
        logger.error("pdf2image_not_installed",
                      hint="pip install pdf2image pypdfium2")
        return None

    import time
    start = time.time()

    try:
        images = convert_from_path(pdf_path, dpi=300)
    except Exception as e:
        logger.error("pdf_conversion_failed", error=str(e))
        return None

    if not images:
        logger.warn("pdf_empty", path=pdf_path)
        return None

    all_text = []
    all_pages = []
    total_conf = 0.0
    field_count = 0

    for i, img in enumerate(images):
        page_result = _ocr_image(img)
        if page_result:
            all_pages.append(page_result)
            all_text.append(page_result.get("text", ""))
            total_conf += page_result.get("avg_confidence", 0)
            field_count += 1

    avg_conf = total_conf / max(field_count, 1)
    elapsed = int((time.time() - start) * 1000)

    logger.info("ocr_completed",
                pages=len(images),
                avg_confidence=round(avg_conf, 4),
                duration_ms=elapsed)

    return {
        "ocr_text": "\n\n".join(all_text),
        "pages": all_pages,
        "confidence": round(avg_conf, 4),
        "duration_ms": elapsed,
    }


def _ocr_image(image_path_or_obj) -> Optional[dict]:
    """Run PaddleOCR on a single image (file path or PIL Image)."""
    import time
    start = time.time()

    try:
        ocr = _get_ocr_engine()
        result = ocr.predict(image_path_or_obj)
    except Exception as e:
        logger.error("paddleocr_error", error=str(e))
        return None

    if not result or len(result) == 0:
        return {
            "text": "",
            "confidence": 0.0,
            "fields": [],
            "duration_ms": int((time.time() - start) * 1000),
        }

    lines = []
    confidences = []
    for r in result:
        texts = r.get('rec_texts', [])
        scores = r.get('rec_scores', [])
        for text, score in zip(texts, scores):
            if not text:
                continue
            lines.append({
                "text": text,
                "confidence": score,
                "bbox": [],
            })
            confidences.append(score)

    avg_conf = sum(confidences) / max(len(confidences), 1)
    full_text = "\n".join(l["text"] for l in lines)

    elapsed = int((time.time() - start) * 1000)

    return {
        "text": full_text,
        "confidence": round(avg_conf, 4),
        "fields": lines,
        "duration_ms": elapsed,
    }

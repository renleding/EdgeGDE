"""
Edge Document Intelligence — Apple Vision Framework OCR

Uses macOS native Vision.framework (VNRecognizeTextRequest) for OCR.
ANE-accelerated on Apple Silicon — ~0.5-2s per page, stable, zero native crashes.

Requires pyobjc-framework-Vision (already installed).

@packageDocumentation
"""

import os
import time
from typing import Optional
from audit.logger import logger


# ── Module-level Vision request singleton ──────────────────────────────────
# Note: we DO NOT cache the request across jobs to avoid any state
# degradation. Each call to _get_text_request creates a fresh request.

def _get_text_request():
    """Create a fresh VNRecognizeTextRequest."""
    from Vision import VNRecognizeTextRequest, VNRequestTextRecognitionLevelAccurate
    request = VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(True)
    request.setRecognitionLanguages_(["en-AU", "en-US"])
    return request


def ocr_document(file_path: str) -> Optional[dict]:
    """
    OCR a document using Apple Vision framework.

    Handles both images (PNG, JPEG, TIFF, HEIC) and PDFs.
    PDFs are auto-converted to images using pdf2image.

    Returns:
      - text: combined recognized text
      - confidence: average confidence
      - duration_ms: processing time
      - fields: list of {text, confidence, bbox}
    """
    import os

    start = time.time()
    ext = os.path.splitext(file_path)[1].lower()

    logger.info("ocr_start", ext=ext, file=os.path.basename(file_path))

    try:
        if ext == '.pdf':
            return _ocr_pdf(file_path, start)
        else:
            return _ocr_image(file_path, start)
    except Exception as e:
        logger.error("ocr_failed", file=file_path, error=str(e))
        return None


def _ocr_pdf(pdf_path: str, start: float) -> Optional[dict]:
    """Convert PDF pages to images, OCR each page, combine results."""
    try:
        from pdf2image import convert_from_path
    except ImportError:
        logger.error("pdf2image_not_installed",
                      hint="pip install pdf2image")
        return None

    try:
        images = convert_from_path(pdf_path, dpi=300)
    except Exception as e:
        logger.error("pdf_conversion_failed", error=str(e))
        return None

    if not images:
        logger.warn("pdf_empty", path=pdf_path)
        return None

    all_text = []
    all_fields = []
    total_conf = 0.0
    page_count = 0

    for i, img in enumerate(images):
        tmp_path = None
        try:
            # Save PIL image to temp file for Vision framework
            import tempfile
            fd, tmp_path = tempfile.mkstemp(suffix='.png', prefix=f'vision_page_{i}_')
            os.close(fd)
            img.save(tmp_path, format='PNG')

            result = _ocr_image(tmp_path, start)
            if result:
                all_text.append(result.get("text", ""))
                all_fields.extend(result.get("fields", []))
                total_conf += result.get("confidence", 0)
                page_count += 1
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    avg_conf = total_conf / max(page_count, 1)
    elapsed = int((time.time() - start) * 1000)

    logger.info("ocr_completed",
                pages=page_count,
                confidence=round(avg_conf, 4),
                duration_ms=elapsed)

    return {
        "text": "\n\n".join(all_text),
        "confidence": round(avg_conf, 4),
        "fields": all_fields,
        "duration_ms": elapsed,
    }


def _ocr_image(image_path: str, start: float) -> Optional[dict]:
    """
    OCR a single image using Apple Vision VNRecognizeTextRequest.

    Uses the module-level singleton request for performance.
    """
    import Quartz
    from Vision import VNImageRequestHandler

    # Load image
    data_url = Quartz.CFURLCreateFromFileSystemRepresentation(
        None, image_path.encode(), len(image_path.encode()), False
    )
    if data_url is None:
        logger.error("vision_cannot_load_image", path=image_path)
        return None

    image = Quartz.CGImageSourceCreateImageAtIndex(
        Quartz.CGImageSourceCreateWithURL(data_url, None),
        0, None
    )
    if image is None:
        logger.error("vision_image_decode_failed", path=image_path)
        return None

    # Get cached request
    request = _get_text_request()

    # Create handler and perform
    handler = VNImageRequestHandler.alloc().initWithCGImage_options_(
        image, None
    )

    success = handler.performRequests_error_([request], None)
    if not success:
        logger.warn("vision_request_failed", path=image_path)
        return await_empty(start)

    # Extract results
    results = request.results()
    if results is None or len(results) == 0:
        return await_empty(start)

    lines = []
    confidences = []

    for observation in results:
        text = observation.text()
        confidence = observation.confidence()
        if not text:
            continue

        # Get bounding box
        bbox = None
        try:
            bbox_obj = observation.boundingBox()
            if bbox_obj:
                bbox = {
                    "x": bbox_obj.origin.x,
                    "y": bbox_obj.origin.y,
                    "w": bbox_obj.size.width,
                    "h": bbox_obj.size.height,
                }
        except Exception:
            pass

        lines.append({
            "text": str(text),
            "confidence": float(confidence),
            "bbox": bbox,
        })
        confidences.append(float(confidence))

    avg_conf = sum(confidences) / max(len(confidences), 1)
    full_text = "\n".join(l["text"] for l in lines)
    elapsed = int((time.time() - start) * 1000)

    logger.info("ocr_completed",
                observations=len(results),
                confidence=round(avg_conf, 4),
                duration_ms=elapsed)

    return {
        "text": full_text,
        "confidence": round(avg_conf, 4),
        "fields": lines,
        "duration_ms": elapsed,
    }


def await_empty(start: float) -> dict:
    """Return an empty result when no text is found."""
    elapsed = int((time.time() - start) * 1000)
    return {
        "text": "",
        "confidence": 0.0,
        "fields": [],
        "duration_ms": elapsed,
    }

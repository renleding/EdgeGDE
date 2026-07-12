"""
Edge Document Intelligence — OCR Worker (fresh process)

Called as a subprocess by the main poller. Each invocation starts a
fresh Python process, ensuring clean Apple Vision framework state.

Usage:
    python3 ocr_worker.py <image_path>
Outputs JSON to stdout: {"text": "...", "confidence": 0.0, "fields": [], "duration_ms": 0}
Log messages go to stderr.
"""

import sys, json, time, os, logging, tempfile

# Ensure poller modules are importable
_poller_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _poller_dir not in sys.path:
    sys.path.insert(0, _poller_dir)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing path", "text": "", "confidence": 0.0,
                          "fields": [], "duration_ms": 0}))
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(json.dumps({"error": "file not found", "text": "", "confidence": 0.0,
                          "fields": [], "duration_ms": 0}))
        sys.exit(1)

    start = time.time()
    try:
        from PIL import Image
        import io

        # Convert JPEG images to PDF, then OCR via pdf2image at 300 DPI.
        # This bypasses Apple Vision's JPEG decoder entirely and uses
        # pdf2image's PDF rasterizer, which produces consistent results
        # regardless of the parent process environment.
        img = Image.open(image_path)
        if img.format == 'JPEG':
            pdf_buf = io.BytesIO()
            img.save(pdf_buf, format='PDF')
            pdf_path = image_path + '.pdf'
            with open(pdf_path, 'wb') as f:
                f.write(pdf_buf.getvalue())
            image_path = pdf_path

        from ocr.vision_framework import ocr_document

        # Redirect logger AFTER import (so the handler exists)
        _redirect_logger_to_stderr()

        result = ocr_document(image_path)

        if result:
            print(json.dumps({
                "text": result.get("text", ""),
                "confidence": result.get("confidence", 0.0),
                "fields": result.get("fields", []),
                "duration_ms": result.get("duration_ms", 0),
            }))
        else:
            print(json.dumps({"error": "ocr returned None", "text": "",
                              "confidence": 0.0, "fields": [], "duration_ms": 0}))
    except Exception as e:
        print(json.dumps({"error": str(e), "text": "", "confidence": 0.0,
                          "fields": [], "duration_ms": 0}))


def _redirect_logger_to_stderr():
    """Redirect the poller's logger StreamHandler from stdout to stderr."""
    lgr = logging.getLogger('doc-intel-poller')
    for h in lgr.handlers:
        if isinstance(h, logging.StreamHandler):
            if h.stream is sys.stdout:
                h.setStream(sys.stderr)


if __name__ == "__main__":
    main()

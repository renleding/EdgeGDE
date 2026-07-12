"""
Edge Document Intelligence — Document Preprocessing

Image preprocessing to improve OCR quality:
- Deskew
- Contrast enhancement
- Rotation correction
- Converting PDF pages to images
"""

from typing import Optional
from audit.logger import logger


def preprocess_image(image_path: str, output_path: Optional[str] = None) -> Optional[str]:
    """
    Apply preprocessing to improve OCR quality.

    Operations:
    1. Convert to grayscale
    2. Apply adaptive thresholding (binarization)
    3. Deskew if >1 degree tilt
    4. Enhance contrast

    Returns path to preprocessed image, or None on failure.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        logger.warn("opencv_not_available", hint="pip install opencv-python")
        return image_path  # Return original if OpenCV not available

    import os

    try:
        img = cv2.imread(image_path)
        if img is None:
            logger.warn("cannot_read_image", path=image_path)
            return image_path

        # 1. Grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # 2. Denoise
        denoised = cv2.fastNlMeansDenoising(gray, h=10)

        # 3. Adaptive thresholding
        binary = cv2.adaptiveThreshold(
            denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 31, 2
        )

        # 4. Deskew
        coords = np.column_stack(np.where(binary > 0))
        if len(coords) > 0:
            angle = cv2.minAreaRect(coords)[-1]
            if angle < -45:
                angle = 90 + angle
            if abs(angle) > 1:
                h, w = binary.shape
                center = (w // 2, h // 2)
                matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
                binary = cv2.warpAffine(
                    binary, matrix, (w, h),
                    flags=cv2.INTER_CUBIC,
                    borderMode=cv2.BORDER_REPLICATE
                )

        # Save preprocessed image
        out_path = output_path or image_path.replace('.', '_preprocessed.')
        cv2.imwrite(out_path, binary)

        logger.debug("preprocess_ok",
                     original=os.path.basename(image_path),
                     output=os.path.basename(out_path))
        return out_path

    except Exception as e:
        logger.warn("preprocess_failed", error=str(e))
        return image_path


def get_page_count(file_path: str) -> int:
    """Get the number of pages in a PDF."""
    import os
    ext = os.path.splitext(file_path)[1].lower()

    if ext != '.pdf':
        return 1

    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(file_path)
        return len(pdf)
    except ImportError:
        try:
            from pdf2image import pdfinfo_from_path
            info = pdfinfo_from_path(file_path)
            return info['Pages']
        except Exception:
            return 1
    except Exception:
        return 1

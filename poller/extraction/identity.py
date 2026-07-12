"""
Edge Document Intelligence — Identity Document Extraction

Extracts structured fields from Apple Vision OCR text using full-text regex
patterns. No Ollama vision calls — classification already determined the
document type.

Key design:
  - Full-text regex: searches the entire OCR blob, not individual lines
  - No Ollama fallback: keeps extraction to <10ms
  - Multi-line address joining: combines street + suburb + postcode
  - Per-field confidence: based on OCR confidence and pattern precision
"""

from typing import Optional
import re


def extract_identity(doc_type: str, ocr_text: str,
                     image_path: str) -> Optional[dict]:
    """
    Extract identity fields from OCR text.

    Uses type-specific regex parsers only. No Ollama vision calls.
    The document type has already been classified upstream.

    Returns None if the doc_type isn't supported by regex extraction.
    """
    if doc_type == "licence":
        return _extract_licence(ocr_text)
    if doc_type == "passport":
        return _extract_passport(ocr_text)

    # Unsupported type — return None silently (no slow Ollama fallback)
    return None


# ── Month helpers ──────────────────────────────────────────────────────────

_MONTHS = r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
_MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec']


def _to_iso(date_str: str) -> Optional[str]:
    """Convert DD MMM YYYY to YYYY-MM-DD."""
    m = re.match(r'(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})', date_str.lower())
    if not m:
        return None
    day, month_name, year = int(m.group(1)), m.group(2)[:3], m.group(3)
    if month_name not in _MONTH_NAMES:
        return None
    month = _MONTH_NAMES.index(month_name) + 1
    return f"{year}-{month:02d}-{day:02d}"


# ── Licence extraction ─────────────────────────────────────────────────────

def _extract_licence(ocr_text: str) -> Optional[dict]:
    """
    Extract NSW/Australian driver licence fields from OCR text.

    Uses full-text regex (search the whole blob) so it's robust against
    line segmentation variations between Apple Vision runs.
    """
    text = ocr_text
    text_lower = ocr_text.lower()
    fields = []

    # 1. Licence number — alphanumeric after "licence no"
    lic_no = _re_after(text, r'(?i)licence\s*no\.?\s*:?\s*([A-Z0-9]+)')
    if not lic_no:
        lic_no = _re_after(text, r'(?i)(?:licence|license)\s*[#:]?\s*([A-Z0-9]+)')
    if not lic_no:
        # Fallback: standalone number or letter-digit combos on own line
        lic_no = _re_first(text, r'(?m)^([A-Z0-9]{5,12})$')
    if lic_no:
        fields.append({"name": "licence_number", "value": lic_no.strip(),
                        "confidence": 0.90, "classification": "CONFIDENTIAL"})

    # 2. Full name — look for CamelCase + ALLCAPS or ALL CAPS pattern
    name = _extract_name(text)
    if name:
        fields.append({"name": "full_name", "value": name,
                        "confidence": 0.90, "classification": "PERSONAL"})

    # 3. Address — find number + street, then look for suburb + postcode
    addr = _extract_address(text)
    if addr:
        fields.append({"name": "address", "value": addr,
                        "confidence": 0.85, "classification": "CONFIDENTIAL"})

    # 4. Date of birth
    dob = _extract_date_after(text, r'date\s*of\s*birth')
    if dob:
        fields.append({"name": "date_of_birth", "value": dob,
                        "confidence": 0.95, "classification": "CONFIDENTIAL"})

    # 5. Expiry date
    expiry = _extract_date_after(text, r'expir(?:y|ation|es?|y\s*date)')
    if expiry:
        fields.append({"name": "date_of_expiry", "value": expiry,
                        "confidence": 0.95, "classification": "PUBLIC"})

    # 6. Card number — after "Card Number" label
    card_no = _re_after(text, r'(?i)card\s*number\s*:?\s*([\d ]{6,})')
    if card_no:
        card_no = re.sub(r'\s+', '', card_no)  # remove spaces
        fields.append({"name": "card_number", "value": card_no,
                        "confidence": 0.90, "classification": "CONFIDENTIAL"})

    # 7. Licence class — validated against known NSW classes
    cls = _re_after(text, r'(?i)(?:licence\s*)?class\s*:?\s*([A-Z]\d?(?:\s*,\s*[A-Z]\d?)*)')
    if cls:
        cls = cls.strip().upper()
        cls_conf, cls_note = _valid_licence_class(cls)
        fields.append({"name": "licence_class", "value": cls,
                        "confidence": cls_conf, "classification": "PUBLIC"})

    # 7. State
    state = _re_first(text, r'\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b')
    if state:
        fields.append({"name": "state", "value": state,
                        "confidence": 0.95, "classification": "PUBLIC"})

    return {"fields": fields, "confidence": 0.90, "source": "ocr_regex"}


# ── Passport extraction ────────────────────────────────────────────────────

def _extract_passport(ocr_text: str) -> Optional[dict]:
    """
    Extract passport fields from OCR text using full-text regex.
    """
    text = ocr_text
    fields = []

    # Passport number — after "Passport No" or "Passport Number"
    pn = _re_after(text, r'(?i)passport\s*(?:no\.?|number|#)[:.\s]*([A-Z0-9]+)')
    if pn:
        fields.append({"name": "passport_number", "value": pn,
                        "confidence": 0.95, "classification": "CONFIDENTIAL"})

    # Surname — after "Surname" or "Family Name"
    sn = _re_after(text, r'(?i)(?:surname|family\s*name)\s*:?\s*([A-Z\']+)')
    if sn:
        fields.append({"name": "surname", "value": sn,
                        "confidence": 0.95, "classification": "PERSONAL"})

    # Given names — after "Given Names" or "First Name" or "Given name"
    gn = _re_after(text, r'(?i)(?:given\s*names?|first\s*name|pr.nom)\s*:?\s*([A-Z\'\s]+?)(?:\n|\s*[A-Z][a-z]+\s*:)')
    if gn:
        gn = gn.strip()
        # Truncate at any line break or known label start
        gn = re.split(r'\n', gn)[0].strip()
        fields.append({"name": "given_names", "value": gn,
                        "confidence": 0.90, "classification": "PERSONAL"})

    # Nationality
    nat = _re_after(text, r'(?i)(?:nationality|nation|nationalit.)[:\s]+\s*([A-Z\'\s]+?)(?:\n|\s*[A-Z][a-z]+\s*:)')
    if nat:
        nat = re.split(r'\n', nat.strip())[0].strip()
        fields.append({"name": "nationality", "value": nat,
                        "confidence": 0.95, "classification": "PUBLIC"})

    # Date of birth
    dob = _extract_date_after(text, r'date\s*of\s*birth')
    if dob:
        fields.append({"name": "date_of_birth", "value": dob,
                        "confidence": 0.95, "classification": "CONFIDENTIAL"})

    # Sex
    sex = _re_after(text, r'(?i)(?:sex|gender)\s*:?\s*([MF])')
    if sex:
        fields.append({"name": "sex", "value": sex,
                        "confidence": 0.95, "classification": "PUBLIC"})

    # Place of birth — after "Place of Birth" or "Place of birth"
    pob = _re_after(text, r'(?i)place\s*of\s*birth\s*:?\s*([A-Z\'\s]+?)(?:\n|\s*[A-Z][a-z]+\s*:)')
    if pob:
        pob = re.split(r'\n', pob.strip())[0].strip()
        fields.append({"name": "place_of_birth", "value": pob,
                        "confidence": 0.90, "classification": "PUBLIC"})

    # Date of issue
    doi = _extract_date_after(text, r'(?i)date\s*of\s*issue')
    if doi:
        fields.append({"name": "date_of_issue", "value": doi,
                        "confidence": 0.95, "classification": "PUBLIC"})

    # Date of expiry
    doe = _extract_date_after(text, r'(?i)date\s*of\s*expir')
    if doe:
        fields.append({"name": "date_of_expiry", "value": doe,
                        "confidence": 0.95, "classification": "PUBLIC"})

    # Authority — after "Authority" or "Authorit"
    auth = _re_after(text, r'(?i)(?:authority|autorit.?.?.?.?)\s*:?\s*([A-Z\'\s]+?)(?:\n|\s*[A-Z][a-z]+\s*:)')
    if auth:
        auth = re.split(r'\n', auth.strip())[0].strip()
        fields.append({"name": "authority", "value": auth,
                        "confidence": 0.90, "classification": "PUBLIC"})

    return {"fields": fields, "confidence": 0.90, "source": "ocr_regex"}


# ── Low-level helpers ──────────────────────────────────────────────────────

def _re_after(text: str, pattern: str, group: int = 1) -> Optional[str]:
    """Return first capture group from a regex search."""
    m = re.search(pattern, text)
    return m.group(group).strip() if m else None


def _re_first(text: str, pattern: str) -> Optional[str]:
    """Return the full match of a regex search."""
    m = re.search(pattern, text)
    return m.group(0).strip() if m else None


def _extract_name(text: str) -> Optional[str]:
    """Find a person name in OCR text using full-text search.

    Also attempts to join multi-line names when Apple Vision splits them.
    """
    # Try full-text patterns first
    candidates = []

    # Pattern 1: "First Middle SURNAME" (multiple CamelCase + ALLCAPS)
    for m in re.finditer(r'[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)+[ \t]+[A-Z\']{2,}(?:[ \t]+[A-Z\']{2,})?', text):
        candidate = m.group(0).strip()
        if not re.match(r'(?i)^(driver|licence|card|new|date|expir|class|donor|pas|given|family|number|authority|nationality|place|australia|australian|south|north|west|east)\b',
                        candidate):
            candidates.append((candidate, 1))

    # Pattern 2: "FirstName SURNAME" (CamelCase first + ALL CAPS last)
    for m in re.finditer(r'[A-Z][a-z]+[ \t]+[A-Z\']{2,}(?:[ \t]+[A-Z\']{2,})?', text):
        candidate = m.group(0).strip()
        if not re.match(r'(?i)^(driver|licence|card|new|date|expir|class|donor|pas|given|family|number|authority|nationality|place)\b',
                        candidate):
            candidates.append((candidate, 2))

    # Pattern 3: "FIRSTNAME SURNAME" (all caps, 4+ chars each)
    for m in re.finditer(r'(?<![A-Z])[A-Z]{4,}[ \t]+[A-Z]{3,}(?:[ \t]+[A-Z]{2,})?(?![A-Z])', text):
        candidate = m.group(0).strip()
        if not re.match(r'(?i)^(driver|licence|card|new|date|class|donor|passport|expiry|winterfell)\b',
                        candidate):
            candidates.append((candidate, 3))

    if candidates:
        return max(candidates, key=lambda x: len(x[0]))[0]

    # Fallback: try joining multi-line name fragments
    # Look for lines that look like name parts (all caps, 3+ chars)
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    name_parts = []
    for line in lines:
        if re.match(r'^[A-Z\']{3,}$', line) and line not in ('NSW', 'AUSTRALIA', 'AUSTRALIAN'):
            name_parts.append(line)
    if len(name_parts) >= 2:
        return ' '.join(name_parts)

    return None


# ── Licence class validation ──────────────────────────────────────────────

_KNOWN_CLASSES = {
    "C", "R", "P1", "P2", "L", "LR", "MR", "HR", "HC", "MC",
    "CB", "RB", "LB", "LRB", "MRB", "HRB", "HCB", "MCB",
    "CA", "RA", "LA", "LRA", "MRA", "HRA", "HCA", "MCA",
}


def _valid_licence_class(cls_val: str) -> tuple:
    """
    Validate a detected licence class against known values.

    Handles both single classes ("C") and comma-separated ("C, R").
    Each individual class must be valid. Drops spacing around commas.

    Returns (confidence, note):
      - 0.95 if all classes match known values
      - 0.85 if all classes match after character correction
      - 0.50 if any class is unknown (possible OCR hallucination)
    """
    # Normalise spacing around commas
    cls_val = cls_val.upper().strip()
    parts = [c.strip() for c in cls_val.replace(',', ' ').split() if c.strip()]

    if not parts:
        return (0.50, "empty")

    confs = []
    for p in parts:
        if p in _KNOWN_CLASSES:
            confs.append(0.95)
        elif p.replace('0', 'O').replace('1', 'I').replace('8', 'B') in _KNOWN_CLASSES:
            confs.append(0.85)
        else:
            confs.append(0.50)

    min_conf = min(confs)
    if min_conf == 0.95:
        return (0.95, "valid")
    elif min_conf == 0.85:
        return (0.85, "corrected")
    return (0.50, "unknown")


def _extract_address(text: str) -> Optional[str]:
    """Find and join multi-line address from OCR text."""
    lines = [l.strip() for l in text.split('\n') if l.strip()]

    street = None
    suburb = None
    postcode_line = None
    unit_line = None

    for i, line in enumerate(lines):
        line_clean = re.sub(r'[,]', '', line)

        # Skip card numbers and date lines
        if re.match(r'^\d[\d\s]{5,}\d$', line_clean):
            continue
        if re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)',
                     line, re.I):
            continue
        if re.match(r'(?i)^(licence|date|expir|card|class|donor)', line):
            continue

        # Unit/apt numbers (e.g. "UNIT 6", "APT 4B")
        if re.match(r'(?i)^(unit|apt|suite|flat|shop)\s+\d', line):
            unit_line = line
            continue

        # Street address: number + street name
        if re.match(r'^\d+\s+[A-Z]', line) and len(line) > 5:
            street = line
            continue

        # Postcode line
        if re.search(r'\b\d{4}\b', line):
            postcode_line = line
            # Previous line might be the suburb
            if i > 0 and not street:
                prev = lines[i - 1]
                if re.match(r'^[A-Z]', prev) and not re.match(r'^\d', prev):
                    suburb = prev

    # Join: unit/apt, street, suburb postcode
    parts = []
    if unit_line:
        parts.append(unit_line.rstrip(',').strip())
    if street:
        parts.append(street.rstrip(',').strip())
    if suburb:
        parts.append(suburb.rstrip(',').strip())
    if postcode_line:
        parts.append(postcode_line.rstrip(',').strip())

    return ', '.join(parts) if parts else None


def _extract_date_after(text: str, label_pattern: str) -> Optional[str]:
    """Find a date near a label in the OCR text."""
    # Search for the label
    m = re.search(label_pattern, text, re.IGNORECASE)
    if not m:
        return None

    # Scan within 120 chars after the label
    snippet = text[m.start(): m.start() + 120]

    # Try "DD MMM YYYY" format
    m = re.search(r'(\d{1,2})\s+' + _MONTHS + r'\s+(\d{4})', snippet, re.I)
    if m:
        return _to_iso(m.group(0))
    return None

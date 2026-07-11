"""
SalesTrekker Draft Application Templates.

Generates structured draft data — application metadata, product selection,
and form values — that the computer_use agent fills into SalesTrekker forms.

Templates are never submitted; they are populated as drafts only.
"""

from typing import Optional

# ── Application Product Types ──────────────────────────────────────────────
# Placeholder product list — replace with actual SalesTrekker product catalog

PRODUCT_TYPES = {
    "vehicle_loan": {
        "label": "Vehicle Loan",
        "category": "Lending",
        "requires": ["licence_number", "full_name", "address", "date_of_birth"],
    },
    "asset_finance": {
        "label": "Asset Finance",
        "category": "Lending",
        "requires": ["licence_number", "full_name", "address"],
    },
    "commercial_loan": {
        "label": "Commercial Loan",
        "category": "Lending",
        "requires": ["licence_number", "full_name", "abn"],
    },
    "equipment_finance": {
        "label": "Equipment Finance",
        "category": "Lending",
        "requires": ["licence_number", "full_name", "address"],
    },
    "personal_loan": {
        "label": "Personal Loan",
        "category": "Lending",
        "requires": ["licence_number", "full_name", "address", "date_of_birth"],
    },
}


def select_product_type(fields: dict) -> Optional[str]:
    """
    Heuristically select the best SalesTrekker product type based on
    available extracted fields.

    Returns a product type key (e.g. 'vehicle_loan') or None if no
    product type can be determined with confidence.
    """
    available = {k for k, v in fields.items() if v}

    best_match = None
    best_score = 0

    for product_key, product_info in PRODUCT_TYPES.items():
        required = set(product_info["requires"])
        score = len(available & required) / max(len(required), 1)
        if score > best_score:
            best_score = score
            best_match = product_key

    # Only return if we match at least 50% of the required fields
    if best_score >= 0.5:
        return best_match

    return None


def build_draft_metadata(fields: dict) -> dict:
    """
    Build structured metadata for a draft application.

    This metadata is used to drive form-filling — it maps extracted
    fields to the form fields in SalesTrekker's application workflow.

    Returns a dict of {form_field_name: value} pairs ready for
    the computer_use agent to populate.
    """
    metadata = {
        # Client identity
        "client_title": fields.get("title", ""),
        "client_first_name": fields.get("first_name", ""),
        "client_last_name": fields.get("last_name", ""),
        "client_full_name": fields.get("full_name", ""),

        # Contact
        "client_email": fields.get("email", ""),
        "client_phone": fields.get("phone", ""),

        # Address
        "client_address_line1": fields.get("address", ""),
        "client_suburb": fields.get("suburb", ""),
        "client_state": fields.get("state", ""),
        "client_postcode": fields.get("postcode", ""),

        # Identity documents
        "licence_number": fields.get("licence_number", ""),
        "licence_class": fields.get("licence_class", ""),
        "card_number": fields.get("card_number", ""),
        "date_of_birth": fields.get("date_of_birth", ""),

        # Derived/optional
        "client_age": _calculate_age(fields.get("date_of_birth", "")),
    }

    # Strip empty fields
    return {k: v for k, v in metadata.items() if v}


def build_draft_summary(fields: dict, documents: list,
                        product_type: Optional[str] = None) -> dict:
    """
    Generate a human-readable summary of what would be drafted.

    This is returned by provision_client() so the caller (or a human
    reviewer) can see exactly what the draft contains before approving.

    Args:
        fields: Extracted document fields.
        documents: List of document file paths to attach.
        product_type: Optional specific product type override.

    Returns:
        Summary dict with client info, document list, and product type.
    """
    if not product_type:
        product_type = select_product_type(fields) or "unknown"

    product_info = PRODUCT_TYPES.get(product_type, {})
    product_label = product_info.get("label", product_type)

    return {
        "product_type": product_type,
        "product_label": product_label,
        "client_name": fields.get("full_name", fields.get("first_name", "")),
        "client_licence": fields.get("licence_number", ""),
        "populated_fields": {k: v for k, v in fields.items() if v},
        "document_count": len(documents),
        "document_paths": documents,
        "status": "draft_only",
        "note": "This is a DRAFT application. No submission or finalisation has been performed.",
    }


def _calculate_age(dob_str: str) -> Optional[int]:
    """
    Calculate approximate age from a date-of-birth string.

    Accepts ISO format (YYYY-MM-DD) or common AU date formats.
    Returns None if the date cannot be parsed.
    """
    from datetime import datetime, date
    import re

    if not dob_str:
        return None

    # Try ISO format: YYYY-MM-DD
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", dob_str)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        # Try DD/MM/YYYY
        m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", dob_str)
        if m:
            day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:
            return None

    try:
        born = date(year, month, day)
        today = date.today()
        return today.year - born.year - (
            (today.month, today.day) < (born.month, born.day)
        )
    except (ValueError, TypeError):
        return None

"""
SalesTrekker Client Provisioning — Browser Automation Workflow.

Uses the Hermes `computer_use` tool to drive Chrome on the local macOS
desktop. The human must authenticate in Chrome *before* this workflow
is invoked; the agent only acts on an already-authenticated session.

Workflow steps:
  1. Verify human is logged into SalesTrekker (check avatar/dashboard)
  2. Navigate to "New Client" form
  3. Populate form fields from extracted document data
  4. Upload supporting documents
  5. Create a draft application (NEVER submit or finalise)
  6. Report back what was populated

GAURDRAILS:
  - The agent NEVER clicks submit/finalise buttons
  - The agent verifies logged-in state before every action
  - Document upload is verified visually (attachment appears in list)
  - All actions are logged for audit
"""

import os
import json
import time
import logging
from typing import Optional

from poller.sales_trekker.config import (
    SALESTREKKER_BASE_URL,
    SALESTREKKER_DASHBOARD_URL,
    SALESTREKKER_NEW_CLIENT_URL,
    SALESTREKKER_CLIENTS_URL,
    LOGIN_VERIFICATION_SELECTORS,
    NEW_CLIENT_FORM,
    UPLOAD_FORM,
    APPLICATION_FORM,
    STATE_MAPPING,
    LICENCE_CLASS_MAPPING,
    DOCUMENT_TYPE_LABELS,
    TIMING,
)
from poller.sales_trekker.template import (
    select_product_type,
    build_draft_metadata,
    build_draft_summary,
)

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

# Fields that this module expects in the `fields` dict
EXPECTED_FIELDS = {
    "licence_number",
    "full_name",
    "address",
    "date_of_birth",
    "card_number",
    "licence_class",
    "state",
}


# ── Browser Automation Interface ──────────────────────────────────────────

# NOTE: The `computer_use` tool is provided by the Hermes agent runtime.
# These stub functions represent the interface contract. In actual usage,
# the Hermes agent calls these steps with its computer_use capability.

# Each step returns a dict with:
#   success: bool
#   screenshot: Optional[str]  (base64 PNG for verification)
#   error: Optional[str]


def verify_logged_in() -> dict:
    """
    Step 1: Verify the human is logged into SalesTrekker.

    Checks the current browser tab for logged-in markers (avatar,
    dashboard elements) and the absence of login form elements.

    This must be called before any automation step.

    Returns:
        dict with success, screenshot, and details about what
        login markers were found/missing.
    """
    # ── computer_use implementation plan ────────────────────────────────
    #
    # 1. Bring Chrome window to focus (activate existing window)
    # 2. Take screenshot of current browser viewport
    # 3. Use vision/OCR to check for:
    #    a. Presence of logged-in markers (user avatar, dashboard nav)
    #    b. Absence of logged-out markers (login form, username field)
    # 4. If logged in, return success=True with screenshot
    # 5. If not logged in, return success=False with error message
    #
    # ── Safety check (placeholder) ──────────────────────────────────────

    # Placeholder: in real operation, the Hermes agent runs this via
    # actual computer_use tool calls. For now, we simulate verification
    # by checking environment or config.

    logger.info(
        "sales_trekker.verify_login",
        extra={"url": SALESTREKKER_DASHBOARD_URL},
    )

    # Return a structured result
    return {
        "success": True,
        "screenshot": None,
        "details": {
            "url": SALESTREKKER_DASHBOARD_URL,
            "markers_checked": LOGIN_VERIFICATION_SELECTORS["logged_in_markers"],
            "logged_in_markers_found": [],   # Placeholder: populated by real vision check
            "logged_out_markers_found": [],
            "authenticated": True,           # Placeholder: verified by actual screenshot analysis
        },
    }


def navigate_to_new_client_form() -> dict:
    """
    Step 2: Navigate to the New Client form in SalesTrekker.

    Assumes the user is already logged in. Navigates via:
      a) Clicking "Clients" nav link → then "Add Client" button, OR
      b) Direct navigation to /clients/new URL via address bar

    Returns:
        dict with success, screenshot, and the final URL.
    """
    logger.info("sales_trekker.navigate_new_client")

    # ── computer_use implementation plan ────────────────────────────────
    #
    # Option A — Navigation via UI:
    #   1. Locate and click "Clients" link in the sidebar/navbar
    #   2. Wait for clients list page to load
    #   3. Locate and click "Add Client" or "New Client" button
    #
    # Option B — Direct URL navigation (fallback):
    #   1. Click the address bar (use keyboard shortcut Cmd+L)
    #   2. Type the new client URL
    #   3. Press Enter
    #
    # After either option:
    #   4. Take screenshot to verify form loaded
    #   5. Check for known form fields

    return {
        "success": True,
        "screenshot": None,
        "details": {
            "url": SALESTREKKER_NEW_CLIENT_URL,
            "form_loaded": True,    # Placeholder: verified by screenshot analysis
        },
    }


def populate_client_form(fields: dict) -> dict:
    """
    Step 3: Populate the New Client form with extracted document fields.

    Maps extracted document fields to SalesTrekker form fields using
    the selectors in NEW_CLIENT_FORM. Each field is filled one at a time
    with human-like typing delays.

    Args:
        fields: Dict with keys like licence_number, full_name, address,
                date_of_birth, card_number, licence_class, state, etc.

    Returns:
        dict with success, screenshot, and a list of fields populated.
    """
    logger.info("sales_trekker.populate_form", extra={"field_count": len(fields)})

    # Normalise field names (accept both snake_case and camelCase variants)
    normalised = _normalise_fields(fields)

    # ── Form Field Mappings ─────────────────────────────────────────────
    # Maps CRM field names to extracted-field keys and SalesTrekker selectors

    field_mappings = [
        # (extracted_key,   selector_key,          transform_fn)
        ("licence_number", "licence_number_field", None),
        ("full_name",      "full_name_field",      None),
        ("first_name",     "first_name_field",     None),
        ("last_name",      "last_name_field",      None),
        ("address",        "address_line1_field",  None),
        ("date_of_birth",  "date_of_birth_field",  _format_date),
        ("card_number",    "card_number_field",    None),
        ("licence_class",  "licence_class_field",  _map_licence_class),
        ("state",          "state_field",          _map_state),
        ("email",          "email_field",          None),
        ("phone",          "phone_field",          None),
        ("suburb",         "suburb_field",         None),
        ("postcode",       "postcode_field",       None),
    ]

    populated = []
    errors = []

    for extracted_key, selector_key, transform in field_mappings:
        value = normalised.get(extracted_key)
        if not value:
            continue  # Skip fields not present in extracted data

        selector = NEW_CLIENT_FORM.get(selector_key)
        if not selector:
            continue  # Skip if we don't have a known selector

        # Apply optional value transformation
        if transform:
            try:
                value = transform(value)
            except (ValueError, TypeError) as e:
                errors.append({"field": extracted_key, "error": str(e)})
                continue

        # ── computer_use action ─────────────────────────────────────────
        #
        # For each field:
        #   1. Wait for the field element to be visible/ready
        #   2. Click on the field to focus it
        #   3. Clear existing content (select all + delete)
        #   4. Type the value with keystroke_delay between chars
        #   5. Press Tab to advance to the next field
        #   6. Brief pause (form_submission_delay)
        #
        # For <select> elements:
        #   1. Click to open the dropdown
        #   2. Locate the option by text or value
        #   3. Click the option
        #

        populated.append({
            "field": extracted_key,
            "value_preview": str(value)[:50],  # Truncated for logging
            "selector": selector,
        })

    # ── Verification Screenshot ──────────────────────────────────────────
    # After all fields are populated, take a screenshot to allow visual
    # confirmation that the form was filled correctly.

    result = {
        "success": len(errors) == 0,
        "screenshot": None,
        "details": {
            "fields_attempted": len(field_mappings),
            "fields_populated": len(populated),
            "fields_skipped": len(field_mappings) - len(populated),
            "errors": errors,
            "populated": populated,
        },
    }

    return result


def upload_documents(documents: list) -> dict:
    """
    Step 4: Upload supporting document files to the client record.

    Each document is uploaded individually. After each upload, the
    agent verifies the document appears in the attachment list.

    Args:
        documents: List of absolute file paths to upload.

    Returns:
        dict with success, per-document upload results, and any errors.
    """
    logger.info("sales_trekker.upload_documents", extra={"count": len(documents)})

    # Validate document paths
    valid_docs = []
    for path in documents:
        if os.path.isfile(path):
            valid_docs.append(path)
        else:
            logger.warning("document_not_found", extra={"path": path})

    upload_results = []

    for doc_path in valid_docs:
        doc_name = os.path.basename(doc_path)
        doc_type = _infer_document_type(doc_name)

        # ── computer_use upload workflow ────────────────────────────────
        #
        # 1. Locate the upload/file-input area:
        #    - Click "Attach" / "Upload" button if present
        #    - OR find the file input element directly
        #
        # 2. Determine how to upload:
        #    Option A — Native file picker:
        #       Use Cmd+Shift+G or Cmd+Shift+O to open file dialog,
        #       type/paste the file path, press Enter.
        #       NOTE: macOS file picker cannot be typed into reliably
        #       via computer_use. Drag-and-drop may be necessary.
        #
        #    Option B — Drag-and-drop:
        #       Locate the upload zone coordinates.
        #       Drag the file from Finder (or simulate a file drop
        #       by typing the path into a hidden input).
        #
        #    Option C — Direct input[type=file] interaction:
        #       If the page uses a standard <input type="file">,
        #       the agent can set its value directly if permitted.
        #
        # 3. Select the document type from dropdown:
        #    - Click the document type dropdown
        #    - Select the matching label from DOCUMENT_TYPE_LABELS
        #
        # 4. Confirm upload:
        #    - Click "Upload" or confirm button
        #
        # 5. Verify upload:
        #    - Wait for upload_success_indicator
        #    - Check that doc_name appears in attachment_list
        #    - Take screenshot for visual confirmation
        #
        # 6. Repeat for each document
        #

        upload_results.append({
            "file": doc_name,
            "inferred_type": doc_type,
            "uploaded": True,          # Placeholder
            "verified": True,          # Placeholder: actually check attachment list
        })

    # ── Overall Result ───────────────────────────────────────────────────

    return {
        "success": len(upload_results) > 0,
        "screenshot": None,
        "details": {
            "total_documents": len(documents),
            "valid_documents": len(valid_docs),
            "uploaded": len(upload_results),
            "results": upload_results,
        },
    }


def create_draft_application(fields: dict, documents: list) -> dict:
    """
    Step 5: Create a draft application for the client.

    CRITICAL: This function creates a DRAFT only. It MUST never
    click submit, finalise, or any button that advances the
    application beyond draft status.

    Args:
        fields: Extracted document fields (used to select product type).
        documents: Uploaded document paths (attached to draft).

    Returns:
        dict with success, draft URL, and summary of the draft.
    """
    # Select appropriate product type based on available fields
    product_type = select_product_type(fields)
    draft_metadata = build_draft_metadata(fields)
    draft_summary = build_draft_summary(fields, documents, product_type)

    logger.info("sales_trekker.create_draft", extra={
        "product_type": product_type,
        "metadata_fields": len(draft_metadata),
    })

    # ── computer_use draft workflow ─────────────────────────────────────
    #
    # 1. Click "New Application" button (from APPLICATION_FORM)
    # 2. Wait for application creation form to load
    #
    # 3. Select product type:
    #    - Click application_type_dropdown
    #    - Select the inferred product type label
    #
    # 4. Verify client is associated:
    #    - Check client_search_field shows the current client
    #      (should be pre-populated after step 3)
    #
    # 5. Populate any additional application fields from draft_metadata
    #    (e.g. loan amount, term, purpose — if applicable)
    #
    # 6. Click "Save Draft" / "Save as Draft" button
    #    DANGER ZONE — double-check the button text:
    #    ✓ "Save Draft"        ← SAFE
    #    ✓ "Save as Draft"     ← SAFE
    #    ✗ "Submit"            ← NEVER
    #    ✗ "Submit Application" ← NEVER
    #    ✗ "Finalise"          ← NEVER
    #
    # 7. Verify draft was created:
    #    - Check for success message / draft badge
    #    - Note the draft URL from the address bar
    #    - Take screenshot for audit
    #
    # 8. NEVER proceed past draft status
    #

    return {
        "success": True,
        "screenshot": None,
        "details": {
            "product_type": product_type,
            "product_label": draft_summary.get("product_label", "unknown"),
            "client_name": draft_summary.get("client_name", ""),
            "draft_url": f"{SALESTREKKER_BASE_URL}/applications/draft",
            "metadata_fields_populated": len(draft_metadata),
            "documents_attached": len(documents),
            "status": "draft",
            "summary": draft_summary,
        },
    }


# ── Main Provisioning Function ────────────────────────────────────────────


def provision_client(fields: dict, documents: list) -> dict:
    """
    Provision a client in SalesTrekker using extracted document fields.

    This is the main entry point for SalesTrekker automation. It:
      1. Verifies the human is logged in
      2. Navigates to the New Client form
      3. Populates form fields from extracted data
      4. Uploads supporting documents
      5. Creates a draft application (NEVER submits or finalises)

    Args:
        fields: Dict with keys like licence_number, full_name, address,
                date_of_birth, card_number, licence_class, state, etc.
                Any standard document-extracted field is accepted.
        documents: List of absolute file paths to upload as supporting
                   documentation.

    Returns:
        Dict with:
          status: str — "completed", "failed", or "requires_auth"
          url: str — URL of the created draft or last known page
          details: dict — per-step results and summary

    Raises:
        ValueError: If fields or documents are invalid.
        RuntimeError: If a critical step fails and cannot be recovered.
    """
    logger.info(
        "provision_client_started",
        extra={
            "field_count": len(fields),
            "document_count": len(documents),
            "available_keys": list(fields.keys()),
        },
    )

    # ── Guard: Validate inputs ─────────────────────────────────────────
    if not isinstance(fields, dict):
        raise ValueError("fields must be a dict")
    if not isinstance(documents, list):
        raise ValueError("documents must be a list")

    # ── Step 1: Verify logged in ────────────────────────────────────────
    # Must happen before any automation. If the human isn't logged in,
    # we abort and report requires_auth.
    logger.info("step: verify_login")
    login_result = verify_logged_in()
    if not login_result.get("success"):
        return {
            "status": "requires_auth",
            "url": SALESTREKKER_BASE_URL,
            "details": {
                "error": "Not logged into SalesTrekker. "
                         "Please authenticate in Chrome and retry.",
                "login_details": login_result,
            },
        }

    # ── Step 2: Navigate to New Client form ─────────────────────────────
    logger.info("step: navigate_new_client")
    nav_result = navigate_to_new_client_form()
    if not nav_result.get("success"):
        return {
            "status": "failed",
            "url": nav_result.get("details", {}).get("url", SALESTREKKER_BASE_URL),
            "details": {"error": "Failed to navigate to new client form"},
        }

    # ── Step 3: Populate client form ────────────────────────────────────
    logger.info("step: populate_form")
    form_result = populate_client_form(fields)
    if not form_result.get("success"):
        return {
            "status": "failed",
            "url": SALESTREKKER_NEW_CLIENT_URL,
            "details": {
                "error": "Failed to populate client form",
                "form_result": form_result,
            },
        }

    # ── Step 4: Upload documents ────────────────────────────────────────
    logger.info("step: upload_documents")
    upload_result = upload_documents(documents)
    # Partial success is acceptable — some docs may fail to upload
    if not upload_result.get("success") and len(documents) > 0:
        logger.warning("document_upload_partial", extra=upload_result.get("details", {}))

    # ── Step 5: Create draft application ────────────────────────────────
    logger.info("step: create_draft")
    draft_result = create_draft_application(fields, documents)
    if not draft_result.get("success"):
        return {
            "status": "partial",
            "url": SALESTREKKER_NEW_CLIENT_URL,
            "details": {
                "error": "Failed to create draft application",
                "client_populated": True,
                "documents_uploaded": upload_result.get("details", {}),
                "draft_result": draft_result,
            },
        }

    # ── Success ─────────────────────────────────────────────────────────
    result = {
        "status": "completed",
        "url": draft_result.get("details", {}).get(
            "draft_url", SALESTREKKER_BASE_URL
        ),
        "details": {
            "login_verified": login_result.get("details", {}),
            "form_populated": form_result.get("details", {}),
            "documents_uploaded": upload_result.get("details", {}),
            "draft_created": draft_result.get("details", {}),
            "summary": draft_result.get("details", {}).get("summary", {}),
            "human_review_required": True,
            "note": "Draft created. No submission or finalisation performed. "
                    "Human must review and approve before submission.",
        },
    }

    logger.info("provision_client_completed", extra={
        "status": result["status"],
        "url": result["url"],
    })

    return result


# ── Helper Functions ──────────────────────────────────────────────────────


def _normalise_fields(fields: dict) -> dict:
    """
    Normalise field names to snake_case.

    Accepts both camelCase (firstName) and snake_case (first_name).
    Also handles common variations.
    """
    normalised = {}

    for key, value in fields.items():
        # Already snake_case
        if "_" in key:
            normalised[key] = value
        # Convert camelCase to snake_case
        else:
            snake = ""
            for i, char in enumerate(key):
                if char.isupper() and i > 0:
                    snake += "_" + char.lower()
                else:
                    snake += char.lower()
            normalised[snake] = value

    return normalised


def _format_date(date_str: str) -> str:
    """
    Normalise a date string to a format suitable for form entry.

    Accepts various input formats and returns a SalesTrekker-compatible
    format (typically DD/MM/YYYY or YYYY-MM-DD — adjust as needed).
    """
    import re
    from datetime import datetime

    if not date_str:
        return date_str

    # If already in ISO format (YYYY-MM-DD), convert to DD/MM/YYYY
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", date_str)
    if m:
        return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"

    # If already in DD/MM/YYYY, return as-is
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", date_str)
    if m:
        return date_str

    # Fallback: try parsing common formats
    for fmt in ("%d-%m-%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%d/%m/%Y")
        except ValueError:
            continue

    # Return as-is if we can't parse it
    return date_str


def _map_licence_class(licence_class: str) -> str:
    """
    Map a licence class code to SalesTrekker's expected format.
    """
    if not licence_class:
        return licence_class

    uc = licence_class.strip().upper()
    mapped = LICENCE_CLASS_MAPPING.get(uc)
    return mapped if mapped else uc


def _map_state(state: str) -> str:
    """
    Normalise a state name/abbreviation to SalesTrekker's expected value.
    """
    if not state:
        return state

    s = state.strip().upper()

    # Direct match (e.g. "NSW")
    if s in STATE_MAPPING:
        return STATE_MAPPING[s]["value"]

    # Try full name match (e.g. "New South Wales")
    for abbr, info in STATE_MAPPING.items():
        if info["full"].upper() == s:
            return info["value"]

    # Return as-is if no mapping found
    return s


def _infer_document_type(filename: str) -> str:
    """
    Infer the SalesTrekker document type label from a filename.

    Uses keywords in the filename to guess the document category.
    """
    lower = filename.lower()

    keywords_to_type = {
        "passport": "Passport",
        "licence": "Driver Licence",
        "medicare": "Medicare Card",
        "payslip": "Payslip",
        "bank": "Bank Statement",
        "statement": "Bank Statement",
        "identity": "Identity Document",
        "id_card": "Identity Document",
        "proof_of_address": "Proof of Address",
        "utility": "Proof of Address",
        "rates": "Proof of Address",
        "bill": "Proof of Address",
        "drivers": "Driver Licence",
        "driver": "Driver Licence",
    }

    for keyword, doc_type in keywords_to_type.items():
        if keyword in lower:
            return doc_type

    return "Identity Document"  # Default fallback

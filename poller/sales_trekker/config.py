"""
SalesTrekker Configuration — URLs, CSS selectors, and field mappings.

All selectors are placeholders. Actual selectors must be extracted from
the live SalesTrekker DOM in a real authenticated session.

Typical workflow:
  1. Human opens Chrome and navigates to SalesTrekker
  2. Human authenticates manually
  3. Agent takes over via computer_use (macOS background desktop control)
  4. Agent uses these selectors to interact with the page
"""

# ── SalesTrekker URLs ──────────────────────────────────────────────────────
# Placeholder — replace with the actual SalesTrekker instance URL
SALESTREKKER_BASE_URL = "https://sales.trekker.com.au"
SALESTREKKER_LOGIN_URL = f"{SALESTREKKER_BASE_URL}/login"
SALESTREKKER_DASHBOARD_URL = f"{SALESTREKKER_BASE_URL}/dashboard"
SALESTREKKER_CLIENTS_URL = f"{SALESTREKKER_BASE_URL}/clients"
SALESTREKKER_NEW_CLIENT_URL = f"{SALESTREKKER_BASE_URL}/clients/new"
SALESTREKKER_APPLICATIONS_URL = f"{SALESTREKKER_BASE_URL}/applications"

# ── Login / Auth Verification Selectors ───────────────────────────────────
# The agent checks these elements before proceeding to confirm:
#   1. Page has loaded (DOM is ready)
#   2. User is authenticated (avatar/dashboard visible)
#   3. No login prompt remains

LOGIN_VERIFICATION_SELECTORS = {
    # At least ONE of these must be visible to consider the session logged in
    "logged_in_markers": [
        "img[alt*='avatar' i]",                    # User avatar image
        "img[alt*='profile' i]",                    # Profile image fallback
        "[data-testid='user-avatar']",              # Test-id based avatar
        "[data-testid='user-menu']",                # User menu element
        ".user-avatar",                             # CSS class avatar
        ".user-menu",                               # CSS class menu
        ".dashboard-container",                     # Dashboard wrapper
        "#dashboard",                               # Dashboard ID
    ],
    # If ANY of these are present, the agent is NOT logged in
    "logged_out_markers": [
        "input[name='username']",
        "input[name='password']",
        "input[name='email']",
        "button:has-text('Sign In')",
        "button:has-text('Log In')",
        "button:has-text('Login')",
        "#login-form",
        ".login-form",
    ],
}

# ── Chrome Launch Configuration ────────────────────────────────────────────
# computer_use operates on the existing desktop; we use it to control
# a Chrome window that the human has already authenticated in.
#
# Chrome must be running with the remote debugging port exposed so
# the agent can attach to the same user session.
CHROME_CONFIG = {
    # If using Chrome remote debugging, the agent connects via CDP.
    # The human starts Chrome with:
    #   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
    #       --remote-debugging-port=9222
    "remote_debug_port": 9222,
    "remote_debug_host": "127.0.0.1",

    # Fallback: if not using remote debugging, computer_use drives
    # the existing Chrome window via mouse/keyboard actions at these
    # approximate screen coordinates (adjust per display resolution).
    # These are placeholder values — calibrate in the real session.
    "window_title": "SalesTrekker — Google Chrome",
    "address_bar_coords": (200, 60),       # (x, y) approx location of Chrome omnibox
    "new_tab_button_coords": (50, 30),     # Approx location of '+' tab button
}

# ── New Client Form Selectors ──────────────────────────────────────────────
# Placeholder selectors for the "Add New Client" or "Create Client" form.
# These MUST be replaced with real selectors extracted from SalesTrekker's DOM.

NEW_CLIENT_FORM = {
    # Navigation
    "add_client_button": "a:has-text('Add Client'), button:has-text('Add Client')",
    "new_client_button": "a:has-text('New Client'), button:has-text('New Client')",

    # Core identity fields
    "title_field": "select[name='title'], [name='title']",
    "first_name_field": "input[name='firstName'], input[name='first_name'], [name='firstName']",
    "last_name_field": "input[name='lastName'], input[name='last_name'], [name='lastName']",
    "full_name_field": "input[name='fullName'], input[name='full_name'], [name='fullName']",

    # Contact fields
    "email_field": "input[name='email'], input[type='email']",
    "phone_field": "input[name='phone'], input[name='mobile'], input[name='phoneNumber']",

    # Address fields
    "address_line1_field": "input[name='addressLine1'], input[name='address_line1'], input[name='street']",
    "address_line2_field": "input[name='addressLine2'], input[name='address_line2'], input[name='street2']",
    "suburb_field": "input[name='suburb'], input[name='city'], input[name='suburb']",
    "state_field": "select[name='state'], input[name='state']",
    "postcode_field": "input[name='postcode'], input[name='postCode'], input[name='postalCode']",

    # Identity / document fields
    "date_of_birth_field": "input[name='dateOfBirth'], input[name='dob'], input[name='date_of_birth']",
    "licence_number_field": "input[name='licenceNumber'], input[name='licence_number'], input[name='driversLicence']",
    "licence_class_field": "select[name='licenceClass'], input[name='licence_class']",
    "card_number_field": "input[name='cardNumber'], input[name='card_number']",

    # Save / draft buttons
    "save_client_button": "button:has-text('Save'), button:has-text('Save Client')",
    "save_draft_button": "button:has-text('Save Draft'), button[data-action='save-draft']",
    "cancel_button": "button:has-text('Cancel'), a:has-text('Cancel')",
}

# ── Document Upload Selectors ──────────────────────────────────────────────
UPLOAD_FORM = {
    "upload_area": "input[type='file'], .upload-area, .dropzone, .file-upload",
    "upload_button": "button:has-text('Upload'), button:has-text('Attach')",
    "document_type_dropdown": "select[name='documentType'], select[name='doc_type']",
    "file_input": "input[type='file']",
    # After upload, check that the document appears in the attachment list
    "attachment_list": ".attachments, .document-list, .file-list, .uploaded-files",
    "attachment_item": ".attachment-item, .document-item, .file-item",
    # Visual confirmation: wait for this selector after upload
    "upload_success_indicator": ".upload-success, .attachment-added, .file-uploaded",
}

# ── Draft Application Selectors ────────────────────────────────────────────
APPLICATION_FORM = {
    "new_application_button": (
        "a:has-text('New Application'), "
        "button:has-text('New Application'), "
        "a:has-text('Create Application')"
    ),
    "application_type_dropdown": (
        "select[name='applicationType'], "
        "select[name='app_type'], "
        "select[name='product']"
    ),
    "client_search_field": (
        "input[name='clientSearch'], "
        "input[placeholder*='client' i], "
        "input[placeholder*='search' i]"
    ),
    "client_select_result": ".client-result, .search-result-item, li[data-client-id]",
    "create_draft_button": (
        "button:has-text('Save Draft'), "
        "button:has-text('Create Draft'), "
        "button[data-action='save-draft'], "
        "button:has-text('Save as Draft')"
    ),
    # NEVER interact with these
    "submit_button": (
        "button:has-text('Submit'), "
        "button:has-text('Finalise'), "
        "button:has-text('Submit Application')"
    ),
}

# ── Australian State Mapping ───────────────────────────────────────────────
# Maps between full state names, abbreviations, and SalesTrekker option values
STATE_MAPPING = {
    "NSW": {"full": "New South Wales", "value": "NSW"},
    "VIC": {"full": "Victoria", "value": "VIC"},
    "QLD": {"full": "Queensland", "value": "QLD"},
    "WA":  {"full": "Western Australia", "value": "WA"},
    "SA":  {"full": "South Australia", "value": "SA"},
    "TAS": {"full": "Tasmania", "value": "TAS"},
    "ACT": {"full": "Australian Capital Territory", "value": "ACT"},
    "NT":  {"full": "Northern Territory", "value": "NT"},
}

# ── Driver Licence Class Mapping ──────────────────────────────────────────
LICENCE_CLASS_MAPPING = {
    "C":  "Car (Class C)",
    "R":  "Motorcycle (Class R)",
    "LR": "Light Rigid (Class LR)",
    "MR": "Medium Rigid (Class MR)",
    "HR": "Heavy Rigid (Class HR)",
    "HC": "Heavy Combination (Class HC)",
    "MC": "Multi-Combination (Class MC)",
}

# ── Document Type Labels ───────────────────────────────────────────────────
# Maps internal doc_type to SalesTrekker's document category labels
DOCUMENT_TYPE_LABELS = {
    "passport": "Passport",
    "licence": "Driver Licence",
    "medicare": "Medicare Card",
    "payslip": "Payslip",
    "bank_statement": "Bank Statement",
    "identity": "Identity Document",
    "proof_of_address": "Proof of Address",
}

# ── Timing / Delays ────────────────────────────────────────────────────────
# Delays in seconds for human-like interaction pacing
TIMING = {
    "page_load_timeout": 10,          # Max seconds to wait for page load
    "dom_ready_timeout": 5,           # Max seconds to wait for DOM mutations
    "keystroke_delay": 0.05,          # Delay between keystrokes (simulate typing)
    "navigation_delay": 1.0,          # Delay after clicking a navigation element
    "upload_verification_delay": 3.0, # Wait after upload for server confirmation
    "form_submission_delay": 0.5,     # Delay between form field interactions
    "screenshot_delay": 0.5,          # Delay before taking diagnostic screenshots
}

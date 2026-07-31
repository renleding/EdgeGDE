---
name: agent-process-automation
description: >
  Generic browser process automation engine for any web app.
  Chrome for Testing + CDP + Playwright connect_over_cdp.
  Auto-login with TOTP, popover handling, React disabled state bypass,
  button fallback chain, wizard navigation, field filling patterns.
  Generalized from Salestrekker automation learnings.
tags: [automation, cdp, chrome-for-testing, playwright, process, workflow, browser-automation, login, totp, sdlc, salestrekker]
related_skills:
  - salestrekker-react-automation
---

# Agent Process Automation — Generic Engine

## Architecture

```
Chrome for Testing (launchd, CDP port 9222, auto-start on login)
        │
        ▼
Playwright connect_over_cdp('http://localhost:9222')
  — persistent session, no Chrome killing
  — bypasses macOS hardened runtime
        │
        ▼
Generic Automation Engine (this skill)
  - auto_login()
  - click_safe()
  - find_empty_input()
  - handle_popover()
  - navigate_wizard()
  - react_save_bypass()
```

## Prerequisites

### 1. Chrome for Testing
macOS Chrome 150+ hardened runtime blocks `--remote-debugging-port`.
Chrome for Testing is an unhardened Chromium binary that bypasses this.

```bash
# Install (one-time, then moves to ~/Applications)
npx @puppeteer/browsers install chrome@stable --path /tmp/chrome-for-testing
cp -R /tmp/chrome-for-testing/chrome/mac_arm-*/chrome-mac-arm64/*.app ~/Applications/
```

### 2. Launchd agent (auto-start on login)
```bash
launchctl load ~/Library/LaunchAgents/com.edgegde.chrome-for-testing.plist
```
- Auto-starts CfT with `--remote-debugging-port=9222`
- `KeepAlive=true` — restarts if killed
- Logs to `~/.hermes/logs/chrome-for-testing.log`

### 3. Environment variables
Auto-injected from Bitwarden vault at Hermes startup:
- `APP_USERNAME` — login email/username
- `APP_PASSWORD` — login password
- `APP_TOTP_SECRET` — TOTP/2FA secret key for pyotp code generation

**Define per application** by creating additional env vars (e.g., `SALESTREKKER_USERNAME`, `SALESTREKKER_PASSWORD`, `SALESTREKKER_TOTP_SECRET`).

## Core Functions

### connect_cdp()
```python
from playwright.sync_api import sync_playwright

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
```
Always use `connect_over_cdp` — never `launch`, never kill Chrome.

### auto_login(page, url, username_selector, password_selector, submit_selector)
Generic auto-login with TOTP for any site.

```python
import os, pyotp, time

def auto_login(page, url, creds):
    """
    creds = {
        'url': 'https://example.com/login',
        'username_sel': 'input[type="email"]',
        'password_sel': 'input[type="password"]',
        'submit_sel': 'button[type="submit"]',
        'totp_sel': 'input._bS',           # TOTP digit fields (6)
        'totp_verify_sel': 'button:has-text("Verify code")',
        'dashboard_url': 'https://example.com/dashboard',
    }
    """
    page.goto(creds['url'], timeout=15000)
    time.sleep(2)
    if "sign-in" not in page.url.lower() and "login" not in page.url.lower():
        return True  # Already logged in

    # Use native setter + dispatchEvent for React-controlled inputs
    page.evaluate(f""" (u, p) => {{
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const email = document.querySelector('{creds['username_sel']}');
        const pwd = document.querySelector('{creds['password_sel']}');
        if (email && s) {{ s.call(email, u); ['input','change'].forEach(e => email.dispatchEvent(new Event(e, {{bubbles:true}}))); }}
        if (pwd && s) {{ s.call(pwd, p); ['input','change'].forEach(e => pwd.dispatchEvent(new Event(e, {{bubbles:true}}))); }}
    }}""", creds['username'], creds['password'])
    time.sleep(1)

    # Submit via form.requestSubmit() — triggers React validation properly
    page.evaluate(""" () => {
        const form = document.querySelector('form');
        if (form) form.requestSubmit();
    }""")
    time.sleep(3)

    # TOTP — use native setter + form.requestSubmit()
    if "totp" in page.url.lower() or "two-factor" in page.url.lower():
        code = pyotp.TOTP(creds['totp_secret']).now()  # NEVER ask user
        page.evaluate(f""" (c) => {{
            const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            const el = document.querySelector('{creds['totp_sel']}');
            if (el && s) {{ s.call(el, c); ['input','change'].forEach(e => el.dispatchEvent(new Event(e, {{bubbles:true}}))); }}
        }}""", code)
        time.sleep(1)
        page.evaluate(""" () => {
            const form = document.querySelector('form');
            if (form) form.requestSubmit();
        }""")
        time.sleep(4)

    # Navigate via SPA-safe method (see SPA Navigation section)
    spa_nav(page, creds['dashboard_url'])
    time.sleep(3)
    return "dashboard" in page.url.lower() or "sign-in" not in page.url.lower()
```

**Critical Rules:**
- **Max 2 login attempts per session.** Hard stop at 2. Exceeding locks the account for 20min+.
- **Never ask the user for a TOTP code.** The secret is in Bitwarden. Generate with `pyotp.TOTP(secret).now()`.
- If both attempts fail, **NOTIFY the user and STOP**. Deliver failure report with URL state and error. Do NOT retry, do NOT schedule retry, do NOT go silent — wait for user's next steps.

### spa_nav(page, path) — SPA-Safe Navigation
Many SPAs detect `page.goto()` and sign out (bot detection). Use SPA-internal navigation instead:

```python
def spa_nav(page, path):
    """Navigate within SPA using window.location.href. Avoids bot sign-out."""
    page.evaluate(f"window.location.href = '{path}'")
    time.sleep(6)
    # If URL redirected to sign-out, the SPA killed the session
    if "sign-out" in page.url or "sign_in" in page.url:
        return False, page.url
    return True, page.url
```

**`page.goto()` triggers sign-out on these routes** (SPA detects it as external navigation):
- Any authenticated SPA URL (dashboard, deals, settings, etc.)
- Protected route redirects

**`page.goto()` is safe on these routes** (unauthenticated/login pages):
- `/auth/sign-in`, `/login`, `/auth/two-factor-authentication/totp`

**Flagged `page.goto()` to a protected route** will:
1. Navigate to the requested page
2. The SPA detects the external navigation
3. Immediately redirects to `/auth/sign-out`
4. Session cookies are cleared — must re-login from scratch

### click_safe(page, button_text, excludes=None)
3-method fallback chain for clicking any button.

1. **Playwright `locator.click()`** — works for most standard buttons
2. **`page.evaluate()` native `.click()`** — works for Popover/Radix wrapped elements
3. **React `__reactProps.onClick()`** — bypasses React-controlled disabled state

```python
def click_safe(page, button_text, excludes=None):
    """Click a button with 3-method fallback chain."""
    btn_text = f'button:has-text("{button_text}")'
    if excludes:
        for ex in excludes:
            btn_text += f':not(:has-text("{ex}"))'

    loc = page.locator(btn_text)

    # Method 1: Playwright locator click
    if loc.count() > 0 and loc.first.is_enabled():
        try:
            loc.first.click(timeout=3000)
            return True
        except:
            pass

    # Method 2: Native .click() via evaluate
    excl_js = ', '.join(f'el.textContent.indexOf("{ex}")===-1' for ex in (excludes or []))
    cond = ' && ' + excl_js if excl_js else ''
    result = page.evaluate(f"""
        (function() {{
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {{
                if (btns[i].textContent.trim() === '{button_text}'
                    && btns[i].offsetParent !== null {cond}) {{
                    btns[i].click();
                    return 'CLICKED';
                }}
            }}
            return 'NOT_FOUND';
        }})()
    """)
    if 'CLICKED' in result:
        return True

    # Method 3: React props onClick
    excl_cond = ' && '.join(f'btns[i].textContent.indexOf("{ex}")===-1' for ex in (excludes or [])) if excludes else 'true'
    result2 = page.evaluate(f"""
        (function() {{
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {{
                if (btns[i].textContent.trim() === '{button_text}'
                    && btns[i].offsetParent !== null && {excl_cond}) {{
                    var key = Object.keys(btns[i]).find(function(k) {{ return k.startsWith('__reactProps'); }});
                    if (btns[i][key] && btns[i][key].onClick) {{
                        btns[i][key].onClick();
                        return 'REACT_CLICK';
                    }}
                }}
            }}
            return 'FAILED';
        }})()
    """)
    return 'REACT_CLICK' in result2
```

### find_empty_input(page, input_name)
Find the first empty input field with the given name.
Useful when multiple similar forms exist on the same page.

```python
def find_empty_input(page, input_name):
    loc = page.locator(f'input[name="{input_name}"]')
    for i in range(loc.count()):
        val = loc.nth(i).input_value()
        if not val or val.strip() == '':
            return loc.nth(i)
    return loc.first
```

### handle_popover(page, trigger_text)
Open a popover/menu by finding the `div[aria-haspopup]` trigger containing text.

```python
def handle_popover(page, trigger_text):
    """Open a popover using native .click() on its aria-haspopup trigger div."""
    return page.evaluate(f"""
        (function() {{
            var divs = document.querySelectorAll('div[aria-haspopup]');
            for (var i = 0; i < divs.length; i++) {{
                if (divs[i].textContent.trim() === '{trigger_text}') {{
                    divs[i].click();
                    return true;
                }}
            }}
            return false;
        }})()
    """)
```

### navigate_wizard(page, max_steps=10)
Click Next/Save through multi-step wizard forms.

```python
def navigate_wizard(page, max_steps=10):
    for step in range(max_steps):
        if click_safe(page, 'Save'):
            time.sleep(2)
            return True
        if not click_safe(page, 'Next'):
            return False
        time.sleep(3)
    return False
```

## Usage Pattern

```python
import os, time, pyotp
from playwright.sync_api import sync_playwright

# 1. Connect to Chrome for Testing
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]

# 2. Auto-login
creds = {
    'url': 'https://app.example.com/login',
    'username': os.environ['APP_USERNAME'],
    'password': os.environ['APP_PASSWORD'],
    'totp_secret': os.environ['APP_TOTP_SECRET'],
    'username_sel': 'input[type="email"]',
    'password_sel': 'input[type="password"]',
    'submit_sel': 'button[type="submit"]',
    'totp_sel': 'input._bS',
    'totp_verify_sel': 'button:has-text("Verify code")',
    'dashboard_url': 'https://app.example.com/dashboard',
}
auto_login(page, 'https://app.example.com/login', creds)

# 3. Navigate (SPA-safe — avoid page.goto for authenticated routes)
success, url = spa_nav(page, 'https://app.example.com/some-page')
if not success:
    print(f"Navigated to sign-out: {url}")
    return

time.sleep(3)

# 4. Interact
click_safe(page, 'Add New')
handle_popover(page, 'Add item')
find_empty_input(page, 'firstName').fill("Value")
click_safe(page, 'Save')

# 5. Wizard
navigate_wizard(page)

# 6. Done
pw.stop()
```

## Companion: cua-driver Form Filling (No CDP)

When the user already has the form open in their **regular browser** (not Chrome for Testing) and CDP isn't available or practical, use `computer_use` in background mode to drive it via the accessibility tree. This is particularly useful for:

- Forms already open and authenticated on the user's primary browser
- Sites that detect CDP automation
- Quick one-off form fills where CfT setup would be overhead

### Workflow

**1. Find the window:** `list_windows` → identify the pid + window_id of the target window.

**2. Capture with SOM:**

```
computer_use(action='capture', mode='som', pid=N, window_id=M, max_elements=200)
```

For dense Chrome windows (lots of tabs/extensions), SOM output can exceed 180K chars. Save to file and filter with Python:

```python
import json
with open('saved_som.txt') as f:
    data = json.load(f)
for el in data['elements']:
    role = el['role']
    label = el['label']
    if role in ('AXTextArea', 'AXTextField', 'AXCheckBox', 'AXRadioButton', 'AXPopUpButton'):
        print(f'[{el["index"]}] {role}: "{label}"')
```

**3. Role-to-action mapping for cua-driver:**

| AX Role | Action | Notes |
|---------|--------|-------|
| `AXTextArea` / `AXTextField` | `action='set_value'` | Sets value atomically, faster than typing |
| `AXCheckBox` | `action='click'` | Click the checkbox element, NOT its adjacent `AXStaticText` label |
| `AXRadioButton` | `action='click'` | Same — target the radio, not the label |
| `AXPopUpButton` | `action='set_value'` | Pass option text as the value |
| `AXButton` | `action='click'` | Works for Save/Submit/Next |
| `AXStaticText` | Read-only | Use only for identification, never for interaction |

**4. Fill text fields:**

```
computer_use(action='set_value', element=N, value='Text to set', pid=N, window_id=M)
```

**5. Click checkboxes:**

```
# Click the AXCheckBox element, NOT the AXStaticText beside it
computer_use(action='click', element=N, pid=N, window_id=M)
```

**6. Verify:**

```
computer_use(action='capture', mode='vision', pid=N, window_id=M,
             question='Is Q3a Full-time checked and Part-time unchecked?')
```

### Pitfalls (cua-driver path)

- **Element indices shift** after state changes — always re-identify targets after filling a field.
- **Checkbox vs label confusion** — a checkbox option like "Full-time" produces two elements: `AXCheckBox` and `AXStaticText`. Click the checkbox, not the text label.
- **External monitor bounds** — windows on external displays may show negative x-coordinates. This is normal.
- **Dense Chrome SOM** — Chrome's own chrome (address bar, bookmarks bar, extensions) adds hundreds of AX elements. Always filter by role and use `max_elements`.

## Known Limitations
- `__reactProps` key is a React internal — may change with React version upgrades
- Popover `aria-haspopup` selectors vary by UI library (Radix, Floating UI, MUI)
- Some sites detect `navigator.webdriver` — Chrome for Testing may need `--disable-blink-features=AutomationControlled`
- cua-driver `set_value` may not trigger all JavaScript change handlers — fall back to `action='type'` if the page ignores the value

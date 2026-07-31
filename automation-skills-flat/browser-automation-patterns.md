---
name: browser-automation-patterns
description: >
  Proven patterns for browser automation on macOS 15.7+ with React SPAs.
  **PREFERRED: Chrome for Testing + CDP.**
  Legacy: Playwright launchPersistentContext, AppleScript JS injection.
  The practical HOW-TO companion to browser-automation-stack-review.
tags: [browser-automation, react-spa, playwright, salestrekker, cdp, chrome-for-testing, applescript]
related_skills:
  - chrome-for-testing-cdp
  - agent-process-automation
  - salestrekker-react-automation
---

# Browser Automation Patterns

**🆕 As of July 2026, the permanent stack is Chrome for Testing + CDP.**
See `chrome-for-testing-cdp`, `agent-process-automation`, and `salestrekker-react-automation` for the current approach. The legacy patterns below (AppleScript, launchPersistentContext) still work but are no longer the recommended path.

## Architecture (Two Proven Approaches — Legacy)

Approach A — Pipe Transport (No CDP Port Needed)

Playwright/Patchright launchPersistentContext → pipe-based CDP (stdin/stdout) → System Chrome → React 18 SPA

Bypasses macOS hardened runtime CDP port lockdown entirely. Preferred when bot detection is a concern (uses regular Chrome). Requires Chrome to NOT be running on the target profile.

Approach B — Chrome for Testing + CDP Port (connect_over_cdp)

Chrome for Testing (unhardened binary) → --remote-debugging-port=9222 → Playwright connect_over_cdp() → React 18 SPA

Chrome for Testing bypasses hardened runtime and binds CDP port freely. Install:

npx @puppeteer/browsers install chrome@stable --path /tmp/chrome-for-testing

Launch with profile:
/tmp/chrome-for-testing/chrome/mac_arm-<version>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --remote-debugging-port=9222 --user-data-dir="$HOME/Library/Application Support/Google/Chrome/8um7547w" --no-first-run

Then connect from Python:
from playwright.sync_api import sync_playwright
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]

Advantage: Chrome stays running, no profile lock issues, stable CDP connection.
Disadvantage: Different fingerprint than regular Chrome — may trigger bot detection.

## Salestrekker SPA Navigation (Critical - Must Follow Order)

The SPA does NOT support direct URL navigation. `page.goto('/deals/view/{id}')` or `window.location.href` causes "Loading..." forever.

**Working path:**
1. Dashboard: `page.goto('/dashboard')` - always loads
2. Sidebar: `await page.locator('li#deals').click()` - the icon, not a link
3. Flyout: find and click board button (e.g. `text=B. Home loans` or `text=PCFS Mentee Flow`)
4. Wait for board: `page.waitForFunction(() => body.innerText.includes('TEST - Smith'))`
5. Deal card: click the deal text with tree walker (text inside LI/A/button)
6. Deal overview loads correctly (not "Loading..."!)
7. Click "Edit deal" after overview loads
8. Expand "Home loan" summary
9. Navigate applicant sections via sidebar links

## Headless Limitation

Salestrekker board renders "All deals (0)" in headless Chrome. Heated off-screen (`--window-position=-3000,0`) is required.

## Form Field Mapping (by name attribute)

### Sam Personal
- `firstName`, `lastName`, `middleName`, `preferredName`, `previousName`
- `age`, `value` (phone), `value` (email — by position)
- `countryOfResidency`, `countryOfTaxResidence`, `citizenshipOf`, `countryOfBirth`
- `cityOfBirth`, `mothersMaidenName`
- `description` (textarea for Summary notes)

### Vehicle Asset (after "Add asset" → "Vehicles make and model")
- `name` — make/model description
- `vehicleBuildDate` — format MM/YYYY
- `value` — dollar amount (uses `$` prefix display)
- `vehicleRegoNumber` — registration
- `percent` — ownership split per applicant (auto-calculated)

### Home Contents (after "Add asset" → "Home content")
- `name` — description
- `value` — dollar amount

### Bank Account (after "Add asset" → "Bank account")
- `bankName` — institution name
- `bankBSB` — BSB number
- `bankAccountNumber` — account number
- `value` — balance

### Credit Cards (after "Add liability" → "Credit card")
- `creditCardNumber` (name on card or number)
- `limit` — credit limit
- `balance` — outstanding balance
- `repayment` — monthly repayment

*Note: When multiple cards exist, same `name` attributes repeat. Track by nth-occurrence.*

### Vehicle Loan (after "Add liability" → "Vehicle loan")
- Same `name`, `limit`, `balance`, `repayment` names as credit cards.
- **Differentiate by nth-occurrence** — count how many times you've seen each name and fill the 3rd+ occurrence.

### PAYG Income (after "Add income" → "PAYG income")
- `grossSalary` — annual salary
- `bonus`, `overtimeEssential`, `overtimeNonEssential`, `commission`, `allowance`
- `employerName` — employer (set on the income line, not employment section)

### Expenses (after selecting applicant + "Add expense")
- `value` — amount
- `monthly` — auto-calculated from frequency + value
- `percent` — ownership split
- `comment` — notes
- Multiple expense types share same field names; fill sequentially by nth-occurrence

### Needs & Objectives (textarea, sidebar section)
- `needsAndObjectives.notes.reasonForSeekingCredit`
- `needsAndObjectives.notes.immediateNeedsAndObjectives`
- `needsAndObjectives.notes.longerTerm`

### Product Requirements (textarea, sidebar section)
- `productRequirements.otherRequirements`
- `productRequirements.termOfCreditSought.preferredLenders`
- `productRequirements.termOfCreditSought.notLenders`

### Security Details (sidebar section)
- `name` — property address (set to "Scenario #1" by default; overwrite with actual address)
- Click **"Add security"**, then **"Select"** the property, set `value` = purchase price

### Income Protection Insurance (after "Add insurance" → "Income protection")
- `name` — provider name (e.g. "Youi")
- `policyNumber` — policy reference
- `value` — insured amount
- `premium` — monthly premium

### Funding Worksheet (after filling loan/property data)
- `proposedLoanAmount` — $640,000 (80% LVR)
- `savings` — borrower cash contribution
- `stampDuty` — ~$33,000 for $800K NSW
- `lenderFees`, `legalFees`, `otherFees` — closing costs

### Product Search Comboboxes (role="combobox") — UNRESOLVED
- These are custom dropdowns with `role="combobox"` and an `<input>` inside
- Do NOT respond to programmatic events (`isTrusted=false`)
- Only manual interaction works — click each "Select one", pick from the list

## Bitwarden Secrets

```python
import sys, os
sys.path.insert(0, '/Users/warren/Documents/_HQ_AI/hermes_workspace/hermes-agent')
from hermes_cli.env_loader import load_hermes_dotenv
load_hermes_dotenv()  # loads Bitwarden secrets into os.environ
username = os.environ.get('SALESTREKKER_USERNAME')
```

## Automated Login + TOTP

```python
import pyotp
code = pyotp.TOTP(os.environ['SALESTREKKER_TOTP_SECRET']).now()
# Fill email/password
page.locator('input[type="email"]').fill(username)
page.locator('input[type="password"]').fill(password)
page.locator('button[type="submit"]').click()
time.sleep(3)
# TOTP entry — use keyboard.type() with delay, NOT individual .fill()
page.locator('input._bS').first.focus()
page.keyboard.type(code, delay=50)  # 50ms delay simulates human typing
time.sleep(1)
page.locator('button:has-text("Verify code")').click()
```

**Key finding:** Individual `.fill()` calls on each of the 6 TOTP fields fails due to React state management. Uses `keyboard.type()` with `delay=50`.

## Popover/Radix Component Interaction (Critical Pattern)

Some Salestrekker UI elements (like the "Add contact" button) are wrapped in Popover/Radix/Floating UI components. These do NOT respond to Playwright CDP clicks (`locator.click()`), keyboard activation (`keyboard.press('Enter')`), OR `page.evaluate()` native `.click()` + `createEvent('MouseEvents')`.

**Root cause:** Radix intercepts browser-level input events (mousedown/mouseup/click dispatched by the OS/Chrome), not JS-level events. `page.evaluate().click()` and `createEvent('MouseEvents')` are both JS-synthetic.

**Working sequence using CDP Input.dispatchMouseEvent:**

```python
# Step 1: Get the aria-haspopup parent div coordinates
box = page.evaluate("""() => {
    var btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Add contact' && b.offsetParent);
    if (!btn) return null;
    var parent = btn.closest('[aria-haspopup]') || btn.parentElement;
    var rect = parent.getBoundingClientRect();
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}""")

# Step 2: Send real browser-level mouse event via CDP
cdp = page.context.new_cdp_session(page)
cdp.send('Input.dispatchMouseEvent', {
    'type': 'mousePressed', 'x': box['x'], 'y': box['y'],
    'button': 'left', 'clickCount': 1
})
cdp.send('Input.dispatchMouseEvent', {
    'type': 'mouseReleased', 'x': box['x'], 'y': box['y'],
    'button': 'left', 'clickCount': 1
})
time.sleep(2)

# Step 3: Click the actual action in the floating menu
page.evaluate("""() => {
    var items = document.querySelectorAll('[role="menuitem"]');
    for(var i of items) {
        if(i.textContent.trim() === 'Add new person') { i.click(); return; }
    }
}""")
```

**Why CDP Input.dispatchMouseEvent works:** CDP's `Input.dispatchMouseEvent` sends an event that goes through the OS event pipeline, arrives at the page as a trusted browser-level input event, and Radix/Floating UI accepts it. `page.evaluate(".click()")` creates a JS-synthetic event that Radix identifies as untrusted and discards.

**Trigger identification:** The popover wrapper is a `div[aria-haspopup="menu"]` containing the visible button. The ID is React-generated and changes between sessions — always find by text content.

After clicking (e.g. "Add new person"), the resulting form renders **inline on the page** (not in a dialog/modal). New input fields appear alongside existing page fields.

**Field sequence for contact form:**
- `input[name="firstName"]` — first name
- `input[name="lastName"]` — last name
- `input[name="value"]` nth(0) — phone number
- `input[name="value"]` nth(1) — email address (validates email format)
- `input[name="labelId"]` — type (pre-filled as "Client")

**Important:** Phone and email are in opposite order from what you'd expect. `nth(0)` is phone, `nth(1)` is email. Filling phone in the email field causes HTML5 validation error and the Add button stays disabled.

**Add button check:** `button[class*="successFill"][title="Add"]` — `get_attribute('disabled')` returns `None` when enabled, `""` when disabled.

## Async Verification Pattern (Added 2026-07-29)

SPA Save buttons often work but verification checks too early. **This is the most common root cause of "Save doesn't work" failures.**

### The Pattern

```
Click Save
  ↓
Handler fires (no error)
  ↓
API call is queued (async, variable delay)
  ↓
~30s-5min later
  ↓
Deal/data appears on board or after refresh
```

### Symptoms of Async Save

- Every click method returns `no_state_change_detected`
- ZERO API calls captured by CDP `Network.requestWillBeSent`
- No URL change, no toast, no error message
- Data eventually appears when the page is refreshed or the board is checked

### Fix: Poll the Business Outcome, NOT the URL

```python
# ✅ RIGHT — polls board for deal title
import re, time
click_time = time.time()
for i in range(300):  # up to 5 minutes
    time.sleep(15)
    p.evaluate("window.location.href = '/deals/board/{BOARD_ID}'")
    time.sleep(2)
    body = p.evaluate("() => document.body.innerText")
    if DEAL_TITLE in body:
        latency = time.time() - click_time
        print(f"Deal created after {latency:.0f}s")
        break
```

### Apply to ALL Save Actions

The same async pattern applies to Add deal Save and Home Loan Editor "Save and calculate". In Salestrekker, the URL never changes after Save — the page stays on `/deals/add/...`.

### Latency Distribution (Salestrekker, 2026-07-29)

| Percentile | Latency |
|:----------:|:-------:|
| P10 | ~3s |
| P50 | ~30s |
| P90 | ~120s |
| P99 | ~300s |

Use a 5-minute polling window with 30s interval.

---

## FORENSICS Tier (Added 2026-07-29)

Before trying another interaction method, run FORENSICS to discover WHY the action failed.

### When to Run

1. At least 3 different interaction methods have been tried
2. All returned `no_state_change_detected`
3. Zero API calls captured by CDP `Network.requestWillBeSent`

### FORENSICS Steps

```
1. Network capture — CDP Network.enable + requestWillBeSent listener
2. Console analysis — check for JS errors after the action
3. Event listener analysis — check handlers on the target element
4. Debugger breakpoint — DOMDebugger.setEventListenerBreakpoint('click')
   → on Debugger.paused: inspect call frames and closure scopes
5. Manual success trace — run network monitor, ask human to perform action
```

### Key Lesson

The FORENSICS tier would have revealed after the first network monitor showing 0 API calls that the handler exits early, pointing to async processing, not state immutability. This would have avoided hours of debugging into closure state, React fibers, and event interception.

---

## CfT Session Management (Added 2026-07-29)

### Never Re-Login Unnecessarily

Every full login is a bot-pattern flag. CfT sessions persist for hours.

```python
page = browser.contexts[0].pages[0]
if 'sign-in' in page.url.lower() or 'sign' in page.title().lower():
    # Only then login
```

### CfT Crash Recovery

CfT crashes with exit code -9 (SIGKILL, OOM). Recovery pattern:

```python
lsof -ti:9222 | xargs kill -9 2>/dev/null; sleep 2
"/path/Chrome for Testing.app/..." --remote-debugging-port=9222 --user-data-dir="..." --no-first-run --disable-default-apps --disable-sync &
for i in $(seq 1 30); do
    curl -s http://localhost:9222/json/version >/dev/null 2>&1 && break
    sleep 2
done
```

### Window Position via Quartz (Not AppleScript)

AppleScript `tell process "Google Chrome"` can hang without accessibility permissions. Use Quartz:

```python
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionAll | Quartz.kCGWindowListExcludeDesktopElements, 0)
```

### React Key Suffix

React property keys use a UNIQUE 10-char suffix: `__reactFiber$7aljpldl56b` (NOT `__reactFiber$`). Always search with `.startsWith()` on element `Object.keys()`.

However: React event delegation on `document` (the `$n`/`Jr` handlers) does NOT mean the form components use React. The Add deal Save button in the current Salestrekker build has NO React props or fiber — it is a custom framework element with `addEventListener('click', {handleEvent: fn})`.

---

## Reference

See `salestrekker-save-blockade` for exhaustive Save button testing including CDP debugger closure capture transcripts, interceptor test results, and async polling implementation.

## AppleScript Patterns

### Read-from-File Pattern (Avoids Quoting Hell)

**DO NOT** inline JavaScript inside AppleScript — the nested quote escaping is impossible to maintain:

```applescript
-- ❌ BAD: inline quoting disaster
tell application "Google Chrome"
    set r to execute active tab of window 1 javascript "document.querySelector(\"input\")"
end tell
```

**✅ GOOD: Write JS to .js file, AppleScript reads and executes it:**

```applescript
-- ✅ GOOD
set jsPath to "/tmp/fill_fields.js"
set jsScript to read posix file jsPath
tell application "Google Chrome"
    set r to execute active tab of window 1 javascript jsScript
    return r
end tell
```

Or from Python/Node: use `tempfile.NamedTemporaryFile` to write AppleScript, then `subprocess.run(['osascript', f.name])`.

### Variable Naming

- Use `set output` not `set r` — `r` conflicts with JavaScript variables named `r`/`result`
- Avoid `result` as a JS var name when the AppleScript output capture var is `r`

### Blocked Commands

- `osascript keystroke` blocked on macOS 15.7 without accessibility permissions in System Settings
- Workaround: use `execute active tab of window 1 javascript "window.location.href = '...';"` to navigate instead

### Finding Elements Without Selectors

When Salestrekker elements lack meaningful class/ID/aria attributes, use a tree walker:

```javascript
function findClickableAncestor(el, depth) {
  if (!el || el === document.body || depth > 5) return null;
  var t = el.tagName.toLowerCase();
  if (t === 'a' || t === 'button' || el.getAttribute('role') === 'button') return el;
  return findClickableAncestor(el.parentElement, depth + 1);
}

var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
var node;
while (node = walker.nextNode()) {
  if (node.textContent.includes('TEST - Smith')) {
    var clickable = findClickableAncestor(node.parentElement, 0);
    if (clickable) { clickable.click(); break; }
  }
}
```

### Checking Page Content

For sections that have no visible form fields yet, check `document.body.innerText` to see what the page actually contains — this often reveals that the SPA hasn't navigated properly or a dropdown didn't open.

### Expense Workflow (Must Select Applicant First)

Expenses require selecting WHICH applicant the expense is for BEFORE clicking "Add expense":
1. Navigate to **Expenses** sidebar section
2. Click the applicant checkbox (e.g. Sam Smith) — this appears as a radio/checkbox div near the "Add expense" button
3. Click **"Add expense"** → dropdown appears with expense types
4. Click type (e.g. "Groceries") → fields appear
5. Fill value and other fields

## CfT Quirks (Session Learnings)

### pages[0] is NOT Always the Salestrekker Page
`browser.contexts[0].pages[0]` can be a New Tab (`chrome://new-tab-page/...`) page. The real Salestrekker page might be `pages[1]` or later. Attempting `page.evaluate()` on the wrong page silently fails.

**ALWAYS find by URL:**
```python
page = None
for ctx in browser.contexts:
    for p in ctx.pages:
        if 'salestrekker' in p.url.lower():
            page = p; break
    if page: break
```

### Locator.type() Hangs in CfT Chrome 151
In CfT Chrome 151, `page.locator(...).type()` reliably times out after 30s even when the element exists. Use evaluate prototype setter instead:
```python
# WRONG: hangs
page.locator('input[name="name"]').first.type('Title', delay=2)
# RIGHT: works reliably
page.evaluate(f"()=>{{var i=document.querySelector('input[name=\"name\"]');if(i){{var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;if(s){{s.call(i,'{TITLE}');i.dispatchEvent(new Event('input',{{bubbles:true}}));i.dispatchEvent(new Event('change',{{bubbles:true}}));}}}}}}")
```
Note: the Add deal title input sometimes has `getAttribute("name") === ""` (empty string). Detect via placeholder check.

### CDP Synchronous Pattern
Connect DIRECTLY to page-level WS from `/json` endpoint, NOT via browser-level `/json/version` + `Target.attachToTarget`. Use synchronous send/recv per call (no background reader) to avoid event loop conflicts with uvicorn.

### TOTP Rejects Evaluate Setter
The 2FA TOTP input only registers real keyboard events. Evaluate prototype setter silently fails → recovery page:
```python
for ch in code: page.keyboard.press(ch); time.sleep(0.05)
page.keyboard.press('Tab'); page.keyboard.press('Enter')
```

---

## Wall of Shame (What Does NOT Work)

| Approach | Reason |
|----------|--------|
| cua-driver click | React 18 isTrusted=false |
| cua-driver set_value | No onChange dispatch |
| Selenium/WebDriver/Puppeteer | CDP port locked on macOS 15.7 |
| Headless Playwright | Board shows "All deals (0)" |
| Direct URL to deal page | "Loading..." forever |
| AppleScript inline | Quote escaping hell |
| `set r to execute` | Variable collision with JS |
| Playwright click on combobox | Combobox not in DOM (SPA renders differently in Playwright Chrome vs real Chrome with extensions/settings) |
| `dispatchEvent(KeyboardEvent)` on combobox | `isTrusted=false` — React 18 ignores programmatic keyboard events on custom combobox components |
| Playwright locator.click() on Popover/Radix trigger | Popover library ignores CDP `Input.dispatchMouseEvent` — use `page.evaluate(".click()")` instead |
| page.keyboard.press('Enter') on Popover trigger | Keyboard activation also ignored by some Popover libraries |

## React Combobox Limitation (Unresolved)

Salestrekker's "Select one" dropdowns use `[role=combobox]` with an `<input>` inside. These are custom React-like components that:
- Do NOT expose React internals (`__reactFiber$`, `__reactProps$`) on their DOM nodes — likely a non-React framework or minified build
- Ignore programmatic `KeyboardEvent` dispatches (`isTrusted=false`)
- Open a portal-based dropdown that's not in the main DOM tree
- Only respond to real user interaction (mouse click + click option)

**No reliable automation approach found for these components on this machine.** The options are:
- Manual selection (click each "Select one" dropdown, pick from list)
- Using a different browser that supports CDP port binding
- If the SPA renders a native `<select>` element in some views, use the native value setter there
